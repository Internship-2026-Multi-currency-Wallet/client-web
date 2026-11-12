import { InvalidSettingsError, parsePublicSettings } from './clientSettings';

const valid = [
  { key: 'auth.googleLogin', value: true },
  { key: 'auth.phoneRequiredAt', value: 'never' },
  { key: 'products.enabled', value: ['wallet'] },
];

describe('parsePublicSettings', () => {
  it('turns the key/value list into a typed object', () => {
    expect(parsePublicSettings(valid)).toEqual({
      'auth.googleLogin': true,
      'auth.phoneRequiredAt': 'never',
      'products.enabled': ['wallet'],
    });
  });

  it.each(['signup', 'firstTransfer', 'never'])('accepts phoneRequiredAt "%s"', (value) => {
    const list = valid.map((s) => (s.key === 'auth.phoneRequiredAt' ? { ...s, value } : s));
    expect(parsePublicSettings(list)['auth.phoneRequiredAt']).toBe(value);
  });

  it('ignores unknown extra keys', () => {
    const settings = parsePublicSettings([...valid, { key: 'future.flag', value: { a: 1 } }]);
    expect(Object.keys(settings)).toHaveLength(3);
  });

  it('rejects a missing known key', () => {
    const list = valid.filter((s) => s.key !== 'auth.googleLogin');
    expect(() => parsePublicSettings(list)).toThrow(InvalidSettingsError);
    expect(() => parsePublicSettings(list)).toThrow('auth.googleLogin is missing');
  });

  it.each([
    ['auth.googleLogin', 'true'],
    ['auth.googleLogin', null],
    ['auth.phoneRequiredAt', 'sometimes'],
    ['auth.phoneRequiredAt', 1],
    ['products.enabled', 'wallet'],
    ['products.enabled', ['wallet', 1]],
  ])('rejects invalid %s = %j', (key, value) => {
    const list = valid.map((s) => (s.key === key ? { ...s, value } : s));
    expect(() => parsePublicSettings(list)).toThrow(`${key} has an invalid value`);
  });

  it('reports every problem at once', () => {
    try {
      parsePublicSettings([{ key: 'auth.googleLogin', value: 1 }]);
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidSettingsError).problems).toHaveLength(3);
    }
  });

  describe('duplicate known keys', () => {
    const rest = valid.slice(1);
    const googleLogin = (value: unknown) => ({ key: 'auth.googleLogin', value });

    it.each([
      ['conflicting values', [googleLogin(true), googleLogin(false)]],
      ['identical values', [googleLogin(true), googleLogin(true)]],
      ['invalid then valid', [googleLogin('x'), googleLogin(true)]],
      ['valid then invalid', [googleLogin(true), googleLogin('x')]],
    ])('rejects %s', (_name, duplicates) => {
      expect(() => parsePublicSettings([...duplicates, ...rest])).toThrow(
        'auth.googleLogin is duplicated',
      );
    });

    it('rejects duplicates that are not adjacent', () => {
      const list = [googleLogin(true), ...rest, googleLogin(true)];
      expect(() => parsePublicSettings(list)).toThrow('auth.googleLogin is duplicated');
    });

    it('does not reject duplicated unknown keys', () => {
      const extra = [
        { key: 'future.flag', value: 1 },
        { key: 'future.flag', value: 2 },
      ];
      expect(parsePublicSettings([...valid, ...extra])['auth.googleLogin']).toBe(true);
    });
  });
});
