import { useEffect, useState } from 'react';
import { api, graphqlQuery } from '../../app/api';
import { useAppDispatch } from '../../app/store';
import type { GoogleAccountQuery } from '../../gql/wallet-core/graphql';
import { type GraphQLRequestError, toRequestError } from '../../graphql/errors';
import { request, type RequestOptions } from '../../graphql/client';
import { loadSession, saveSession, sessionFromPayload } from '../../graphql/session';
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

export const googleApi = api.enhanceEndpoints({ addTagTypes: ['GoogleAccount'] }).injectEndpoints({
  endpoints: (build) => ({
    googleAccount: build.query<LinkedAccount | null, void>({
      queryFn: () =>
        graphqlQuery(async () => (await request('walletCore', googleAccountQuery)).googleAccount),
      providesTags: ['GoogleAccount'],
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

export const { useGoogleAccountQuery, useUnlinkGoogleAccountMutation } = googleApi;

/** The backend switch (`auth.googleLogin`) and this build's Google client must both be there. */
export function useGoogleSignInEnabled(): boolean {
  return useClientSetting('auth.googleLogin') && isGoogleSignInConfigured();
}

/** Server failures become plain `GraphQLRequestError`s, so `toFlowError` can tell them from browser exceptions. */
async function serverCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toRequestError(error);
  }
}

function toFlowError(error: unknown): GraphQLRequestError {
  // Server answers and the popup errors are plain objects; exceptions never are.
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

function useGoogleFlow(flow: (popup: Window, signal: AbortSignal) => Promise<unknown>): GoogleFlow {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<GraphQLRequestError | null>(null);
  const [running] = useState(() => new Set<AbortController>());

  // Leaving the page (another login, another user, navigation) cancels the sign-in: its popup closes
  // and its code is never exchanged.
  useEffect(() => () => running.forEach((controller) => controller.abort()), [running]);

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
    const controller = new AbortController();
    running.add(controller);
    setPending(true);
    flow(popup, controller.signal)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(toFlowError(failure));
      })
      .finally(() => {
        running.delete(controller);
        if (!controller.signal.aborted) setPending(false);
      });
  };

  return { start, isPending, error, reset: () => setError(null) };
}

export function useGoogleLogin(): GoogleFlow {
  return useGoogleFlow(async (popup, signal) => {
    const input = await signInWithGoogle(
      popup,
      () =>
        serverCall(
          async () =>
            (await request('walletCore', startGoogleLoginMutation, undefined, NO_SESSION_RETRY))
              .startGoogleLogin,
        ),
      signal,
    );
    // Someone signed in meanwhile (e.g. in another tab): that session wins.
    const stale = () => signal.aborted || loadSession() !== null;
    if (stale()) return;
    const { loginWithGoogle } = await serverCall(() =>
      request('walletCore', loginWithGoogleMutation, { input }, NO_SESSION_RETRY),
    );
    if (stale()) return;
    saveSession(sessionFromPayload(loginWithGoogle));
  });
}

export function useGoogleLink(): GoogleFlow {
  const dispatch = useAppDispatch();
  return useGoogleFlow(async (popup, signal) => {
    const input = await signInWithGoogle(
      popup,
      () =>
        serverCall(
          async () => (await request('walletCore', startGoogleLinkMutation)).startGoogleLink,
        ),
      signal,
    );
    if (signal.aborted) return;
    try {
      const { linkGoogleAccount } = await serverCall(() =>
        request('walletCore', linkGoogleAccountMutation, { input }),
      );
      dispatch(googleApi.util.upsertQueryData('googleAccount', undefined, linkGoogleAccount));
    } catch (error) {
      // The link may have changed elsewhere (e.g. GOOGLE_ACCOUNT_ALREADY_LINKED): reload it.
      dispatch(googleApi.util.invalidateTags(['GoogleAccount']));
      throw error;
    }
  });
}
