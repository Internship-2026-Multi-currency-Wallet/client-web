import { useEffect, useState } from 'react';
import { api, graphqlQuery } from '../../app/api';
import { useAppDispatch } from '../../app/store';
import type { GoogleAccountQuery } from '../../gql/wallet-core/graphql';
import { type GraphQLRequestError, toRequestError } from '../../graphql/errors';
import { request, type RequestOptions } from '../../graphql/client';
import { withSessionLock } from '../../graphql/refresh';
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
import {
  GOOGLE_POPUP_ERRORS,
  isGoogleSignInConfigured,
  openGooglePopup,
  signInWithGoogle,
} from './googlePopup';

/** Login calls create the session: an `UNAUTHENTICATED` is their answer, never a reason to refresh. */
const NO_SESSION_RETRY: RequestOptions = { retryOnUnauthenticated: false };

type LinkedAccount = NonNullable<GoogleAccountQuery['googleAccount']>;

export const googleApi = api.enhanceEndpoints({ addTagTypes: ['GoogleAccount'] }).injectEndpoints({
  endpoints: (build) => ({
    // Keyed by user id: a late answer for one user can never show up for another.
    googleAccount: build.query<LinkedAccount | null, string>({
      queryFn: () =>
        graphqlQuery(async () => (await request('walletCore', googleAccountQuery)).googleAccount),
      providesTags: ['GoogleAccount'],
    }),
    unlinkGoogleAccount: build.mutation<boolean, string>({
      queryFn: () =>
        graphqlQuery(
          async () =>
            (await request('walletCore', unlinkGoogleAccountMutation)).unlinkGoogleAccount,
        ),
      async onQueryStarted(userId, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled.catch(() => ({ data: undefined }));
        if (data) dispatch(googleApi.util.upsertQueryData('googleAccount', userId, null));
      },
    }),
  }),
});

export const { useGoogleAccountQuery, useUnlinkGoogleAccountMutation } = googleApi;

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
  cancel: () => void;
  isPending: boolean;
  error: GraphQLRequestError | null;
  reset: () => void;
}

function useGoogleFlow(flow: (popup: Window, signal: AbortSignal) => Promise<unknown>): GoogleFlow {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<GraphQLRequestError | null>(null);
  const [running] = useState(() => new Set<AbortController>());

  // Cancellation prevents starting an exchange but cannot undo an exchange already sent.
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

  // The popup is not watched for being closed, so the user needs a way out of the wait.
  const cancel = () => {
    running.forEach((controller) => controller.abort());
    running.clear();
    setPending(false);
    setError({ code: GOOGLE_POPUP_ERRORS.POPUP_CLOSED, message: GOOGLE_POPUP_ERRORS.POPUP_CLOSED });
  };

  return { start, cancel, isPending, error, reset: () => setError(null) };
}

// A start sets the google_auth_state cookie when it answers, also after its sign-in was cancelled. Starts run one
// at a time, so an earlier answer can never replace the cookie of a later sign-in.
let startQueue: Promise<unknown> = Promise.resolve();

function serializedStart<T>(call: () => Promise<T>): Promise<T> {
  const run = startQueue.then(call, call);
  startQueue = run.catch(() => undefined);
  return run;
}

export function useGoogleLogin(): GoogleFlow {
  return useGoogleFlow(async (popup, signal) => {
    const input = await signInWithGoogle(
      popup,
      () =>
        serializedStart(() =>
          serverCall(
            async () =>
              (await request('walletCore', startGoogleLoginMutation, undefined, NO_SESSION_RETRY))
                .startGoogleLogin,
          ),
        ),
      signal,
    );
    // Only the request and the save are locked, not the popup: see withSessionLock.
    await withSessionLock(async () => {
      if (signal.aborted || loadSession() !== null) return;
      const { loginWithGoogle } = await serverCall(() =>
        request('walletCore', loginWithGoogleMutation, { input }, NO_SESSION_RETRY),
      );
      // The answer has already replaced the refresh cookie, so the stored session must follow it.
      saveSession(sessionFromPayload(loginWithGoogle));
    });
  });
}

export function useGoogleLink(userId: string): GoogleFlow {
  const dispatch = useAppDispatch();
  return useGoogleFlow(async (popup, signal) => {
    const input = await signInWithGoogle(
      popup,
      () =>
        serializedStart(() =>
          serverCall(
            async () => (await request('walletCore', startGoogleLinkMutation)).startGoogleLink,
          ),
        ),
      signal,
    );
    if (signal.aborted) return;
    try {
      const { linkGoogleAccount } = await serverCall(() =>
        request('walletCore', linkGoogleAccountMutation, { input }),
      );
      // Cancelling hides the feedback, not the result: the mutation is already on the server.
      dispatch(googleApi.util.upsertQueryData('googleAccount', userId, linkGoogleAccount));
    } catch (error) {
      // The link may have changed elsewhere (e.g. GOOGLE_ACCOUNT_ALREADY_LINKED): reload it.
      dispatch(googleApi.util.invalidateTags(['GoogleAccount']));
      throw error;
    }
  });
}
