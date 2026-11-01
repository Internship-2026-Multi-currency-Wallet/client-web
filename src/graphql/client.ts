import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ClientError, GraphQLClient } from 'graphql-request';
import { type Client, createClient } from 'graphql-ws';
import { print } from 'graphql';
import { config } from '../config-env';
import { authorizationHeader } from './dev-auth';

/** Backends this app talks to. */
export type Service = 'walletCore' | 'ratesService';

const httpUrls: Record<Service, string> = {
  walletCore: config.walletCoreUrl,
  ratesService: config.ratesServiceUrl,
};

const wsUrls: Partial<Record<Service, string>> = {
  ratesService: config.ratesServiceWsUrl,
};

function headers(): Record<string, string> {
  const authorization = authorizationHeader(config.devUser);
  return authorization ? { Authorization: authorization } : {};
}

const httpClients = new Map<Service, GraphQLClient>();

function httpClient(service: Service): GraphQLClient {
  let client = httpClients.get(service);
  if (!client) {
    // Absolute URL (graphql-request needs one); relative paths resolve against the page.
    const url = new URL(httpUrls[service], globalThis.location?.href).toString();
    client = new GraphQLClient(url, { headers });
    httpClients.set(service, client);
  }
  return client;
}

/** A GraphQL error flattened for UI and Redux (serializable). */
export interface GraphQLRequestError {
  message: string;
  code?: string;
}

export function toRequestError(error: unknown): GraphQLRequestError {
  if (error instanceof ClientError) {
    const first = error.response.errors?.[0];
    return {
      message: first?.message ?? error.message,
      code: (first?.extensions?.code as string | undefined) ?? String(error.response.status),
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

/** Queries and mutations over HTTP (graphql-request). Fully typed by the generated documents. */
export function request<TResult, TVariables extends Record<string, unknown>>(
  service: Service,
  document: TypedDocumentNode<TResult, TVariables>,
  ...variables: TVariables extends Record<string, never> ? [] : [TVariables]
): Promise<TResult> {
  return httpClient(service).request<TResult>({
    document,
    variables: variables[0] as Record<string, unknown> | undefined,
  });
}

const wsClients = new Map<Service, Client>();

function wsClient(service: Service): Client {
  let client = wsClients.get(service);
  if (!client) {
    const url = wsUrls[service];
    if (!url) throw new Error(`No websocket URL configured for ${service}`);
    client = createClient({ url, lazy: true, connectionParams: headers, retryAttempts: 5 });
    wsClients.set(service, client);
  }
  return client;
}

export interface SubscriptionHandlers<TResult> {
  next: (data: TResult) => void;
  error?: (error: GraphQLRequestError) => void;
}

/** Subscriptions over websocket (graphql-ws). Returns an unsubscribe function. */
export function subscribe<TResult, TVariables extends Record<string, unknown>>(
  service: Service,
  document: TypedDocumentNode<TResult, TVariables>,
  handlers: SubscriptionHandlers<TResult>,
  variables?: TVariables,
): () => void {
  return wsClient(service).subscribe<TResult>(
    { query: print(document), variables },
    {
      next: (result) => {
        if (result.errors?.length) {
          handlers.error?.({
            message: result.errors[0].message,
            code: result.errors[0].extensions?.code as string | undefined,
          });
        } else if (result.data) {
          handlers.next(result.data);
        }
      },
      error: (error) => handlers.error?.(toRequestError(error)),
      complete: () => undefined,
    },
  );
}
