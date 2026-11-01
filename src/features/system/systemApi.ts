import { api, graphqlQuery } from '../../app/api';
import { request } from '../../graphql/client';
import type { MeQuery, WalletCoreHealthQuery } from '../../gql/wallet-core/graphql';
import { meQuery, walletCoreHealthQuery } from './system.wallet-core';

export const systemApi = api.injectEndpoints({
  endpoints: (build) => ({
    walletCoreHealth: build.query<WalletCoreHealthQuery['health'], void>({
      queryFn: () =>
        graphqlQuery(async () => (await request('walletCore', walletCoreHealthQuery)).health),
    }),
    me: build.query<MeQuery['me'], void>({
      queryFn: () => graphqlQuery(async () => (await request('walletCore', meQuery)).me),
    }),
  }),
});

export const { useWalletCoreHealthQuery, useMeQuery } = systemApi;
