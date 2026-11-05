import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { config } from '../config-env';
import { authHandlers, userIdFromBearer } from './auth-handlers';
import type { MeQuery, WalletCoreHealthQuery } from '../gql/wallet-core/graphql';
import type { ServerTimeSubscription } from '../gql/rates-service/graphql';

/**
 * Mock Service Worker handlers (`VITE_USE_MOCKS=true`): every screen works without backends.
 * One `graphql.link()` per backend; add handlers next to the operations you build.
 * Shapes are checked against the generated types, so a contract change breaks the build here.
 */
const walletCore = graphql.link(config.walletCoreUrl);
const ratesServiceWs = graphql.link(config.ratesServiceWsUrl);

/** In mocks the dev user comes from the request header, like on the real backend. */
function devUserFrom(request: Request): { id: string; permissions: string[] } | null {
  const match = /^Dev\s+([^:]+)(?::(.*))?$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) return null;
  const permissions = (match[2] ?? '').split(',').filter(Boolean);
  return { id: match[1], permissions };
}

export const handlers = [
  walletCore.query<WalletCoreHealthQuery>('WalletCoreHealth', () =>
    HttpResponse.json({
      data: {
        health: {
          service: 'wallet-core',
          version: 'mock',
          client: config.client,
          db: 'UP',
          redis: 'UP',
        },
      },
    }),
  ),

  ...authHandlers,

  walletCore.query<MeQuery>('Me', ({ request }) => {
    const bearerId = userIdFromBearer(request.headers.get('authorization'));
    if (bearerId) {
      return HttpResponse.json({
        data: { me: { id: bearerId, permissions: ['wallet'], strategy: 'jwt' } },
      });
    }
    const user = devUserFrom(request);
    if (!user) {
      return HttpResponse.json({
        data: null,
        errors: [{ message: 'Authentication required', extensions: { code: 'UNAUTHENTICATED' } }],
      });
    }
    return HttpResponse.json({ data: { me: { ...user, strategy: 'dev' } } });
  }),

  ratesServiceWs.subscription<ServerTimeSubscription>(
    'ServerTime',
    ({ subscription, finalize }) => {
      const publish = () =>
        subscription.publish({ data: { serverTime: new Date().toISOString() } });
      publish();
      const timer = setInterval(publish, 1000);
      finalize(() => clearInterval(timer));
    },
  ),
];
