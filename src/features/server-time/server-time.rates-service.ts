import { graphql } from '../../gql/rates-service';

export const serverTimeSubscription = graphql(`
  subscription ServerTime {
    serverTime
  }
`);
