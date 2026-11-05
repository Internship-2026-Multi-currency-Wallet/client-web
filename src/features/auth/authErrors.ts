import type { GraphQLRequestError } from '../../graphql/client';
import { PASSWORD_HINT, PHONE_HINT } from './validation';

/** Texts are ours: the server `message` is for developers. Codes are from the wallet-core contract. */
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
    case 'INVALID_CREDENTIALS':
      // Generic on purpose: never reveals whether the email exists.
      return 'Invalid email or password.';
    case 'ACCOUNT_LOCKED': {
      const time = formatUnlockTime(error.lockedUntil);
      return time
        ? `Too many failed attempts. Your account is locked until ${time}.`
        : 'Too many failed attempts. Your account is locked. Try again later.';
    }
    case 'SESSION_CHANGED':
      return 'Your session changed while you were logging in. Please try again.';
    case 'AUTH_COOKIE_LOCK':
      return 'Could not start the session safely. Please try again.';
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
  if (error.code === 'EMAIL_ALREADY_REGISTERED') {
    return { fieldErrors: { email: 'This email is already registered. Log in instead.' } };
  }
  if (error.code === 'BAD_USER_INPUT') {
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
