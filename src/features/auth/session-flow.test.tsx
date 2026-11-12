import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { accessToken, loadSession } from '../../graphql/session';
import { setMockRefreshCookie } from '../../mocks/auth-handlers';
import { server } from '../../mocks/server';
import { OTHER_USER, otherTab, signInForTest, testSession } from '../../test/auth';
import {
  errorResponse,
  meHandler,
  newLog,
  refreshHandler,
  walletCore,
} from '../../test/graphql-handlers';
import { renderApp } from '../../test/render';

describe('protected routes', () => {
  it('redirects an anonymous user from the wallet to Login', async () => {
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('keeps public pages open without a session', async () => {
    renderApp('/signup');
    expect(await screen.findByRole('heading', { name: 'Create account' })).toBeInTheDocument();
  });

  it('does not trust malformed stored data and sends nothing with it', async () => {
    localStorage.setItem('wallet.session', JSON.stringify({ accessToken: 't', user: {} }));
    const log = newLog();
    server.use(meHandler(log), refreshHandler(log));
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(log.me + log.refresh).toBe(0);
  });
});

describe('session after a reload', () => {
  it('restores the session from localStorage', async () => {
    signInForTest();
    renderApp('/');
    expect(await screen.findByTestId('me')).toHaveTextContent('Authenticated user: 1');
    expect(screen.getByText('demo@example.com')).toBeInTheDocument();
  });

  it('refreshes an expired access token invisibly, showing nothing private meanwhile', async () => {
    signInForTest({ expired: true });
    const stale = accessToken();
    const log = newLog();
    let renewed!: () => void;
    const renewal = new Promise<void>((resolve) => (renewed = resolve));
    server.use(
      meHandler(log),
      refreshHandler(log, () => renewal),
    );
    renderApp('/');

    try {
      expect(await screen.findByText('Restoring your session…')).toBeInTheDocument();
      expect(screen.queryByText('demo@example.com')).not.toBeInTheDocument();
      expect(log.me).toBe(0); // the expired token is never sent
    } finally {
      renewed();
    }
    expect(await screen.findByTestId('me')).toHaveTextContent('Authenticated user: 1');
    expect(log.refresh).toBe(1);
    expect(accessToken()).not.toBe(stale);
  });

  it('treats the user as logged out when the refresh session is over', async () => {
    signInForTest({ expired: true, refreshable: false });
    const { router } = renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(loadSession()).toBeNull();
  });

  it('does not log out because the server is temporarily down', async () => {
    signInForTest({ expired: true });
    server.use(
      walletCore.mutation('RefreshSession', () => errorResponse('INTERNAL', { status: 503 })),
    );
    const { router } = renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(loadSession()).not.toBeNull();
    expect(await screen.findByText(/Could not load your account/)).toBeInTheDocument();
  });

  it('does not restore a session from the refresh cookie alone', async () => {
    setMockRefreshCookie('1'); // a valid cookie, but nothing in localStorage
    const log = newLog();
    server.use(refreshHandler(log));
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(log.refresh).toBe(0);
  });
});

describe('logout', () => {
  it('clears the session, revokes the cookie and returns to Login', async () => {
    signInForTest();
    const { router } = renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(loadSession()).toBeNull();
    await waitFor(() => expect(document.cookie).not.toContain('mock_refresh'));

    await act(() => router.navigate('/'));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('logs out locally even when the server cannot be reached, and stays logged out after a reload', async () => {
    signInForTest();
    server.use(walletCore.mutation('Logout', () => HttpResponse.error()));
    const first = renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(loadSession()).toBeNull();
    first.unmount();

    const log = newLog();
    server.use(refreshHandler(log));
    renderApp('/'); // a reload: the surviving cookie alone does not sign in
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(log.refresh).toBe(0);
  });
});

describe('other tabs and the cache', () => {
  it('follows a logout made in another tab', async () => {
    signInForTest();
    const { router } = renderApp('/');
    await screen.findByRole('heading', { name: 'Welcome' });

    act(() => {
      otherTab.write(null);
      otherTab.notify();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it("drops the previous user's data when another user logs in in another tab; settings stay", async () => {
    signInForTest();
    const log = newLog();
    server.use(meHandler(log));
    renderApp('/');
    expect(await screen.findByTestId('me')).toHaveTextContent('Authenticated user: 1');

    act(() => {
      otherTab.write(testSession(OTHER_USER));
      otherTab.notify();
    });

    expect(screen.queryByText('Loading settings…')).not.toBeInTheDocument();
    expect(screen.queryByText('demo@example.com')).not.toBeInTheDocument();
    expect(await screen.findByText('other@example.com')).toBeInTheDocument();
    expect(await screen.findByTestId('me')).toHaveTextContent('Authenticated user: 2');
  });

  it('keeps the cached data when another tab only refreshed the token', async () => {
    signInForTest();
    const log = newLog();
    server.use(meHandler(log));
    renderApp('/');
    await screen.findByTestId('me');

    act(() => {
      otherTab.write(testSession());
      otherTab.notify();
    });

    expect(screen.getByTestId('me')).toHaveTextContent('Authenticated user: 1');
    expect(log.me).toBe(1);
  });
});
