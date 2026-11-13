import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { config } from '../config-env';
import { AUTH_ERROR_CODES } from '../features/auth/authErrors';
import type {
  GoogleAccountQuery,
  GoogleAuthInput,
  LinkGoogleAccountMutation,
  LinkGoogleAccountMutationVariables,
  LoginWithGoogleMutation,
  LoginWithGoogleMutationVariables,
  StartGoogleLinkMutation,
  StartGoogleLoginMutation,
  UnlinkGoogleAccountMutation,
} from '../gql/wallet-core/graphql';
import {
  authPayload,
  graphqlError,
  mockUserById,
  setMockRefreshCookie,
  userIdFromBearer,
} from './auth-handlers';

const walletCore = graphql.link(config.walletCoreUrl);

const MOCK_GOOGLE_CODE_PREFIX = 'mock-google:';
const STATE_TTL_MS = 10 * 60 * 1000;
// Because jsdom does not forward request cookies, this mock reads a JavaScript-accessible cookie
// directly and cannot detect omitted credentials.
const STATE_COOKIE = 'google_auth_state';
const LINKS_KEY = 'mock.google.links';
const CALLBACK_PATH = '/auth/google/callback';
// wallet-core accepts one of its CORS origins plus exactly this path, so the mock must not be laxer:
// a redirect URI it approves has to work against the real backend too.
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:5174', location.origin];

function isAllowedRedirect(redirectUri: string): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  return (
    ALLOWED_ORIGINS.includes(url.origin) &&
    url.pathname === CALLBACK_PATH &&
    url.search === '' &&
    url.hash === ''
  );
}

export function mockGoogleCode(email: string): string {
  return `${MOCK_GOOGLE_CODE_PREFIX}${email}`;
}

interface PendingSignIn {
  purpose: 'link' | 'login';
  userId: string | null;
  state: string;
  expiresAt: number;
}

interface MockLink {
  sub: string;
  userId: string;
  email: string;
  linkedAt: string;
}

function loadLinks(): MockLink[] {
  const raw = sessionStorage.getItem(LINKS_KEY);
  return raw ? (JSON.parse(raw) as MockLink[]) : [];
}

function saveLinks(links: MockLink[]): void {
  sessionStorage.setItem(LINKS_KEY, JSON.stringify(links));
}

function writeStateCookie(pending: PendingSignIn): void {
  const value = encodeURIComponent(JSON.stringify(pending));
  document.cookie = `${STATE_COOKIE}=${value}; path=/; max-age=${STATE_TTL_MS / 1000}`;
}

function readStateCookie(): PendingSignIn | null {
  const match = new RegExp(`(?:^|; )${STATE_COOKIE}=([^;]*)`).exec(document.cookie);
  if (!match) return null;
  try {
    return JSON.parse(decodeURIComponent(match[1])) as PendingSignIn;
  } catch {
    return null;
  }
}

function clearStateCookie(): void {
  document.cookie = `${STATE_COOKIE}=; path=/; max-age=0`;
}

export function resetMockGoogle(): void {
  sessionStorage.removeItem(LINKS_KEY);
  clearStateCookie();
}

function start(purpose: PendingSignIn['purpose'], userId: string | null) {
  const pending: PendingSignIn = {
    purpose,
    userId,
    state: crypto.randomUUID(),
    expiresAt: Date.now() + STATE_TTL_MS,
  };
  writeStateCookie(pending);
  return {
    state: pending.state,
    nonce: crypto.randomUUID(),
    expiresAt: new Date(pending.expiresAt).toISOString(),
  };
}

const unauthenticated = () => graphqlError('UNAUTHENTICATED', 'Authentication required');

type GoogleIdentity = { sub: string; email: string };

function verify(
  input: GoogleAuthInput,
  expected: { purpose: PendingSignIn['purpose']; userId: string | null },
): GoogleIdentity | ReturnType<typeof graphqlError> {
  const pending = readStateCookie();
  // One attempt per sign-in, as wallet-core clears the cookie whatever the result.
  clearStateCookie();
  if (!input.code.trim()) {
    return graphqlError(AUTH_ERROR_CODES.BAD_USER_INPUT, 'Google authorization code is required', {
      field: 'code',
    });
  }
  if (!input.state) {
    return graphqlError(AUTH_ERROR_CODES.BAD_USER_INPUT, 'Google sign-in state is required', {
      field: 'state',
    });
  }
  if (!isAllowedRedirect(input.redirectUri)) {
    return graphqlError(AUTH_ERROR_CODES.BAD_USER_INPUT, 'Unknown Google redirect URI', {
      field: 'redirectUri',
    });
  }
  if (
    !pending ||
    pending.expiresAt <= Date.now() ||
    pending.purpose !== expected.purpose ||
    pending.userId !== expected.userId ||
    pending.state !== input.state
  ) {
    return graphqlError(
      AUTH_ERROR_CODES.INVALID_GOOGLE_STATE,
      'Google sign-in expired or was started elsewhere, please start again',
    );
  }
  if (!input.code.startsWith(MOCK_GOOGLE_CODE_PREFIX)) {
    return graphqlError(
      AUTH_ERROR_CODES.INVALID_GOOGLE_CODE,
      'Google sign-in failed, please try again',
    );
  }
  const email = input.code.slice(MOCK_GOOGLE_CODE_PREFIX.length).trim().toLowerCase();
  if (email.startsWith('unverified')) {
    return graphqlError(
      AUTH_ERROR_CODES.GOOGLE_EMAIL_NOT_VERIFIED,
      'The email of this Google account is not verified',
    );
  }
  return { sub: `mock-sub:${email}`, email };
}

const isError = (value: unknown): value is ReturnType<typeof graphqlError> =>
  value instanceof Response;

const toAccount = ({ email, linkedAt }: MockLink) => ({ email, linkedAt });

export const googleHandlers = [
  walletCore.query<GoogleAccountQuery>('GoogleAccount', ({ request }) => {
    const userId = userIdFromBearer(request.headers.get('authorization'));
    if (!userId) return unauthenticated();
    const link = loadLinks().find((candidate) => candidate.userId === userId);
    return HttpResponse.json({ data: { googleAccount: link ? toAccount(link) : null } });
  }),

  walletCore.mutation<StartGoogleLinkMutation>('StartGoogleLink', ({ request }) => {
    const userId = userIdFromBearer(request.headers.get('authorization'));
    if (!userId) return unauthenticated();
    return HttpResponse.json({ data: { startGoogleLink: start('link', userId) } });
  }),

  walletCore.mutation<LinkGoogleAccountMutation, LinkGoogleAccountMutationVariables>(
    'LinkGoogleAccount',
    ({ request, variables }) => {
      const userId = userIdFromBearer(request.headers.get('authorization'));
      if (!userId) return unauthenticated();
      const identity = verify(variables.input, { purpose: 'link', userId });
      if (isError(identity)) return identity;

      const links = loadLinks();
      const mine = links.find((link) => link.userId === userId);
      if (mine?.sub === identity.sub) {
        return HttpResponse.json({ data: { linkGoogleAccount: toAccount(mine) } });
      }
      if (links.some((link) => link.sub === identity.sub)) {
        return graphqlError(
          AUTH_ERROR_CODES.GOOGLE_ACCOUNT_LINKED_TO_ANOTHER_USER,
          'This Google account is already linked to another user',
        );
      }
      if (mine) {
        return graphqlError(
          AUTH_ERROR_CODES.GOOGLE_ACCOUNT_ALREADY_LINKED,
          'Another Google account is already linked; unlink it first',
        );
      }
      const link: MockLink = { ...identity, userId, linkedAt: new Date().toISOString() };
      saveLinks([...links, link]);
      return HttpResponse.json({ data: { linkGoogleAccount: toAccount(link) } });
    },
  ),

  walletCore.mutation<UnlinkGoogleAccountMutation>('UnlinkGoogleAccount', ({ request }) => {
    const userId = userIdFromBearer(request.headers.get('authorization'));
    if (!userId) return unauthenticated();
    // wallet-core also ends the user's other sessions; the mock has one session only.
    saveLinks(loadLinks().filter((link) => link.userId !== userId));
    return HttpResponse.json({ data: { unlinkGoogleAccount: true } });
  }),

  walletCore.mutation<StartGoogleLoginMutation>('StartGoogleLogin', () =>
    HttpResponse.json({ data: { startGoogleLogin: start('login', null) } }),
  ),

  walletCore.mutation<LoginWithGoogleMutation, LoginWithGoogleMutationVariables>(
    'LoginWithGoogle',
    ({ variables }) => {
      const identity = verify(variables.input, { purpose: 'login', userId: null });
      if (isError(identity)) return identity;

      const link = loadLinks().find((candidate) => candidate.sub === identity.sub);
      const user = link && mockUserById(link.userId);
      if (!user) {
        return graphqlError(
          AUTH_ERROR_CODES.GOOGLE_ACCOUNT_NOT_LINKED,
          'No account is linked to this Google account',
        );
      }
      if (user.lockedUntil !== null && user.lockedUntil > Date.now()) {
        const lockedUntil = new Date(user.lockedUntil).toISOString();
        return graphqlError(
          AUTH_ERROR_CODES.ACCOUNT_LOCKED,
          `Account is locked until ${lockedUntil}`,
          {
            lockedUntil,
          },
        );
      }
      setMockRefreshCookie(user.id);
      return HttpResponse.json({ data: { loginWithGoogle: authPayload(user) } });
    },
  ),
];
