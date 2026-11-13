import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { config } from '../config-env';
import { loadSession } from '../graphql/session';
import { DEMO_USER } from '../mocks/auth-handlers';
import { server } from '../mocks/server';
import { signInForTest } from '../test/auth';
import { errorResponse, walletCore } from '../test/graphql-handlers';
import { renderApp } from '../test/render';

const email = () => screen.getByLabelText(/^email/i);
const password = () => screen.getByLabelText(/^password/i);
const phone = () => screen.getByLabelText(/^phone/i);
const submit = () => screen.getByRole('button', { name: /^sign up$|creating account/i });

const NEW_USER = { email: 'new.user@example.com', password: 'Secret123!' };

async function open() {
  const app = renderApp('/signup');
  await screen.findByRole('heading', { name: 'Create account' });
  return app;
}

describe('SignUpPage', () => {
  it('links to third-party notices below the login prompt, outside the form', async () => {
    await open();
    const link = screen.getByRole('link', { name: 'Third-party notices' });
    expect(link).toBeVisible();
    expect(link).toHaveAttribute('href', '/third-party-notices.txt');
    expect(screen.getByText(/Already have an account/).nextElementSibling).toBe(link);
    expect(link.closest('form')).toBeNull();
  });

  it('is served at /signup and moves focus to its heading', async () => {
    renderApp('/signup');
    expect(await screen.findByRole('heading', { name: 'Create account' })).toHaveFocus();
  });

  it('creates the account without a session and redirects to Login with a notice', async () => {
    const { router } = await open();
    await userEvent.type(email(), NEW_USER.email);
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.type(phone(), '+380501234567');
    await userEvent.click(submit());

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByText('Account created. Log in to continue.')).toBeInTheDocument();
    expect(loadSession()).toBeNull();
    expect(document.cookie).not.toContain('mock_refresh');
  });

  it('can log in with the new account', async () => {
    await open();
    await userEvent.type(email(), NEW_USER.email);
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.click(submit());
    await screen.findByRole('heading', { name: 'Log in' });

    await userEvent.type(email(), NEW_USER.email);
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  it('does not call the API for a weak password', async () => {
    let calls = 0;
    server.use(
      graphql.link(config.walletCoreUrl).mutation('Register', () => {
        calls += 1;
        return HttpResponse.json({ data: null });
      }),
    );
    await open();
    await userEvent.type(email(), NEW_USER.email);
    await userEvent.type(password(), 'weak');
    await userEvent.click(submit());

    expect(password()).toHaveAccessibleDescription(/8-128 characters/);
    expect(calls).toBe(0);
  });

  it.each(['user@пошта.укр', 'ü@example.com', 'a..b@example.com', '.a@example.com'])(
    'does not call the API for the email %s, which wallet-core rejects',
    async (rejected) => {
      let calls = 0;
      server.use(
        graphql.link(config.walletCoreUrl).mutation('Register', () => {
          calls += 1;
          return HttpResponse.json({ data: null });
        }),
      );
      await open();
      await userEvent.type(email(), rejected);
      await userEvent.type(password(), NEW_USER.password);
      await userEvent.click(submit());

      expect(email()).toHaveAccessibleDescription('Enter a valid email address');
      expect(calls).toBe(0);
    },
  );

  it('treats the email case-insensitively and ignores surrounding spaces, like wallet-core', async () => {
    await open();
    await userEvent.type(email(), `  ${DEMO_USER.email.toUpperCase()}  `);
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.click(submit());

    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
    expect(email()).toHaveAccessibleDescription(/already registered/i);
  });

  it('shows "email already registered" under the email and clears it on edit', async () => {
    const { router } = await open();
    await userEvent.type(email(), DEMO_USER.email.toUpperCase()); // case-insensitive
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.click(submit());

    await screen.findByText(/already registered/i);
    expect(email()).toHaveAccessibleDescription(/already registered/i);
    await waitFor(() => expect(email()).toHaveFocus());
    expect(router.state.location.pathname).toBe('/signup');

    await userEvent.type(email(), 'x');
    expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();
  });

  it('keeps the values after a server field error and creates the account on retry', async () => {
    const { router } = await open();
    await userEvent.type(email(), DEMO_USER.email);
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.type(phone(), '+380501234567');
    await userEvent.click(submit());
    await waitFor(() => expect(email()).toHaveFocus());
    expect(password()).toHaveValue(NEW_USER.password);
    expect(phone()).toHaveValue('+380501234567');

    await userEvent.clear(email());
    await userEvent.type(email(), NEW_USER.email);
    await userEvent.click(submit());

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('clears the generic server alert on edit and keeps the values', async () => {
    server.use(
      graphql
        .link(config.walletCoreUrl)
        .mutation('Register', () =>
          HttpResponse.json({ errors: [{ message: 'boom' }] }, { status: 500 }),
        ),
    );
    await open();
    await userEvent.type(email(), NEW_USER.email);
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(email()).toHaveValue(NEW_USER.email);
    expect(email()).toHaveAttribute('aria-invalid', 'false');

    await userEvent.type(password(), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('focuses a server field error once the form is enabled again, with production RAF batching', async () => {
    // Production stores notify subscribers on the next animation frame, not on the next microtask as in tests.
    vi.stubEnv('MODE', 'production');
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    server.use(
      walletCore.mutation('Register', async () => {
        await answered;
        return errorResponse('EMAIL_ALREADY_REGISTERED');
      }),
    );
    try {
      await open();
      const scroll = vi.fn();
      email().scrollIntoView = scroll;
      await userEvent.type(email(), NEW_USER.email);
      await userEvent.type(password(), NEW_USER.password);
      await userEvent.click(submit());
      await waitFor(() => expect(email()).toBeDisabled());

      answer();
      expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
      await waitFor(() => expect(email()).toHaveFocus());
      expect(email()).toBeEnabled();
      expect(email()).toHaveAccessibleDescription(/already registered/i);
      expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    } finally {
      answer();
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ['email', /valid email/i],
    ['password', /8-128 characters/i],
    ['phone', /international format/i],
  ])('shows a server BAD_USER_INPUT for %s under that field', async (field, text) => {
    server.use(
      graphql.link(config.walletCoreUrl).mutation('Register', () =>
        HttpResponse.json({
          errors: [{ message: 'dev message', extensions: { code: 'BAD_USER_INPUT', field } }],
        }),
      ),
    );
    await open();
    await userEvent.type(email(), NEW_USER.email);
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.click(submit());

    const input = { email, password, phone }[field as 'email' | 'password' | 'phone']();
    if (field === 'password') {
      const helperId = `${input.id}-helper-text`;
      await waitFor(() =>
        expect(document.getElementById(helperId)).toHaveTextContent(
          /^Use 8-128 characters with a digit, an uppercase letter and a special character$/,
        ),
      );
      expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(helperId);
    }
    await waitFor(() => expect(input).toHaveAccessibleDescription(text));
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.queryByText('dev message')).not.toBeInTheDocument();
  });

  it('shows a generic message for unexpected server errors', async () => {
    server.use(
      graphql
        .link(config.walletCoreUrl)
        .mutation('Register', () =>
          HttpResponse.json({ errors: [{ message: 'boom' }] }, { status: 500 }),
        ),
    );
    await open();
    await userEvent.type(email(), NEW_USER.email);
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('sends a signed-in user to the wallet', async () => {
    signInForTest();
    renderApp('/signup');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });

  describe('keeps the page that required the login', () => {
    const logIn = async (user: { email: string; password: string }) => {
      await userEvent.type(email(), user.email);
      await userEvent.type(password(), user.password);
      await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    };

    it('through Login → Sign up → registration → Login, with the query string', async () => {
      const { router } = renderApp('/wallet?currency=EUR');
      await screen.findByRole('heading', { name: 'Log in' });
      await userEvent.click(screen.getByRole('link', { name: 'Sign up' }));
      await screen.findByRole('heading', { name: 'Create account' });

      await userEvent.type(email(), NEW_USER.email);
      await userEvent.type(password(), NEW_USER.password);
      await userEvent.click(submit());
      expect(await screen.findByText('Account created. Log in to continue.')).toBeInTheDocument();

      await logIn(NEW_USER);
      expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/wallet');
      expect(router.state.location.search).toBe('?currency=EUR');
    });

    it('through the Sign up → Log in link', async () => {
      const { router } = renderApp('/wallet');
      await screen.findByRole('heading', { name: 'Log in' });
      await userEvent.click(screen.getByRole('link', { name: 'Sign up' }));
      await screen.findByRole('heading', { name: 'Create account' });
      await userEvent.click(screen.getByRole('link', { name: 'Log in' }));
      await screen.findByRole('heading', { name: 'Log in' });

      await logIn(DEMO_USER);
      expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/wallet');
    });

    it.each(['https://evil.example/', '//evil.example/'])(
      'but never leaves the app for %s',
      async (from) => {
        const { router } = await open();
        await act(() => router.navigate('/signup', { state: { from } }));
        await userEvent.type(email(), NEW_USER.email);
        await userEvent.type(password(), NEW_USER.password);
        await userEvent.click(submit());
        await screen.findByText('Account created. Log in to continue.');

        await logIn(NEW_USER);
        expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/');
      },
    );
  });

  it('links to /login', async () => {
    const { router } = await open();
    const link = screen.getByRole('link', { name: 'Log in' });
    expect(link).toHaveAttribute('href', '/login');

    await userEvent.click(link);
    expect(router.state.location.pathname).toBe('/login');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toHaveFocus();
  });

  it('puts the link after the submit button in tab order and follows it with Enter', async () => {
    const { router } = await open();
    const link = screen.getByRole('link', { name: 'Log in' });

    submit().focus();
    await userEvent.tab();
    expect(link).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(submit()).toHaveFocus();

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/login');
  });
});
