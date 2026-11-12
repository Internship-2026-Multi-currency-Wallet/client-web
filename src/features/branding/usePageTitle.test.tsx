import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { brand } from '../../brand/brand';
import { config } from '../../config-env';
import type { PublicSettingsQuery } from '../../gql/wallet-core/graphql';
import { server } from '../../mocks/server';
import { signInForTest } from '../../test/auth';
import { renderApp } from '../../test/render';

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

async function expectTitle(page: string) {
  await waitFor(() => expect(document.title).toBe(`${page} · ${brand.siteName}`));
}

describe('usePageTitle', () => {
  beforeEach(() => {
    document.title = '';
  });

  it('titles the login page', async () => {
    renderApp('/login');
    await expectTitle('Login');
  });

  it('titles the sign-up page', async () => {
    renderApp('/signup');
    await expectTitle('Sign up');
  });

  it('titles the home page', async () => {
    signInForTest();
    renderApp('/');
    await expectTitle('Home');
  });

  it('titles the wallet page', async () => {
    signInForTest();
    enableProducts(['wallet']);
    renderApp('/wallet');
    await expectTitle('Wallet');
  });

  it('titles the not-found page', async () => {
    renderApp('/does-not-exist');
    await expectTitle('Page not found');
  });

  it('updates the title when navigating between pages', async () => {
    renderApp('/login');
    await expectTitle('Login');
    await userEvent.click(await screen.findByRole('link', { name: 'Sign up' }));
    await expectTitle('Sign up');
  });
});
