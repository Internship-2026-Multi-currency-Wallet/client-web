import { mockAccessToken, setMockRefreshCookie } from '../mocks/auth-handlers';
import { SESSION_STORAGE_KEY, type Session } from '../graphql/session';

export const TEST_USER = { id: '1', email: 'demo@example.com', phone: null };
export const OTHER_USER = { id: '2', email: 'other@example.com', phone: null };

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** A session of a mock user; `expired` = its access token has already expired. */
export function testSession(user = TEST_USER, { expired = false } = {}): Session {
  const expiresAt = expired ? Date.now() - 1000 : Date.now() + FIFTEEN_MINUTES;
  return {
    accessToken: mockAccessToken(user.id, expiresAt),
    accessTokenExpiresAt: new Date(expiresAt).toISOString(),
    user,
  };
}

/**
 * Starts a test as an already signed-in user (written straight to storage, like a page reload would find it).
 * `refreshable: false`: no refresh cookie, so a refresh fails with INVALID_REFRESH_TOKEN.
 */
export function signInForTest({
  expired = false,
  refreshable = true,
  user = TEST_USER,
} = {}): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(testSession(user, { expired })));
  if (refreshable) setMockRefreshCookie(user.id);
}

/** What another tab does: it writes the storage, and this tab later gets a `storage` event. */
export const otherTab = {
  write(session: Session | null): void {
    if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  },
  notify(): void {
    window.dispatchEvent(new StorageEvent('storage', { key: SESSION_STORAGE_KEY }));
  },
};
