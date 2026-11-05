/**
 * The signed-in session as stored in `localStorage` (team decision for the MVP; the refresh token is an HttpOnly
 * cookie the browser handles, JavaScript never sees it). This module is the only place that touches the storage
 * and the only place that decides when a session transition is current or stale.
 *
 * Session *generation*: an opaque id that changes whenever a session starts or ends (every login, even of the same
 * user; logout; session lost). A token refresh of the same session does NOT change it. Every async operation that
 * started under a session remembers the generation and may only apply its result (save tokens, clear the session,
 * cache data, retry a request) if the generation is still the same.
 *
 * Storage: ONE record `{ generation, session | null }` under one key. One `setItem` is atomic, so a reader (which
 * does not take a lock) never sees a session of one generation with the id of another.
 *
 * Writes (login save, refresh, invalid-session cleanup, logout) are serialized across tabs with ONE Web Lock
 * (`navigator.locks`, name `SESSION_LOCK_NAME`). The critical section is synchronous (read, compare, write) and
 * never contains a network request. Without it the check and the write were separate steps and another tab could
 * change the session in between (a stale refresh would then overwrite a logout).
 *
 * Two layers, deliberately separate:
 * - IMMEDIATE LOCAL INVALIDATION (this tab's memory only): `clearSession()` picks the next generation at once
 *   (`pendingGeneration`), reports "signed out" to listeners and makes the readers return nothing. Every operation
 *   that started earlier carries an older generation, so when its turn in the lock comes it is rejected, even if it
 *   was queued before the logout. Nothing waits for the lock.
 * - SERIALIZED STORAGE UPDATE (shared): the same logout then writes `{ pendingGeneration, null }` under the lock,
 *   retrying the lock if it times out; this tab stays signed out until that write succeeded.
 *
 * Without Web Locks (old browsers, insecure origins, some sandboxes) the same code runs without the lock: every
 * guarantee WITHIN one tab and the consistent snapshot stay, but the cross-tab read-check-write is best-effort
 * only (a console warning says so once). `crossTabLocksAvailable()` tells which mode is active.
 */

export interface SessionUser {
  id: string;
  email: string;
  phone: string | null;
}

export interface Session {
  accessToken: string;
  /** ISO date-time from `AuthPayload.accessTokenExpiresAt`. */
  accessTokenExpiresAt: string;
  user: SessionUser;
}

export interface SessionChange {
  session: Session | null;
  /** Another user (or nobody) now: private cached data must go. `false` for a token refresh of the same user. */
  identityChanged: boolean;
}

/** An operation started under a session that has since ended or changed owner; its result was discarded. */
export class SessionChangedError extends Error {
  constructor() {
    super('The session changed while the request was in flight');
    this.name = 'SessionChangedError';
  }
}

/** One record `{ generation, session }`, see the header comment. */
export const SESSION_STORAGE_KEY = 'wallet.session';
export const SESSION_LOCK_NAME = 'wallet.session';
/** Waiting longer than this for the lock is a failure (a hung tab); nothing is written then. */
export const SESSION_LOCK_TIMEOUT_MS = 5000;

/** The shared session could not be updated safely (no lock within the timeout, lock API failure). */
export class SessionLockError extends Error {
  constructor() {
    super('Could not update the session safely. Please try again.');
    this.name = 'SessionLockError';
  }
}

/** An access token this close to its expiry is treated as expired (clock skew, request time). */
export const EXPIRY_SKEW_MS = 30_000;

type Listener = (change: SessionChange) => void;
const listeners = new Set<Listener>();

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Strict check of persisted data: never trust what was in storage. Normalizes `phone`. */
function parseSession(value: unknown): Session | null {
  if (typeof value !== 'object' || value === null) return null;
  const { accessToken, accessTokenExpiresAt, user } = value as Record<string, unknown>;
  if (!nonEmpty(accessToken) || !nonEmpty(accessTokenExpiresAt)) return null;
  if (!Number.isFinite(Date.parse(accessTokenExpiresAt))) return null;
  if (typeof user !== 'object' || user === null) return null;
  const { id, email, phone } = user as Record<string, unknown>;
  if (!nonEmpty(id) || !nonEmpty(email)) return null;
  if (phone !== undefined && phone !== null && typeof phone !== 'string') return null;
  return { accessToken, accessTokenExpiresAt, user: { id, email, phone: phone ?? null } };
}

interface StoredRecord {
  generation: string;
  session: Session | null;
}

/** The persisted record; anything unknown or invalid counts as "signed out" (it is overwritten by the next write). */
function readRecord(): StoredRecord {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (raw !== null) {
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value === 'object' && value !== null) {
        const { generation, session } = value as Record<string, unknown>;
        if (typeof generation === 'string') {
          if (session === null) return { generation, session: null };
          const parsed = parseSession(session);
          if (parsed) return { generation, session: parsed };
        }
      }
    } catch {
      // fall through: corrupt JSON
    }
  }
  return { generation: '', session: null };
}

function writeRecord(record: StoredRecord): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(record));
}

const newGeneration = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Set by `clearSession()` from the moment of the logout until its storage write is done: this tab is signed out
 * already, whatever the storage still says. It also is the generation every later operation of this tab starts with.
 */
let pendingGeneration: string | null = null;

/**
 * Storage generations this tab's pending logout may have been waiting on: what the storage held when the logout
 * began, plus this tab's own tombstones. If the shared record carries any OTHER generation, another tab has written
 * since: that newer state must not be hidden by the local `pendingGeneration`.
 */
const pendingKnown = new Set<string>();

function endPending(): void {
  pendingGeneration = null;
  pendingKnown.clear();
}

/** The current session generation. Compare only for equality. */
export function sessionGeneration(): string {
  return pendingGeneration ?? readRecord().generation;
}

/** The stored session, or `null` when there is none, the stored value is invalid, or this tab is logging out. */
export function loadSession(): Session | null {
  return pendingGeneration === null ? readRecord().session : null;
}

export function accessToken(): string | null {
  return loadSession()?.accessToken ?? null;
}

export function isAccessTokenExpired(session: Session, now = Date.now()): boolean {
  return Date.parse(session.accessTokenExpiresAt) - now <= EXPIRY_SKEW_MS;
}

/** `true` when `navigator.locks` exists: cross-tab updates are then really serialized. */
export function crossTabLocksAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks;
}

let warnedNoLocks = false;

/**
 * Runs `critical` (synchronous: read, compare, write; NEVER a network request) exclusively across tabs.
 * Rejects with `SessionLockError` if the lock cannot be obtained in time; then `critical` did not run.
 * Without Web Locks it just runs, and that is only best-effort across tabs (see the header comment).
 */
async function withSessionLock<T>(critical: () => T): Promise<T> {
  if (!crossTabLocksAvailable()) {
    if (!warnedNoLocks) {
      warnedNoLocks = true;
      console.warn(
        'Web Locks are unavailable: cross-tab session updates are best-effort (a tab can overwrite a ' +
          'concurrent change of another tab). Use a current browser over https or localhost.',
      );
    }
    return critical();
  }
  let ran = false;
  try {
    return await navigator.locks.request(
      SESSION_LOCK_NAME,
      { signal: AbortSignal.timeout(SESSION_LOCK_TIMEOUT_MS) },
      () => {
        ran = true;
        return critical();
      },
    );
  } catch (error) {
    if (ran) throw error; // a bug inside the critical section, not a lock failure
    throw new SessionLockError();
  }
}

/** The user this tab last reported; starts from what is really persisted, so a reload is not an "identity change". */
let lastUserId: string | null =
  typeof window === 'undefined' ? null : (readRecord().session?.user.id ?? null);

let notifySeq = 0;

function notify(session: Session | null, identityChanged: boolean): void {
  lastUserId = session?.user.id ?? null;
  const seq = ++notifySeq;
  for (const listener of [...listeners]) {
    // A listener changed the session while we were notifying (e.g. logged out): that inner notification already told
    // everybody, including the listeners we have not reached yet. Telling them this older state now would leave them
    // on a stale session.
    if (seq !== notifySeq) return;
    listener({ session, identityChanged });
  }
}

/**
 * Orders this tab's pending logout against the shared record, INSIDE the lock (and on a storage event). The logout
 * began on a storage generation this tab saw (`pendingKnown`: that one and its own tombstones); it is entitled to
 * replace exactly that. If the record carries another generation, a tab committed a newer state since (a login, a
 * logout, a session loss): the logout is obsolete and the local pending state must not hide the newer record. The
 * tab then adopts what is really persisted and tells its listeners (an earlier storage event may have been ignored).
 */
function reconcilePending(current: StoredRecord): void {
  if (pendingGeneration === null || pendingKnown.has(current.generation)) return;
  endPending();
  if (current.session) notify(current.session, current.session.user.id !== lastUserId);
}

/** The shared record as seen inside the lock, with this tab's pending logout already reconciled against it. */
function currentRecord(): StoredRecord {
  const current = readRecord();
  reconcilePending(current);
  return current;
}

/** The generation operations of this tab compare with, after `currentRecord()`: the pending logout, if still valid. */
const effectiveGeneration = (record: StoredRecord) => pendingGeneration ?? record.generation;

/**
 * Starts a NEW session (a login), also for the same user, only if no session started or ended since `expected`.
 * `false` = stale, nothing was written. Rejects with `SessionLockError` if the lock failed (nothing was written).
 */
export function saveSessionIfCurrent(expected: string, session: Session): Promise<boolean> {
  return withSessionLock(() => {
    const current = currentRecord();
    if (expected !== effectiveGeneration(current)) return false;
    writeRecord({ generation: newGeneration(), session });
    // A logout of this tab that is still waiting for the lock is superseded: this record replaced the old session
    // entirely, and its late tombstone must not clear the login (`persistLogout` checks `pendingGeneration`).
    endPending();
    notify(session, (current.session?.user.id ?? null) !== session.user.id);
    return true;
  });
}

/**
 * Stores renewed tokens of the SAME session (a refresh). Written only if the generation is still `expected` and
 * the session still exists, so a refresh that lost against a logout or a newer login in any tab is dropped.
 * The generation stays the same: operations of this session remain valid. `false` = stale, nothing was written.
 *
 * A refresh may never change WHO is signed in. If the answer is for another user than the session that asked (the
 * cookie belongs to somebody else), it is refused: neither its identity nor its token is stored or announced, and,
 * because that session is still the current one (checked above, in the same critical section), it ends like a lost
 * session (`false`, listeners hear "signed out", the private cache goes). Only an explicit login can start a session.
 *
 * Rejects with `SessionLockError` if the lock failed (nothing was written, the session is untouched).
 */
export function renewSession(expected: string, session: Session): Promise<boolean> {
  return withSessionLock(() => {
    const current = currentRecord();
    if (expected !== effectiveGeneration(current) || !current.session) return false;
    if (current.session.user.id !== session.user.id) {
      writeRecord({ generation: newGeneration(), session: null });
      notify(null, true);
      return false;
    }
    writeRecord({ generation: current.generation, session });
    notify(session, false);
    return true;
  });
}

/**
 * The refresh session is over (`INVALID_REFRESH_TOKEN`): ends the local session, unless it is stale.
 * `true`  = another tab renewed the session meanwhile (the cookie is shared): it is alive, nothing was cleared.
 * `false` = cleared, or this result is stale (a logout or login happened since `startGeneration`).
 * Rejects with `SessionLockError` if the lock failed (nothing was cleared).
 */
export function clearSessionIf(
  startGeneration: string,
  tokenAtStart: string | null,
): Promise<boolean> {
  return withSessionLock(() => {
    const current = currentRecord();
    if (startGeneration !== effectiveGeneration(current)) return false;
    if (current.session && current.session.accessToken !== tokenAtStart) return true;
    writeRecord({ generation: newGeneration(), session: null });
    notify(null, true);
    return false;
  });
}

/** Pause before logout asks for the lock again after a failed attempt; doubles up to `LOGOUT_RETRY_MAX_MS`. */
const LOGOUT_RETRY_MS = 500;
const LOGOUT_RETRY_MAX_MS = 5000;

/**
 * Writes the logout of `generation` under the lock and only then ends the pending state. A lock failure (timeout:
 * another tab holds it too long, API error) is retried on the SAME lock, never bypassed: an unlocked write could be
 * overwritten by the holder, which would bring the old session back. Meanwhile this tab stays signed out
 * (`pendingGeneration`). Stops when a newer logout of this tab took over (it writes its own generation), when a login
 * superseded it (`saveSessionIfCurrent` ends the pending state), when another tab committed a newer generation
 * (`reconcilePending`: that state is adopted, never overwritten), or on a non-lock error
 * (e.g. storage failure): this tab then stays signed out in memory. Never rejects.
 */
async function persistLogout(generation: string): Promise<void> {
  // Decided inside the lock: a login accepted here, a newer logout of this tab, or a newer generation committed by
  // another tab (`reconcilePending`) make this logout obsolete; then nothing is written.
  const write = () => {
    currentRecord();
    if (pendingGeneration === generation) writeRecord({ generation, session: null });
  };
  for (let delayMs = LOGOUT_RETRY_MS; pendingGeneration === generation;) {
    try {
      await withSessionLock(write);
      break;
    } catch (error) {
      if (!(error instanceof SessionLockError)) return;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, LOGOUT_RETRY_MAX_MS);
    }
  }
  if (pendingGeneration === generation) endPending();
}

/**
 * Logout. Synchronously and in this tab only: the next generation is chosen, listeners hear "signed out", readers
 * return nothing, so every operation that started earlier is stale from now on. The shared storage is then written
 * under the lock (same generation, no session), retried until it succeeds (`persistLogout`).
 */
export function clearSession(): string {
  const generation = newGeneration();
  pendingKnown.add(readRecord().generation);
  if (pendingGeneration !== null) pendingKnown.add(pendingGeneration); // an earlier, overlapping logout of this tab
  pendingKnown.add(generation);
  pendingGeneration = generation;
  notify(null, true);
  void persistLogout(generation);
  return generation; // the identity of this logout (see `sessionIsStill`)
}

/**
 * Is `generation` still the current one, judged against the shared record (also adopting a newer generation another
 * tab committed, see `reconcilePending`)? Used by operations that are about to change the refresh cookie and must not
 * if the session they belong to has been replaced meanwhile. The generation returned by `clearSession()` stays current
 * both while its tombstone is pending and after it was written; a login or logout of any tab after it ends that.
 */
export function sessionIsStill(generation: string): boolean {
  return generation === effectiveGeneration(currentRecord());
}

/** Resolves when every session write queued so far (in this tab) has reached the storage. For tests. */
export function sessionWritesSettled(): Promise<void> {
  return withSessionLock(() => undefined).catch(() => undefined);
}

/**
 * Seeds a session without the lock and without a stale check. For tests only; production code uses
 * `saveSessionIfCurrent`.
 */
export function saveSession(session: Session): void {
  const previous = readRecord().session;
  writeRecord({ generation: newGeneration(), session });
  notify(session, (previous?.user.id ?? null) !== session.user.id);
}

/** Called after every change: login, refresh, logout, and a change made by another tab. */
export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab signed in, refreshed or signed out: follow it. Nothing here guards a write; it only updates the UI
// and the cache. While this tab is logging out it only follows a newer generation of another tab.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_STORAGE_KEY && event.key !== null) return;
    const record = readRecord();
    if (pendingGeneration !== null) {
      // Logging out: ignore changes of the same session, but a newer generation of another tab ends the logout.
      reconcilePending(record);
      return;
    }
    notify(record.session, (record.session?.user.id ?? null) !== lastUserId);
  });
}
