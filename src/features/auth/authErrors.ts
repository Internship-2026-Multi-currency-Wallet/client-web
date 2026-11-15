import type { GraphQLRequestError } from '../../graphql/errors';
import { INVALID_REFRESH_TOKEN } from '../../graphql/refresh';
import { GOOGLE_POPUP_ERRORS } from './googlePopup';
import { PASSWORD_HINT, PHONE_HINT } from './validation';

/** Same values as `AuthErrorCode` in wallet-core. */
export const AUTH_ERROR_CODES = {
  BAD_USER_INPUT: 'BAD_USER_INPUT',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INVALID_REFRESH_TOKEN,
  GOOGLE_LOGIN_DISABLED: 'GOOGLE_LOGIN_DISABLED',
  INVALID_GOOGLE_STATE: 'INVALID_GOOGLE_STATE',
  INVALID_GOOGLE_CODE: 'INVALID_GOOGLE_CODE',
  GOOGLE_EMAIL_NOT_VERIFIED: 'GOOGLE_EMAIL_NOT_VERIFIED',
  GOOGLE_ACCOUNT_LINKED_TO_ANOTHER_USER: 'GOOGLE_ACCOUNT_LINKED_TO_ANOTHER_USER',
  GOOGLE_ACCOUNT_ALREADY_LINKED: 'GOOGLE_ACCOUNT_ALREADY_LINKED',
  GOOGLE_ACCOUNT_NOT_LINKED: 'GOOGLE_ACCOUNT_NOT_LINKED',
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

export function lockedUntilOf(error: Partial<GraphQLRequestError>): string | undefined {
  const value = error.extensions?.lockedUntil;
  return typeof value === 'string' ? value : undefined;
}

export function describeLoginError(error: Partial<GraphQLRequestError>): string {
  switch (error.code) {
    case AUTH_ERROR_CODES.INVALID_CREDENTIALS:
      // Generic on purpose: never reveals whether the email exists.
      return 'Invalid email or password.';
    case AUTH_ERROR_CODES.ACCOUNT_LOCKED: {
      const time = formatUnlockTime(lockedUntilOf(error));
      return time
        ? `Too many failed attempts. Your account is locked until ${time}.`
        : 'Too many failed attempts. Your account is locked. Try again later.';
    }
    default:
      return unknownError(error);
  }
}

/** Errors that login and linking share; `null` = not one of them. */
function describeGoogleCommonError(error: Partial<GraphQLRequestError>): string | null {
  switch (error.code) {
    case GOOGLE_POPUP_ERRORS.POPUP_CLOSED:
      return 'Google sign-in was cancelled.';
    case GOOGLE_POPUP_ERRORS.POPUP_BLOCKED:
      return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
    case GOOGLE_POPUP_ERRORS.TIMEOUT:
      return 'Google sign-in took too long. Please try again.';
    case GOOGLE_POPUP_ERRORS.FAILED:
    case AUTH_ERROR_CODES.INVALID_GOOGLE_STATE:
    case AUTH_ERROR_CODES.INVALID_GOOGLE_CODE:
      return 'Google sign-in failed or expired. Please try again.';
    case AUTH_ERROR_CODES.GOOGLE_EMAIL_NOT_VERIFIED:
      return 'The email of this Google account is not verified.';
    case AUTH_ERROR_CODES.GOOGLE_LOGIN_DISABLED:
      return 'Sign-in with Google is not available right now.';
    default:
      return null;
  }
}

export function describeGoogleLoginError(error: Partial<GraphQLRequestError>): string {
  switch (error.code) {
    case AUTH_ERROR_CODES.GOOGLE_ACCOUNT_NOT_LINKED:
      return 'This Google account is not linked to any account. Log in with your email and password, then link Google in your account settings.';
    case AUTH_ERROR_CODES.ACCOUNT_LOCKED:
      return describeLoginError(error);
    default:
      return describeGoogleCommonError(error) ?? unknownError(error);
  }
}

export function describeGoogleLinkError(error: Partial<GraphQLRequestError>): string {
  switch (error.code) {
    case AUTH_ERROR_CODES.GOOGLE_ACCOUNT_LINKED_TO_ANOTHER_USER:
      return 'This Google account is already linked to another user.';
    case AUTH_ERROR_CODES.GOOGLE_ACCOUNT_ALREADY_LINKED:
      return 'Another Google account is already linked. Unlink it first.';
    default:
      return describeGoogleCommonError(error) ?? unknownError(error);
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
