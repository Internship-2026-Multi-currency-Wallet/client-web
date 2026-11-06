import { delay } from 'msw';
import { server } from '../mocks/server';
import {
  deliverStorageEvent,
  OTHER_USER,
  otherTab,
  signInForTest,
  testSession,
} from '../test/auth';
import {
  errorResponse,
  healthResponse,
  meHandler,
  newLog,
  refreshHandler,
  walletCore,
} from '../test/graphql-handlers';
import { meQuery, walletCoreHealthQuery } from '../features/system/system.wallet-core';
import { refreshSession, request } from './client';
import {
  clearSession,
  loadSession,
  saveSession,
  SessionChangedError,
  sessionWritesSettled,
  sessionGeneration,
} from './session';

/** Regression tests for the concurrency defects of the session lifecycle (one `it` per confirmed defect). */
describe('session lifecycle: stale async results', () => {
  it('a refresh in flight does NOT bring the session back after logout', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(refreshHandler(log, () => delay(60)));

    const refreshing = refreshSession();
    await vi.waitFor(() => expect(log.refresh).toBe(1)); // the request is on the wire (it holds the cookie lock)
    clearSession(); // logout while the refresh request is still on the wire
    await expect(refreshing).resolves.toBe(false);

    expect(loadSession()).toBeNull();
    expect(log.refresh).toBe(1);
  });

  it('a refresh whose session ended before it got the cookie lock is not even sent', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(refreshHandler(log));

    const refreshing = refreshSession();
    clearSession(); // before the refresh could take the lock
    await expect(refreshing).resolves.toBe(false);

    expect(loadSession()).toBeNull();
    expect(log.refresh).toBe(0);
  });

  it('a stale INVALID_REFRESH_TOKEN does NOT clear a newer login', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      refreshHandler(log, async () => {
        await delay(60);
        return errorResponse('INVALID_REFRESH_TOKEN');
      }),
    );

    const refreshing = refreshSession();
    clearSession();
    await sessionWritesSettled();
    saveSession(testSession(OTHER_USER)); // a new login (other tab) happens meanwhile
    await expect(refreshing).resolves.toBe(false);

    expect(loadSession()?.user.id).toBe(OTHER_USER.id);
  });

  it('INVALID_REFRESH_TOKEN after another tab already renewed the session keeps that session', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      refreshHandler(log, async () => {
        await delay(40);
        return errorResponse('INVALID_REFRESH_TOKEN'); // the cookie was rotated by the other tab
      }),
    );

    const refreshing = refreshSession();
    const renewed = testSession(); // same user, fresh token, written by the other tab
    otherTab.refresh(renewed);

    await expect(refreshing).resolves.toBe(true);
    expect(loadSession()?.accessToken).toBe(renewed.accessToken);
  });

  it('a request started under user A is NOT retried under user B', async () => {
    signInForTest({ expired: true }); // user A (id 1)
    const log = newLog();
    server.use(
      meHandler(log),
      refreshHandler(log, () => delay(60)),
    );

    const pending = request('walletCore', meQuery);
    await delay(20); // A's request failed with UNAUTHENTICATED and waits for the refresh
    saveSession(testSession(OTHER_USER)); // user B logs in in another tab
    await expect(pending).rejects.toBeDefined();

    expect(log.me).toBe(1); // never repeated, so B's token was not used for A's request
    expect(loadSession()?.user.id).toBe(OTHER_USER.id); // and A's refreshed tokens did not replace B's
  });

  it('the late answer of a request started under A is dropped after logout', async () => {
    signInForTest();
    const log = newLog();
    server.use(meHandler(log, () => delay(60)));

    const pending = request('walletCore', meQuery);
    await delay(10);
    clearSession();

    await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
  });

  it('a refresh never joins a refresh that belongs to an older session', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(refreshHandler(log, () => delay(60)));

    const old = refreshSession();
    await vi.waitFor(() => expect(log.refresh).toBe(1)); // `old` is on the wire
    clearSession();
    await sessionWritesSettled(); // the logout reached the storage; then a new login (the test helper writes unlocked)
    signInForTest({ expired: true, user: OTHER_USER });
    const fresh = refreshSession();

    await Promise.all([old, fresh]);
    expect(log.refresh).toBe(2);
  });
});

/**
 * Another tab's change is visible to this tab only through the shared storage until the `storage` event arrives
 * (it is asynchronous and may come late). A stale result must be rejected by what is in storage, not by the event.
 */
describe('session lifecycle across tabs (no storage event yet)', () => {
  const slowRefresh = (log: { refresh: number }) => refreshHandler(log, () => delay(60));

  it('a refresh finishing after another tab LOGGED OUT does not bring the session back', async () => {
    signInForTest({ expired: true });
    server.use(slowRefresh(newLog()));

    const refreshing = refreshSession();
    await delay(10);
    otherTab.logout();
    await expect(refreshing).resolves.toBe(false);

    expect(loadSession()).toBeNull();
    deliverStorageEvent(); // the late event only confirms it
    expect(loadSession()).toBeNull();
  });

  it('a refresh finishing after another tab logged in as SOMEONE ELSE does not overwrite that login', async () => {
    signInForTest({ expired: true });
    server.use(slowRefresh(newLog()));

    const refreshing = refreshSession();
    await delay(10);
    otherTab.login(testSession(OTHER_USER));
    await expect(refreshing).resolves.toBe(false);

    expect(loadSession()?.user.id).toBe(OTHER_USER.id);
  });

  it('a refresh finishing after another tab logged in as the SAME user does not overwrite that login', async () => {
    signInForTest({ expired: true });
    server.use(slowRefresh(newLog()));
    const newer = testSession();

    const refreshing = refreshSession();
    await delay(10);
    otherTab.login(newer); // a new login is a new session even for the same user
    await expect(refreshing).resolves.toBe(false);

    expect(loadSession()?.accessToken).toBe(newer.accessToken);
  });

  it('a refresh by another tab (same session) is not a new session: this tab keeps its operations valid', async () => {
    signInForTest();
    const log = newLog();
    server.use(meHandler(log, () => delay(40)));

    const pending = request('walletCore', meQuery);
    await delay(10);
    const generation = sessionGeneration();
    otherTab.refresh(testSession());

    await expect(pending).resolves.toMatchObject({ me: { id: '1' } });
    expect(sessionGeneration()).toBe(generation);
  });

  it('a new login of the same user starts a new generation', () => {
    signInForTest();
    const before = sessionGeneration();
    saveSession(testSession());
    expect(sessionGeneration()).not.toBe(before);
  });

  it('a late answer is dropped after another tab logged out, even before the storage event', async () => {
    signInForTest();
    server.use(meHandler(newLog(), () => delay(60)));

    const pending = request('walletCore', meQuery);
    await delay(10);
    otherTab.logout();

    await expect(pending).rejects.toBeInstanceOf(SessionChangedError);
  });

  it('a retry is not made under the session another tab started', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      meHandler(log),
      refreshHandler(log, () => delay(60)),
    );

    const pending = request('walletCore', meQuery);
    await delay(20);
    otherTab.login(testSession(OTHER_USER));
    await expect(pending).rejects.toBeDefined();

    expect(log.me).toBe(1);
    expect(loadSession()?.user.id).toBe(OTHER_USER.id);
  });

  it('public requests are not rejected when the user changes while they are on the wire', async () => {
    signInForTest();
    server.use(walletCore.query('WalletCoreHealth', () => delay(60).then(() => healthResponse())));

    const pending = request('walletCore', walletCoreHealthQuery);
    await delay(10);
    otherTab.logout();

    await expect(pending).resolves.toMatchObject({ health: { service: 'wallet-core' } });
  });
});
