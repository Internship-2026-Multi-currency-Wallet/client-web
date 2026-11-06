/**
 * Client-side checks that mirror the wallet-core `register` rules (merged wallet-core #8, `register.schema.ts`), so most mistakes are
 * caught before the request. The server stays the source of truth and still answers `BAD_USER_INPUT`.
 * Login checks credentials, not format: it only requires a password to be present.
 */

export interface SignUpValues {
  email: string;
  password: string;
  phone: string;
}

export interface SignUpInput {
  email: string;
  password: string;
  phone?: string;
}

export interface LoginValues {
  email: string;
  password: string;
}

export type LoginInput = LoginValues;

export type SignUpField = 'email' | 'password' | 'phone';
export type SignUpErrors = Partial<Record<SignUpField, string>>;
export type LoginErrors = Partial<Record<'email' | 'password', string>>;

export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 255;
export const PASSWORD_HINT =
  'Use 8-128 characters with a digit, an uppercase letter and a special character';
export const PHONE_REQUIRED = 'Enter your phone number';
export const PHONE_HINT = 'Use international format, e.g. +380501234567';

/**
 * The email rule of wallet-core (`z.email()` of zod 4, which `register.schema.ts` uses), the same regex as zod's, only without escapes that ESLint calls useless: ASCII
 * only, no leading, trailing or double dots in the local part, a domain of ASCII labels and a letters-only TLD of at
 * least 2 characters. So `ü@example.com` and `user@пошта.укр` are NOT accepted (nor punycode TLDs like `.xn--p1ai`; a punycode label under an ASCII TLD is). Whether the
 * mailbox exists is the server's job. `validation.parity.test.ts` checks this regex against zod itself.
 */
export const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

/** E.164: `+`, then 7-15 digits, the first not 0 (same as the backend). */
export const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/;

/** What the backend stores and compares: trimmed and lower-cased (so `\u212A` "Kelvin" becomes a plain `k`). */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function validateEmail(email: string): string | undefined {
  const value = normalizeEmail(email);
  if (value === '') return 'Enter your email';
  // Same order as the backend (format first), so the same input gets the same verdict.
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address';
  if (value.length > EMAIL_MAX_LENGTH)
    return `Email must be at most ${EMAIL_MAX_LENGTH} characters`;
  return undefined;
}

/** Login: only presence. Not trimmed: leading/trailing spaces may be part of the password. */
export function validatePassword(password: string): string | undefined {
  return password === '' ? 'Enter a password' : undefined;
}

/**
 * Sign-up: 8-128 characters, an ASCII digit (like the backend's `\d`; other Unicode digits do not count), an uppercase
 * letter and a special character (not a letter or digit).
 */
export function validateNewPassword(password: string): string | undefined {
  if (password === '') return 'Enter a password';
  const strong =
    password.length >= 8 &&
    password.length <= PASSWORD_MAX_LENGTH &&
    /[0-9]/.test(password) &&
    /\p{Lu}/u.test(password) &&
    /[^\p{L}\p{N}]/u.test(password);
  return strong ? undefined : PASSWORD_HINT;
}

/**
 * E.164: `+`, then 7-15 digits, the first not 0 (same as the backend). A non-empty phone is always checked; an empty
 * one fails only when `required` (the client setting `auth.phoneRequiredAt` is `signup`).
 */
export function validatePhone(phone: string, required = false): string | undefined {
  const value = phone.trim();
  if (value === '') return required ? PHONE_REQUIRED : undefined;
  return PHONE_PATTERN.test(value) ? undefined : PHONE_HINT;
}

/** Empty object = valid. The phone is optional unless `phoneRequired`. */
export function validateSignUp(
  values: SignUpValues,
  { phoneRequired = false }: { phoneRequired?: boolean } = {},
): SignUpErrors {
  const errors: SignUpErrors = {};
  const email = validateEmail(values.email);
  const password = validateNewPassword(values.password);
  const phone = validatePhone(values.phone, phoneRequired);
  if (email) errors.email = email;
  if (password) errors.password = password;
  if (phone) errors.phone = phone;
  return errors;
}

/** Empty object = valid. */
export function validateLogin(values: LoginValues): LoginErrors {
  const errors: LoginErrors = {};
  const email = validateEmail(values.email);
  const password = validatePassword(values.password);
  if (email) errors.email = email;
  if (password) errors.password = password;
  return errors;
}

export function toLoginInput(values: LoginValues): LoginInput {
  return { email: values.email.trim(), password: values.password };
}

export function toSignUpInput(values: SignUpValues): SignUpInput {
  const phone = values.phone.trim();
  return {
    email: values.email.trim(),
    password: values.password,
    ...(phone !== '' && { phone }),
  };
}
