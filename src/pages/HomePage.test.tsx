import { screen } from '@testing-library/react';
import { graphql } from 'msw/graphql';
import { HttpResponse } from 'msw';
import { config } from '../config-env';
import { server } from '../mocks/server';
import { signInForTest } from '../test/auth';
import { renderApp } from '../test/render';

describe('HomePage', () => {
  beforeEach(() => signInForTest());

  it('shows wallet-core health, the signed-in user and the live server time (mocks)', async () => {
    renderApp('/');
    expect(await screen.findByTestId('health')).toHaveTextContent(
      'Connected to wallet-core: wallet-core mock (client demo, db UP, redis UP)',
    );
    expect(await screen.findByTestId('me')).toHaveTextContent(
      'Authenticated user: 1 (permissions: wallet)',
    );
    expect(await screen.findByTestId('server-time')).toHaveTextContent(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('still names a dev-header identity as the dev user', async () => {
    server.use(
      graphql
        .link(config.walletCoreUrl)
        .query('Me', () =>
          HttpResponse.json({ data: { me: { id: '7', permissions: [], strategy: 'dev' } } }),
        ),
    );
    renderApp('/');
    expect(await screen.findByTestId('me')).toHaveTextContent('Dev user: 7 (permissions: none)');
  });

  it('shows an error when wallet-core is down', async () => {
    server.use(
      graphql
        .link(config.walletCoreUrl)
        .query('WalletCoreHealth', () => HttpResponse.json({}, { status: 503 })),
    );
    renderApp('/');
    expect(await screen.findByText(/wallet-core is not reachable/)).toBeInTheDocument();
  });
});
