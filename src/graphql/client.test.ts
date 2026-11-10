import { delay, HttpResponse } from 'msw';
import { meQuery } from '../features/system/system.wallet-core';
import { loginMutation } from '../features/auth/auth.wallet-core';
import { server } from '../mocks/server';
import { OTHER_USER, otherTab, signInForTest, testSession } from '../test/auth';
import {
  errorResponse,
  meHandler,
  newLog,
  refreshHandler,
  unauthenticated,
  walletCore,
} from '../test/graphql-handlers';
import { createStore } from '../app/store';
import { authApi } from '../features/auth/authApi';
import { request, refreshSession, toRequestError } from './client';
import { accessToken, clearSession, loadSession } from './session';

describe('request: authorization header', () => {
  it('sends the session access token as Bearer', async () => {
    signInForTest();
    const log = newLog();
    server.use(meHandler(log));
    await request('walletCore', meQuery);
    expect(log.headers[0]).toBe(`Bearer ${accessToken()}`);
  });

  it('falls back to the dev user only while nobody is signed in', async () => {
    const log = newLog();
    server.use(meHandler(log));
    await expect(request('walletCore', meQuery)).rejects.toBeDefined();
    expect(log.headers[0]).toBe('Dev 1:wallet');
  });
});

describe('request: silent refresh', () => {
  it('refreshes once on UNAUTHENTICATED and repeats the request', async () => {
    signInForTest({ expired: true });
    const stale = accessToken();
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));

    const result = await request('walletCore', meQuery);
    expect(result.me.id).toBe('1');
    expect(log.refresh).toBe(1);
    expect(log.me).toBe(2);
    expect(accessToken()).not.toBe(stale);
    expect(log.headers[1]).toBe(`Bearer ${accessToken()}`);
  });

  it('does nothing when the token is fine', async () => {
    signInForTest();
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));
    await request('walletCore', meQuery);
    expect(log.refresh).toBe(0);
    expect(log.me).toBe(1);
  });

  it('shares ONE refresh between concurrent failed requests', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      meHandler(log),
      refreshHandler(log, () => delay(50)),
    );

    const results = await Promise.all([
      request('walletCore', meQuery),
      request('walletCore', meQuery),
      request('walletCore', meQuery),
    ]);
    expect(results.map((r) => r.me.id)).toEqual(['1', '1', '1']);
    expect(log.refresh).toBe(1);
    expect(log.me).toBe(6); // 3 failures + 3 retries
  });

  it('does not refresh again when another request already did', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    // The 2nd request answers late, after the 1st request has completed the refresh.
    server.use(
      meHandler(log, async () => {
        if (log.me === 2) await delay(150);
      }),
      refreshHandler(log, () => delay(10)),
    );

    const first = request('walletCore', meQuery);
    const second = request('walletCore', meQuery);
    await Promise.all([first, second]);
    expect(log.refresh).toBe(1);
  });

  it('repeats the request at most once: no refresh loop', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      walletCore.query('Me', () => {
        log.me += 1;
        return unauthenticated();
      }),
      refreshHandler(log),
    );

    await expect(request('walletCore', meQuery)).rejects.toMatchObject({
      response: { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] },
    });
    expect(log.me).toBe(2);
    expect(log.refresh).toBe(1);
    expect(loadSession()).not.toBeNull(); // the session itself is fine
  });

  it('clears the session when the refresh session is over', async () => {
    signInForTest({ expired: true, refreshable: false });
    const log = newLog();
    server.use(meHandler(log));

    await expect(request('walletCore', meQuery)).rejects.toBeDefined();
    expect(loadSession()).toBeNull();
    expect(log.me).toBe(1); // not repeated
  });

  it('keeps the session when the refresh fails for another reason (e.g. server down)', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      meHandler(log),
      refreshHandler(log, async () => errorResponse('INTERNAL_SERVER_ERROR', { status: 503 })),
    );

    // The refresh error itself, not the UNAUTHENTICATED of the request.
    await expect(request('walletCore', meQuery)).rejects.toMatchObject({
      response: { status: 503 },
    });
    expect(loadSession()).not.toBeNull();
    expect(log.me).toBe(1);
  });

  it('never refreshes without a session (anonymous or dev user)', async () => {
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));
    await expect(request('walletCore', meQuery)).rejects.toBeDefined();
    expect(log.refresh).toBe(0);
  });

  it('never refreshes because of an auth operation', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      walletCore.mutation('Login', () => unauthenticated()),
      refreshHandler(log),
    );
    await expect(
      request('walletCore', loginMutation, { input: { email: 'a@b.co', password: 'x' } }),
    ).rejects.toBeDefined();
    expect(log.refresh).toBe(0);
  });

  it('waits for the refresh lock and reuses the token another tab got meanwhile', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));
    // Another tab holds the lock while it refreshes.
    let release!: () => void;
    const held = navigator.locks.request(
      'wallet.refresh',
      () => new Promise<void>((r) => (release = r)),
    );

    const pending = request('walletCore', meQuery);
    await vi.waitFor(() => expect(log.me).toBe(1));
    const renewed = testSession();
    otherTab.write(renewed);
    release();
    await held;

    expect((await pending).me.id).toBe('1');
    expect(log.refresh).toBe(0); // the rotated cookie was not used a second time
    expect(log.headers[1]).toBe(`Bearer ${renewed.accessToken}`);
  });

  it('does not repeat the request as another user who signed in during the request', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      meHandler(log, async () => otherTab.write(testSession(OTHER_USER))),
      refreshHandler(log),
    );

    await expect(request('walletCore', meQuery)).rejects.toMatchObject({
      response: { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] },
    });
    expect(log.me).toBe(1);
    expect(log.refresh).toBe(0);
    expect(loadSession()?.user.id).toBe(OTHER_USER.id);
  });

  it.each([
    ['succeeds', () => undefined],
    ['fails with HTTP 503', () => errorResponse('INTERNAL', { status: 503 })],
  ])(
    'does not repeat the request as another user who signed in during a refresh that %s',
    async (_, answer) => {
      signInForTest({ expired: true });
      const log = newLog();
      server.use(
        meHandler(log),
        refreshHandler(log, async () => {
          otherTab.write(testSession(OTHER_USER));
          return answer();
        }),
      );

      await expect(request('walletCore', meQuery)).rejects.toMatchObject({
        response: { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] },
      });
      expect(log.me).toBe(1);
      expect(log.refresh).toBe(1);
      expect(loadSession()?.user.id).toBe(OTHER_USER.id); // the late answer for user 1 did not overwrite it
    },
  );

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

  it('refreshSession() reports a finished refresh session as false', async () => {
    signInForTest({ refreshable: false });
    await expect(refreshSession()).resolves.toBe(false);
    expect(loadSession()).toBeNull();
  });
});

describe('toRequestError', () => {
  it('carries extensions.field and extensions.lockedUntil', async () => {
    server.use(
      walletCore.mutation('Login', () =>
        HttpResponse.json({
          errors: [
            {
              message: 'locked',
              extensions: {
                code: 'ACCOUNT_LOCKED',
                lockedUntil: '2030-01-01T00:00:00.000Z',
                field: 'x',
              },
            },
          ],
        }),
      ),
    );
    const error = await request('walletCore', loginMutation, {
      input: { email: 'a@b.co', password: 'x' },
    }).catch(toRequestError);
    expect(error).toEqual({
      message: 'locked',
      code: 'ACCOUNT_LOCKED',
      field: 'x',
      lockedUntil: '2030-01-01T00:00:00.000Z',
    });
  });

  describe('no submitted secret in a non-GraphQL failure', () => {
    const SECRET = 'Distinct-Pa55word!-must-never-leak';
    const input = { email: 'leak@example.com', password: SECRET };
    const unavailable = () =>
      server.use(
        walletCore.mutation(
          'Login',
          // A proxy page, not a GraphQL body (hence the cast).
          () => new HttpResponse('Service Unavailable', { status: 503 }) as never,
        ),
      );

    it('keeps the HTTP status as the code and a fixed message', async () => {
      unavailable();
      const error = await request('walletCore', loginMutation, { input }).catch(toRequestError);
      expect(error).toEqual({ message: 'Request failed with HTTP 503', code: '503' });
      expect(JSON.stringify(error)).not.toContain(SECRET);
    });

    it('never reaches the RTK Query error or the Redux state', async () => {
      unavailable();
      const store = createStore();
      const result = await store.dispatch(authApi.endpoints.login.initiate(input));
      expect(result).toHaveProperty('error.code', '503');
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(store.getState())).not.toContain(SECRET);
    });
  });
});
