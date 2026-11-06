import { delay } from 'msw';
import { createStore } from '../app/store';
import { server } from '../mocks/server';
import {
  deliverStorageEvent,
  OTHER_USER,
  otherTab,
  otherTabLocked,
  signInForTest,
  storedRecord,
  TEST_USER,
  testSession,
} from '../test/auth';
import { errorResponse, newLog, refreshHandler } from '../test/graphql-handlers';
import { refreshSession } from './client';
import {
  clearSession,
  crossTabLocksAvailable,
  loadSession,
  onSessionChange,
  renewSession,
  saveSessionIfCurrent,
  SESSION_LOCK_NAME,
  SESSION_STORAGE_KEY,
  SessionLockError,
  sessionGeneration,
  sessionWritesSettled,
} from './session';

/** Every write of a non-empty session to the shared record, in order (to prove a session was never restored). */
function trackSessionWrites() {
  const real = Storage.prototype.setItem;
  const written: (string | null)[] = [];
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === SESSION_STORAGE_KEY) {
      written.push(
        (JSON.parse(value) as { session: { accessToken: string } | null }).session?.accessToken ??
          null,
      );
    }
    real.call(this, key, value);
  });
  return { written, stop: () => spy.mockRestore() };
}

/** Holds the session lock (as another tab in the middle of its write would) until `release()`. */
function holdLock() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const acquired = navigator.locks.request(SESSION_LOCK_NAME, () => held);
  return { release, done: acquired };
}

/** A second, independent instance of the session module (own module state, same storage and LockManager) = tab B. */
async function openSecondTab(): Promise<typeof import('./session')> {
  vi.resetModules();
  return import('./session');
}

describe('session writes are serialized by one lock', () => {
  it('the original race: another tab logging out while this tab refreshes is ordered, never overwritten', async () => {
    signInForTest({ expired: true });
    const expected = sessionGeneration();
    // As in the unlocked implementation, tab B logs out exactly when the refresh has read the stored record.
    // Now tab B has to take the same lock, so it runs after the refresh's critical section, not inside it.
    const realGetItem = Storage.prototype.getItem;
    let logout: Promise<unknown> | undefined;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      const value = realGetItem.call(this, key);
      if (key === SESSION_STORAGE_KEY && !logout) logout = otherTabLocked.logout();
      return value;
    });

    const renewed = await renewSession(expected, testSession());
    spy.mockRestore();
    await logout;

    expect(renewed).toBe(true); // the refresh was first in the lock order
    expect(storedRecord().session).toBeNull(); // and the logout of tab B is the last word
  });

  it("a refresh queued AFTER another tab's logout is dropped", async () => {
    signInForTest({ expired: true });
    const expected = sessionGeneration();
    const logout = otherTabLocked.logout();
    const renewing = renewSession(expected, testSession());
    await logout;

    await expect(renewing).resolves.toBe(false);
    expect(storedRecord().session).toBeNull();
  });

  it("a login queued after another tab's login is dropped (same user too)", async () => {
    signInForTest();
    const expected = sessionGeneration();
    const newer = testSession();
    const otherLogin = otherTabLocked.login(newer);
    const saving = saveSessionIfCurrent(expected, testSession());
    await otherLogin;

    await expect(saving).resolves.toBe(false);
    expect(storedRecord().session?.accessToken).toBe(newer.accessToken);
  });

  it('writes generation and session in ONE setItem (no torn snapshot)', async () => {
    signInForTest({ expired: true });
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    await renewSession(sessionGeneration(), testSession());
    await saveSessionIfCurrent(sessionGeneration(), testSession());
    clearSession();
    await sessionWritesSettled();

    expect(spy.mock.calls.map(([key]) => key)).toEqual([
      SESSION_STORAGE_KEY,
      SESSION_STORAGE_KEY,
      SESSION_STORAGE_KEY,
    ]);
    spy.mockRestore();
  });
});

describe('logout is immediate locally and never undone by a stale write', () => {
  it('signs this tab out at once, while a stale refresh holding the lock cannot restore the session', async () => {
    signInForTest({ expired: true });
    const stale = testSession(undefined, { expired: true });
    const staleExpected = sessionGeneration();
    const heard: (string | null)[] = [];
    const off = onSessionChange(({ session }) => heard.push(session?.user.id ?? null));
    const writes = trackSessionWrites();

    const lock = holdLock(); // the lock is busy: nothing can be written yet
    const refresh = renewSession(staleExpected, stale); // queued behind it, started BEFORE the logout
    clearSession();

    // Immediate local invalidation: no waiting for the lock.
    expect(loadSession()).toBeNull();
    expect(heard).toEqual([null]);
    expect(sessionGeneration()).not.toBe(staleExpected);

    lock.release();
    await lock.done;
    await expect(refresh).resolves.toBe(false); // rejected by the generation, even though it holds a place in the queue
    await sessionWritesSettled();

    expect(storedRecord().session).toBeNull();
    expect(writes.written).toEqual([null]); // the only write was the logout: the session never reappeared
    writes.stop();
    off();
  });

  it('a login started right after the logout is accepted once the logout is written', async () => {
    signInForTest();
    clearSession();
    const login = saveSessionIfCurrent(sessionGeneration(), testSession(OTHER_USER));

    await expect(login).resolves.toBe(true);
    expect(storedRecord().session?.user.id).toBe(OTHER_USER.id);
    expect(loadSession()?.user.id).toBe(OTHER_USER.id);
  });

  it('a refresh-only storage event of the same session is ignored while logging out (see F below)', async () => {
    signInForTest();
    const heard: (string | null)[] = [];
    const off = onSessionChange(({ session }) => heard.push(session?.user.id ?? null));
    const lock = holdLock();
    clearSession();
    otherTab.refresh(testSession(TEST_USER));
    deliverStorageEvent();
    lock.release();
    await sessionWritesSettled();

    expect(heard).toEqual([null]);
    expect(storedRecord().session).toBeNull();
    off();
  });
});

describe('lock failures never restore a stale session', () => {
  /** The SESSION lock fails (the cookie lock, if asked, works): what these tests are about. */
  const failLocks = () => {
    const real = navigator.locks.request.bind(navigator.locks) as (
      ...args: unknown[]
    ) => Promise<unknown>;
    return vi
      .spyOn(navigator.locks, 'request')
      .mockImplementation(((name: string, ...rest: unknown[]) =>
        name === SESSION_LOCK_NAME
          ? Promise.reject(new DOMException('no lock', 'AbortError'))
          : real(name, ...rest)) as never);
  };

  it('a refresh that cannot take the lock writes nothing and keeps the session as it was', async () => {
    signInForTest({ expired: true });
    const before = localStorage.getItem(SESSION_STORAGE_KEY);
    const log = newLog();
    server.use(refreshHandler(log));
    const spy = failLocks();

    await expect(refreshSession()).rejects.toBeInstanceOf(SessionLockError);

    spy.mockRestore();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(before);
  });

  it('INVALID_REFRESH_TOKEN with a failed lock clears nothing (it is not proven the session is over)', async () => {
    signInForTest({ expired: true });
    const before = localStorage.getItem(SESSION_STORAGE_KEY);
    server.use(refreshHandler(newLog(), async () => errorResponse('INVALID_REFRESH_TOKEN')));
    const spy = failLocks();

    await expect(refreshSession()).rejects.toBeInstanceOf(SessionLockError);

    spy.mockRestore();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(before);
  });

  it('a login that cannot take the lock is rejected and stores nothing', async () => {
    const spy = failLocks();
    await expect(saveSessionIfCurrent(sessionGeneration(), testSession())).rejects.toBeInstanceOf(
      SessionLockError,
    );
    spy.mockRestore();
    expect(loadSession()).toBeNull();
  });

  it('a logout never writes outside the lock: it keeps asking for it, stays signed out, and succeeds later', async () => {
    signInForTest();
    const before = localStorage.getItem(SESSION_STORAGE_KEY);
    const spy = failLocks();
    clearSession();
    await delay(50);

    expect(loadSession()).toBeNull(); // signed out at once and while the lock keeps failing
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe(before); // nothing written without the lock

    spy.mockRestore(); // the lock works again: the next retry persists the logout
    await vi.waitFor(() => expect(storedRecord().session).toBeNull(), { timeout: 3000 });
    expect(loadSession()).toBeNull();
  });

  it('a login accepted while the logout waits for its retry is not undone by that retry', async () => {
    signInForTest();
    const store = createStore();
    expect(store.getState().auth.user?.id).toBe(TEST_USER.id);

    const failing = failLocks();
    clearSession(); // its first attempt fails: the tombstone is not written, a retry is scheduled
    await delay(20);
    failing.mockRestore(); // the lock works again, but the retry is still waiting

    const login = testSession(OTHER_USER);
    await expect(saveSessionIfCurrent(sessionGeneration(), login)).resolves.toBe(true);
    await delay(900); // well past the retry delay: the old logout gets its turn
    await sessionWritesSettled();

    // Storage, readers and Redux all show the login; the earlier logout did not clear it.
    expect(storedRecord().session?.user.id).toBe(OTHER_USER.id);
    expect(loadSession()?.user.id).toBe(OTHER_USER.id);
    expect(store.getState().auth).toMatchObject({ status: 'authenticated', user: OTHER_USER });
  });

  it('a login that began under a pending logout is rejected when another tab persisted a newer logout', async () => {
    signInForTest();
    const store = createStore();
    const failing = failLocks();
    clearSession(); // logout A: no lock yet, so it is only pending in this tab
    await delay(20);
    failing.mockRestore();

    const generation = sessionGeneration(); // the login starts under A's pending generation
    const lock = holdLock();
    const heard: (string | null)[] = [];
    const off = onSessionChange(({ session }) => heard.push(session?.user.id ?? null));
    const otherLogout = otherTabLocked.logout(); // tab B's newer logout is queued first ...
    const login = saveSessionIfCurrent(generation, testSession(OTHER_USER)); // ... the login behind it
    lock.release();
    await otherLogout;

    await expect(login).resolves.toBe(false); // B's logout is newer: the late login must not undo it
    await delay(900); // A's own logout retry gets its turn too
    await sessionWritesSettled();

    expect(storedRecord().session).toBeNull();
    expect(loadSession()).toBeNull();
    expect(heard).not.toContain(OTHER_USER.id);
    expect(store.getState().auth).toMatchObject({ status: 'anonymous', user: null });
    off();
  });

  it('overlapping logouts of this tab: the login of the latest one is accepted, an earlier one is stale', async () => {
    signInForTest();
    const failing = failLocks();
    clearSession();
    const first = sessionGeneration();
    clearSession();
    const second = sessionGeneration();
    await delay(20);
    failing.mockRestore();

    await expect(saveSessionIfCurrent(first, testSession(OTHER_USER))).resolves.toBe(false);
    await expect(saveSessionIfCurrent(second, testSession(OTHER_USER))).resolves.toBe(true);
    await delay(900);
    await sessionWritesSettled();
    expect(storedRecord().session?.user.id).toBe(OTHER_USER.id);
    expect(loadSession()?.user.id).toBe(OTHER_USER.id);
  });

  it("C: a login committed by another tab is NOT erased by this tab's older pending logout", async () => {
    signInForTest();
    const store = createStore();
    const heardA: (string | null)[] = [];
    onSessionChange(({ session }) => heardA.push(session?.user.id ?? null));
    const failing = failLocks();
    clearSession(); // tab A: pending logout, its lock requests fail
    await delay(20);
    failing.mockRestore();

    const tabB = await openSecondTab();
    const heardB: (string | null)[] = [];
    tabB.onSessionChange(({ session }) => heardB.push(session?.user.id ?? null));
    await expect(
      tabB.saveSessionIfCurrent(tabB.sessionGeneration(), testSession(OTHER_USER)),
    ).resolves.toBe(true); // B logs in; A's storage event is NOT delivered (ignored / missed)

    await delay(900); // A's retry gets the lock
    await sessionWritesSettled();

    expect(storedRecord().session?.user.id).toBe(OTHER_USER.id); // B's login survived
    expect(tabB.loadSession()?.user.id).toBe(OTHER_USER.id);
    expect(heardB).toEqual([OTHER_USER.id]); // B was never logged out
    expect(loadSession()?.user.id).toBe(OTHER_USER.id); // A follows the persisted session
    expect(heardA).toEqual([null, OTHER_USER.id]);
    expect(store.getState().auth).toMatchObject({ status: 'authenticated', user: OTHER_USER });
  });

  it('E: logouts in two tabs: the older pending one does not overwrite the persisted one, nobody gets stuck', async () => {
    signInForTest();
    const failing = failLocks();
    clearSession(); // tab A: pending
    await delay(20);
    failing.mockRestore();

    const tabB = await openSecondTab();
    tabB.clearSession(); // tab B logs out too and persists at once
    await tabB.sessionWritesSettled();
    const persisted = storedRecord();
    expect(persisted.session).toBeNull();

    await delay(900); // A's retry: its logout is obsolete, nothing to write
    await sessionWritesSettled();
    expect(storedRecord()).toEqual(persisted); // A did not rewrite the record

    // A is not stuck in the pending state: a login of A is accepted from the persisted generation.
    await expect(saveSessionIfCurrent(sessionGeneration(), testSession(OTHER_USER))).resolves.toBe(
      true,
    );
    expect(storedRecord().session?.user.id).toBe(OTHER_USER.id);
  });

  it('F: a storage event during a pending logout is not lost: the newer login of another tab is adopted at once', async () => {
    signInForTest();
    const store = createStore();
    const heard: (string | null)[] = [];
    onSessionChange(({ session }) => heard.push(session?.user.id ?? null));
    const lock = holdLock();
    clearSession(); // waits for the lock
    otherTab.login(testSession(OTHER_USER)); // tab B logged in
    deliverStorageEvent();

    expect(loadSession()?.user.id).toBe(OTHER_USER.id); // adopted without waiting for the lock
    expect(store.getState().auth).toMatchObject({ status: 'authenticated', user: OTHER_USER });
    lock.release();
    await sessionWritesSettled();
    expect(storedRecord().session?.user.id).toBe(OTHER_USER.id); // the obsolete logout wrote nothing
    expect(heard).toEqual([null, OTHER_USER.id]);
  });

  it('F: a storage event that only renews the same session does not cancel the pending logout', async () => {
    signInForTest();
    const lock = holdLock();
    clearSession();
    otherTab.refresh(testSession(TEST_USER)); // same generation, new tokens
    deliverStorageEvent();
    expect(loadSession()).toBeNull();
    lock.release();
    await vi.waitFor(() => expect(storedRecord().session).toBeNull());
  });

  it('G: a listener that logs out while it is being notified does not leave later listeners on the stale session', () => {
    signInForTest();
    const lastSeen: (string | null)[] = [];
    const offFirst = onSessionChange(({ session }) => {
      if (session) clearSession(); // re-entrant: a logout inside the notification
    });
    const offSecond = onSessionChange(({ session }) => lastSeen.push(session?.user.id ?? null));
    otherTab.login(testSession(OTHER_USER));
    deliverStorageEvent();

    expect(lastSeen.at(-1)).toBeNull(); // the last word is the logout, not the stale login
    expect(loadSession()).toBeNull();
    offFirst();
    offSecond();
  });

  it('the pending logout still wins over a stale refresh, and a second logout takes over', async () => {
    signInForTest();
    const failing = failLocks();
    clearSession();
    await delay(20);
    failing.mockRestore();
    clearSession(); // a newer logout owns the pending state now
    await expect(saveSessionIfCurrent('stale-generation', testSession(OTHER_USER))).resolves.toBe(
      false,
    );
    await vi.waitFor(() => expect(storedRecord().session).toBeNull(), { timeout: 3000 });
    expect(loadSession()).toBeNull();
  });

  it("a lock timeout does not let the holder's later write bring the old session back", async () => {
    signInForTest();
    const stale = testSession(undefined, { expired: true });
    // Short lock timeout so the logout's first attempts fail quickly.
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => AbortSignal.abort(new DOMException('timeout', 'TimeoutError')));
    const heard: (string | null)[] = [];
    const off = onSessionChange(({ session }) => heard.push(session?.user.id ?? null));
    const seen: (string | null)[] = [];
    const sampler = setInterval(() => seen.push(loadSession()?.user.id ?? null), 5);

    // Another writer (tab B's refresh) holds the lock and, when it is done, writes the OLD session.
    let finish!: () => void;
    const holding = new Promise<void>((resolve) => (finish = resolve));
    const writer = navigator.locks.request(SESSION_LOCK_NAME, async () => {
      await holding;
      otherTab.refresh(stale);
    });

    const requests = vi.spyOn(navigator.locks, 'request');
    clearSession();
    await delay(120); // the logout's lock requests time out meanwhile, and it retries
    expect(loadSession()).toBeNull();
    expect(storedRecord().session).not.toBeNull(); // still the old session in the storage: nothing was written

    // The timeout path really ran: some lock requests were rejected (not just slow).
    const outcomes = await Promise.allSettled(
      requests.mock.results.map((r) => r.value as Promise<unknown>),
    );
    expect(outcomes.filter((o) => o.status === 'rejected').length).toBeGreaterThan(0);
    requests.mockRestore();

    timeout.mockRestore(); // the holder finishes; the logout's retry gets the lock after it
    finish();
    await writer;
    await vi.waitFor(() => expect(storedRecord().session).toBeNull(), { timeout: 3000 });
    await sessionWritesSettled();

    expect(storedRecord().session).toBeNull(); // the logout is the last word
    expect(seen.every((id) => id === null)).toBe(true); // this tab never showed the old session
    expect(heard).toEqual([null]); // (Vitest also fails a run on any unhandled promise rejection)
    clearInterval(sampler);
    off();
  });
});

describe('without Web Locks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, 'locks', {
      value: realLocks,
      configurable: true,
    });
  });
  const realLocks = navigator.locks;

  it('reports it, warns once, and keeps the in-tab guarantees', async () => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(crossTabLocksAvailable()).toBe(false);

    signInForTest({ expired: true });
    const staleExpected = sessionGeneration();
    const refresh = renewSession(staleExpected, testSession(undefined, { expired: true }));
    clearSession(); // still immediate and still makes the earlier operation stale
    await expect(refresh).resolves.toBe(true); // ran at once, before the logout: no queue without locks
    expect(loadSession()).toBeNull();

    await renewSession(sessionGeneration(), testSession());
    await sessionWritesSettled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/best-effort/);
    expect(storedRecord().session).toBeNull();
    warn.mockRestore();
  });
});
