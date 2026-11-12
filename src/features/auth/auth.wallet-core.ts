import { graphql } from '../../gql/wallet-core';

export const registerMutation = graphql(`
  mutation Register($input: RegisterInput!) {
    register(input: $input) {
      id
      email
      phone
    }
  }
`);

export const loginMutation = graphql(`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
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

export const logoutMutation = graphql(`
  mutation Logout {
    logout
  }
`);
