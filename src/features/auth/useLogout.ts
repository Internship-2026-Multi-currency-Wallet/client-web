import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { clearSession } from '../../graphql/session';
import { useLogoutMutation } from './authApi';
import { LOGOUT_TIMEOUT_MS, trackLogout } from './logoutCoordinator';

export { LOGOUT_TIMEOUT_MS };

/**
 * - `revoked`: the server confirmed the session is ended.
 * - `local-only`: this device is logged out, but the server did not confirm (unreachable, slow, error): the
 *   refresh cookie may stay valid until it expires.
 */
export type LogoutResult = 'revoked' | 'local-only';

/**
 * Logs out. The local session is cleared FIRST and synchronously, so access is gone and every pending operation
 * of that session is stale no matter what the server does; only then the server is asked, for at most `timeoutMs`
 * (then the request is aborted).
 */
export function useLogout(timeoutMs = LOGOUT_TIMEOUT_MS): () => Promise<LogoutResult> {
  const [logout] = useLogoutMutation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  return async () => {
    const logoutGeneration = clearSession();
    void navigate('/login', { replace: true });

    const call = logout(logoutGeneration);
    // A login started meanwhile waits until this request is settled (see `waitForPendingLogout`).
    trackLogout(call);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    let result: LogoutResult;
    try {
      const outcome = await Promise.race([call.unwrap(), timeout]);
      // Too slow: stop the request. The browser then ignores its late response (and its Set-Cookie), so it can
      // never clear the refresh cookie of a login made after this logout.
      if (outcome === 'timeout') call.abort();
      result = outcome === true ? 'revoked' : 'local-only';
    } catch {
      result = 'local-only';
    } finally {
      clearTimeout(timer);
    }
    // Tell the user, but only if they are still on the login page.
    if (result === 'local-only' && pathnameRef.current === '/login') {
      void navigate('/login', { replace: true, state: { logout: result } });
    }
    return result;
  };
}
