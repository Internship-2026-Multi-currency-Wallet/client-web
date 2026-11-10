import { HttpResponse } from 'msw';
import { type AppStore, createStore } from '../../app/store';
import { server } from '../../mocks/server';
import { signInForTest } from '../../test/auth';
import { newLog, refreshHandler, unauthenticated, walletCore } from '../../test/graphql-handlers';
import { loadSession } from '../../graphql/session';
import { authApi } from './authApi';
import { describeLoginError, describeRegisterError, formatUnlockTime } from './authErrors';
import { PASSWORD_HINT } from './validation';

const input = { email: 'demo@example.com', password: 'Str0ng-Pa55word!' };

// Each auth mutation creates or ends the session itself: its UNAUTHENTICATED is the answer, never a reason to
// refresh and send it (with the password) a second time. An expired session is present, so the default policy would
// refresh.
const send = {
  Login: (store: AppStore) => store.dispatch(authApi.endpoints.login.initiate(input)),
  Register: (store: AppStore) =>
    store.dispatch(authApi.endpoints.register.initiate({ ...input, phone: null })),
  Logout: (store: AppStore) => store.dispatch(authApi.endpoints.logout.initiate()),
};

describe.each(['Login', 'Register', 'Logout'] as const)(
  'authApi: %s on UNAUTHENTICATED',
  (operationName) => {
    it('is sent once and never refreshes the session', async () => {
      // The store first: with an expired session it would refresh on its own at start (restoreSession).
      const store = createStore();
      signInForTest({ expired: true });
      const before = loadSession();
      const log = newLog();
      let calls = 0;
      server.use(
        walletCore.mutation(operationName, () => {
          calls += 1;
          return unauthenticated();
        }),
        refreshHandler(log),
      );

      const result = await send[operationName](store);

      expect(result).toHaveProperty('error.code', 'UNAUTHENTICATED');
      expect(calls).toBe(1);
      expect(log.refresh).toBe(0);
      expect(loadSession()).toEqual(before);
    });
  },
);

describe('authApi.logout (no variables)', () => {
  it('sends the mutation once without variables and resolves', async () => {
    signInForTest();
    const bodies: Record<string, unknown>[] = [];
    server.use(
      walletCore.mutation('Logout', ({ variables }) => {
        bodies.push(variables);
        return HttpResponse.json({ data: { logout: true } });
      }),
    );
    const store = createStore();

    const result = await store.dispatch(authApi.endpoints.logout.initiate());

    expect(result).toHaveProperty('data', true);
    expect(bodies).toEqual([{}]); // one call, no variables
  });
});

// The filtered extensions still carry what the forms show.
describe('authApi errors as the forms see them', () => {
  const diagnostics = { stacktrace: ['at AuthService'], exception: { name: 'Internal' } };

  it('ACCOUNT_LOCKED still shows the unlock time', async () => {
    const lockedUntil = '2030-01-01T10:15:00.000Z';
    server.use(
      walletCore.mutation('Login', () =>
        HttpResponse.json({
          errors: [
            {
              message: 'locked',
              extensions: { code: 'ACCOUNT_LOCKED', lockedUntil, ...diagnostics },
            },
          ],
        }),
      ),
    );
    const store = createStore();

    const result = await store.dispatch(authApi.endpoints.login.initiate(input));

    expect(result.error).toEqual({
      message: 'locked',
      code: 'ACCOUNT_LOCKED',
      extensions: { code: 'ACCOUNT_LOCKED', lockedUntil },
    });
    expect(describeLoginError(result.error!)).toBe(
      `Too many failed attempts. Your account is locked until ${formatUnlockTime(lockedUntil)}.`,
    );
  });

  it('BAD_USER_INPUT still names the invalid field', async () => {
    server.use(
      walletCore.mutation('Register', () =>
        HttpResponse.json({
          errors: [
            {
              message: 'dev text',
              extensions: { code: 'BAD_USER_INPUT', field: 'password', ...diagnostics },
            },
          ],
        }),
      ),
    );
    const store = createStore();

    const result = await store.dispatch(
      authApi.endpoints.register.initiate({ ...input, phone: null }),
    );

    expect(result.error).toEqual({
      message: 'dev text',
      code: 'BAD_USER_INPUT',
      field: 'password',
      extensions: { code: 'BAD_USER_INPUT', field: 'password' },
    });
    expect(describeRegisterError(result.error!)).toEqual({
      fieldErrors: { password: PASSWORD_HINT },
    });
    expect(JSON.stringify(store.getState())).not.toContain(input.password);
  });
});
