import { api, graphqlQuery } from '../../app/api';
import type { LoginInput, RegisterInput } from '../../gql/wallet-core/graphql';
import { request, requestAbortable } from '../../graphql/client';
import { withAuthCookieLock } from '../../graphql/cookie-lock';
import {
  saveSessionIfCurrent,
  SessionChangedError,
  sessionGeneration,
  sessionIsStill,
  type SessionUser,
} from '../../graphql/session';
import { waitForPendingLogout } from './logoutCoordinator';
import { loginMutation, logoutMutation, registerMutation } from './auth.wallet-core';

export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    /** Creates the account only: no session is started, the user logs in next. */
    register: build.mutation<SessionUser, RegisterInput>({
      queryFn: (input) =>
        graphqlQuery(async () => {
          const { register } = await request('walletCore', registerMutation, { input });
          return { ...register, phone: register.phone ?? null };
        }),
    }),
    /**
     * Saving the session also updates the auth slice (see `createStore`). Stale results are dropped.
     * The login sets the refresh cookie, so it runs under the cookie lock (see `cookie-lock.ts`) from the check that
     * it is still relevant until the session is saved: a login that lost against a logout or another login while
     * waiting is not sent at all, and its cookie can never end up next to another user's session.
     */
    login: build.mutation<SessionUser, LoginInput>({
      queryFn: (input) =>
        graphqlQuery(async () => {
          // A logout of this device may still be on the wire: its late answer must not clear this login's cookie.
          const generation = sessionGeneration(); // taken first: a logout during the wait makes this login stale
          await waitForPendingLogout();
          return withAuthCookieLock(
            async (signal) => {
              if (!sessionIsStill(generation)) throw new SessionChangedError();
              const { login } = await requestAbortable(signal, 'walletCore', loginMutation, {
                input,
              });
              const user = { ...login.user, phone: login.user.phone ?? null };
              // A logout or another login happened while this one was in flight: its result must not win.
              const saved = await saveSessionIfCurrent(generation, {
                accessToken: login.accessToken,
                accessTokenExpiresAt: login.accessTokenExpiresAt,
                user,
              });
              if (!saved) throw new SessionChangedError();
              return user;
            },
            { whenUnavailable: 'run' },
          );
        }),
    }),
    /**
     * Revokes the refresh session on the server; the argument is the identity of the logout (what `clearSession()`
     * returned), so the request is sent only while that logout is still the latest event of the session: a newer
     * login must keep its session and cookie. Clearing the local session is `useLogout`'s job. Abortable: `signal`
     * also cancels the wait for the cookie lock.
     */
    logout: build.mutation<boolean, string>({
      queryFn: (logoutGeneration, { signal }) =>
        graphqlQuery(() =>
          withAuthCookieLock(
            async (requestSignal) => {
              if (!sessionIsStill(logoutGeneration)) return false; // replaced by a newer login/logout: nothing to revoke
              return (await requestAbortable(requestSignal, 'walletCore', logoutMutation)).logout;
            },
            { signal, whenUnavailable: 'run' },
          ),
        ),
    }),
  }),
});

export const { useRegisterMutation, useLoginMutation, useLogoutMutation } = authApi;
