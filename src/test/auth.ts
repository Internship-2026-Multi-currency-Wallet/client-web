import { mockAccessToken, setMockRefreshCookie } from '../mocks/auth-handlers';
import {
  SESSION_LOCK_NAME,
  SESSION_STORAGE_KEY,
  saveSession,
  type Session,
} from '../graphql/session';

export const TEST_USER = { id: '1', email: 'demo@example.com', phone: null };
export const OTHER_USER = { id: '2', email: 'other@example.com', phone: null };

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** A session object for a mock user; `expired` = the access token has already expired. */
export function testSession(user = TEST_USER, { expired = false } = {}): Session {
  const expiresAt = expired ? Date.now() - 1000 : Date.now() + FIFTEEN_MINUTES;
  return {
    accessToken: mockAccessToken(user.id, expiresAt),
    accessTokenExpiresAt: new Date(expiresAt).toISOString(),
    user,
  };
}

/**
 * Starts a test as an already signed-in user (the demo user of the mocks). `expired`: the stored access token has
 * expired. `refreshable: false`: the refresh cookie is gone, so a refresh fails with INVALID_REFRESH_TOKEN.
 */
export function signInForTest({
  expired = false,
  refreshable = true,
  user = TEST_USER,
} = {}): void {
  saveSession(testSession(user, { expired }));
  if (refreshable) setMockRefreshCookie(user.id);
}

const newGeneration = () => `other-tab-${Math.random().toString(36).slice(2)}`;

/** The shared record as it is persisted: `{ generation, session | null }`. */
export function storedRecord(): { generation: string; session: Session | null } {
  return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? 'null') as {
    generation: string;
    session: Session | null;
  };
}

/** Writes the shared record the way any tab does. */
export function writeStoredRecord(generation: string, session: Session | null): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ generation, session }));
}

/**
 * What ANOTHER tab does to the shared storage, without this tab hearing about it: no listener runs and no
 * `storage` event is dispatched (call `deliverStorageEvent` later to model the delayed event). Each action is a
 * completed write that happened before this tab's next step.
 */
export const otherTab = {
  /** A new login (also of the same user). */
  login(session: Session): void {
    writeStoredRecord(newGeneration(), session);
  },
  logout(): void {
    writeStoredRecord(newGeneration(), null);
  },
  /** A token refresh of the same session: new tokens, same generation. */
  refresh(session: Session): void {
    writeStoredRecord(storedRecord()?.generation ?? '', session);
  },
};

/**
 * The same actions as a tab that takes the session lock like production code: it queues behind whatever
 * holds the lock and runs after it. Returns when the write is done.
 */
export const otherTabLocked = {
  login: (session: Session) =>
    navigator.locks.request(SESSION_LOCK_NAME, () => otherTab.login(session)),
  logout: () => navigator.locks.request(SESSION_LOCK_NAME, () => otherTab.logout()),
  refresh: (session: Session) =>
    navigator.locks.request(SESSION_LOCK_NAME, () => otherTab.refresh(session)),
};

/** The (late) `storage` event the browser delivers to this tab for a change made by another tab. */
export function deliverStorageEvent(): void {
  window.dispatchEvent(new StorageEvent('storage', { key: SESSION_STORAGE_KEY }));
}
