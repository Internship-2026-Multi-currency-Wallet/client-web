import { type DocumentNode, Kind } from 'graphql';
import { delay, HttpResponse } from 'msw';
import type { LoginMutation, MeQuery } from '../gql/wallet-core/graphql';
import { meQuery } from '../features/system/system.wallet-core';
import { loginMutation } from '../features/auth/auth.wallet-core';
import { userIdFromBearer } from '../mocks/auth-handlers';
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
import { request } from './client';
import { toRequestError } from './errors';
import { accessToken, loadSession } from './session';

/**
 * Another tab holds the refresh lock. `refreshQueued` resolves once this tab's refresh asks for the same lock, so
 * the test changes the storage exactly while that refresh waits, without sleeps or polling.
 */
async function otherTabHoldsRefreshLock() {
  let releaseLock!: () => void;
  let held!: Promise<void>;
  await new Promise<void>((acquired) => {
    held = navigator.locks.request('wallet.refresh', () => {
      acquired();
      return new Promise<void>((r) => (releaseLock = r));
    });
  });
  // Safe to call twice: resolving a settled promise is a no-op.
  const release = async () => {
    releaseLock();
    await held;
  };
  const locks = navigator.locks;
  const original = locks.request.bind(locks) as (
    name: string,
    callback: () => Promise<unknown>,
  ) => Promise<unknown>;
  let queued!: () => void;
  const refreshQueued = new Promise<void>((r) => (queued = r));
  const spy = vi.spyOn(locks, 'request').mockImplementation(((
    name: string,
    callback: () => Promise<unknown>,
  ) => {
    if (name === 'wallet.refresh') queued();
    return original(name, callback);
  }) as typeof locks.request);
  // Also when an assertion fails before `release()`: a lock left held would hang every later refresh.
  onTestFinished(async () => {
    spy.mockRestore();
    await release();
  });
  return { refreshQueued, release };
}

/** The same document under another operation name. */
function renamed<T extends DocumentNode>(document: T, name: string): T {
  return {
    ...document,
    definitions: document.definitions.map((definition) =>
      definition.kind === Kind.OPERATION_DEFINITION
        ? { ...definition, name: { kind: Kind.NAME, value: name } }
        : definition,
    ),
  };
}

describe('request: typing', () => {
  it('keeps results and variables typed by the document (checked by tsc, never run)', () => {
    const typed = async () => {
      expectTypeOf(await request('walletCore', meQuery)).toEqualTypeOf<MeQuery>();
      expectTypeOf(
        await request('walletCore', meQuery, undefined, { retryOnUnauthenticated: false }),
      ).toEqualTypeOf<MeQuery>();
      expectTypeOf(
        await request('walletCore', loginMutation, { input: { email: 'a@b.co', password: 'x' } }),
      ).toEqualTypeOf<LoginMutation>();
      // @ts-expect-error the variables of Login are required
      await request('walletCore', loginMutation);
      // @ts-expect-error the variables must match the document
      await request('walletCore', loginMutation, { input: { email: 1 } });
      // @ts-expect-error Me has no variables
      await request('walletCore', meQuery, { id: '1' });
      // @ts-expect-error unknown option
      await request('walletCore', meQuery, undefined, { retry: false });
    };
    expect(typed).toBeTypeOf('function');
  });
});

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

  it('never refreshes when the call opts out (retryOnUnauthenticated: false)', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    let logins = 0;
    server.use(
      walletCore.mutation('Login', () => {
        logins += 1;
        return unauthenticated();
      }),
      refreshHandler(log),
    );
    await expect(
      request(
        'walletCore',
        loginMutation,
        { input: { email: 'a@b.co', password: 'x' } },
        { retryOnUnauthenticated: false },
      ),
    ).rejects.toBeDefined();
    expect(log.refresh).toBe(0);
    expect(logins).toBe(1); // not repeated
  });

  it('opts out for an operation without variables too', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));
    await expect(
      request('walletCore', meQuery, undefined, { retryOnUnauthenticated: false }),
    ).rejects.toMatchObject({
      response: { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] },
    });
    expect(log.refresh).toBe(0);
    expect(log.me).toBe(1);
  });

  it('the operation name does not decide the policy', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    let signIns = 0;
    server.use(
      // `Me` named like the old auth operation: still refreshed and repeated by default.
      walletCore.query('Login', ({ request }) => {
        log.me += 1;
        const id = userIdFromBearer(request.headers.get('authorization'));
        return id
          ? HttpResponse.json({ data: { me: { id, permissions: [], strategy: 'jwt' } } })
          : unauthenticated();
      }),
      // `Login` renamed: still not repeated, because the caller said so.
      walletCore.mutation('SignIn', () => {
        signIns += 1;
        return unauthenticated();
      }),
      refreshHandler(log),
    );

    expect((await request('walletCore', renamed(meQuery, 'Login'))).me.id).toBe('1');
    expect(log.me).toBe(2);
    expect(log.refresh).toBe(1);

    await expect(
      request(
        'walletCore',
        renamed(loginMutation, 'SignIn'),
        { input: { email: 'a@b.co', password: 'x' } },
        { retryOnUnauthenticated: false },
      ),
    ).rejects.toBeDefined();
    expect(signIns).toBe(1);
    expect(log.refresh).toBe(1); // no second refresh
  });

  it('waits for the refresh lock and reuses the token another tab got meanwhile', async () => {
    signInForTest({ expired: true });
    const stale = accessToken();
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));
    const otherTabLock = await otherTabHoldsRefreshLock();

    const pending = request('walletCore', meQuery);
    // The request got UNAUTHENTICATED and its refresh now waits for the lock of the other tab.
    await otherTabLock.refreshQueued;
    expect(log.me).toBe(1);
    const renewed = testSession();
    otherTab.write(renewed);
    await otherTabLock.release();

    expect((await pending).me.id).toBe('1');
    expect(log.refresh).toBe(0); // the rotated cookie was not used a second time
    expect(log.me).toBe(2); // one failure, one retry
    expect(log.headers).toEqual([`Bearer ${stale}`, `Bearer ${renewed.accessToken}`]);
    expect(loadSession()).toEqual(renewed);
  });

  it('does not repeat the request as another user who signed in while the refresh waited for the lock', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));
    const otherTabLock = await otherTabHoldsRefreshLock();

    const pending = request('walletCore', meQuery);
    await otherTabLock.refreshQueued;
    const other = testSession(OTHER_USER);
    otherTab.write(other);
    await otherTabLock.release();

    await expect(pending).rejects.toMatchObject({
      response: { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] },
    });
    expect(log.me).toBe(1); // never replayed with the other user's token
    expect(log.refresh).toBe(0);
    expect(loadSession()).toEqual(other);
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
});

describe('toRequestError', () => {
  it('carries extensions.field and the raw extensions', async () => {
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
      extensions: {
        code: 'ACCOUNT_LOCKED',
        lockedUntil: '2030-01-01T00:00:00.000Z',
        field: 'x',
      },
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

    it('keeps a GraphQL error with extensions serializable and free of the variables', async () => {
      server.use(
        walletCore.mutation('Login', () =>
          HttpResponse.json({
            errors: [
              {
                message: 'locked',
                extensions: { code: 'ACCOUNT_LOCKED', lockedUntil: '2030-01-01T00:00:00.000Z' },
              },
            ],
          }),
        ),
      );
      const store = createStore();
      const result = await store.dispatch(authApi.endpoints.login.initiate(input));
      expect(result).toHaveProperty('error.extensions.lockedUntil', '2030-01-01T00:00:00.000Z');
      expect(JSON.parse(JSON.stringify(result.error))).toEqual(result.error);
      expect(JSON.stringify(result)).not.toContain(SECRET);
      expect(JSON.stringify(store.getState())).not.toContain(SECRET);
    });
  });
});
