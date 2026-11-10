import { ClientError } from 'graphql-request';

/** A GraphQL error flattened for UI and Redux (serializable). */
export interface GraphQLRequestError {
  message: string;
  code?: string;
  /** `BAD_USER_INPUT`: the invalid input field (`email`, `password`, `phone`). */
  field?: string;
  /** `extensions` of the first GraphQL error, as sent by the server; features parse their own keys. */
  extensions?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function toRequestError(error: unknown): GraphQLRequestError {
  if (error instanceof ClientError) {
    const first = error.response.errors?.[0];
    const extensions = first?.extensions;
    return {
      // Never `error.message`: graphql-request puts the serialized request (with the variables, e.g. a password) in it.
      message: first?.message ?? `Request failed with HTTP ${error.response.status}`,
      code: (extensions?.code as string | undefined) ?? String(error.response.status),
      ...(typeof extensions?.field === 'string' && { field: extensions.field }),
      // A copy of the parsed JSON body, never the request: no variables, and plain data for Redux.
      ...(isRecord(extensions) && { extensions: { ...extensions } }),
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
