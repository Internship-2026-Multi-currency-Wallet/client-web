import {
  accessToken,
  clearSession,
  loadSession,
  onSessionChange,
  SESSION_STORAGE_KEY,
  saveSession,
  type Session,
  sessionWritesSettled,
} from './session';
import { deliverStorageEvent, otherTab, storedRecord, writeStoredRecord } from '../test/auth';

const session: Session = {
  accessToken: 'token-1',
  accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
  user: { id: '1', email: 'a@b.co', phone: null },
};

describe('session storage', () => {
  it('saves, loads and clears the session in localStorage', async () => {
    expect(loadSession()).toBeNull();
    saveSession(session);
    expect(loadSession()).toEqual(session);
    expect(accessToken()).toBe('token-1');
    expect(storedRecord().session).toEqual(session); // one record: generation + session

    clearSession();
    expect(loadSession()).toBeNull(); // signed out at once, before the storage write
    expect(accessToken()).toBeNull();
    await sessionWritesSettled();
    expect(storedRecord().session).toBeNull();
  });

  it('notifies listeners on save and clear, until they unsubscribe', () => {
    const listener = vi.fn();
    const off = onSessionChange(listener);
    saveSession(session);
    clearSession();
    expect(listener.mock.calls).toEqual([
      [{ session, identityChanged: true }],
      [{ session: null, identityChanged: true }],
    ]);

    off();
    saveSession(session);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it.each(['not json', '{"accessToken":1}', 'null', '[]', JSON.stringify(session)])(
    'treats a corrupt or old-format stored value (%s) as signed out',
    (value) => {
      localStorage.setItem(SESSION_STORAGE_KEY, value);
      expect(loadSession()).toBeNull();
    },
  );

  it('follows a change made in another tab (storage event)', () => {
    const listener = vi.fn();
    const off = onSessionChange(listener);
    otherTab.login(session);
    deliverStorageEvent();
    otherTab.logout();
    deliverStorageEvent();
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    off();

    expect(listener.mock.calls).toEqual([
      [{ session, identityChanged: true }],
      [{ session: null, identityChanged: true }],
    ]);
  });
});

describe('identity tracked from the persisted session', () => {
  it('a token refresh of the same user after a reload is NOT an identity change', async () => {
    // A reload: the storage is populated before the module is evaluated.
    writeStoredRecord('g1', session);
    vi.resetModules();
    const fresh = await import('./session');
    const listener = vi.fn();
    fresh.onSessionChange(listener);

    const renewed = { ...session, accessToken: 'token-2' };
    otherTab.refresh(renewed);
    deliverStorageEvent();

    expect(listener.mock.calls).toEqual([[{ session: renewed, identityChanged: false }]]);
  });

  it('another user after a reload is an identity change', async () => {
    writeStoredRecord('g1', session);
    vi.resetModules();
    const fresh = await import('./session');
    const listener = vi.fn();
    fresh.onSessionChange(listener);

    const other = { ...session, user: { ...session.user, id: '2' } };
    otherTab.login(other);
    deliverStorageEvent();

    expect(listener.mock.calls).toEqual([[{ session: other, identityChanged: true }]]);
  });
});
