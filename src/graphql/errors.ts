import { ClientError } from 'graphql-request';

/** A GraphQL error flattened for UI and Redux (serializable). */
export interface GraphQLRequestError {
  message: string;
  code?: string;
  /** `BAD_USER_INPUT`: the invalid input field (`email`, `password`, `phone`). */
  field?: string;
  /** Allowed `extensions` of the first GraphQL error (see `ALLOWED_EXTENSIONS`); features parse their own keys. */
  extensions?: Record<string, unknown>;
}

/**
 * The only `extensions` keys that reach the UI and Redux, as documented in the contracts (`schema/`): `code`,
 * `field` (`BAD_USER_INPUT`) and `lockedUntil` (`ACCOUNT_LOCKED`). Anything else the server adds (diagnostics, stack
 * traces, echoed input) is dropped. Add a key here when a feature starts to read it.
 */
const ALLOWED_EXTENSIONS = ['code', 'field', 'lockedUntil'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Allowed keys with string values only, so the result stays plain serializable data; `undefined` if none is left. */
function allowedExtensions(extensions: unknown): Record<string, string> | undefined {
  if (!isRecord(extensions)) return undefined;
  const allowed = ALLOWED_EXTENSIONS.flatMap((key) => {
    const value = extensions[key];
    return typeof value === 'string' ? [[key, value] as const] : [];
  });
  return allowed.length > 0 ? Object.fromEntries(allowed) : undefined;
}

export function toRequestError(error: unknown): GraphQLRequestError {
  if (error instanceof ClientError) {
    const first = error.response.errors?.[0];
    const extensions = first?.extensions;
    const allowed = allowedExtensions(extensions);
    return {
      // Never `error.message`: graphql-request puts the serialized request (with the variables, e.g. a password) in it.
      message: first?.message ?? `Request failed with HTTP ${error.response.status}`,
      // A string code only (validated with the allowlist), else the HTTP status as before.
      code: allowed?.code ?? String(error.response.status),
      ...(typeof extensions?.field === 'string' && { field: extensions.field }),
      // From the parsed response body only, never the request: no variables, and plain data for Redux.
      ...(allowed && { extensions: allowed }),
    };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof ClientError &&
    !!error.response.errors?.some((e) => e.extensions?.code === code)
  );
}
