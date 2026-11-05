/**
 * The refresh-token cookie is shared by every tab of the browser, and the backend rotates it on every refresh (the
 * old token is invalid at once, no grace period). Two tabs sending the same cookie would make one of them fail with
 * `INVALID_REFRESH_TOKEN` and, before this lock, even clear a session the other tab had just renewed.
 *
 * So a network request that READS or CHANGES that cookie runs inside this Web Lock (`wallet.auth-cookie`), one at a
 * time per browser: the refresh, the login and the logout all use it (each of them sets, rotates or clears the cookie).
 *
 * Lock order, always: `wallet.auth-cookie` -> `wallet.session`. The session lock (`session.ts`) is only held for
 * short synchronous storage updates and never waits for this one, so the two cannot deadlock.
 *
 * - The lock is held across the HTTP request AND the local session update that follows it. It is released only when the operation has really finished: the request
 *   is cancelled with `requestSignal` after `requestMs` (never abandoned with `Promise.race` while it could still
 *   change the cookie). A cancelled or failed request is an UNCERTAIN outcome (the server may have rotated the token
 *   before the answer was lost); it is reported to the caller, never retried here.
 * - If the lock cannot be obtained (`acquireMs` elapsed, API failure) `AuthCookieLockError` is thrown and NOTHING was
 *   sent; there is no bypass while the API exists. Without the Web Locks API the refresh fails the same way (an
 *   uncoordinated rotating refresh is exactly the bug this prevents), so such a browser cannot renew a session; login
 *   and logout may run uncoordinated with a console warning (`whenUnavailable: 'run'`).
 */
export const AUTH_COOKIE_LOCK_NAME = 'wallet.auth-cookie';

/** Mutable only so that tests can use short timeouts. `acquireMs` must exceed `requestMs` plus a session-lock wait. */
export const AUTH_COOKIE_TIMEOUTS = { acquireMs: 30_000, requestMs: 15_000 };

/** The cookie lock could not be taken: nothing was sent to the server. */
export class AuthCookieLockError extends Error {
  readonly reason: 'unavailable' | 'failed';
  constructor(reason: 'unavailable' | 'failed') {
    super(
      reason === 'unavailable'
        ? 'This browser cannot coordinate session renewal between tabs (no Web Locks), so the session cannot be renewed safely. Please log in again.'
        : 'Could not coordinate session renewal with other tabs. Please try again.',
    );
    this.name = 'AuthCookieLockError';
    this.reason = reason;
  }
}

export interface AuthCookieLockOptions {
  /** Cancels both the wait for the lock and the request (a logout the caller gave up on). */
  signal?: AbortSignal;
  /**
   * Without the Web Locks API: `'fail'` (default, used by the refresh) throws; `'run'` (login and logout) runs the
   * operation WITHOUT coordination and warns once on the console. Login and logout must keep working in such a
   * browser, and a logout that is skipped would leave the session alive on the server; the price is that the
   * cross-tab cookie races below are possible there. Product decision pending (see README).
   */
  whenUnavailable?: 'fail' | 'run';
}

let warnedUnavailable = false;

/**
 * Runs `operation` while holding the cookie lock. `requestSignal` aborts after `AUTH_COOKIE_TIMEOUTS.requestMs` or
 * when `options.signal` aborts; pass it to the HTTP request. Errors of `operation` are rethrown as they are. While the
 * operation holds this lock it may take the session lock (never the other way round).
 */
export async function withAuthCookieLock<T>(
  operation: (requestSignal: AbortSignal) => Promise<T>,
  { signal, whenUnavailable = 'fail' }: AuthCookieLockOptions = {},
): Promise<T> {
  if (signal?.aborted) throw new AuthCookieLockError('failed'); // given up before it started: nothing is sent

  const acquisition = new AbortController();
  const request = new AbortController();
  const cancel = () => {
    acquisition.abort(signal?.reason);
    request.abort(signal?.reason);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  const startRequestTimer = () => {
    requestTimer = setTimeout(
      () => request.abort(new DOMException('The request timed out', 'TimeoutError')),
      AUTH_COOKIE_TIMEOUTS.requestMs,
    );
  };

  if (typeof navigator === 'undefined' || !navigator.locks) {
    try {
      if (whenUnavailable === 'fail') throw new AuthCookieLockError('unavailable');
      if (!warnedUnavailable) {
        warnedUnavailable = true;
        console.warn(
          'Web Locks are unavailable: login and logout run without cross-tab coordination of the refresh cookie ' +
            '(another tab can leave a cookie that does not match the session). Use a current browser over https or localhost.',
        );
      }
      startRequestTimer();
      return await operation(request.signal);
    } finally {
      clearTimeout(requestTimer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  const acquisitionTimer = setTimeout(
    () =>
      acquisition.abort(new DOMException('Waiting for the cookie lock timed out', 'TimeoutError')),
    AUTH_COOKIE_TIMEOUTS.acquireMs,
  );
  let started = false;
  try {
    return await navigator.locks.request(
      AUTH_COOKIE_LOCK_NAME,
      { signal: acquisition.signal },
      async () => {
        started = true;
        clearTimeout(acquisitionTimer);
        startRequestTimer();
        return await operation(request.signal);
      },
    );
  } catch (error) {
    if (started) throw error; // the operation failed: not a lock problem
    throw new AuthCookieLockError('failed');
  } finally {
    clearTimeout(acquisitionTimer);
    clearTimeout(requestTimer);
    signal?.removeEventListener('abort', cancel);
  }
}
