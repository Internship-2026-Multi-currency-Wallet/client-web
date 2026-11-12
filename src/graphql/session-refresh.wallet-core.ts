import { graphql } from '../gql/wallet-core';

/** Lives in the graphql layer (not in a feature) because `refresh.ts` runs it for the transport itself. */
export const refreshSessionMutation = graphql(`
  mutation RefreshSession {
    refreshSession {
      accessToken
      accessTokenExpiresAt
      user {
        id
        email
        phone
      }
    }
  }
`);
