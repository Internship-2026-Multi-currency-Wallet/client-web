import { HttpResponse } from 'msw';
import { type GraphQLResponseBody, graphql } from 'msw/graphql';
import type { WalletCoreHealthQuery } from '../gql/wallet-core/graphql';
import { config } from '../config-env';
import { userIdFromBearer } from '../mocks/auth-handlers';

export const walletCore = graphql.link(config.walletCoreUrl);

export function errorResponse(
  code: string,
  init?: ResponseInit,
): HttpResponse<GraphQLResponseBody<never>> {
  return HttpResponse.json({ errors: [{ message: code, extensions: { code } }] }, init);
}

export const unauthenticated = () => errorResponse('UNAUTHENTICATED');

export interface CallLog {
  me: number;
  refresh: number;
  headers: (string | null)[];
}

export const newLog = (): CallLog => ({ me: 0, refresh: 0, headers: [] });

/** A `Me` handler that accepts only a still valid mock access token; counts calls, records headers. */
export function meHandler(log: CallLog, beforeAnswer?: () => Promise<void>) {
  return walletCore.query('Me', async ({ request }) => {
    log.me += 1;
    const header = request.headers.get('authorization');
    log.headers.push(header);
    await beforeAnswer?.();
    const id = userIdFromBearer(header);
    return id
      ? HttpResponse.json({ data: { me: { id, permissions: ['wallet'], strategy: 'jwt' } } })
      : unauthenticated();
  });
}

/** A `RefreshSession` handler; `work` can delay or replace the answer (return a response to replace it). */
export function refreshHandler(log: { refresh: number }, work?: () => Promise<Response | void>) {
  return walletCore.mutation('RefreshSession', async () => {
    log.refresh += 1;
    const custom = await work?.();
    if (custom) return custom as HttpResponse<GraphQLResponseBody<never>>;
    const expiresAt = Date.now() + 15 * 60 * 1000;
    return HttpResponse.json({
      data: {
        refreshSession: {
          accessToken: `mock-access.1.${expiresAt}`,
          accessTokenExpiresAt: new Date(expiresAt).toISOString(),
          user: { id: '1', email: 'demo@example.com', phone: null },
        },
      },
    });
  });
}

export const healthResponse = (): HttpResponse<GraphQLResponseBody<WalletCoreHealthQuery>> =>
  HttpResponse.json({
    data: {
      health: { service: 'wallet-core', version: 'test', client: 'demo', db: 'UP', redis: 'UP' },
    },
  });
