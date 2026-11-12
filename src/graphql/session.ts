/**
 * The signed-in session, kept in localStorage (MVP decision). The refresh token is an HttpOnly cookie that only the
 * browser sees.
 */

export interface SessionUser {
  id: string;
  email: string;
  phone: string | null;
}

export interface Session {
  accessToken: string;
  accessTokenExpiresAt: string;
  user: SessionUser;
}

export const SESSION_STORAGE_KEY = 'wallet.session';

/** An access token this close to its expiry counts as expired (clock skew, request time). */
export const EXPIRY_SKEW_MS = 30_000;

type Listener = (session: Session | null) => void;
const listeners = new Set<Listener>();

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Stored data is never trusted: anything malformed counts as "signed out". */
function parseSession(raw: string | null): Session | null {
  try {
    const { accessToken, accessTokenExpiresAt, user } = JSON.parse(raw ?? 'null') as Record<
      string,
      unknown
    >;
    const { id, email, phone } = (user ?? {}) as Record<string, unknown>;
    if (!nonEmpty(accessToken) || !nonEmpty(accessTokenExpiresAt)) return null;
    if (!Number.isFinite(Date.parse(accessTokenExpiresAt))) return null;
    if (!nonEmpty(id) || !nonEmpty(email)) return null;
    if (phone != null && typeof phone !== 'string') return null;
    return { accessToken, accessTokenExpiresAt, user: { id, email, phone: phone ?? null } };
  } catch {
    return null;
  }
}

export function sessionFromPayload(payload: {
  accessToken: string;
  accessTokenExpiresAt: string;
  user: { id: string; email: string; phone?: string | null };
}): Session {
  const { accessToken, accessTokenExpiresAt, user } = payload;
  return {
    accessToken,
    accessTokenExpiresAt,
    user: { id: user.id, email: user.email, phone: user.phone ?? null },
  };
}

export function loadSession(): Session | null {
  return parseSession(localStorage.getItem(SESSION_STORAGE_KEY));
}

export function accessToken(): string | null {
  return loadSession()?.accessToken ?? null;
}

export function isAccessTokenExpired(session: Session, now = Date.now()): boolean {
  return Date.parse(session.accessTokenExpiresAt) - now <= EXPIRY_SKEW_MS;
}

function notify(session: Session | null): void {
  for (const listener of [...listeners]) listener(session);
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  notify(session);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  notify(null);
}

/** Also called for changes made in another tab. */
export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The `storage` event fires only in the OTHER tabs.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === SESSION_STORAGE_KEY || event.key === null) notify(loadSession());
  });
}
