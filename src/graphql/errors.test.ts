import { ClientError } from 'graphql-request';
import { hasErrorCode, toRequestError } from './errors';

const SECRET = 'Distinct-Pa55word!-must-never-leak';
const request = {
  query: 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken } }',
  variables: { input: { email: 'leak@example.com', password: SECRET } },
};

/** What graphql-request throws for a response; `errors` are plain JSON objects, as parsed from the wire. */
const clientError = ({ status = 200, errors }: { status?: number; errors?: object[] }) =>
  new ClientError(
    {
      status,
      headers: new Headers(),
      body: '',
      errors: errors as ClientError['response']['errors'],
    },
    request,
  );

describe('toRequestError', () => {
  it('keeps only the allowed extensions (code, field, lockedUntil)', () => {
    const error = toRequestError(
      clientError({
        errors: [
          {
            message: 'Account is locked',
            extensions: {
              code: 'ACCOUNT_LOCKED',
              field: 'email',
              lockedUntil: '2030-01-01T00:00:00.000Z',
              stacktrace: ['Error: locked', '    at AuthService.login (auth.service.ts:42)'],
              exception: { name: 'LockedException', cause: { sql: 'SELECT * FROM users' } },
              originalError: { message: 'internal' },
              input: { password: SECRET },
            },
          },
        ],
      }),
    );

    expect(error).toEqual({
      message: 'Account is locked',
      code: 'ACCOUNT_LOCKED',
      field: 'email',
      extensions: {
        code: 'ACCOUNT_LOCKED',
        field: 'email',
        lockedUntil: '2030-01-01T00:00:00.000Z',
      },
    });
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });

  it('drops allowed keys whose value is not a string', () => {
    const error = toRequestError(
      clientError({
        errors: [
          {
            message: 'x',
            extensions: {
              code: 'BAD_USER_INPUT',
              field: { name: 'password', value: SECRET },
              lockedUntil: 1893456000000,
            },
          },
        ],
      }),
    );

    expect(error).toEqual({
      message: 'x',
      code: 'BAD_USER_INPUT',
      extensions: { code: 'BAD_USER_INPUT' },
    });
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });

  it('falls back to the HTTP status for a non-string code, never copying it', () => {
    const error = toRequestError(
      clientError({
        status: 400,
        errors: [
          {
            message: 'x',
            extensions: { code: { stacktrace: ['at AuthService'], input: { password: SECRET } } },
          },
        ],
      }),
    );

    expect(error).toEqual({ message: 'x', code: '400' });
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });

  it('omits extensions when none of the allowed keys is left', () => {
    const error = toRequestError(
      clientError({
        status: 500,
        errors: [{ message: 'boom', extensions: { stacktrace: ['at x'] } }],
      }),
    );
    expect(error).toEqual({ message: 'boom', code: '500' });
  });

  it('keeps the HTTP fallback for a response without GraphQL errors, never ClientError.message', () => {
    const raw = clientError({ status: 503 });
    expect(raw.message).toContain(SECRET); // what graphql-request would leak

    const error = toRequestError(raw);

    expect(error).toEqual({ message: 'Request failed with HTTP 503', code: '503' });
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });

  it('is plain serializable data', () => {
    const error = toRequestError(
      clientError({
        errors: [
          {
            message: 'locked',
            extensions: { code: 'ACCOUNT_LOCKED', lockedUntil: '2030-01-01T00:00:00.000Z' },
          },
        ],
      }),
    );
    expect(JSON.parse(JSON.stringify(error))).toEqual(error);
    expect(Object.getPrototypeOf(error.extensions)).toBe(Object.prototype);
  });

  it('keeps the message of other errors as before', () => {
    expect(toRequestError(new TypeError('Failed to fetch'))).toEqual({
      message: 'Failed to fetch',
    });
    expect(toRequestError('offline')).toEqual({ message: 'offline' });
  });
});

describe('hasErrorCode', () => {
  it('still sees codes of any GraphQL error, unaffected by the filter', () => {
    const error = clientError({
      errors: [
        { message: 'a', extensions: { code: 'FIRST' } },
        { message: 'b', extensions: { code: 'UNAUTHENTICATED', stacktrace: [] } },
      ],
    });
    expect(hasErrorCode(error, 'UNAUTHENTICATED')).toBe(true);
    expect(hasErrorCode(error, 'OTHER')).toBe(false);
    expect(hasErrorCode(new Error('UNAUTHENTICATED'), 'UNAUTHENTICATED')).toBe(false);
  });
});
