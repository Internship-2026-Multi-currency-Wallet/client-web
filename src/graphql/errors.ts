import { ClientError } from 'graphql-request';

/** A GraphQL error flattened for UI and Redux (serializable). */
export interface GraphQLRequestError {
  message: string;
  code?: string;
  /** `BAD_USER_INPUT`: the invalid input field (`email`, `password`, `phone`). */
  field?: string;
  extensions?: Record<string, unknown>;
}

/** Only contract-approved string extensions may enter Redux because server diagnostics can contain sensitive input. */
const ALLOWED_EXTENSIONS = ['code', 'field', 'lockedUntil'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
      code: allowed?.code ?? String(error.response.status),
      ...(typeof extensions?.field === 'string' && { field: extensions.field }),
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
