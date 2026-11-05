import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { config } from '../config-env';
import { loadSession } from '../graphql/session';
import { DEMO_USER } from '../mocks/auth-handlers';
import { server } from '../mocks/server';
import { signInForTest } from '../test/auth';
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

  it('shows "email already registered" under the email and clears it on edit', async () => {
    const { router } = await open();
    await userEvent.type(email(), DEMO_USER.email.toUpperCase()); // case-insensitive
    await userEvent.type(password(), NEW_USER.password);
    await userEvent.click(submit());

    await screen.findByText(/already registered/i);
    expect(email()).toHaveAccessibleDescription(/already registered/i);
    expect(email()).toHaveFocus();
    expect(router.state.location.pathname).toBe('/signup');

    await userEvent.type(email(), 'x');
    expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();
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
    await screen.findByText(text);
    expect(input).toHaveAccessibleDescription(text);
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
