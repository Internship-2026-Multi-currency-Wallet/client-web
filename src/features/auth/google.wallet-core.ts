import { graphql } from '../../gql/wallet-core';

export const googleAccountQuery = graphql(`
  query GoogleAccount {
    googleAccount {
      email
      linkedAt
    }
  }
`);

export const startGoogleLinkMutation = graphql(`
  mutation StartGoogleLink {
    startGoogleLink {
      state
      nonce
      expiresAt
    }
  }
`);

export const linkGoogleAccountMutation = graphql(`
  mutation LinkGoogleAccount($input: GoogleAuthInput!) {
    linkGoogleAccount(input: $input) {
      email
      linkedAt
    }
  }
`);

export const unlinkGoogleAccountMutation = graphql(`
  mutation UnlinkGoogleAccount {
    unlinkGoogleAccount
  }
`);

export const startGoogleLoginMutation = graphql(`
  mutation StartGoogleLogin {
    startGoogleLogin {
      state
      nonce
      expiresAt
    }
  }
`);

export const loginWithGoogleMutation = graphql(`
  mutation LoginWithGoogle($input: GoogleAuthInput!) {
    loginWithGoogle(input: $input) {
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
