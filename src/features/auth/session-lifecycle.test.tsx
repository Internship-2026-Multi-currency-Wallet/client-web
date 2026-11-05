import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, HttpResponse } from 'msw';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { AppProviders } from '../../app/AppProviders';
import { routes } from '../../app/routes';
import { createStore } from '../../app/store';
import { DEMO_USER } from '../../mocks/auth-handlers';
import { refreshSession } from '../../graphql/client';
import { clearSession, loadSession, saveSession } from '../../graphql/session';
import { server } from '../../mocks/server';
import {
  deliverStorageEvent,
  OTHER_USER,
  otherTab,
  signInForTest,
  testSession,
} from '../../test/auth';
import { meHandler, newLog, walletCore } from '../../test/graphql-handlers';
import { systemApi } from '../system/systemApi';
import { authApi } from './authApi';
import { useLogout } from './useLogout';

const select = {
  me: (store: ReturnType<typeof createStore>) => systemApi.endpoints.me.select()(store.getState()),
  health: (store: ReturnType<typeof createStore>) =>
    systemApi.endpoints.walletCoreHealth.select()(store.getState()),
};

/** The refresh answer for the session another tab started (the mock users have no user 2). */
const refreshAs = (user: typeof OTHER_USER) =>
  walletCore.mutation('RefreshSession', () => {
    const expiresAt = Date.now() + 900_000;
    return HttpResponse.json({
      data: {
        refreshSession: {
          accessToken: `mock-access.${user.id}.${expiresAt}`,
          accessTokenExpiresAt: new Date(expiresAt).toISOString(),
          user,
        },
      },
    });
  });

describe('stale login response', () => {
  it('does not overwrite a newer session (another tab logged in as someone else)', async () => {
    const store = createStore();
    server.use(
      walletCore.mutation('Login', async () => {
        await delay(60);
        const expiresAt = Date.now() + 900_000;
        return HttpResponse.json({
          data: {
            login: {
              accessToken: `mock-access.1.${expiresAt}`,
              accessTokenExpiresAt: new Date(expiresAt).toISOString(),
              user: { id: '1', email: DEMO_USER.email, phone: null },
            },
          },
        });
      }),
    );

    const login = store.dispatch(authApi.endpoints.login.initiate({ ...DEMO_USER }));
    await delay(10);
    saveSession(testSession(OTHER_USER)); // someone else logged in meanwhile
    const result = await login;

    expect(result.error).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(loadSession()?.user.id).toBe(OTHER_USER.id);
    expect(store.getState().auth.user?.id).toBe(OTHER_USER.id);
  });

  it('does not log the user in again after a logout that happened during the login', async () => {
    const store = createStore();
    const login = store.dispatch(authApi.endpoints.login.initiate({ ...DEMO_USER }));
    clearSession(); // logout while the login request is in flight
    const result = await login;

    expect(result.error).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(loadSession()).toBeNull();
    expect(store.getState().auth.status).toBe('anonymous');
  });
});

describe('private cache isolation', () => {
  it('drops private data when another user takes over, keeps public data', async () => {
    signInForTest();
    const store = createStore();
    await store.dispatch(systemApi.endpoints.me.initiate());
    await store.dispatch(systemApi.endpoints.walletCoreHealth.initiate());
    expect(select.me(store).data?.id).toBe('1');

    act(() => saveSession(testSession(OTHER_USER))); // cross-tab login as another user

    expect(select.me(store).data).toBeUndefined();
    expect(select.health(store).data).toBeDefined(); // public: the settings gate of E1-2 relies on this
  });

  it('drops private data on logout', async () => {
    signInForTest();
    const store = createStore();
    await store.dispatch(systemApi.endpoints.me.initiate());

    act(() => clearSession());

    expect(select.me(store).data).toBeUndefined();
  });

  it('keeps the private cache while the tokens of the SAME user are renewed', async () => {
    signInForTest();
    const store = createStore();
    await store.dispatch(systemApi.endpoints.me.initiate());

    act(() => saveSession(testSession())); // silent refresh: same user, new token

    expect(select.me(store).data?.id).toBe('1');
  });

  it("drops user A's private data when this tab refreshes the session that tab B already started as user B", async () => {
    signInForTest(); // tab A: user 1, with cached Me
    const store = createStore();
    await store.dispatch(systemApi.endpoints.me.initiate());
    expect(select.me(store).data?.id).toBe('1');

    // Tab B logs in as user 2; this tab has not received the storage event yet.
    otherTab.login(testSession(OTHER_USER, { expired: true }));
    server.use(refreshAs(OTHER_USER));
    // This tab refreshes the persisted session (now B's): for the storage B -> B is no identity change,
    // but for this store (A -> B) it is.
    await act(() => refreshSession());

    expect(store.getState().auth.user?.id).toBe(OTHER_USER.id);
    expect(select.me(store).data).toBeUndefined(); // A's data must not stay visible for B

    act(() => deliverStorageEvent()); // the delayed event changes nothing more
    expect(select.me(store).data).toBeUndefined();
  });

  it('keeps public data in that same A -> B switch', async () => {
    signInForTest();
    const store = createStore();
    await store.dispatch(systemApi.endpoints.walletCoreHealth.initiate());
    otherTab.login(testSession(OTHER_USER, { expired: true }));
    server.use(refreshAs(OTHER_USER));

    await act(() => refreshSession());

    expect(select.health(store).data).toBeDefined();
  });

  it('never caches an answer that arrives after the user changed', async () => {
    signInForTest();
    const store = createStore();
    server.use(meHandler(newLog(), () => delay(60)));

    const pending = store.dispatch(systemApi.endpoints.me.initiate());
    await delay(10);
    act(() => clearSession()); // logout while user 1's request is still on the wire
    const result = await pending;

    expect(result.data).toBeUndefined();
    expect(select.me(store).data).toBeUndefined();
  });

  it('shows the new user, not the previous one, on screen after a cross-tab identity change', async () => {
    signInForTest();
    const store = createStore();
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    render(
      <AppProviders store={store}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByTestId('me')).toHaveTextContent('Dev user: 1');

    act(() => saveSession(testSession(OTHER_USER)));

    expect(await screen.findByText('other@example.com')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('me')).toHaveTextContent('Dev user: 2'));
    expect(screen.queryByText('Dev user: 1', { exact: false })).not.toBeInTheDocument();
  });
});

describe('logout does not wait for the server', () => {
  function Harness({ timeoutMs }: { timeoutMs: number }) {
    const logout = useLogout(timeoutMs);
    // A layout like AppLayout: it stays mounted while the route changes, so it can follow the location.
    return (
      <>
        <button onClick={() => void logout()}>Log out now</button>
        <Outlet />
      </>
    );
  }

  function renderHarness(timeoutMs = 60) {
    const store = createStore();
    const router = createMemoryRouter(
      [{ element: <Harness timeoutMs={timeoutMs} />, children: routes[0].children }],
      { initialEntries: ['/'] },
    );
    render(
      <AppProviders store={store}>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    return { store, router };
  }

  it('cancels local access immediately even if the backend hangs, then says it is unconfirmed', async () => {
    signInForTest();
    server.use(walletCore.mutation('Logout', () => delay('infinite')));
    const { store, router } = renderHarness(80);

    await userEvent.click(screen.getByRole('button', { name: 'Log out now' }));

    // Right away: no waiting for the server.
    expect(loadSession()).toBeNull();
    expect(store.getState().auth.status).toBe('anonymous');
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByText(/did not confirm/i)).not.toBeInTheDocument();

    // After the bounded wait the user is told that the server did not confirm the revocation.
    expect(await screen.findByText(/did not confirm/i)).toBeInTheDocument();
  });

  it('shows no warning when the server confirms the revocation', async () => {
    signInForTest();
    const { router } = renderHarness(500);

    await userEvent.click(screen.getByRole('button', { name: 'Log out now' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    await delay(100);

    expect(screen.queryByText(/did not confirm/i)).not.toBeInTheDocument();
    expect(document.cookie).not.toContain('mock_refresh'); // the mock server revoked it
  });

  it('reports an unreachable server as unconfirmed too', async () => {
    signInForTest();
    server.use(walletCore.mutation('Logout', () => HttpResponse.error()));
    renderHarness(500);

    await userEvent.click(screen.getByRole('button', { name: 'Log out now' }));

    expect(await screen.findByText(/did not confirm/i)).toBeInTheDocument();
    expect(loadSession()).toBeNull();
  });
});

describe('stale login across tabs (no storage event yet)', () => {
  const slowLogin = () =>
    walletCore.mutation('Login', async () => {
      await delay(60);
      const expiresAt = Date.now() + 900_000;
      return HttpResponse.json({
        data: {
          login: {
            accessToken: `mock-access.1.${expiresAt}`,
            accessTokenExpiresAt: new Date(expiresAt).toISOString(),
            user: { id: '1', email: DEMO_USER.email, phone: null },
          },
        },
      });
    });

  it('a login finishing after another tab logged in (same user) does not overwrite it', async () => {
    const store = createStore();
    server.use(slowLogin());
    const newer = testSession();

    const login = store.dispatch(authApi.endpoints.login.initiate({ ...DEMO_USER }));
    await delay(10);
    otherTab.login(newer);
    const result = await login;

    expect(result.error).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(loadSession()?.accessToken).toBe(newer.accessToken);
  });

  it('after the delayed storage event the store follows the session that won', async () => {
    const store = createStore();
    server.use(slowLogin());

    const login = store.dispatch(authApi.endpoints.login.initiate({ ...DEMO_USER }));
    await delay(10);
    otherTab.login(testSession(OTHER_USER));
    await login;
    act(() => deliverStorageEvent());

    expect(store.getState().auth.user?.id).toBe(OTHER_USER.id);
  });

  it('a stale refresh does not resurrect the session in the store either', async () => {
    signInForTest({ expired: true });
    const store = createStore();
    await delay(10);
    otherTab.logout();
    await delay(100);
    act(() => deliverStorageEvent());

    expect(loadSession()).toBeNull();
    expect(store.getState().auth.status).toBe('anonymous');
  });
});

describe('public data survives identity changes', () => {
  it('keeps public data cached and a public request finishing after logout succeeds', async () => {
    signInForTest();
    const store = createStore();
    await store.dispatch(systemApi.endpoints.walletCoreHealth.initiate());
    const pending = store.dispatch(
      systemApi.endpoints.walletCoreHealth.initiate(undefined, { forceRefetch: true }),
    );
    act(() => clearSession());
    const result = await pending;

    expect(result.isError).toBe(false);
    expect(select.health(store).data).toBeDefined();
  });
});

describe('delayed logout response vs. a new login', () => {
  function Harness({ timeoutMs }: { timeoutMs: number }) {
    const logout = useLogout(timeoutMs);
    return <button onClick={() => void logout()}>Log out now</button>;
  }

  it('login waits for the aborted logout, so the late response cannot delete the new refresh cookie', async () => {
    signInForTest();
    const events: string[] = [];
    let logoutAborted = false;
    server.use(
      walletCore.mutation('Logout', async ({ request }) => {
        events.push('logout:start');
        request.signal.addEventListener('abort', () => {
          logoutAborted = true;
          events.push('logout:aborted');
        });
        await delay(250); // the server is slow; its answer would arrive after the new login
        return HttpResponse.json({ data: { logout: true } });
      }),
    );
    const store = createStore();
    const router = createMemoryRouter([{ path: '*', element: <Harness timeoutMs={50} /> }]);
    render(
      <AppProviders store={store}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Log out now' }));
    expect(loadSession()).toBeNull();

    // The user logs in again right away, while the logout request is still unanswered.
    const login = await store.dispatch(authApi.endpoints.login.initiate({ ...DEMO_USER }));
    events.push('login:done');
    expect(login.error).toBeUndefined();
    expect(logoutAborted).toBe(true); // the login did not start before the logout request was dropped

    await delay(300); // the late logout response time has passed
    expect(document.cookie).toContain('mock_refresh'); // the new login's cookie is intact
    await expect(refreshSession()).resolves.toBe(true);
    expect(events.indexOf('logout:aborted')).toBeLessThan(events.indexOf('login:done'));
  });
});
