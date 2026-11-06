import {
  PASSWORD_HINT,
  PHONE_HINT,
  PHONE_REQUIRED,
  toLoginInput,
  toSignUpInput,
  validateEmail,
  validateLogin,
  validateNewPassword,
  validatePassword,
  validatePhone,
  validateSignUp,
} from './validation';

describe('validateEmail', () => {
  it('requires a value', () => {
    expect(validateEmail('')).toBe('Enter your email');
    expect(validateEmail('   ')).toBe('Enter your email');
  });

  it.each([
    'plain',
    'a@b',
    '@b.com',
    'a@.com',
    'a b@c.com',
    'a@@b.com',
    'om@,.l',
    'a@b..co',
    'a@-b.co',
    'a..b@c.co',
    '.a@c.co',
    'a.@c.co',
    'ü@example.com',
    'user@пошта.укр', // IDN: wallet-core (zod) refuses it
    'user@example.xn--p1ai', // a punycode TLD has digits and hyphens: refused too
    'a@b.c',
    'a@b.c_o',
    'a@b.co.',
  ])('rejects %j', (email) => {
    expect(validateEmail(email)).toBe('Enter a valid email address');
  });

  it.each([
    'user@example.com',
    'first.last+tag@sub.example.co',
    '  user@example.com  ',
    'a@my-host.example.org',
    'user@xn--e1afmkfd.com', // punycode label under an ASCII TLD
    '\u212A@example.com', // lower-cases to a plain "k", like on the backend
    'a@b-.co', // zod allows a trailing hyphen in a label
  ])('accepts %j', (email) => {
    expect(validateEmail(email)).toBeUndefined();
  });
});

describe('validateNewPassword (register rules)', () => {
  it('requires a value', () => {
    expect(validateNewPassword('')).toBe('Enter a password');
  });

  it.each([
    ['Ab1!xyz', 'shorter than 8'],
    ['Secret!!!', 'no digit'],
    ['secret123!', 'no uppercase letter'],
    ['Secret1234', 'no special character'],
  ])('rejects %j (%s)', (password) => {
    expect(validateNewPassword(password)).toBe(PASSWORD_HINT);
  });

  // The backend's `\d` is ASCII-only: Arabic-Indic and fullwidth digits are not digits for the password rule.
  it.each(['Secret٣٣٣!', 'Secret１２３!'])(
    'rejects a password with only non-ASCII digits: %j',
    (password) => {
      expect(validateNewPassword(password)).toBe(PASSWORD_HINT);
    },
  );

  it.each(['Secret123!', 'Abcdefg1_', 'Пароль123!', 'Aa1 aaaaa'])('accepts %j', (password) => {
    expect(validateNewPassword(password)).toBeUndefined();
  });
});

describe('validateNewPassword length boundaries', () => {
  const ofLength = (n: number) => 'Aa1!' + 'a'.repeat(n - 4);

  it('accepts exactly 128 characters', () => {
    expect(ofLength(128)).toHaveLength(128);
    expect(validateNewPassword(ofLength(128))).toBeUndefined();
  });

  it('rejects 129 characters', () => {
    expect(ofLength(129)).toHaveLength(129);
    expect(validateNewPassword(ofLength(129))).toBe(PASSWORD_HINT);
  });

  it('describes the 8-128 range in the hint', () => {
    expect(PASSWORD_HINT).toContain('8-128');
  });
});

describe('validatePhone (E.164, optional by default)', () => {
  it.each(['', '   ', '+380501234567', '+1234567', '+123456789012345', ' +380501234567 '])(
    'accepts %j',
    (phone) => {
      expect(validatePhone(phone)).toBeUndefined();
    },
  );

  it.each([
    '380501234567',
    '+0501234567',
    '+123456',
    '+1234567890123456',
    '+38050abc4567',
    '+380 50 123',
    '+٣٨٠٥٠١٢٣٤٥٦٧',
  ])('rejects %j', (phone) => {
    expect(validatePhone(phone)).toBe(PHONE_HINT);
  });

  it('accepts 7 to 15 digits and nothing outside', () => {
    expect(validatePhone('+1234567')).toBeUndefined();
    expect(validatePhone('+123456')).toBe(PHONE_HINT);
    expect(validatePhone('+123456789012345')).toBeUndefined();
    expect(validatePhone('+1234567890123456')).toBe(PHONE_HINT);
  });

  describe('when required', () => {
    it.each(['', '   '])('rejects an empty phone %j', (phone) => {
      expect(validatePhone(phone, true)).toBe(PHONE_REQUIRED);
    });

    it('still validates a non-empty phone the same way', () => {
      expect(validatePhone('+380501234567', true)).toBeUndefined();
      expect(validatePhone('0501234567', true)).toBe(PHONE_HINT);
    });
  });
});

describe('validateEmail length (backend: at most 255)', () => {
  const ofLength = (n: number) => 'a'.repeat(n - '@b.co'.length) + '@b.co';

  it('accepts exactly 255 characters', () => {
    expect(ofLength(255)).toHaveLength(255);
    expect(validateEmail(ofLength(255))).toBeUndefined();
  });

  it('rejects 256 characters with a length message', () => {
    expect(validateEmail(ofLength(256))).toBe('Email must be at most 255 characters');
  });

  it('measures the trimmed value', () => {
    expect(validateEmail(` ${ofLength(255)} `)).toBeUndefined();
  });
});

describe('validatePassword', () => {
  it('requires a value but sets no length or complexity rules', () => {
    expect(validatePassword('')).toBe('Enter a password');
    expect(validatePassword('a')).toBeUndefined();
    expect(validatePassword(' ')).toBeUndefined();
  });
});

describe('validateSignUp', () => {
  it('requires the phone only with phoneRequired', () => {
    const values = { email: 'a@b.co', password: 'Secret123!', phone: '' };
    expect(validateSignUp(values)).toEqual({});
    expect(validateSignUp(values, { phoneRequired: false })).toEqual({});
    expect(validateSignUp(values, { phoneRequired: true })).toEqual({ phone: PHONE_REQUIRED });
  });

  it('returns no errors for valid values, with or without phone', () => {
    expect(validateSignUp({ email: 'a@b.co', password: 'Secret123!', phone: '' })).toEqual({});
    expect(
      validateSignUp({ email: 'a@b.co', password: 'Secret123!', phone: '+380501234567' }),
    ).toEqual({});
  });

  it('collects errors per field', () => {
    expect(validateSignUp({ email: 'nope', password: '', phone: '12' })).toEqual({
      email: 'Enter a valid email address',
      password: 'Enter a password',
      phone: PHONE_HINT,
    });
  });
});

describe('toSignUpInput', () => {
  it('trims email and phone and keeps the password untouched', () => {
    expect(toSignUpInput({ email: ' a@b.co ', password: ' p ', phone: ' +123 ' })).toEqual({
      email: 'a@b.co',
      password: ' p ',
      phone: '+123',
    });
  });

  it('omits an empty phone', () => {
    const input = toSignUpInput({ email: 'a@b.co', password: 'p', phone: '  ' });
    expect(input).toEqual({ email: 'a@b.co', password: 'p' });
    expect('phone' in input).toBe(false);
  });
});

describe('validateLogin', () => {
  it('requires email and password and nothing more', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'Enter your email',
      password: 'Enter a password',
    });
    expect(validateLogin({ email: 'nope', password: 'x' })).toEqual({
      email: 'Enter a valid email address',
    });
    expect(validateLogin({ email: 'a@b.co', password: 'x' })).toEqual({});
  });
});

describe('toLoginInput', () => {
  it('trims the email and keeps the password exactly as typed', () => {
    expect(toLoginInput({ email: ' a@b.co ', password: '  p  ' })).toEqual({
      email: 'a@b.co',
      password: '  p  ',
    });
  });
});
