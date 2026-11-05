import { HttpResponse } from 'msw';
import {
  type CookieJar,
  gate,
  type Gate,
  type Gates,
  type RotatingBackend,
} from './rotating-backend';
import { errorResponse, walletCore } from './graphql-handlers';

/**
 * TEST-ONLY adapter: serves the REAL GraphQL operations (`RefreshSession`, `Me`) that the production frontend sends,
 * from the Phase 1 `RotatingBackend` and `CookieJar`.
 *
 * Per `RefreshSession` request (numbered in the order the requests REACH this handler):
 * 1. the cookie is read when the request is sent (= when the handler starts),
 * 2. it waits for `plan.arrival` (network latency), then the backend consumes the token atomically,
 * 3. it waits for `plan.delivery`, then "Set-Cookie" is applied to the jar and the answer is returned.
 * Every refresh answers with a DISTINCT access token (`access-<user>-<refresh token>`), so a test can tell which
 * refresh a session came from. Nothing here is persisted anywhere; it lives and dies with the test.
 */
export interface RefreshTransport {
  handlers: ReturnType<typeof walletCore.mutation>[];
  /** Number of `RefreshSession` requests that reached the server so far. */
  readonly refreshCalls: number;
  /** Plans the timing of the n-th request (1-based) before it is sent. */
  plan: (n: number, gates: Gates) => void;
  /** Resolves when the server has consumed the token of the n-th request (before its answer is delivered). */
  consumed: (n: number) => Promise<void>;
  /** Resolves when the n-th request has reached the handler (it left the browser with the cookie it then had). */
  sent: (n: number) => Promise<void>;
  /** `Me` calls so far: the bearer token each carried and whether it was accepted. */
  readonly meCalls: { bearer: string | null; accepted: boolean }[];
  /** Makes the next `Me` answer wait until `release()`; the token is judged when the answer is given. */
  holdNextMe: () => Gate;
  /** Access tokens the server issued so far. */
  readonly issuedAccessTokens: string[];
}

export function rotatingTransport(backend: RotatingBackend, jar: CookieJar): RefreshTransport {
  let calls = 0;
  const plans = new Map<number, Gates>();
  const gates = new Map<string, Gate>();
  const named = (key: string) => {
    let g = gates.get(key);
    if (!g) gates.set(key, (g = gate()));
    return g;
  };
  const issued: string[] = [];
  const meCalls: { bearer: string | null; accepted: boolean }[] = [];
  let meHold: Gate | null = null;

  const refresh = walletCore.mutation('RefreshSession', async () => {
    const n = ++calls;
    const sentWith = jar.value; // read when the request is sent
    named(`sent:${n}`).open();
    const plan = plans.get(n) ?? {};
    await plan.arrival;
    const response = backend.consume(sentWith); // atomic on the "server", whatever the browser does
    named(`consumed:${n}`).open();
    await plan.delivery;
    if (!response.ok) return errorResponse('INVALID_REFRESH_TOKEN');
    jar.value = response.token; // the browser applies Set-Cookie when it receives the answer
    const accessToken = `access-${response.userId}-${response.token}`;
    issued.push(accessToken);
    return HttpResponse.json({
      data: {
        refreshSession: {
          accessToken,
          accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          user: { id: response.userId, email: 'demo@example.com', phone: null },
        },
      },
    });
  });

  const me = walletCore.query('Me', async ({ request }) => {
    const hold = meHold;
    meHold = null;
    await hold?.promise;
    const header = request.headers.get('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    const accepted = bearer !== null && issued.includes(bearer);
    meCalls.push({ bearer, accepted });
    return accepted
      ? HttpResponse.json({ data: { me: { id: '1', permissions: ['wallet'], strategy: 'jwt' } } })
      : errorResponse('UNAUTHENTICATED');
  });

  return {
    handlers: [refresh, me],
    get refreshCalls() {
      return calls;
    },
    plan: (n, g) => void plans.set(n, g),
    consumed: (n) => named(`consumed:${n}`).promise,
    sent: (n) => named(`sent:${n}`).promise,
    meCalls,
    holdNextMe: () => (meHold = gate()),
    issuedAccessTokens: issued,
  };
}

/** Timing controls of one operation (Login or Logout); the requests are numbered in the order they REACH the server. */
export interface OperationControls {
  readonly calls: number;
  plan: (n: number, gates: Gates) => void;
  /** The n-th request has reached the server (it left the browser with the cookie it then had). */
  sent: (n: number) => Promise<void>;
  /** The server has handled the n-th request (its effect on the server is done; the answer is not delivered yet). */
  consumed: (n: number) => Promise<void>;
}

export interface AuthTransport extends RefreshTransport {
  login: OperationControls;
  logout: OperationControls;
}

/** Email -> user id of the users the fixture knows. */
export const FIXTURE_USERS: Record<string, string> = {
  'demo@example.com': '1',
  'other@example.com': '2',
};

function controls(): OperationControls & {
  begin: () => { n: number; plan: Gates; opened: (name: 'sent' | 'consumed') => void };
} {
  let calls = 0;
  const plans = new Map<number, Gates>();
  const gates = new Map<string, Gate>();
  const named = (key: string) => {
    let g = gates.get(key);
    if (!g) gates.set(key, (g = gate()));
    return g;
  };
  return {
    get calls() {
      return calls;
    },
    plan: (n, g) => void plans.set(n, g),
    sent: (n) => named(`sent:${n}`).promise,
    consumed: (n) => named(`consumed:${n}`).promise,
    begin: () => {
      const n = ++calls;
      return {
        n,
        plan: plans.get(n) ?? {},
        opened: (name) => named(`${name}:${n}`).open(),
      };
    },
  };
}

/**
 * `rotatingTransport` plus `Login` and `Logout`, for the cross-tab cookie races (F2). SIMULATED server behavior (the
 * real Login/Logout resolvers are not merged; wallet-core PRs #12 and #15 are open): S2 and S4 are ASSUMPTIONS, not
 * backend facts. Open PR #15 (head 5750415) differs from S2 and agrees with S3 and S4, see below.
 *
 * - S1 (confirmed by the backend developer) refresh rotates the token, the old one dies at once, no grace period.
 * - S2 (assumption) Login starts a NEW independent session and sets its cookie; it revokes no other session.
 *   DIFFERS from PR #15: login also revokes the session of the refresh cookie the request carried ("login replaces its
 *   refresh cookie"). Not applied here until #15 is merged.
 * - S3 (assumption) Logout revokes exactly the session of the cookie it carries (not a token family, not every
 *   session of the user), answers `true` always, and its answer deletes the cookie, even a newer one.
 * - S4 (assumption) A failed refresh does not touch the cookie. Matches PR #15 (no Set-Cookie on INVALID_REFRESH_TOKEN).
 * Browser side (modeled, same as in `rotating-backend.ts`): the cookie is read when the request is sent and
 * `Set-Cookie` is applied when the answer is delivered, independently of what the page does with the answer.
 */
export function rotatingAuthTransport(backend: RotatingBackend, jar: CookieJar): AuthTransport {
  const base = rotatingTransport(backend, jar);
  const loginControls = controls();
  const logoutControls = controls();

  const login = walletCore.mutation('Login', async ({ variables }) => {
    const call = loginControls.begin();
    call.opened('sent');
    await call.plan.arrival;
    const userId = FIXTURE_USERS[variables.input.email];
    if (userId === undefined) return errorResponse('INVALID_CREDENTIALS');
    const token = backend.login(userId); // S2
    call.opened('consumed');
    await call.plan.delivery;
    jar.value = token; // Set-Cookie
    const accessToken = `access-${userId}-${token}`;
    base.issuedAccessTokens.push(accessToken);
    return HttpResponse.json({
      data: {
        login: {
          accessToken,
          accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          user: { id: userId, email: variables.input.email, phone: null },
        },
      },
    });
  });

  const logout = walletCore.mutation('Logout', async () => {
    const call = logoutControls.begin();
    const sentWith = jar.value; // read when the request is sent
    call.opened('sent');
    await call.plan.arrival;
    backend.revoke(sentWith); // S3
    call.opened('consumed');
    await call.plan.delivery;
    jar.value = null; // S3: Set-Cookie that deletes the cookie
    return HttpResponse.json({ data: { logout: true } });
  });

  return {
    ...base,
    login: loginControls,
    logout: logoutControls,
    handlers: [...base.handlers, login, logout],
  };
}
