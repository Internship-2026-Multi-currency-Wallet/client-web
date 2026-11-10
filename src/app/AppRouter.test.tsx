import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { config } from '../config-env';
import type { PublicSettingsQuery } from '../gql/wallet-core/graphql';
import { server } from '../mocks/server';
import { signInForTest } from '../test/auth';
import { renderApp } from '../test/render';

/** Public settings with the given `products.enabled`; the other settings keep their defaults. */
function enableProducts(products: string[]) {
  server.use(
    graphql.link(config.walletCoreUrl).query<PublicSettingsQuery>('PublicSettings', () =>
      HttpResponse.json({
        data: {
          publicSettings: [
            { key: 'auth.googleLogin', value: true },
            { key: 'auth.phoneRequiredAt', value: 'never' },
            { key: 'products.enabled', value: products },
          ],
        },
      }),
    ),
  );
}

describe('AppRouter', () => {
  beforeEach(() => signInForTest());

  it('shows an enabled product: its page and its menu item', async () => {
    enableProducts(['wallet']);
    renderApp('/wallet');
    // level 1: the page heading, not the app name in the header.
    expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wallet' })).toHaveAttribute('href', '/wallet');
  });

  it('opens a product from the menu', async () => {
    enableProducts(['wallet']);
    renderApp('/');
    await userEvent.click(await screen.findByRole('link', { name: 'Wallet' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument();
  });

  it('hides a product that is not enabled: no menu item, and its URL is not found', async () => {
    enableProducts([]);
    renderApp('/wallet');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Wallet' })).not.toBeInTheDocument();
  });

  it('keeps the same router and the app mounted through logout and login', async () => {
    enableProducts(['wallet']);
    const { routers } = renderApp('/wallet');
    await screen.findByRole('heading', { level: 1, name: 'Wallet' });

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByText('Loading settings…')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^email/i), 'demo@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Demo1234!');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.queryByText('Loading settings…')).not.toBeInTheDocument();
    expect(routers).toHaveLength(1);
  });
});

describe('AppRouter without a session', () => {
  it('sends an anonymous visitor of a product to Login and back to the product after login', async () => {
    enableProducts(['wallet']);
    const { router } = renderApp('/wallet');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^email/i), 'demo@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Demo1234!');
    await act(() => userEvent.click(screen.getByRole('button', { name: 'Log in' })));
    expect(await screen.findByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/wallet');
  });
});
