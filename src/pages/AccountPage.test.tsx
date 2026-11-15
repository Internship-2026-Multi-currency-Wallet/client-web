import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, HttpResponse } from 'msw';
import { seedMockGoogleLink } from '../mocks/google-handlers';
import { server } from '../mocks/server';
import { OTHER_USER, otherTab, signInForTest, testSession } from '../test/auth';
import { googleLoginOff, stubGooglePopup } from '../test/google';
import { errorResponse, walletCore } from '../test/graphql-handlers';
import { renderApp } from '../test/render';

const linkButton = () => screen.getByRole('button', { name: /link google account|waiting/i });

async function openAccount() {
  signInForTest();
  const app = renderApp('/account');
  await screen.findByRole('heading', { name: 'Account settings' });
  return app;
}

describe('AccountPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is for signed-in users only', async () => {
    const { router } = renderApp('/account');
    await screen.findByRole('heading', { name: 'Log in' });
    expect(router.state.location.pathname).toBe('/login');
  });

  it('is linked from the header', async () => {
    signInForTest();
    renderApp('/');
    const header = within(await screen.findByRole('banner'));
    await userEvent.click(header.getByRole('link', { name: 'Account' }));
    expect(await screen.findByRole('heading', { name: 'Account settings' })).toBeInTheDocument();
  });

  it('links a Google account', async () => {
    const google = stubGooglePopup();
    await openAccount();
    expect(await screen.findByText(/^Not linked/)).toBeInTheDocument();

    await userEvent.click(linkButton());
    expect(linkButton()).toHaveTextContent('Waiting for Google…');
    await google.approve('Demo.Google@example.com');

    expect(await screen.findByText('demo.google@example.com')).toBeInTheDocument();
    expect(screen.getByText(/^Linked to/)).toHaveTextContent(/since/);
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a Google account that is already linked to another user', async () => {
    seedMockGoogleLink('2', 'taken@example.com');
    const google = stubGooglePopup();
    await openAccount();
    await userEvent.click(await screen.findByRole('button', { name: 'Link Google account' }));
    await google.approve('taken@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This Google account is already linked to another user.',
    );
    expect(await screen.findByText(/^Not linked/)).toBeInTheDocument();
  });

  it('shows the link made elsewhere when another Google account is already linked', async () => {
    const google = stubGooglePopup();
    await openAccount();
    await screen.findByText(/^Not linked/);
    seedMockGoogleLink('1', 'first@example.com'); // e.g. in another tab

    await userEvent.click(linkButton());
    await google.approve('second@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /another google account is already linked/i,
    );
    expect(await screen.findByText('first@example.com')).toBeInTheDocument();
  });

  it('explains that the user closed the Google window', async () => {
    const google = stubGooglePopup();
    await openAccount();
    await userEvent.click(await screen.findByRole('button', { name: 'Link Google account' }));
    await google.closeByUser();

    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in was cancelled.');
    expect(linkButton()).toBeEnabled();
  });

  it('cancels the link when the user leaves the page', async () => {
    let links = 0;
    server.use(
      walletCore.mutation('LinkGoogleAccount', () => {
        links += 1;
        return errorResponse('INVALID_GOOGLE_STATE');
      }),
    );
    const google = stubGooglePopup();
    await openAccount();
    await userEvent.click(await screen.findByRole('button', { name: 'Link Google account' }));
    await google.authorizeUrl();
    await userEvent.click(within(screen.getByRole('banner')).getByRole('link', { name: 'Home' }));

    await screen.findByRole('heading', { name: 'Welcome' });
    expect(google.popup.closed).toBe(true);
    await google.approve('demo.google@example.com');
    await delay(100);
    expect(links).toBe(0);
  });

  it('never shows a link that finished after the user changed to the next user', async () => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    let linkCalled = false;
    server.use(
      walletCore.mutation('LinkGoogleAccount', async () => {
        linkCalled = true;
        await answered;
        return HttpResponse.json({
          data: {
            linkGoogleAccount: {
              email: 'demo.google@example.com',
              linkedAt: new Date().toISOString(),
            },
          },
        });
      }),
    );
    const google = stubGooglePopup();
    await openAccount();
    await userEvent.click(await screen.findByRole('button', { name: 'Link Google account' }));
    await google.approve('demo.google@example.com');
    await waitFor(() => expect(linkCalled).toBe(true));

    // Another tab switches to the next user while the link request is still running.
    otherTab.write(testSession(OTHER_USER));
    otherTab.notify();
    await screen.findByText(OTHER_USER.email);
    expect(await screen.findByText(/^Not linked/)).toBeInTheDocument();
    answer();
    await delay(100);

    expect(screen.queryByText('demo.google@example.com')).not.toBeInTheDocument();
    expect(screen.getByText(/^Not linked/)).toBeInTheDocument();
  });

  it('unlinks only after confirmation', async () => {
    seedMockGoogleLink('1', 'demo.google@example.com');
    await openAccount();
    await userEvent.click(await screen.findByRole('button', { name: 'Unlink' }));

    const dialog = within(screen.getByRole('dialog', { name: 'Unlink Google account?' }));
    expect(dialog.getByText(/logged out on your other devices/)).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('demo.google@example.com')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Unlink' }),
    );
    expect(await screen.findByText(/^Not linked/)).toBeInTheDocument();
    // The page is aria-hidden until the dialog has finished closing.
    expect(await screen.findByRole('button', { name: 'Link Google account' })).toBeInTheDocument();
  });

  it('shows a failed load with a retry', async () => {
    let calls = 0;
    server.use(
      walletCore.query('GoogleAccount', () => {
        calls += 1;
        return calls === 1
          ? errorResponse('INTERNAL_SERVER_ERROR')
          : HttpResponse.json({ data: { googleAccount: null } });
      }),
    );
    await openAccount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/^Not linked/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers no Link while Google sign-in is off', async () => {
    googleLoginOff();
    await openAccount();
    expect(await screen.findByText(/not available/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link Google account' })).not.toBeInTheDocument();
  });
});
