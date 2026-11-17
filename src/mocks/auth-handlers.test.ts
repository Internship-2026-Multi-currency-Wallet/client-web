import { describe, expect, it } from 'vitest';
import { ClientError } from 'graphql-request';
import { request } from '../graphql/client';
import { registerMutation } from '../features/auth/auth.wallet-core';
import { setMockPhoneRequiredAt } from './auth-handlers';

const register = (password: string) =>
  request('walletCore', registerMutation, {
    input: { email: 'mock-password@example.com', password },
  });

const passwordOfLength = (n: number) => 'Aa1!' + 'a'.repeat(n - 4);

describe('mock Register: password length (backend: 8-128, separate messages)', () => {
  it('accepts 128 characters', async () => {
    await expect(register(passwordOfLength(128))).resolves.toMatchObject({
      register: { email: 'mock-password@example.com' },
    });
  });

  it.each([7, 129])('rejects %i characters with BAD_USER_INPUT on password', async (length) => {
    const error = await register(passwordOfLength(length)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClientError);
    expect((error as ClientError).response.errors?.[0]).toMatchObject({
      message:
        length < 8
          ? 'Password must be at least 8 characters'
          : 'Password must be at most 128 characters',
      extensions: { code: 'BAD_USER_INPUT', field: 'password' },
    });
  });
});

const registerWith = (input: { email?: string; password?: string; phone?: string | null }) =>
  request('walletCore', registerMutation, {
    input: { email: 'mock-input@example.com', password: 'Secret123!', ...input },
  });

const problemOf = async (promise: Promise<unknown>) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ClientError);
  return (error as ClientError).response.errors?.[0];
};

describe('mock Register: phone, password digit and email length (backend PR #8)', () => {
  it.each(['+1234567', '+123456789012345'])('accepts the phone %s', async (phone) => {
    await expect(registerWith({ email: `p${phone}@example.com`, phone })).resolves.toBeDefined();
  });

  it.each(['+123456', '+1234567890123456', '+٣٨٠٥٠١٢٣٤٥٦٧'])(
    'rejects the phone %s',
    async (phone) => {
      expect(await problemOf(registerWith({ phone }))).toMatchObject({
        extensions: { code: 'BAD_USER_INPUT', field: 'phone' },
      });
    },
  );

  it('requires an ASCII digit in the password', async () => {
    expect(await problemOf(registerWith({ password: 'Secret٣٣٣!' }))).toMatchObject({
      message: 'Password must contain at least one digit',
      extensions: { code: 'BAD_USER_INPUT', field: 'password' },
    });
  });

  it('allows an email of 255 characters and rejects 256', async () => {
    const ofLength = (n: number) => 'a'.repeat(n - '@b.co'.length) + '@b.co';
    await expect(registerWith({ email: ofLength(255) })).resolves.toBeDefined();
    expect(await problemOf(registerWith({ email: ofLength(256) }))).toMatchObject({
      extensions: { code: 'BAD_USER_INPUT', field: 'email' },
    });
  });
});

describe('mock Register: auth.phoneRequiredAt (backend PR #50)', () => {
  const NO_PHONE = [{}, { phone: null }, { phone: '' }, { phone: '  ' }];

  it.each(NO_PHONE)('answers PHONE_REQUIRED at signup without a phone: %j', async (phone) => {
    setMockPhoneRequiredAt('signup');
    expect(await problemOf(registerWith(phone))).toMatchObject({
      message: 'Phone is required',
      extensions: { code: 'PHONE_REQUIRED', field: 'phone' },
    });
  });

  it('answers BAD_USER_INPUT, not PHONE_REQUIRED, for an invalid phone at signup', async () => {
    setMockPhoneRequiredAt('signup');
    expect(await problemOf(registerWith({ phone: ' +380501234567 ' }))).toMatchObject({
      extensions: { code: 'BAD_USER_INPUT', field: 'phone' },
    });
  });

  it('reports a broken password before the missing phone', async () => {
    setMockPhoneRequiredAt('signup');
    expect(await problemOf(registerWith({ password: 'short' }))).toMatchObject({
      extensions: { code: 'BAD_USER_INPUT', field: 'password' },
    });
  });

  it('registers with a phone at signup', async () => {
    setMockPhoneRequiredAt('signup');
    await expect(registerWith({ phone: '+380501234567' })).resolves.toMatchObject({
      register: { phone: '+380501234567' },
    });
  });

  it.each(['never', 'firstTransfer'] as const)(
    'registers without a phone and stores null when it is %s',
    async (value) => {
      setMockPhoneRequiredAt(value);
      await expect(registerWith({ phone: '  ' })).resolves.toMatchObject({
        register: { phone: null },
      });
    },
  );
});
