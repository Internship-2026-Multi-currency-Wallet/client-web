import { graphql } from '../../gql/wallet-core';

export const walletCoreHealthQuery = graphql(`
  query WalletCoreHealth {
    health {
      service
      version
      client
      db
      redis
    }
  }
`);

export const meQuery = graphql(`
  query Me {
    me {
      id
      kind
      permissions
      strategy
    }
  }
`);
