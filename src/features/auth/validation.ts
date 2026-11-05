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

// Deliberately simple, not RFC 5322. Local part: anything without spaces or "@". Domain: dot-separated labels of
// letters/digits/hyphens (no leading/trailing hyphen, no empty label) and a TLD of at least 2 characters.
// Whether the mailbox exists or the TLD is real is the server's job.
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?';
const TLD = '[\\p{L}\\p{N}][\\p{L}\\p{N}-]*[\\p{L}\\p{N}]';
const EMAIL_PATTERN = new RegExp(`^[^\\s@]+@(?:${LABEL}\\.)+${TLD}$`, 'u');

export function validateEmail(email: string): string | undefined {
  const value = email.trim();
  if (value === '') return 'Enter your email';
  if (value.length > EMAIL_MAX_LENGTH)
    return `Email must be at most ${EMAIL_MAX_LENGTH} characters`;
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address';
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
  return /^\+[1-9]\d{6,14}$/.test(value) ? undefined : PHONE_HINT;
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
