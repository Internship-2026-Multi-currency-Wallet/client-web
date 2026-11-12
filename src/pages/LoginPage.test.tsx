import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { config } from '../config-env';
import { loadSession } from '../graphql/session';
import { DEMO_USER } from '../mocks/auth-handlers';
import { server } from '../mocks/server';
import { signInForTest } from '../test/auth';
import { newLog, refreshHandler } from '../test/graphql-handlers';
import { renderApp } from '../test/render';

const email = () => screen.getByLabelText(/^email/i);
const password = () => screen.getByLabelText(/^password/i);
const submit = () => screen.getByRole('button', { name: /^log in$|logging in/i });

async function fill(user: { email: string; password: string }) {
  await userEvent.type(email(), user.email);
  await userEvent.type(password(), user.password);
}

describe('LoginPage', () => {
  it('is served at /login and moves focus to its heading', async () => {
    renderApp('/login');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toHaveFocus();
  });

  it('logs in, stores the session and lands in the wallet', async () => {
    const { router } = renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    await fill(DEMO_USER);
    await userEvent.click(submit());

    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    const session = loadSession();
    expect(session?.user.email).toBe(DEMO_USER.email);
    expect(session?.accessToken).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it('does not call the API while the form is invalid', async () => {
    let calls = 0;
    server.use(
      graphql.link(config.walletCoreUrl).mutation('Login', () => {
        calls += 1;
        return HttpResponse.json({ data: null });
      }),
    );
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    await userEvent.click(submit());

    expect(email()).toHaveAccessibleDescription('Enter your email');
    expect(calls).toBe(0);
  });

  it('shows one generic message for a wrong password and an unknown email, and clears it on edit', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    await fill({ email: DEMO_USER.email, password: 'Wrong1234!' });
    await userEvent.click(submit());
    const wrongPassword = (await screen.findByRole('alert')).textContent;
    expect(wrongPassword).toBe('Invalid email or password.');
    expect(loadSession()).toBeNull();

    await userEvent.clear(email());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.type(email(), 'nobody@example.com');
    await userEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toBe(wrongPassword);
  });

  it('locks the account after 5 failed attempts and shows when it unlocks', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    await fill({ email: DEMO_USER.email, password: 'Wrong1234!' });
    for (let attempt = 0; attempt < 5; attempt++) {
      await userEvent.click(submit());
      await waitFor(() => expect(submit()).toBeEnabled());
    }

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/locked until/i);
    expect(alert.textContent).toMatch(/\d{4}|\d{1,2}:\d{2}/); // a formatted date/time

    // Even the right password is refused while locked.
    await userEvent.clear(password());
    await userEvent.type(password(), DEMO_USER.password);
    await userEvent.click(submit());
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(screen.getByRole('alert')).toHaveTextContent(/locked until/i);
    expect(loadSession()).toBeNull();
  });

  it('shows the loading state and ignores a second submit', async () => {
    let calls = 0;
    server.use(
      graphql.link(config.walletCoreUrl).mutation('Login', async () => {
        calls += 1;
        await delay(100);
        return HttpResponse.json({
          errors: [{ message: 'x', extensions: { code: 'INVALID_CREDENTIALS' } }],
        });
      }),
    );
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    await fill(DEMO_USER);
    await userEvent.click(submit());

    expect(submit()).toBeDisabled();
    expect(submit()).toHaveTextContent('Logging in…');
    expect(email()).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(calls).toBe(1);
    expect(submit()).toBeEnabled();
  });

  it('explains an unreachable server', async () => {
    server.use(graphql.link(config.walletCoreUrl).mutation('Login', () => HttpResponse.error()));
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    await fill(DEMO_USER);
    await userEvent.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i);
  });

  it('sends a signed-in user to the wallet', async () => {
    signInForTest();
    const { router } = renderApp('/login');
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('does not flash the form while a stored session is being restored', async () => {
    signInForTest({ expired: true });
    let renewed!: () => void;
    const renewal = new Promise<void>((resolve) => (renewed = resolve));
    server.use(refreshHandler(newLog(), () => renewal));
    const { router } = renderApp('/login');

    try {
      await waitFor(() => expect(screen.queryByText('Loading settings…')).not.toBeInTheDocument());
      expect(screen.queryByRole('heading', { name: 'Log in' })).not.toBeInTheDocument();
    } finally {
      renewed();
    }
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('goes back to the page that required the login', async () => {
    const { router } = renderApp('/');
    await screen.findByRole('heading', { name: 'Log in' });
    expect(router.state.location.pathname).toBe('/login');
    await fill(DEMO_USER);
    await userEvent.click(submit());

    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('links to /signup', async () => {
    const { router } = renderApp('/login');
    const link = await screen.findByRole('link', { name: 'Sign up' });
    expect(link).toHaveAttribute('href', '/signup');

    await userEvent.click(link);
    expect(router.state.location.pathname).toBe('/signup');
    expect(await screen.findByRole('heading', { name: 'Create account' })).toHaveFocus();
  });

  it('has a natural keyboard order and submits with Enter and Space', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    const link = screen.getByRole('link', { name: 'Sign up' });

    await fill({ email: DEMO_USER.email, password: 'Wrong1234!' });
    await userEvent.tab();
    expect(submit()).toHaveFocus();
    await userEvent.tab();
    expect(link).toHaveFocus();
    await userEvent.tab({ shift: true });
    await userEvent.tab({ shift: true });
    expect(password()).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(email()).toHaveFocus();

    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password.');

    await userEvent.type(password(), 'x'); // an edit clears the message
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.tab();
    expect(submit()).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Create account' })).toBeInTheDocument();
  });

  it('shows no registration notice by default', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Log in' });
    expect(within(document.body).queryByText(/account created/i)).not.toBeInTheDocument();
  });
});
