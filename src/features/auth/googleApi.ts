import { useState } from 'react';
import { api, graphqlQuery } from '../../app/api';
import type {
  GoogleAccountQuery,
  GoogleAuthInput,
  StartGoogleLoginMutation,
} from '../../gql/wallet-core/graphql';
import type { GraphQLRequestError } from '../../graphql/errors';
import { request, type RequestOptions } from '../../graphql/client';
import { saveSession, sessionFromPayload, type SessionUser } from '../../graphql/session';
import { useClientSetting } from '../settings/useClientSetting';
import {
  googleAccountQuery,
  linkGoogleAccountMutation,
  loginWithGoogleMutation,
  startGoogleLinkMutation,
  startGoogleLoginMutation,
  unlinkGoogleAccountMutation,
} from './google.wallet-core';
import { isGoogleSignInConfigured, openGooglePopup, signInWithGoogle } from './googlePopup';

/** Login calls create the session: an `UNAUTHENTICATED` is their answer, never a reason to refresh. */
const NO_SESSION_RETRY: RequestOptions = { retryOnUnauthenticated: false };

type LinkedAccount = NonNullable<GoogleAccountQuery['googleAccount']>;
type GoogleAuthStart = StartGoogleLoginMutation['startGoogleLogin'];

export const googleApi = api.enhanceEndpoints({ addTagTypes: ['GoogleAccount'] }).injectEndpoints({
  endpoints: (build) => ({
    googleAccount: build.query<LinkedAccount | null, void>({
      queryFn: () =>
        graphqlQuery(async () => (await request('walletCore', googleAccountQuery)).googleAccount),
      providesTags: ['GoogleAccount'],
    }),
    startGoogleLogin: build.mutation<GoogleAuthStart, void>({
      queryFn: () =>
        graphqlQuery(
          async () =>
            (await request('walletCore', startGoogleLoginMutation, undefined, NO_SESSION_RETRY))
              .startGoogleLogin,
        ),
    }),
    loginWithGoogle: build.mutation<SessionUser, GoogleAuthInput>({
      queryFn: (input) =>
        graphqlQuery(async () => {
          const { loginWithGoogle } = await request(
            'walletCore',
            loginWithGoogleMutation,
            { input },
            NO_SESSION_RETRY,
          );
          const session = sessionFromPayload(loginWithGoogle);
          saveSession(session);
          return session.user;
        }),
    }),
    startGoogleLink: build.mutation<GoogleAuthStart, void>({
      queryFn: () =>
        graphqlQuery(
          async () => (await request('walletCore', startGoogleLinkMutation)).startGoogleLink,
        ),
    }),
    linkGoogleAccount: build.mutation<LinkedAccount, GoogleAuthInput>({
      queryFn: (input) =>
        graphqlQuery(
          async () =>
            (await request('walletCore', linkGoogleAccountMutation, { input })).linkGoogleAccount,
        ),
      // On an error the link may have changed elsewhere (e.g. GOOGLE_ACCOUNT_ALREADY_LINKED): reload it.
      invalidatesTags: (_result, error) => (error ? ['GoogleAccount'] : []),
      async onQueryStarted(_input, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled.catch(() => ({ data: undefined }));
        if (data) dispatch(googleApi.util.upsertQueryData('googleAccount', undefined, data));
      },
    }),
    unlinkGoogleAccount: build.mutation<boolean, void>({
      queryFn: () =>
        graphqlQuery(
          async () =>
            (await request('walletCore', unlinkGoogleAccountMutation)).unlinkGoogleAccount,
        ),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled.catch(() => ({ data: undefined }));
        if (data) dispatch(googleApi.util.upsertQueryData('googleAccount', undefined, null));
      },
    }),
  }),
});

export const {
  useGoogleAccountQuery,
  useStartGoogleLoginMutation,
  useLoginWithGoogleMutation,
  useStartGoogleLinkMutation,
  useLinkGoogleAccountMutation,
  useUnlinkGoogleAccountMutation,
} = googleApi;

/** The backend switch (`auth.googleLogin`) and this build's Google client must both be there. */
export function useGoogleSignInEnabled(): boolean {
  return useClientSetting('auth.googleLogin') && isGoogleSignInConfigured();
}

function toFlowError(error: unknown): GraphQLRequestError {
  // Server answers (RTK Query `unwrap`) and the popup errors are plain objects; exceptions never are.
  if (
    typeof error === 'object' &&
    error !== null &&
    Object.getPrototypeOf(error) === Object.prototype &&
    'message' in error
  ) {
    return error as GraphQLRequestError;
  }
  // A browser exception: `CLIENT_ERROR` keeps it from reading as "server unreachable"; the console keeps the cause.
  console.error('Google sign-in failed in the browser', error);
  return { code: 'CLIENT_ERROR', message: error instanceof Error ? error.message : String(error) };
}

export interface GoogleFlow {
  start: () => void;
  isPending: boolean;
  error: GraphQLRequestError | null;
  reset: () => void;
}

/** Opens the popup on `start()` (in the click) and runs `flow` with it; errors are kept for the UI. */
function useGoogleFlow(flow: (popup: Window) => Promise<unknown>): GoogleFlow {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<GraphQLRequestError | null>(null);

  const start = () => {
    if (isPending) return;
    setError(null);
    let popup: Window;
    try {
      popup = openGooglePopup();
    } catch (failure) {
      setError(toFlowError(failure));
      return;
    }
    setPending(true);
    flow(popup).then(
      () => setPending(false),
      (failure: unknown) => {
        setPending(false);
        setError(toFlowError(failure));
      },
    );
  };

  return { start, isPending, error, reset: () => setError(null) };
}

/** On success the session is saved, so the login page redirects like after a password login. */
export function useGoogleLogin(): GoogleFlow {
  const [startLogin] = useStartGoogleLoginMutation();
  const [login] = useLoginWithGoogleMutation();
  return useGoogleFlow(async (popup) => {
    const input = await signInWithGoogle(popup, () => startLogin().unwrap());
    await login(input).unwrap();
  });
}

export function useGoogleLink(): GoogleFlow {
  const [startLink] = useStartGoogleLinkMutation();
  const [link] = useLinkGoogleAccountMutation();
  return useGoogleFlow(async (popup) => {
    const input = await signInWithGoogle(popup, () => startLink().unwrap());
    await link(input).unwrap();
  });
}
