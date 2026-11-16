import type { RefreshSessionMutation } from '../gql/wallet-core/graphql';
import { hasErrorCode } from './errors';
import { httpClient } from './http';
import { accessToken, clearSession, saveSession, sessionFromPayload } from './session';
import { refreshSessionMutation } from './session-refresh.wallet-core';

/** wallet-core `AuthErrorCode`: the refresh-token cookie is missing, expired or already rotated. */
export const INVALID_REFRESH_TOKEN = 'INVALID_REFRESH_TOKEN';

// The refresh cookie is shared by all tabs and is replaced by every session-creating call (password login,
// Google login, refresh), so those calls take one lock: whichever finishes last leaves both the cookie and the
// stored session on the same user.
const SESSION_LOCK = 'wallet.session';
/** A hung refresh must not hold the lock (and every tab waiting on it) forever. */
const REFRESH_TIMEOUT_MS = 15_000;

/** Runs `callback` alone among the tabs of this browser. */
export function withSessionLock<T>(callback: () => Promise<T>): Promise<T> {
  // No Web Locks outside a secure context (e.g. the dev server opened via a LAN IP): not coordinated.
  return navigator.locks ? navigator.locks.request(SESSION_LOCK, callback) : callback();
}

let refreshing: Promise<boolean> | null = null;

/**
 * `true` = a valid session exists now; `false` = it is over. Network errors, 5xx and timeouts are thrown and keep
 * the session.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= refreshWithLock().finally(() => (refreshing = null));
  return refreshing;
}

async function refreshWithLock(): Promise<boolean> {
  const tokenAtStart = accessToken();
  return withSessionLock(async () => {
    // Changed while we waited: another tab refreshed (reuse its token) or somebody logged out / in.
    if (accessToken() !== tokenAtStart || tokenAtStart === null) return accessToken() !== null;
    let payload;
    try {
      ({ refreshSession: payload } = await httpClient('walletCore').request<RefreshSessionMutation>(
        { document: refreshSessionMutation, signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) },
      ));
    } catch (error) {
      if (!hasErrorCode(error, INVALID_REFRESH_TOKEN)) throw error;
      if (accessToken() === tokenAtStart) clearSession();
      return false;
    }
    // A logout or login during the request wins over this answer.
    if (accessToken() !== tokenAtStart) return accessToken() !== null;
    saveSession(sessionFromPayload(payload));
    return true;
  });
}
