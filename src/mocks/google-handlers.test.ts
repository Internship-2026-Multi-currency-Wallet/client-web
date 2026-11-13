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
import { OTHER_USER, TEST_USER, signInForTest } from '../test/auth';
import { mockGoogleCode } from './google-handlers';

const REDIRECT_URI = 'http://localhost:5173/auth/google/callback';

const errorOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ClientError);
  return (error as ClientError).response.errors?.[0];
};

const startLink = async () =>
  (await request('walletCore', startGoogleLinkMutation)).startGoogleLink;
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
    signInForTest({ user: OTHER_USER });
    await link('shared@gmail.com');
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
    ['startGoogleLink', () => request('walletCore', startGoogleLinkMutation)],
    ['unlinkGoogleAccount', () => request('walletCore', unlinkGoogleAccountMutation)],
  ])('%s needs a signed-in user', async (_name, call) => {
    expect((await errorOf(call()))?.extensions?.code).toBe('UNAUTHENTICATED');
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
