import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ClientError } from 'graphql-request';
import { registerMutation } from './auth.wallet-core';
import { request } from '../../graphql/client';
import { signUpSchema } from './validation';

const validateSignUp = (values: { email: string; password: string; phone: string }) => {
  const result = signUpSchema().safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path[0], issue.message]));
};

/**
 * The Register rules of wallet-core, copied from its merged `src/auth/register.schema.ts` (same zod 4 version
 * range). The client form and the MSW mock must give the same verdict as this schema for every input, so a
 * mistake the backend rejects is caught before the request and the mock never accepts what production refuses.
 * Update this copy when `register.schema.ts` changes.
 */
const backend = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('email').max(255, 'email')),
  password: z
    .string()
    .min(8, 'password')
    .max(128, 'password')
    .regex(/\d/, 'password')
    .regex(/\p{Lu}/u, 'password')
    .regex(/[^\p{L}\p{N}]/u, 'password'),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'phone')
    .nullish(),
});

const VALID = { email: 'artem@test.com', password: 'Qwerty1!' };
const long = (n: number) => 'a'.repeat(n - '@b.co'.length) + '@b.co';

interface Case {
  name: string;
  email?: string;
  password?: string;
  phone?: string | null;
}

const EMAILS: Case[] = [
  'user@example.com',
  'First.Last+tag@Sub.Example.CO',
  "o'brien@example.com",
  '  padded@example.com  ',
  'a@b.co',
  'user@пошта.укр', // IDN domain: rejected by zod
  'ü@example.com', // non-ASCII local part
  'a..b@example.com',
  '.a@example.com',
  'a.@example.com',
  'a@-b.co',
  'a@b-.co',
  'a@b.c',
  'a@b.c0',
  'a@b',
  'a@@b.co',
  'a b@example.com',
  'K@example.com', // Kelvin sign: lower-cases to an ASCII "k", so it is valid after normalising
  'İ@example.com', // dotted capital I: lower-cases to "i" + a combining dot, which is not ASCII
  'a@sub..example.com',
  long(255),
  long(256),
  `${'a'.repeat(300)}`, // too long AND malformed: the format error comes first
  '',
  '   ',
].map((email) => ({
  name: `email ${JSON.stringify(email.length > 40 ? email.slice(0, 40) + '…' : email)}`,
  email,
}));

const PASSWORDS: Case[] = [
  'Qwerty1!',
  'Qwe1!',
  'Qwerty1!' + 'a'.repeat(120), // 128
  'Qwerty1!' + 'a'.repeat(121), // 129
  'Qwerty!!',
  'qwerty1!',
  'Qwerty12',
  'Пароль1 ',
  'Qwerty1_',
  'Secret٣٣٣!', // Arabic-Indic digits are not `\d`
  'Secret1 ', // a no-break space counts as special
  '',
].map((password) => ({
  name: `password ${JSON.stringify(password.length > 20 ? password.slice(0, 20) + '…' : password)}`,
  password,
}));

const PHONES: Case[] = [
  undefined,
  null,
  '',
  ' ',
  '+380501234567',
  '+1234567',
  '+123456',
  '+123456789012345',
  '+1234567890123456',
  '+0501234567',
  '0501234567',
  '+380 50 123 45 67',
  ' +380501234567',
  '+٣٨٠٥٠١٢٣٤٥٦٧',
].map((phone) => ({ name: `phone ${JSON.stringify(phone)}`, phone }));

const CASES = [...EMAILS, ...PASSWORDS, ...PHONES];
const inputOf = (c: Case) => ({
  email: c.email ?? VALID.email,
  password: c.password ?? VALID.password,
  ...(c.phone !== undefined && { phone: c.phone }),
});

/** Field the backend reports first, or null when the input is valid. */
function backendField(input: object): string | null {
  const result = backend.safeParse(input);
  return result.success ? null : String(result.error.issues[0].path[0]);
}

describe('Register rules: client form and mock agree with wallet-core', () => {
  it.each(CASES)('mock Register, $name', async (c) => {
    const input = inputOf(c);
    const expected = backendField(input);
    // Each case registers a fresh address, so "already registered" never hides the verdict being compared.
    const unique =
      c.email === undefined ? { ...input, email: `case-${CASES.indexOf(c)}@example.com` } : input;
    const outcome = await request('walletCore', registerMutation, { input: unique }).then(
      () => null,
      (error: unknown) => {
        const first = (error as ClientError).response.errors?.[0];
        expect(first?.extensions?.code).toMatch(/^(BAD_USER_INPUT|EMAIL_ALREADY_REGISTERED)$/);
        return first?.extensions?.code === 'BAD_USER_INPUT'
          ? String(first.extensions.field)
          : 'taken';
      },
    );
    expect(outcome).toBe(expected);
  });

  it.each(CASES.filter((c) => c.phone === undefined || typeof c.phone === 'string'))(
    'client form, $name',
    (c) => {
      const input = inputOf(c);
      const errors = validateSignUp({
        email: input.email,
        password: input.password,
        phone: input.phone ?? '',
      });
      const expected = backendField(input);
      // The form trims the phone and treats a blank one as "no phone" (the request then omits it). That is the
      // only intended difference from the backend, which rejects "" and " +380…" when they are sent as they are.
      const phoneIsBlankOrPadded =
        c.phone === '' || (typeof c.phone === 'string' && c.phone.trim() !== c.phone);
      if (phoneIsBlankOrPadded) {
        expect(errors.phone).toBeUndefined();
        return;
      }
      const first = (['email', 'password', 'phone'] as const).find((field) => errors[field]);
      expect(first ?? null).toBe(expected);
    },
  );
});
