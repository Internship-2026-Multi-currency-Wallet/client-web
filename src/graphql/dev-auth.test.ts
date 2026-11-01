import { authorizationHeader, devUserPermissions } from './dev-auth';

describe('dev auth', () => {
  it('builds the Dev authorization header', () => {
    expect(authorizationHeader('1:wallet')).toBe('Dev 1:wallet');
    expect(authorizationHeader(null)).toBeUndefined();
  });

  it('reads permissions from the dev user', () => {
    expect(devUserPermissions('100:bo:users,bo:users:modify')).toEqual([
      'bo:users',
      'bo:users:modify',
    ]);
    expect(devUserPermissions('7')).toEqual([]);
    expect(devUserPermissions(null)).toEqual([]);
  });
});
