import { otherTab } from '../test/auth';
import {
  accessToken,
  clearSession,
  loadSession,
  onSessionChange,
  SESSION_STORAGE_KEY,
  saveSession,
  type Session,
} from './session';

const session: Session = {
  accessToken: 'token-1',
  accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
  user: { id: '1', email: 'a@b.co', phone: null },
};

describe('session storage', () => {
  it('saves, loads and clears the session in localStorage', () => {
    expect(loadSession()).toBeNull();
    saveSession(session);
    expect(loadSession()).toEqual(session);
    expect(accessToken()).toBe('token-1');

    clearSession();
    expect(loadSession()).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('notifies listeners on save and clear, until they unsubscribe', () => {
    const listener = vi.fn();
    const off = onSessionChange(listener);
    saveSession(session);
    clearSession();
    expect(listener.mock.calls).toEqual([[session], [null]]);

    off();
    saveSession(session);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it.each([
    'not json',
    'null',
    '[]',
    '{"accessToken":1}',
    JSON.stringify({ ...session, accessTokenExpiresAt: 'soon' }),
    JSON.stringify({ ...session, user: { email: 'a@b.co' } }),
    JSON.stringify({ generation: 'g1', session }), // the earlier format
  ])('treats a corrupt stored value (%s) as signed out', (value) => {
    localStorage.setItem(SESSION_STORAGE_KEY, value);
    expect(loadSession()).toBeNull();
  });

  it('follows changes made in another tab (storage event)', () => {
    const listener = vi.fn();
    const off = onSessionChange(listener);
    otherTab.write(session);
    otherTab.notify();
    otherTab.write(null);
    otherTab.notify();
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    off();

    expect(listener.mock.calls).toEqual([[session], [null]]);
  });
});
