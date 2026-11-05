import { graphql } from '../gql/wallet-core';

/** Lives next to the client (not in a feature) because `client.ts` itself runs it on `UNAUTHENTICATED`. */
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
