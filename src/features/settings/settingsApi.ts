import { api, graphqlQuery } from '../../app/api';
import { request } from '../../graphql/client';
import {
  type ClientSettings,
  InvalidSettingsError,
  parsePublicSettings,
  toInvalidSettingsRequestError,
} from './clientSettings';
import { publicSettingsQuery } from './settings.wallet-core';

export const settingsApi = api.injectEndpoints({
  endpoints: (build) => ({
    /** Public settings of this client, validated. The only place that fetches them. */
    publicSettings: build.query<ClientSettings, void>({
      // `queryFn` has no `transformResponse`, so validation happens here.
      queryFn: async () => {
        const result = await graphqlQuery(
          async () => (await request('walletCore', publicSettingsQuery)).publicSettings,
        );
        if ('error' in result) return result;
        try {
          return { data: parsePublicSettings(result.data) };
        } catch (error) {
          if (error instanceof InvalidSettingsError) {
            return { error: toInvalidSettingsRequestError(error) };
          }
          throw error;
        }
      },
    }),
  }),
});

export const { usePublicSettingsQuery } = settingsApi;
