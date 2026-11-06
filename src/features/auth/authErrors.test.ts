import { describeLoginError, describeRegisterError, formatUnlockTime } from './authErrors';
import { PASSWORD_HINT, PHONE_HINT } from './validation';

describe('describeLoginError', () => {
  it('tells the user to try again when the cookie lock could not be taken', () => {
    expect(describeLoginError({ code: 'AUTH_COOKIE_LOCK', message: 'dev text' })).toBe(
      'Could not start the session safely. Please try again.',
    );
  });

  it('keeps INVALID_CREDENTIALS generic', () => {
    expect(describeLoginError({ code: 'INVALID_CREDENTIALS', message: 'dev text' })).toBe(
      'Invalid email or password.',
    );
  });

  it('shows the unlock time for ACCOUNT_LOCKED', () => {
    const lockedUntil = '2026-11-02T10:15:00.000Z';
    const message = describeLoginError({ code: 'ACCOUNT_LOCKED', message: 'x', lockedUntil });
    expect(message).toContain('locked until');
    expect(message).toContain(formatUnlockTime(lockedUntil)!);
  });

  it('copes with a missing or malformed lockedUntil', () => {
    for (const lockedUntil of [undefined, 'garbage']) {
      expect(describeLoginError({ code: 'ACCOUNT_LOCKED', message: 'x', lockedUntil })).toMatch(
        /locked\. Try again later/,
      );
    }
  });

  it('distinguishes an unreachable server from other failures', () => {
    expect(describeLoginError({ message: 'fetch failed' })).toMatch(/could not reach the server/i);
    expect(describeLoginError({ code: '500', message: 'x' })).toMatch(/something went wrong/i);
  });
});

describe('describeRegisterError', () => {
  it('maps EMAIL_ALREADY_REGISTERED to the email field', () => {
    expect(describeRegisterError({ code: 'EMAIL_ALREADY_REGISTERED', message: 'x' })).toEqual({
      fieldErrors: { email: 'This email is already registered. Log in instead.' },
    });
  });

  it('maps BAD_USER_INPUT by extensions.field, with our own texts', () => {
    expect(
      describeRegisterError({ code: 'BAD_USER_INPUT', field: 'password', message: 'dev' }),
    ).toEqual({ fieldErrors: { password: PASSWORD_HINT } });
    expect(
      describeRegisterError({ code: 'BAD_USER_INPUT', field: 'phone', message: 'dev' }),
    ).toEqual({ fieldErrors: { phone: PHONE_HINT } });
    expect(
      describeRegisterError({ code: 'BAD_USER_INPUT', field: 'email', message: 'dev' }),
    ).toEqual({
      fieldErrors: { email: 'Enter a valid email address' },
    });
  });

  it('falls back to a form error for an unknown field or code', () => {
    expect(
      describeRegisterError({ code: 'BAD_USER_INPUT', field: 'nope', message: 'x' }).formError,
    ).toBeTruthy();
    expect(describeRegisterError({ code: '500', message: 'x' }).formError).toMatch(
      /something went wrong/i,
    );
  });
});
