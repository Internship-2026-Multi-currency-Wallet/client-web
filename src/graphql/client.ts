import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ClientError, GraphQLClient } from 'graphql-request';
import { type Client, createClient } from 'graphql-ws';
import { type DocumentNode, print } from 'graphql';
import { config } from '../config-env';
import type { RefreshSessionMutation } from '../gql/wallet-core/graphql';
import { AuthCookieLockError, withAuthCookieLock } from './cookie-lock';
import { authorizationHeader } from './dev-auth';
import {
  accessToken,
  clearSessionIf,
  isAccessTokenExpired,
  loadSession,
  renewSession,
  SessionChangedError,
  sessionGeneration,
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
  if (error instanceof SessionChangedError)
    return { message: error.message, code: 'SESSION_CHANGED' };
  if (error instanceof AuthCookieLockError)
    return { message: error.message, code: 'AUTH_COOKIE_LOCK' };
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

let refreshInFlight: { generation: string; promise: Promise<boolean> } | null = null;

/**
 * Gets a new access token with the refresh-token cookie. Single-flight per session generation: concurrent callers
 * share one request, but a caller of a newer session never joins a refresh of an older one.
 *
 * `true`  = the session of this generation now holds a fresh token.
 * `false` = it has none: the refresh session is over (`INVALID_REFRESH_TOKEN`, local session cleared) or this
 *           refresh became stale (logout/login/other user meanwhile) and its result was dropped.
 * Any other failure (network, 5xx, timeout, no cookie lock) is thrown and keeps the session: it may work later.
 */
export function refreshSession(): Promise<boolean> {
  const generation = sessionGeneration();
  if (refreshInFlight?.generation !== generation) {
    const promise = performRefresh(generation).finally(() => {
      if (refreshInFlight?.promise === promise) refreshInFlight = null;
    });
    refreshInFlight = { generation, promise };
  }
  return refreshInFlight.promise;
}

async function performRefresh(startGeneration: string): Promise<boolean> {
  // Taken NOW, before waiting for the lock: a tab that waits can then tell that another tab renewed meanwhile.
  const tokenAtStart = accessToken();
  // The cookie rotates on every refresh, so only one tab at a time may send it (see `cookie-lock.ts`). The lock is
  // held until the session is updated; the short storage updates inside take the session lock (order: cookie ->
  // session). A lock failure is thrown like a network failure: nothing was sent, the session is left as it is.
  return withAuthCookieLock(async (signal) => {
    // Look at the shared session again: it may have changed while this tab waited.
    if (sessionGeneration() !== startGeneration) return false; // logout / login / other user: this refresh is stale
    const current = accessToken();
    if (current === null) return false; // the session is gone
    if (current !== tokenAtStart) return true; // another tab already renewed it: reuse that, send nothing

    let payload;
    try {
      ({ refreshSession: payload } = await httpClient('walletCore').request<RefreshSessionMutation>(
        {
          document: refreshSessionMutation,
          signal,
        },
      ));
    } catch (error) {
      // Network errors, timeouts and server errors are thrown and keep the session (the outcome may be unknown).
      if (!hasErrorCode(error, 'INVALID_REFRESH_TOKEN')) throw error;
      // Stale (logout/login meanwhile) -> false; renewed by another tab (shared cookie) -> true; else cleared -> false.
      return clearSessionIf(startGeneration, tokenAtStart);
    }
    return renewSession(startGeneration, {
      accessToken: payload.accessToken,
      accessTokenExpiresAt: payload.accessTokenExpiresAt,
      user: { ...payload.user, phone: payload.user.phone ?? null },
    });
  });
}

// These never trigger a refresh: they are how a session starts, renews or ends.
const AUTH_OPERATIONS = new Set(['Register', 'Login', 'RefreshSession', 'Logout']);

// The answer is the same for everybody, so it stays valid when the user changes while it is on the wire (the
// client settings gate of E1-2 must not fail on login/logout). They still carry a token if there is one.
export const PUBLIC_OPERATIONS: ReadonlySet<string> = new Set([
  'WalletCoreHealth',
  'PublicSettings',
]);

function hasOperationNamed(document: DocumentNode, names: ReadonlySet<string>): boolean {
  return document.definitions.some(
    (definition) =>
      definition.kind === 'OperationDefinition' &&
      !!definition.name &&
      names.has(definition.name.value),
  );
}

const isAuthOperation = (document: DocumentNode) => hasOperationNamed(document, AUTH_OPERATIONS);

/**
 * Queries and mutations over HTTP (graphql-request). Fully typed by the generated documents.
 *
 * Silent refresh: if a request made with an access token fails with `UNAUTHENTICATED`, the session is refreshed
 * and the request is repeated once. A second failure is returned as is (no loops).
 *
 * Identity safety: a request that carried a token belongs to that session generation. If the generation changes
 * (logout, login, another user) before the answer is used, the request is neither refreshed nor repeated and its
 * result is dropped with `SessionChangedError`, so one user's data can never be cached for the next one.
 */
export function request<TResult, TVariables extends Record<string, unknown>>(
  service: Service,
  document: TypedDocumentNode<TResult, TVariables>,
  ...variables: TVariables extends Record<string, never> ? [] : [TVariables]
): Promise<TResult> {
  return run(undefined, service, document, variables[0] as TVariables | undefined);
}

/** Like `request`, but the HTTP request is aborted with `signal` (the browser then drops the response). */
export function requestAbortable<TResult, TVariables extends Record<string, unknown>>(
  signal: AbortSignal,
  service: Service,
  document: TypedDocumentNode<TResult, TVariables>,
  ...variables: TVariables extends Record<string, never> ? [] : [TVariables]
): Promise<TResult> {
  return run(signal, service, document, variables[0] as TVariables | undefined);
}

async function run<TResult, TVariables extends Record<string, unknown>>(
  signal: AbortSignal | undefined,
  service: Service,
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables | undefined,
): Promise<TResult> {
  const send = () =>
    httpClient(service).request<TResult>({
      document,
      variables: variables as Record<string, unknown> | undefined,
      signal,
    });
  const tokenUsed = accessToken();
  const startGeneration = sessionGeneration();
  const superseded = () =>
    tokenUsed !== null &&
    startGeneration !== sessionGeneration() &&
    !hasOperationNamed(document, PUBLIC_OPERATIONS);

  let result: TResult;
  try {
    result = await send();
  } catch (error) {
    if (
      !tokenUsed ||
      superseded() ||
      !hasErrorCode(error, 'UNAUTHENTICATED') ||
      isAuthOperation(document)
    ) {
      throw error;
    }
    // A parallel request may have refreshed already: then just repeat with the new token.
    if (accessToken() === tokenUsed && !(await refreshSession())) throw error;
    if (superseded() || !accessToken()) throw error;
    result = await send(); // the one and only repeat; its errors are final
  }
  if (superseded()) throw new SessionChangedError();
  return result;
}

/**
 * The access token is only checked when the socket is (re)connected, so a reconnect after a sleep or a dropped
 * network can find it expired. Unlike an HTTP request, a rejected connection is not retried by `run()`: graphql-ws
 * treats the server's `Unauthorized` close as final and the subscription would stay dead until the page remounts.
 * So an expired token is renewed first, through the same single-flight refresh as everywhere else; if that is not
 * possible the connection is not attempted with a token the server is known to reject.
 */
async function connectionParams(): Promise<Record<string, string>> {
  const session = loadSession();
  if (!session || !isAccessTokenExpired(session)) return headers();
  // A fixed message on purpose: graphql-ws puts the error text into the close reason, and a raw `ClientError` carries
  // the request. An ordinary error also makes graphql-ws give up at once instead of retrying with a token that is dead.
  const unrenewable = new Error('The live connection needs a session that could not be renewed.');
  try {
    if (!(await refreshSession())) throw unrenewable;
  } catch {
    throw unrenewable;
  }
  const renewed = loadSession();
  if (!renewed || isAccessTokenExpired(renewed)) throw unrenewable;
  return headers();
}

const wsClients = new Map<Service, Client>();

function wsClient(service: Service): Client {
  let client = wsClients.get(service);
  if (!client) {
    const url = wsUrls[service];
    if (!url) throw new Error(`No websocket URL configured for ${service}`);
    client = createClient({ url, lazy: true, connectionParams, retryAttempts: 5 });
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
