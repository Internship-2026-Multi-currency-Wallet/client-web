import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import type { LoginWithGoogleMutationVariables } from '../../gql/wallet-core/graphql';
import { loadSession } from '../../graphql/session';
import { seedMockGoogleLink } from '../../mocks/google-handlers';
import { server } from '../../mocks/server';
import { googleLoginOff, stubGooglePopup } from '../../test/google';
import { errorResponse, walletCore } from '../../test/graphql-handlers';
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

  it('explains that the user closed the Google window', async () => {
    const google = stubGooglePopup();
    await openLogin();
    await userEvent.click(googleButton());
    await google.closeByUser();

    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in was cancelled.');
    expect(googleButton()).toBeEnabled();
    expect(loadSession()).toBeNull();
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

  it('is not offered when auth.googleLogin is off', async () => {
    googleLoginOff();
    await openLogin();
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
  });
});
