import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, HttpResponse } from 'msw';
import {
  accessToken,
  loadSession,
  type Session,
  sessionWritesSettled,
} from '../../graphql/session';
import { setMockRefreshCookie } from '../../mocks/auth-handlers';
import { server } from '../../mocks/server';
import {
  deliverStorageEvent,
  OTHER_USER,
  otherTab,
  signInForTest,
  storedRecord,
  testSession,
  writeStoredRecord,
} from '../../test/auth';
import {
  errorResponse,
  meHandler,
  newLog,
  refreshHandler,
  walletCore,
} from '../../test/graphql-handlers';
import { renderApp } from '../../test/render';

describe('protected routes and session lifecycle', () => {
  it('redirects an anonymous user from the wallet to Login', async () => {
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('heading', { name: 'Welcome' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('keeps public pages open without a session', async () => {
    renderApp('/signup');
    expect(await screen.findByRole('heading', { name: 'Create account' })).toBeInTheDocument();
  });

  it('restores the session after a reload (a new store reads localStorage)', async () => {
    signInForTest();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(await screen.findByTestId('me')).toHaveTextContent('Dev user: 1');
    expect(screen.getByText('demo@example.com')).toBeInTheDocument();
  });

  it('refreshes an expired access token invisibly after a reload', async () => {
    signInForTest({ expired: true });
    const stale = accessToken();
    const { router } = renderApp('/');

    expect(await screen.findByTestId('me')).toHaveTextContent('Dev user: 1');
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(accessToken()).not.toBe(stale);
  });

  it('treats the user as logged out when the refresh session is over', async () => {
    signInForTest({ expired: true, refreshable: false });
    const { router } = renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(loadSession()).toBeNull();
  });

  it('shows nothing private while an expired session is being renewed, then opens the page', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      meHandler(log),
      refreshHandler(log, () => delay(80)),
    );
    renderApp('/');

    expect(await screen.findByText('Restoring your session…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome' })).not.toBeInTheDocument();
    expect(screen.queryByText('demo@example.com')).not.toBeInTheDocument();
    expect(log.me).toBe(0); // the stale token was never used

    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(log.refresh).toBe(1);
    expect(log.headers.every((header) => header === `Bearer ${accessToken()}`)).toBe(true);
  });

  it('does not treat a temporary server failure as a lost session: keeps it and offers Retry', async () => {
    signInForTest({ expired: true });
    let up = false;
    server.use(
      walletCore.mutation('RefreshSession', () =>
        up
          ? HttpResponse.json({
              data: {
                refreshSession: {
                  accessToken: `mock-access.1.${Date.now() + 900_000}`,
                  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
                  user: { id: '1', email: 'demo@example.com', phone: null },
                },
              },
            })
          : errorResponse('INTERNAL_SERVER_ERROR', { status: 503 }),
      ),
    );
    const { router } = renderApp('/');

    expect(
      await screen.findByText(/could not reach the server to restore your session/i),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(loadSession()).not.toBeNull(); // not logged out
    expect(screen.queryByRole('heading', { name: 'Welcome' })).not.toBeInTheDocument();

    up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('treats a network failure during restoration like a temporary one', async () => {
    signInForTest({ expired: true });
    server.use(walletCore.mutation('RefreshSession', () => HttpResponse.error()));
    renderApp('/');

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(loadSession()).not.toBeNull();
  });

  it.each([
    ['no expiry', { accessToken: 't', user: { id: '1', email: 'a@b.co' } }],
    [
      'unparsable expiry',
      { accessToken: 't', accessTokenExpiresAt: 'soon', user: { id: '1', email: 'a@b.co' } },
    ],
    [
      'empty token',
      {
        accessToken: '',
        accessTokenExpiresAt: '2099-01-01T00:00:00Z',
        user: { id: '1', email: 'a@b.co' },
      },
    ],
    [
      'no user id',
      { accessToken: 't', accessTokenExpiresAt: '2099-01-01T00:00:00Z', user: { email: 'a@b.co' } },
    ],
    ['no user', { accessToken: 't', accessTokenExpiresAt: '2099-01-01T00:00:00Z' }],
  ])('does not trust stored data with %s', async (_label, stored) => {
    writeStoredRecord('g1', stored as Session);
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));
    const { router } = renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(loadSession()).toBeNull();
    expect(log.me + log.refresh).toBe(0);
  });

  it('does not restore a session from the refresh cookie alone (no stored session = logged out)', async () => {
    setMockRefreshCookie('1'); // a valid cookie, but nothing in localStorage
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(log.refresh).toBe(0);
  });

  it('stays logged out after an explicit logout even if the server never confirmed it', async () => {
    signInForTest();
    server.use(walletCore.mutation('Logout', () => HttpResponse.error())); // the cookie survives
    const first = renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    await screen.findByRole('heading', { name: 'Log in' });
    first.unmount();
    expect(document.cookie).toContain('mock_refresh'); // still valid on the "server"

    const log = newLog();
    server.use(refreshHandler(log));
    renderApp('/'); // a reload
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(log.refresh).toBe(0);
  });

  it('logs out: revokes the session, clears local state and returns to Login', async () => {
    signInForTest();
    const { router } = renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(loadSession()).toBeNull();
    await sessionWritesSettled();
    expect(storedRecord().session).toBeNull(); // written to the shared storage too
    // The mock Logout ran and dropped its refresh cookie, i.e. the server session was revoked.
    expect(document.cookie).not.toContain('mock_refresh');

    // The wallet is closed again.
    await act(() => router.navigate('/'));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('logs out locally even when the server cannot be reached', async () => {
    signInForTest();
    server.use(walletCore.mutation('Logout', () => HttpResponse.error()));
    renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(loadSession()).toBeNull();
  });

  it('follows a logout made in another tab', async () => {
    signInForTest();
    const { router } = renderApp('/');
    await screen.findByRole('heading', { name: 'Welcome' });

    act(() => {
      otherTab.logout();
      deliverStorageEvent();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('follows a login as another user in another tab', async () => {
    signInForTest();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Welcome' });
    expect(screen.getByText('demo@example.com')).toBeInTheDocument();

    act(() => {
      otherTab.login(testSession(OTHER_USER));
      deliverStorageEvent();
    });

    expect(await screen.findByText('other@example.com')).toBeInTheDocument();
    expect(screen.queryByText('demo@example.com')).not.toBeInTheDocument();
  });

  it('follows a token refresh made in another tab without reloading the page data', async () => {
    signInForTest();
    const log = newLog();
    server.use(meHandler(log));
    renderApp('/');
    await screen.findByTestId('me');
    expect(log.me).toBe(1);

    act(() => {
      otherTab.refresh(testSession());
      deliverStorageEvent();
    });
    await delay(80);

    expect(screen.getByTestId('me')).toHaveTextContent('Dev user: 1'); // still there, same user
    expect(log.me).toBe(1); // not fetched again
  });
});
