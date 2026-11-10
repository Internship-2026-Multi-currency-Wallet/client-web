import { api, graphqlQuery } from '../../app/api';
import type { LoginInput, RegisterInput } from '../../gql/wallet-core/graphql';
import { request } from '../../graphql/client';
import { saveSession, sessionFromPayload, type SessionUser } from '../../graphql/session';
import { loginMutation, logoutMutation, registerMutation } from './auth.wallet-core';

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    /** Creates the account only: the user logs in next. */
    register: build.mutation<SessionUser, RegisterInput>({
      queryFn: (input) =>
        graphqlQuery(async () => {
          const { register } = await request('walletCore', registerMutation, { input });
          return { ...register, phone: register.phone ?? null };
        }),
    }),
    login: build.mutation<SessionUser, LoginInput>({
      queryFn: (input) =>
        graphqlQuery(async () => {
          const { login } = await request('walletCore', loginMutation, { input });
          const session = sessionFromPayload(login);
          saveSession(session);
          return session.user;
        }),
    }),
    /** Revokes the refresh session on the server and clears its cookie. */
    logout: build.mutation<boolean, void>({
      queryFn: () => graphqlQuery(async () => (await request('walletCore', logoutMutation)).logout),
    }),
  }),
});

export const { useRegisterMutation, useLoginMutation, useLogoutMutation } = authApi;
