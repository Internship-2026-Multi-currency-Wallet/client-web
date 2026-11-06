import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { config } from '../config-env';
import type { PublicSettingsQuery } from '../gql/wallet-core/graphql';
import { server } from '../mocks/server';
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
});
