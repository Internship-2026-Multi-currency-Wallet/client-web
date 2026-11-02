import { graphql } from '../../gql/wallet-core';

export const publicSettingsQuery = graphql(`
  query PublicSettings {
    publicSettings {
      key
      value
    }
  }
`);
