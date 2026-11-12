import { GraphQLClient } from 'graphql-request';
import { config } from '../config-env';
import { authorizationHeader } from './dev-auth';
import { accessToken } from './session';

/** Backends this app talks to. */
export type Service = 'walletCore' | 'ratesService';

const httpUrls: Record<Service, string> = {
  walletCore: config.walletCoreUrl,
  ratesService: config.ratesServiceUrl,
};

/** A signed-in session wins; the dev user is only the fallback while nobody is signed in. */
export function headers(): Record<string, string> {
  const token = accessToken();
  if (token) return { Authorization: `Bearer ${token}` };
  const authorization = authorizationHeader(config.devUser);
  return authorization ? { Authorization: authorization } : {};
}

const httpClients = new Map<Service, GraphQLClient>();

export function httpClient(service: Service): GraphQLClient {
  let client = httpClients.get(service);
  if (!client) {
    // Absolute URL (graphql-request needs one); relative paths resolve against the page.
    const url = new URL(httpUrls[service], globalThis.location?.href).toString();
    // Only wallet-core owns the refresh-token cookie; other services get no credentials (CORS stays simple).
    client = new GraphQLClient(url, {
      headers,
      ...(service === 'walletCore' && { credentials: 'include' as const }),
    });
    httpClients.set(service, client);
  }
  return client;
}
