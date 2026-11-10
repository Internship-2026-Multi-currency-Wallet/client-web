import { z } from 'zod';

import type { LoginInput, RegisterInput } from '../../gql/wallet-core/graphql';

export type { LoginInput };
export type SignUpInput = RegisterInput;
export type SignUpErrors = Partial<Record<keyof SignUpValues, string>>;

export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 255;
export const PASSWORD_HINT =
  'Use 8-128 characters with a digit, an uppercase letter and a special character';
export const PHONE_REQUIRED = 'Enter your phone number';
export const PHONE_HINT = 'Use international format, e.g. +380501234567';

export const EMAIL_PATTERN = z.regexes.email;

/** E.164: `+`, then 7-15 digits, the first not 0 (same as the backend). */
export const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

/** What the backend stores and compares: trimmed and lower-cased (so `\u212A` "Kelvin" becomes a plain `k`). */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .pipe(
    z
      .string()
      .min(1, 'Enter your email')
      .pipe(
        z
          .email('Enter a valid email address')
          .max(EMAIL_MAX_LENGTH, `Email must be at most ${EMAIL_MAX_LENGTH} characters`),
      ),
  );
export const passwordSchema = z.string().min(1, 'Enter a password');
export const newPasswordSchema = passwordSchema.pipe(
  z
    .string()
    .min(8, PASSWORD_HINT)
    .max(PASSWORD_MAX_LENGTH, PASSWORD_HINT)
    .regex(/[0-9]/, PASSWORD_HINT)
    .regex(/\p{Lu}/u, PASSWORD_HINT)
    .regex(/[^\p{L}\p{N}]/u, PASSWORD_HINT),
);
export const phoneSchema = (required = false) =>
  z
    .string()
    .trim()
    .min(required ? 1 : 0, PHONE_REQUIRED)
    .refine((value) => value === '' || PHONE_PATTERN.test(value), PHONE_HINT);

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const signUpSchema = (phoneRequired = false) =>
  z.object({
    email: emailSchema,
    password: newPasswordSchema,
    phone: phoneSchema(phoneRequired),
  });

export type LoginValues = z.input<typeof loginSchema>;
export type SignUpValues = z.input<ReturnType<typeof signUpSchema>>;

export function toLoginInput(values: LoginValues): LoginInput {
  return { email: normalizeEmail(values.email), password: values.password };
}

export function toSignUpInput(values: SignUpValues): SignUpInput {
  const phone = values.phone.trim();
  return {
    email: normalizeEmail(values.email),
    password: values.password,
    ...(phone !== '' && { phone }),
  };
}
