import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { type GraphQLRequestError, toRequestError } from '../graphql/client';

/**
 * RTK Query API for GraphQL. Features add their endpoints with `api.injectEndpoints`
 * in their own folder (see `features/system/systemApi.ts`), using `graphqlQuery` below.
 */
export const api = createApi({
  reducerPath: 'api',
  baseQuery: fakeBaseQuery<GraphQLRequestError>(),
  endpoints: () => ({}),
});

/** Wraps a GraphQL call into an RTK Query `queryFn` result. */
export async function graphqlQuery<T>(
  call: () => Promise<T>,
): Promise<{ data: T } | { error: GraphQLRequestError }> {
  try {
    return { data: await call() };
  } catch (error) {
    return { error: toRequestError(error) };
  }
}
