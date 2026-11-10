import { api, graphqlQuery } from '../../app/api';
import type { LoginInput, RegisterInput } from '../../gql/wallet-core/graphql';
import { request, type RequestOptions } from '../../graphql/client';
import { saveSession, sessionFromPayload, type SessionUser } from '../../graphql/session';
import { loginMutation, logoutMutation, registerMutation } from './auth.wallet-core';

/** These calls create or end the session: an `UNAUTHENTICATED` is their answer, never a reason to refresh. */
const NO_SESSION_RETRY: RequestOptions = { retryOnUnauthenticated: false };

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    /** Creates the account only: the user logs in next. */
    register: build.mutation<SessionUser, RegisterInput>({
      queryFn: (input) =>
        graphqlQuery(async () => {
          const { register } = await request(
            'walletCore',
            registerMutation,
            { input },
            NO_SESSION_RETRY,
          );
          return { ...register, phone: register.phone ?? null };
        }),
    }),
    login: build.mutation<SessionUser, LoginInput>({
      queryFn: (input) =>
        graphqlQuery(async () => {
          const { login } = await request('walletCore', loginMutation, { input }, NO_SESSION_RETRY);
          const session = sessionFromPayload(login);
          saveSession(session);
          return session.user;
        }),
    }),
    /** Revokes the refresh session on the server and clears its cookie. */
    logout: build.mutation<boolean, void>({
      queryFn: () =>
        graphqlQuery(
          async () =>
            (await request('walletCore', logoutMutation, undefined, NO_SESSION_RETRY)).logout,
        ),
    }),
  }),
});

export const { useRegisterMutation, useLoginMutation, useLogoutMutation } = authApi;
