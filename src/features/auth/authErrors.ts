import type { GraphQLRequestError } from '../../graphql/client';
import { PASSWORD_HINT, PHONE_HINT } from './validation';

/** Same values as `AuthErrorCode` in wallet-core. */
export const AUTH_ERROR_CODES = {
  BAD_USER_INPUT: 'BAD_USER_INPUT',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
} as const;

// Texts are ours: the server `message` is for developers.
const GENERIC = 'Something went wrong. Please try again.';

function unknownError(error: Partial<GraphQLRequestError>): string {
  return error.code === undefined
    ? 'Could not reach the server. Check your connection and try again.'
    : GENERIC;
}

export function formatUnlockTime(lockedUntil: string | undefined): string | null {
  if (!lockedUntil) return null;
  const date = new Date(lockedUntil);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}

export function describeLoginError(error: Partial<GraphQLRequestError>): string {
  switch (error.code) {
    case AUTH_ERROR_CODES.INVALID_CREDENTIALS:
      // Generic on purpose: never reveals whether the email exists.
      return 'Invalid email or password.';
    case AUTH_ERROR_CODES.ACCOUNT_LOCKED: {
      const time = formatUnlockTime(error.lockedUntil);
      return time
        ? `Too many failed attempts. Your account is locked until ${time}.`
        : 'Too many failed attempts. Your account is locked. Try again later.';
    }
    default:
      return unknownError(error);
  }
}

export interface RegisterErrorView {
  /** Shown above the form. */
  formError?: string;
  /** Shown under the field named by the server. */
  fieldErrors?: Partial<Record<'email' | 'password' | 'phone', string>>;
}

export function describeRegisterError(error: Partial<GraphQLRequestError>): RegisterErrorView {
  if (error.code === AUTH_ERROR_CODES.EMAIL_ALREADY_REGISTERED) {
    return { fieldErrors: { email: 'This email is already registered. Log in instead.' } };
  }
  if (error.code === AUTH_ERROR_CODES.BAD_USER_INPUT) {
    switch (error.field) {
      case 'email':
        return { fieldErrors: { email: 'Enter a valid email address' } };
      case 'password':
        return { fieldErrors: { password: PASSWORD_HINT } };
      case 'phone':
        return { fieldErrors: { phone: PHONE_HINT } };
    }
  }
  return { formError: unknownError(error) };
}
