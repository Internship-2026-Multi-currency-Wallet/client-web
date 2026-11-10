import { HttpResponse } from 'msw';
import { type AppStore, createStore } from '../../app/store';
import { server } from '../../mocks/server';
import { signInForTest } from '../../test/auth';
import { newLog, refreshHandler, unauthenticated, walletCore } from '../../test/graphql-handlers';
import { loadSession } from '../../graphql/session';
import { authApi } from './authApi';

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
