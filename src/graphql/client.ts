import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { type Client, createClient } from 'graphql-ws';
import { print } from 'graphql';
import { config } from '../config-env';
import { type GraphQLRequestError, hasErrorCode, toRequestError } from './errors';
import { headers, httpClient, type Service } from './http';
import { refreshSession } from './refresh';
import { accessToken, isAccessTokenExpired, loadSession } from './session';

const wsUrls: Partial<Record<Service, string>> = {
  ratesService: config.ratesServiceWsUrl,
};

export interface RequestOptions {
  /**
   * Default `true`: on `UNAUTHENTICATED` the session is refreshed and the request repeated once. `false` for calls
   * that create or end the session themselves (login, register, logout): their failure is the answer.
   */
  retryOnUnauthenticated?: boolean;
}

/**
 * Queries and mutations over HTTP (graphql-request). Fully typed by the generated documents.
 * On `UNAUTHENTICATED` the session is refreshed and the request repeated once (see `RequestOptions`).
 */
export async function request<TResult, TVariables extends Record<string, unknown>>(
  service: Service,
  document: TypedDocumentNode<TResult, TVariables>,
  ...[variables, options]: TVariables extends Record<string, never>
    ? [variables?: TVariables, options?: RequestOptions]
    : [variables: TVariables, options?: RequestOptions]
): Promise<TResult> {
  const send = () =>
    httpClient(service).request<TResult>({
      document,
      variables: variables as Record<string, unknown> | undefined,
    });
  const used = loadSession(); // the token and its user, from one snapshot
  try {
    return await send();
  } catch (error) {
    if (
      !used ||
      !hasErrorCode(error, 'UNAUTHENTICATED') ||
      options?.retryOnUnauthenticated === false
    ) {
      throw error;
    }
    // Another request may have refreshed already.
    if (accessToken() === used.accessToken) {
      const renewed = await refreshSession().catch((refreshError: unknown) => {
        // A failed refresh reports its own error, unless another user signed in meanwhile.
        if (loadSession()?.user.id === used.user.id) throw refreshError;
        return false;
      });
      if (!renewed) throw error;
    }
    // Signed out or another user signed in meanwhile (e.g. in another tab): never repeat the request as them.
    if (loadSession()?.user.id !== used.user.id) throw error;
    return send();
  }
}

/** The session could not be renewed for now (network, 5xx, timeout): graphql-ws may retry the connection. */
class TransientAuthError extends Error {}

// Messages are fixed: graphql-ws sends the text as the close reason, and a `ClientError` carries the request.
async function connectionParams(): Promise<Record<string, string>> {
  const session = loadSession();
  if (!session || !isAccessTokenExpired(session)) return headers();
  let renewed: boolean;
  try {
    renewed = await refreshSession();
  } catch {
    throw new TransientAuthError('The session could not be renewed right now.');
  }
  if (!renewed) throw new Error('The session has ended.');
  return headers();
}

// graphql-ws retries only close events by default; any other error is fatal. A browser reports a socket that cannot
// connect (server down) with an `error` Event before the close event, so that Event is retried too.
const shouldRetry = (error: unknown) =>
  error instanceof TransientAuthError ||
  (error instanceof Event && error.type === 'error') ||
  (typeof error === 'object' && error !== null && 'code' in error && 'reason' in error);

const wsClients = new Map<Service, Client>();

function wsClient(service: Service): Client {
  let client = wsClients.get(service);
  if (!client) {
    const url = wsUrls[service];
    if (!url) throw new Error(`No websocket URL configured for ${service}`);
    client = createClient({ url, lazy: true, connectionParams, retryAttempts: 5, shouldRetry });
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
