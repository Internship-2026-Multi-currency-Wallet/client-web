import { describe, expect, it } from 'vitest';
import { ClientError } from 'graphql-request';
import { request } from '../graphql/client';
import {
  googleAccountQuery,
  linkGoogleAccountMutation,
  loginWithGoogleMutation,
  startGoogleLinkMutation,
  startGoogleLoginMutation,
  unlinkGoogleAccountMutation,
} from '../features/auth/google.wallet-core';
import { loginMutation } from '../features/auth/auth.wallet-core';
import { OTHER_USER, TEST_USER, signInForTest } from '../test/auth';
import { googleLoginOff } from '../test/google';
import { DEMO_USER } from './auth-handlers';
import { mockGoogleCode, seedMockGoogleLink } from './google-handlers';

const REDIRECT_URI = 'http://localhost:5173/auth/google/callback';

const errorOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ClientError);
  return (error as ClientError).response.errors?.[0];
};

const startLink = async (password: string = DEMO_USER.password) =>
  (await request('walletCore', startGoogleLinkMutation, { password })).startGoogleLink;
const startLogin = async () =>
  (await request('walletCore', startGoogleLoginMutation)).startGoogleLogin;

const linkWith = (state: string, googleEmail: string, extra: { redirectUri?: string } = {}) =>
  request('walletCore', linkGoogleAccountMutation, {
    input: { code: mockGoogleCode(googleEmail), state, redirectUri: REDIRECT_URI, ...extra },
  });
const link = async (googleEmail: string) => linkWith((await startLink()).state, googleEmail);

const loginWith = async (googleEmail: string) =>
  request('walletCore', loginWithGoogleMutation, {
    input: {
      code: mockGoogleCode(googleEmail),
      state: (await startLogin()).state,
      redirectUri: REDIRECT_URI,
    },
  });

describe('mock Google login (wallet-core E1-5 contract)', () => {
  it('starts a sign-in with a state, a nonce and a 10-minute expiry', async () => {
    signInForTest();
    const before = Date.now();
    const start = await startLink();
    const after = Date.now();
    expect(start.state).not.toBe(start.nonce);
    const expiresAt = new Date(start.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 10 * 60 * 1000);
  });

  it('links the Google account and shows it', async () => {
    signInForTest();
    expect(await request('walletCore', googleAccountQuery)).toEqual({ googleAccount: null });
    const { linkGoogleAccount } = await link('demo@gmail.com');
    expect(linkGoogleAccount).toEqual({ email: 'demo@gmail.com', linkedAt: expect.any(String) });
    expect(await request('walletCore', googleAccountQuery)).toEqual({
      googleAccount: linkGoogleAccount,
    });
  });

  it('returns the same link when the same Google account is linked again', async () => {
    signInForTest();
    const first = await link('demo@gmail.com');
    await expect(link('demo@gmail.com')).resolves.toEqual(first);
  });

  it('refuses a Google account linked to another user', async () => {
    seedMockGoogleLink(OTHER_USER.id, 'shared@gmail.com');
    signInForTest();
    expect(await errorOf(link('shared@gmail.com'))).toMatchObject({
      message: 'This Google account is already linked to another user',
      extensions: { code: 'GOOGLE_ACCOUNT_LINKED_TO_ANOTHER_USER' },
    });
  });

  it('refuses a second Google account until the first is unlinked', async () => {
    signInForTest();
    await link('demo@gmail.com');
    expect((await errorOf(link('second@gmail.com')))?.extensions).toEqual({
      code: 'GOOGLE_ACCOUNT_ALREADY_LINKED',
    });
    await expect(request('walletCore', unlinkGoogleAccountMutation)).resolves.toEqual({
      unlinkGoogleAccount: true,
    });
    expect(await request('walletCore', googleAccountQuery)).toEqual({ googleAccount: null });
    await expect(link('second@gmail.com')).resolves.toBeDefined();
  });

  describe('the google_auth_state cookie', () => {
    const stateCookie = () =>
      /(?:^|; )google_auth_state=([^;]*)/.exec(document.cookie)?.[1] ?? null;

    it('is set when a sign-in starts and cleared by the attempt that uses it', async () => {
      signInForTest();
      const { state } = await startLink();
      expect(stateCookie()).not.toBeNull();
      await linkWith(state, 'demo@gmail.com');
      expect(stateCookie()).toBeNull();
    });

    it('is what the sign-in is carried in: without it the attempt is refused', async () => {
      signInForTest();
      const { state } = await startLink();
      document.cookie = 'google_auth_state=; path=/; max-age=0';
      expect((await errorOf(linkWith(state, 'demo@gmail.com')))?.extensions).toEqual({
        code: 'INVALID_GOOGLE_STATE',
      });
    });
  });

  describe('INVALID_GOOGLE_STATE', () => {
    it('without a started sign-in', async () => {
      signInForTest();
      expect((await errorOf(linkWith('made-up', 'demo@gmail.com')))?.extensions).toEqual({
        code: 'INVALID_GOOGLE_STATE',
      });
    });

    it('for another state than the started one', async () => {
      signInForTest();
      await startLink();
      expect((await errorOf(linkWith('other', 'demo@gmail.com')))?.extensions?.code).toBe(
        'INVALID_GOOGLE_STATE',
      );
    });

    it('for a sign-in that was already used', async () => {
      signInForTest();
      const { state } = await startLink();
      await linkWith(state, 'unverified@gmail.com').catch(() => undefined);
      expect((await errorOf(linkWith(state, 'demo@gmail.com')))?.extensions?.code).toBe(
        'INVALID_GOOGLE_STATE',
      );
    });

    it('for a sign-in started for logging in', async () => {
      signInForTest();
      const { state } = await startLogin();
      expect((await errorOf(linkWith(state, 'demo@gmail.com')))?.extensions?.code).toBe(
        'INVALID_GOOGLE_STATE',
      );
    });
  });

  it.each([
    ['another path on an allowed origin', 'http://localhost:5173/'],
    ['the callback path on a foreign origin', 'https://attacker.example/auth/google/callback'],
    ['a relative path', '/auth/google/callback'],
    ['a trailing slash', 'http://localhost:5173/auth/google/callback/'],
    ['a query', 'http://localhost:5173/auth/google/callback?x=1'],
    ['an empty query', 'http://localhost:5173/auth/google/callback?'],
    ['a fragment', 'http://localhost:5173/auth/google/callback#x'],
    ['an upper-case host', 'http://LOCALHOST:5173/auth/google/callback'],
  ])('answers BAD_USER_INPUT for a redirect URI with %s', async (_name, redirectUri) => {
    signInForTest();
    const { state } = await startLink();
    expect((await errorOf(linkWith(state, 'demo@gmail.com', { redirectUri })))?.extensions).toEqual(
      { code: 'BAD_USER_INPUT', field: 'redirectUri' },
    );
  });

  it('accepts the callback of the origin the app itself runs on', async () => {
    signInForTest();
    const { state } = await startLink();
    await expect(
      linkWith(state, 'demo@gmail.com', { redirectUri: `${location.origin}/auth/google/callback` }),
    ).resolves.toMatchObject({ linkGoogleAccount: { email: 'demo@gmail.com' } });
  });

  it('answers INVALID_GOOGLE_CODE for a code Google did not issue', async () => {
    signInForTest();
    const { state } = await startLink();
    const error = await errorOf(
      request('walletCore', linkGoogleAccountMutation, {
        input: { code: 'garbage', state, redirectUri: REDIRECT_URI },
      }),
    );
    expect(error?.extensions?.code).toBe('INVALID_GOOGLE_CODE');
  });

  it('answers GOOGLE_EMAIL_NOT_VERIFIED for an unverified Google email', async () => {
    signInForTest();
    expect((await errorOf(link('unverified@gmail.com')))?.extensions?.code).toBe(
      'GOOGLE_EMAIL_NOT_VERIFIED',
    );
  });

  it.each([
    ['googleAccount', () => request('walletCore', googleAccountQuery)],
    ['startGoogleLink', () => startLink()],
    ['unlinkGoogleAccount', () => request('walletCore', unlinkGoogleAccountMutation)],
  ])('%s needs a signed-in user', async (_name, call) => {
    expect((await errorOf(call()))?.extensions?.code).toBe('UNAUTHENTICATED');
  });

  describe('the password before linking', () => {
    const hasStateCookie = () => document.cookie.includes('google_auth_state=');

    it('answers INVALID_CREDENTIALS for a wrong password and starts no sign-in', async () => {
      signInForTest();
      const error = await errorOf(startLink('Wrong1234!'));
      expect(error?.extensions).toEqual({ code: 'INVALID_CREDENTIALS' });
      expect(hasStateCookie()).toBe(false);
    });

    it('locks the account after 5 wrong passwords, for linking and for logging in', async () => {
      signInForTest();
      for (let attempt = 1; attempt < 5; attempt += 1) {
        expect((await errorOf(startLink('Wrong1234!')))?.extensions?.code).toBe(
          'INVALID_CREDENTIALS',
        );
      }
      const locked = await errorOf(startLink('Wrong1234!'));
      expect(locked?.extensions).toMatchObject({
        code: 'ACCOUNT_LOCKED',
        lockedUntil: expect.any(String),
      });
      expect((await errorOf(startLink()))?.extensions?.code).toBe('ACCOUNT_LOCKED');
      const login = await errorOf(
        request('walletCore', loginMutation, {
          input: { email: DEMO_USER.email, password: DEMO_USER.password },
        }),
      );
      expect(login?.extensions?.code).toBe('ACCOUNT_LOCKED');
    });
  });

  describe('loginWithGoogle', () => {
    it('logs in the user the Google account is linked to', async () => {
      signInForTest();
      await link('demo@gmail.com');
      localStorage.clear();
      const { loginWithGoogle } = await loginWith('demo@gmail.com');
      expect(loginWithGoogle.user).toEqual(TEST_USER);
      expect(loginWithGoogle.accessToken).toMatch(/^mock-access\.1\./);
    });

    it('answers GOOGLE_ACCOUNT_NOT_LINKED for an unlinked Google account', async () => {
      expect(await errorOf(loginWith('nobody@gmail.com'))).toMatchObject({
        message: 'No account is linked to this Google account',
        extensions: { code: 'GOOGLE_ACCOUNT_NOT_LINKED' },
      });
    });

    it('answers GOOGLE_ACCOUNT_NOT_LINKED once the account is unlinked', async () => {
      signInForTest();
      await link('demo@gmail.com');
      await request('walletCore', unlinkGoogleAccountMutation);
      localStorage.clear();
      expect((await errorOf(loginWith('demo@gmail.com')))?.extensions?.code).toBe(
        'GOOGLE_ACCOUNT_NOT_LINKED',
      );
    });
  });
});

describe('mock Google login: the auth.googleLogin setting and a locked account', () => {
  it('answers GOOGLE_LOGIN_DISABLED wherever a sign-in starts or finishes, and still lets a user unlink', async () => {
    signInForTest();
    seedMockGoogleLink(TEST_USER.id, 'demo.google@example.com');
    googleLoginOff();

    const link = await errorOf(startLink('Wrong1234!'));
    expect(link?.extensions).toEqual({ code: 'GOOGLE_LOGIN_DISABLED' });
    const login = await errorOf(request('walletCore', startGoogleLoginMutation));
    expect(login?.extensions).toEqual({ code: 'GOOGLE_LOGIN_DISABLED' });

    const input = { code: 'garbage', state: 'garbage', redirectUri: REDIRECT_URI };
    const finishLogin = await errorOf(request('walletCore', loginWithGoogleMutation, { input }));
    expect(finishLogin?.extensions).toEqual({ code: 'GOOGLE_LOGIN_DISABLED' });
    const finishLink = await errorOf(request('walletCore', linkGoogleAccountMutation, { input }));
    expect(finishLink?.extensions).toEqual({ code: 'GOOGLE_LOGIN_DISABLED' });

    await expect(request('walletCore', unlinkGoogleAccountMutation)).resolves.toEqual({
      unlinkGoogleAccount: true,
    });
  });

  it('answers ACCOUNT_LOCKED for a Google login to an account locked by wrong passwords', async () => {
    seedMockGoogleLink(TEST_USER.id, 'demo.google@example.com');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request('walletCore', loginMutation, {
        input: { email: DEMO_USER.email, password: 'Wrong1234!' },
      }).catch(() => undefined);
    }

    const { state } = (await request('walletCore', startGoogleLoginMutation)).startGoogleLogin;
    const error = await errorOf(
      request('walletCore', loginWithGoogleMutation, {
        input: {
          code: mockGoogleCode('demo.google@example.com'),
          state,
          redirectUri: REDIRECT_URI,
        },
      }),
    );
    expect(error?.extensions).toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });
});
