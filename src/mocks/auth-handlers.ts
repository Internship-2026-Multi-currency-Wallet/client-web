import { HttpResponse } from 'msw';
import { type GraphQLResponseBody, graphql } from 'msw/graphql';
import { config } from '../config-env';
import type {
  LoginMutation,
  LoginMutationVariables,
  LogoutMutation,
  RefreshSessionMutation,
  RegisterMutation,
  RegisterMutationVariables,
} from '../gql/wallet-core/graphql';
import { EMAIL_PATTERN, normalizeEmail, PHONE_PATTERN } from '../features/auth/validation';

/**
 * Mock of the wallet-core auth contract (schema from `wallet-core/main`, PR #2 + #5). `Register` follows the merged
 * resolver (`register.schema.ts`); `Login`, `RefreshSession` and `Logout` follow the merged `auth.service.ts`.
 *
 * The HttpOnly refresh cookie is imitated with a plain `mock_refresh` cookie (handlers run in the page, so
 * `document.cookie` works in the browser and in jsdom). Mock users are kept in `sessionStorage` (until the tab
 * closes) so that a reload keeps them and the session restore can be tried by hand. Mock mode only: use fake
 * passwords.
 */
const walletCore = graphql.link(config.walletCoreUrl);

export const DEMO_USER = { email: 'demo@example.com', password: 'Demo1234!' } as const;

const ACCESS_TTL_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const REFRESH_COOKIE = 'mock_refresh';

interface MockUser {
  id: string;
  email: string;
  phone: string | null;
  password: string;
  failedLogins: number;
  lockedUntil: number | null;
}

const USERS_KEY = 'mock.auth.users';

const demoUser = (): MockUser => ({
  id: '1',
  email: DEMO_USER.email,
  phone: null,
  password: DEMO_USER.password,
  failedLogins: 0,
  lockedUntil: null,
});

function loadUsers(): Map<string, MockUser> {
  const raw = sessionStorage.getItem(USERS_KEY);
  const list: MockUser[] = raw ? (JSON.parse(raw) as MockUser[]) : [demoUser()];
  return new Map(list.map((user) => [user.email, user]));
}

let users = loadUsers();

function persistUsers(): void {
  sessionStorage.setItem(USERS_KEY, JSON.stringify([...users.values()]));
}

export function resetMockAuth(): void {
  sessionStorage.removeItem(USERS_KEY);
  users = loadUsers();
  clearMockRefreshCookie();
}

type PublicUser = { id: string; email: string; phone: string | null };

const publicUser = ({ id, email, phone }: MockUser): PublicUser => ({ id, email, phone });

/** `mock-access.<userId>.<expiresAtMs>`: stateless, so `Me` can check it without a session store. */
export function mockAccessToken(userId: string, expiresAt = Date.now() + ACCESS_TTL_MS): string {
  return `mock-access.${userId}.${expiresAt}`;
}

/** Id of the user a still valid mock access token belongs to. */
export function userIdFromBearer(authorization: string | null): string | null {
  const match = /^Bearer mock-access\.([^.]+)\.(\d+)$/.exec(authorization ?? '');
  return match && Number(match[2]) > Date.now() ? match[1] : null;
}

export function setMockRefreshCookie(userId: string): void {
  document.cookie = `${REFRESH_COOKIE}=${userId}; path=/; max-age=${30 * 24 * 3600}`;
}

export function clearMockRefreshCookie(): void {
  document.cookie = `${REFRESH_COOKIE}=; path=/; max-age=0`;
}

function refreshCookieUserId(): string | null {
  const match = new RegExp(`(?:^|; )${REFRESH_COOKIE}=([^;]+)`).exec(document.cookie);
  return match ? match[1] : null;
}

function graphqlError(
  code: string,
  message: string,
  extensions: Record<string, string> = {},
): HttpResponse<GraphQLResponseBody<never>> {
  return HttpResponse.json({
    errors: [{ message, extensions: { code, ...extensions } }],
  });
}

function authPayload(user: MockUser) {
  const expiresAt = Date.now() + ACCESS_TTL_MS;
  return {
    accessToken: mockAccessToken(user.id, expiresAt),
    accessTokenExpiresAt: new Date(expiresAt).toISOString(),
    user: publicUser(user),
  };
}

/**
 * The first invalid field, exactly like `registerInputSchema` of wallet-core (same order, same rules and messages).
 * The email and phone patterns are the client's own (`validation.ts`); `validation.parity.test.ts` compares them
 * with the backend's zod schema. `phone`: omitted or `null` = none; an empty string is invalid (not trimmed).
 */
function registerInputProblem(input: RegisterMutationVariables['input']) {
  const email = normalizeEmail(input.email);
  if (!EMAIL_PATTERN.test(email)) {
    return { field: 'email', message: 'Email must be a valid email address' };
  }
  if (email.length > 255) {
    return { field: 'email', message: 'Email must be at most 255 characters' };
  }
  const p = input.password;
  if (p.length < 8) return { field: 'password', message: 'Password must be at least 8 characters' };
  if (p.length > 128) {
    return { field: 'password', message: 'Password must be at most 128 characters' };
  }
  if (!/\d/.test(p))
    return { field: 'password', message: 'Password must contain at least one digit' };
  if (!/\p{Lu}/u.test(p)) {
    return { field: 'password', message: 'Password must contain at least one uppercase letter' };
  }
  if (!/[^\p{L}\p{N}]/u.test(p)) {
    return { field: 'password', message: 'Password must contain at least one special character' };
  }
  if (input.phone != null && !PHONE_PATTERN.test(input.phone)) {
    return { field: 'phone', message: 'Phone must be in international format, e.g. +380501234567' };
  }
  return null;
}

export const authHandlers = [
  walletCore.mutation<RegisterMutation, RegisterMutationVariables>('Register', ({ variables }) => {
    const { input } = variables;
    const problem = registerInputProblem(input);
    if (problem) return graphqlError('BAD_USER_INPUT', problem.message, { field: problem.field });

    const email = normalizeEmail(input.email);
    if (users.has(email)) {
      return graphqlError('EMAIL_ALREADY_REGISTERED', 'Email is already registered');
    }
    const user: MockUser = {
      id: String(Math.max(0, ...[...users.values()].map((u) => Number(u.id))) + 1),
      email,
      phone: input.phone ?? null,
      password: input.password,
      failedLogins: 0,
      lockedUntil: null,
    };
    users.set(email, user);
    persistUsers();
    // PR #5: register creates the account only. No token, no cookie.
    return HttpResponse.json({ data: { register: publicUser(user) } });
  }),

  walletCore.mutation<LoginMutation, LoginMutationVariables>('Login', ({ variables }) => {
    const { email, password } = variables.input;
    const user = users.get(normalizeEmail(email));
    // Unknown email and wrong password look the same on purpose.
    if (!user) return graphqlError('INVALID_CREDENTIALS', 'Invalid email or password');

    const lockedError = () =>
      graphqlError(
        'ACCOUNT_LOCKED',
        `Account is locked until ${new Date(user.lockedUntil!).toISOString()}`,
        {
          lockedUntil: new Date(user.lockedUntil!).toISOString(),
        },
      );
    if (user.lockedUntil !== null && user.lockedUntil > Date.now()) return lockedError();

    if (user.password !== password) {
      user.failedLogins += 1;
      if (user.failedLogins >= MAX_FAILED_LOGINS) {
        user.failedLogins = 0;
        user.lockedUntil = Date.now() + LOCK_MS;
        persistUsers();
        // Same as the backend: the 5th failed attempt is the one that already answers ACCOUNT_LOCKED.
        return lockedError();
      }
      persistUsers();
      return graphqlError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    user.failedLogins = 0;
    user.lockedUntil = null;
    persistUsers();
    setMockRefreshCookie(user.id);
    return HttpResponse.json({ data: { login: authPayload(user) } });
  }),

  walletCore.mutation<RefreshSessionMutation>('RefreshSession', () => {
    const id = refreshCookieUserId();
    const user = id ? [...users.values()].find((candidate) => candidate.id === id) : undefined;
    if (!user) return graphqlError('INVALID_REFRESH_TOKEN', 'Session expired, please log in again');
    return HttpResponse.json({ data: { refreshSession: authPayload(user) } });
  }),

  walletCore.mutation<LogoutMutation>('Logout', ({ request }) => {
    // A browser ignores the response (and its Set-Cookie) of a request that was aborted.
    if (!request.signal.aborted) clearMockRefreshCookie();
    // Always true, also without a session. An issued access token stays valid until it expires (contract).
    return HttpResponse.json({ data: { logout: true } });
  }),
];
