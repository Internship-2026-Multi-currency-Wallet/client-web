import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ClientError, GraphQLClient } from 'graphql-request';
import { type Client, createClient } from 'graphql-ws';
import { type DocumentNode, print } from 'graphql';
import { config } from '../config-env';
import type { RefreshSessionMutation } from '../gql/wallet-core/graphql';
import { AUTH_ERROR_CODES } from '../features/auth/authErrors';
import { authorizationHeader } from './dev-auth';
import {
  accessToken,
  clearSession,
  isAccessTokenExpired,
  loadSession,
  saveSession,
  sessionFromPayload,
} from './session';
import { refreshSessionMutation } from './session-refresh.wallet-core';

/** Backends this app talks to. */
export type Service = 'walletCore' | 'ratesService';

const httpUrls: Record<Service, string> = {
  walletCore: config.walletCoreUrl,
  ratesService: config.ratesServiceUrl,
};

const wsUrls: Partial<Record<Service, string>> = {
  ratesService: config.ratesServiceWsUrl,
};

/** A signed-in session wins; the dev user is only the fallback while nobody is signed in. */
function headers(): Record<string, string> {
  const token = accessToken();
  if (token) return { Authorization: `Bearer ${token}` };
  const authorization = authorizationHeader(config.devUser);
  return authorization ? { Authorization: authorization } : {};
}

const httpClients = new Map<Service, GraphQLClient>();

function httpClient(service: Service): GraphQLClient {
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

/** A GraphQL error flattened for UI and Redux (serializable). */
export interface GraphQLRequestError {
  message: string;
  code?: string;
  /** `BAD_USER_INPUT`: the invalid input field (`email`, `password`, `phone`). */
  field?: string;
  /** `ACCOUNT_LOCKED`: ISO date-time when the account unlocks. */
  lockedUntil?: string;
}

export function toRequestError(error: unknown): GraphQLRequestError {
  if (error instanceof ClientError) {
    const first = error.response.errors?.[0];
    const extensions = first?.extensions;
    return {
      // Never `error.message`: graphql-request puts the serialized request (with the variables, e.g. a password) in it.
      message: first?.message ?? `Request failed with HTTP ${error.response.status}`,
      code: (extensions?.code as string | undefined) ?? String(error.response.status),
      ...(typeof extensions?.field === 'string' && { field: extensions.field }),
      ...(typeof extensions?.lockedUntil === 'string' && { lockedUntil: extensions.lockedUntil }),
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof ClientError &&
    !!error.response.errors?.some((e) => e.extensions?.code === code)
  );
}

// The cookie rotates on every refresh and the old one dies at once, so only one tab at a time may use it.
const REFRESH_LOCK = 'wallet.refresh';
/** A hung refresh must not hold the lock (and every tab waiting on it) forever. */
const REFRESH_TIMEOUT_MS = 15_000;

function withRefreshLock<T>(callback: () => Promise<T>): Promise<T> {
  // No Web Locks outside a secure context (e.g. the dev server opened via a LAN IP): refresh uncoordinated.
  return navigator.locks ? navigator.locks.request(REFRESH_LOCK, callback) : callback();
}

let refreshing: Promise<boolean> | null = null;

/**
 * `true` = a valid session exists now; `false` = it is over. Network errors, 5xx and timeouts are thrown and keep
 * the session.
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= refreshWithLock().finally(() => (refreshing = null));
  return refreshing;
}

async function refreshWithLock(): Promise<boolean> {
  const tokenAtStart = accessToken();
  return withRefreshLock(async () => {
    // Changed while we waited: another tab refreshed (reuse its token) or somebody logged out / in.
    if (accessToken() !== tokenAtStart || tokenAtStart === null) return accessToken() !== null;
    let payload;
    try {
      ({ refreshSession: payload } = await httpClient('walletCore').request<RefreshSessionMutation>(
        { document: refreshSessionMutation, signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) },
      ));
    } catch (error) {
      if (!hasErrorCode(error, AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN)) throw error;
      if (accessToken() === tokenAtStart) clearSession();
      return false;
    }
    // A logout or login during the request wins over this answer.
    if (accessToken() !== tokenAtStart) return accessToken() !== null;
    saveSession(sessionFromPayload(payload));
    return true;
  });
}

const AUTH_OPERATIONS = new Set(['Register', 'Login', 'RefreshSession', 'Logout']);

const isAuthOperation = (document: DocumentNode) =>
  document.definitions.some(
    (definition) =>
      definition.kind === 'OperationDefinition' &&
      AUTH_OPERATIONS.has(definition.name?.value ?? ''),
  );

/**
 * Queries and mutations over HTTP (graphql-request). Fully typed by the generated documents.
 * On `UNAUTHENTICATED` the session is refreshed and the request repeated once.
 */
export async function request<TResult, TVariables extends Record<string, unknown>>(
  service: Service,
  document: TypedDocumentNode<TResult, TVariables>,
  ...[variables]: TVariables extends Record<string, never> ? [] : [TVariables]
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
    if (!used || !hasErrorCode(error, 'UNAUTHENTICATED') || isAuthOperation(document)) {
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
