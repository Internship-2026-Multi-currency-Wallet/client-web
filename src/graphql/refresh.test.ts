import { delay } from 'msw';
import { server } from '../mocks/server';
import { OTHER_USER, otherTab, signInForTest, testSession } from '../test/auth';
import { errorResponse, newLog, refreshHandler } from '../test/graphql-handlers';
import { refreshSession } from './refresh';
import { accessToken, clearSession, loadSession } from './session';

describe('refreshSession', () => {
  it('renews the session and rotates the access token', async () => {
    signInForTest({ expired: true });
    const stale = accessToken();
    const log = newLog();
    server.use(refreshHandler(log));

    await expect(refreshSession()).resolves.toBe(true);
    expect(log.refresh).toBe(1);
    expect(accessToken()).not.toBe(stale);
  });

  it('shares ONE refresh between concurrent callers (single flight)', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(refreshHandler(log, () => delay(50)));

    await expect(
      Promise.all([refreshSession(), refreshSession(), refreshSession()]),
    ).resolves.toEqual([true, true, true]);
    expect(log.refresh).toBe(1);
  });

  it('never refreshes without a session', async () => {
    const log = newLog();
    server.use(refreshHandler(log));
    await expect(refreshSession()).resolves.toBe(false);
    expect(log.refresh).toBe(0);
  });

  it('reports a finished refresh session (INVALID_REFRESH_TOKEN) as false and clears it', async () => {
    signInForTest({ refreshable: false });
    await expect(refreshSession()).resolves.toBe(false);
    expect(loadSession()).toBeNull();
  });

  it('throws on another failure (e.g. server down) and keeps the session', async () => {
    signInForTest({ expired: true });
    const before = loadSession();
    const log = newLog();
    server.use(
      refreshHandler(log, async () => errorResponse('INTERNAL_SERVER_ERROR', { status: 503 })),
    );

    await expect(refreshSession()).rejects.toMatchObject({ response: { status: 503 } });
    expect(loadSession()).toEqual(before);
  });

  it('waits for the refresh lock and reuses the token another tab got meanwhile', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(refreshHandler(log));
    // Another tab holds the lock while it refreshes.
    let release: (() => void) | undefined;
    const held = navigator.locks.request(
      'wallet.refresh',
      () => new Promise<void>((r) => (release = r)),
    );
    await vi.waitFor(() => expect(release).toBeDefined());

    const pending = refreshSession();
    const renewed = testSession();
    otherTab.write(renewed);
    release!();
    await held;

    await expect(pending).resolves.toBe(true);
    expect(log.refresh).toBe(0); // the rotated cookie was not used a second time
    expect(accessToken()).toBe(renewed.accessToken);
  });

  it('a logout during the refresh request wins: the answer does not bring the session back', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      refreshHandler(log, async () => {
        clearSession();
      }),
    );

    await expect(refreshSession()).resolves.toBe(false);
    expect(loadSession()).toBeNull();
  });

  it('a login as another user during the refresh request wins over the late answer', async () => {
    signInForTest({ expired: true });
    const other = testSession(OTHER_USER);
    const log = newLog();
    server.use(refreshHandler(log, async () => otherTab.write(other)));

    await expect(refreshSession()).resolves.toBe(true);
    expect(log.refresh).toBe(1);
    expect(loadSession()).toEqual(other);
  });
});
