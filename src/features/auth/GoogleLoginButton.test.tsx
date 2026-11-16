import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, HttpResponse } from 'msw';
import type { LoginWithGoogleMutationVariables } from '../../gql/wallet-core/graphql';
import { loadSession } from '../../graphql/session';
import { mockAccessToken } from '../../mocks/auth-handlers';
import { seedMockGoogleLink } from '../../mocks/google-handlers';
import { server } from '../../mocks/server';
import { OTHER_USER, otherTab, TEST_USER, testSession } from '../../test/auth';
import { googleLoginOff, stubGooglePopup } from '../../test/google';
import { errorResponse, walletCore } from '../../test/graphql-handlers';
import { authApi } from './authApi';
import { renderApp } from '../../test/render';

const googleButton = () => screen.getByRole('button', { name: /continue with google|waiting/i });

async function openLogin() {
  const app = renderApp('/login');
  await screen.findByRole('heading', { name: 'Log in' });
  return app;
}

async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('Continue with Google', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs in with a linked Google account and lands in the wallet', async () => {
    seedMockGoogleLink('1', 'demo.google@example.com');
    const google = stubGooglePopup();
    const { router } = await openLogin();
    expect(googleButton().querySelector('img')).toHaveAttribute('src', '/icons/google.svg');

    await userEvent.click(googleButton());
    expect(googleButton()).toHaveTextContent('Waiting for Google…');
    expect(googleButton()).toBeDisabled();
    await google.approve('demo.google@example.com');

    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(loadSession()?.user.email).toBe('demo@example.com');
    expect(google.popup.closed).toBe(true);
  });

  it('sends the user to Google with state, nonce and PKCE, and passes them on to wallet-core', async () => {
    let variables: LoginWithGoogleMutationVariables | undefined;
    server.use(
      walletCore.mutation<never, LoginWithGoogleMutationVariables>('LoginWithGoogle', (req) => {
        variables = req.variables;
        return errorResponse('GOOGLE_ACCOUNT_NOT_LINKED');
      }),
    );
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());

    const url = await google.authorizeUrl();
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({
      client_id: 'test-client.apps.googleusercontent.com',
      redirect_uri: `${location.origin}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      code_challenge_method: 'S256',
    });
    expect(params.state).toBeTruthy();
    expect(params.nonce).toBeTruthy();

    await google.approve('someone@example.com');
    await screen.findByRole('alert');
    expect(variables?.input).toMatchObject({
      state: params.state,
      redirectUri: params.redirect_uri,
    });
    expect(await sha256Base64Url(variables?.input.codeVerifier ?? '')).toBe(params.code_challenge);
  });

  it('lets the user cancel the wait, and says so', async () => {
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());
    await google.authorizeUrl();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in was cancelled.');
    expect(googleButton()).toBeEnabled();
    expect(loadSession()).toBeNull();
  });

  it('keeps waiting for the callback when the popup reports itself closed, as a COOP-detached one does', async () => {
    seedMockGoogleLink('1', 'demo.google@example.com');
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());
    await google.authorizeUrl();
    google.popup.closed = true;

    await delay(2000);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(googleButton()).toHaveTextContent('Waiting for Google…');

    await google.approve('demo.google@example.com');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('treats Cancel on the Google screen like a closed window', async () => {
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());
    await google.deny();

    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in was cancelled.');
    expect(google.popup.closed).toBe(true);
  });

  it('explains a Google account that is not linked to any user', async () => {
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());
    await google.approve('stranger@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /not linked to any account.*link google in your account settings/i,
    );
    expect(loadSession()).toBeNull();
  });

  it('explains a blocked popup without starting a sign-in', async () => {
    let started = 0;
    server.use(
      walletCore.mutation('StartGoogleLogin', () => {
        started += 1;
        return HttpResponse.json({ data: null });
      }),
    );
    vi.spyOn(window, 'open').mockReturnValue(null);
    await openLogin();
    await userEvent.click(googleButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/allow pop-ups/i);
    expect(started).toBe(0);
  });

  it('closes the popup when the sign-in cannot start', async () => {
    server.use(
      walletCore.mutation('StartGoogleLogin', () => errorResponse('GOOGLE_LOGIN_DISABLED')),
    );
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in with Google is not available right now.',
    );
    await waitFor(() => expect(google.popup.closed).toBe(true));
  });

  it('does not blame the server for a failure in the browser', async () => {
    // E.g. `crypto.subtle` missing outside a secure context.
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new TypeError('boom'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    );
    expect(consoleError).toHaveBeenCalled();
    expect(google.popup.closed).toBe(true);
  });

  it('locks the password form while the Google window is open', async () => {
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());

    expect(screen.getByLabelText(/^email/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /^log in$/i })).toBeDisabled();
    await google.authorizeUrl();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/^email/i)).toBeEnabled();
  });

  it('waits while a password login is running', async () => {
    server.use(
      walletCore.mutation('Login', async () => {
        await delay(200);
        return errorResponse('INVALID_CREDENTIALS');
      }),
    );
    await openLogin();
    await userEvent.type(screen.getByLabelText(/^email/i), 'demo@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Wrong1234!');
    await userEvent.click(screen.getByRole('button', { name: /^log in$/i }));

    expect(googleButton()).toBeDisabled();
    await screen.findByRole('alert');
    expect(googleButton()).toBeEnabled();
  });

  it('never replaces a session that started while the Google window was open', async () => {
    let exchanges = 0;
    server.use(
      walletCore.mutation('LoginWithGoogle', () => {
        exchanges += 1;
        return errorResponse('GOOGLE_ACCOUNT_NOT_LINKED');
      }),
    );
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());
    await google.authorizeUrl();

    // Another tab logs in: this page leaves the login screen and cancels the Google sign-in.
    otherTab.write(testSession(OTHER_USER));
    otherTab.notify();
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(google.popup.closed).toBe(true);

    await google.approve('demo.google@example.com');
    await delay(100);
    expect(exchanges).toBe(0);
    expect(loadSession()?.user.id).toBe(OTHER_USER.id);
  });

  it('cancels the Google sign-in when the user leaves the login page', async () => {
    let exchanges = 0;
    server.use(
      walletCore.mutation('LoginWithGoogle', () => {
        exchanges += 1;
        return errorResponse('GOOGLE_ACCOUNT_NOT_LINKED');
      }),
    );
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());
    await google.authorizeUrl();
    await userEvent.click(screen.getByRole('link', { name: 'Sign up' }));

    await screen.findByRole('heading', { name: 'Create account' });
    expect(google.popup.closed).toBe(true);
    await google.approve('demo.google@example.com');
    await delay(100);
    expect(exchanges).toBe(0);
    expect(loadSession()).toBeNull();
  });

  it('closes the popup at once when the user leaves while the sign-in is starting', async () => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    server.use(
      walletCore.mutation('StartGoogleLogin', async () => {
        await answered;
        return errorResponse('GOOGLE_LOGIN_DISABLED');
      }),
    );
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());
    await userEvent.click(screen.getByRole('link', { name: 'Sign up' }));

    await screen.findByRole('heading', { name: 'Create account' });
    expect(google.popup.closed).toBe(true);
    answer();
  });

  it('is not offered when auth.googleLogin is off', async () => {
    googleLoginOff();
    await openLogin();
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
  });

  it('does not send a password login while a Google sign-in is replacing the session', async () => {
    // The refresh cookie is shared by the tabs and every session-creating call replaces it: both logins take
    // one lock, so the password login cannot reach the server during the Google exchange. When the Google
    // session lands, another user is signed in and the queued password login is cancelled.
    seedMockGoogleLink('1', 'demo.google@example.com');
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const session = (user: typeof TEST_USER) => ({
      accessToken: mockAccessToken(user.id),
      accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      user,
    });
    server.use(
      walletCore.mutation('LoginWithGoogle', async () => {
        order.push('google');
        await gate;
        return HttpResponse.json({ data: { loginWithGoogle: session(TEST_USER) } });
      }),
      walletCore.mutation('Login', () => {
        order.push('password');
        return HttpResponse.json({ data: { login: session(OTHER_USER) } });
      }),
    );
    const google = stubGooglePopup();
    const { store } = await openLogin();
    await userEvent.click(googleButton());
    await google.approve('demo.google@example.com');
    await waitFor(() => expect(order).toEqual(['google']));

    // Another tab's password login starts while Google's answer is still on its way.
    const password = store.dispatch(
      authApi.endpoints.login.initiate({ email: OTHER_USER.email, password: 'Qwerty1!' }),
    );
    await delay(100);
    expect(order).toEqual(['google']);

    release();
    await password;
    expect(order).toEqual(['google']);
    expect(loadSession()?.user.id).toBe(TEST_USER.id);
  });
});
