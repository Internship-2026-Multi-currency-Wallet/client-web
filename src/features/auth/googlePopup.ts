import { config } from '../../config-env';
import type { GoogleAuthInput, StartGoogleLoginMutation } from '../../gql/wallet-core/graphql';
import type { GraphQLRequestError } from '../../graphql/errors';

/** Registered in the Google OAuth client for every client-web origin (ops README, "Google login setup"). */
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';
export const MOCK_GOOGLE_PATH = '/auth/google/mock';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CHANNEL = 'google-auth';
// A started sign-in is valid for 10 minutes on wallet-core.
const TIMEOUT_MS = 10 * 60 * 1000;

export const GOOGLE_POPUP_ERRORS = {
  POPUP_BLOCKED: 'GOOGLE_POPUP_BLOCKED',
  POPUP_CLOSED: 'GOOGLE_POPUP_CLOSED',
  TIMEOUT: 'GOOGLE_TIMEOUT',
  FAILED: 'GOOGLE_FAILED',
} as const;

type GoogleAuthStart = StartGoogleLoginMutation['startGoogleLogin'];

const popupError = (code: string): GraphQLRequestError => ({ code, message: code });

export interface GoogleCallbackResult {
  state: string;
  code: string | null;
  error: string | null;
}

export const isGoogleSignInConfigured = (): boolean =>
  config.useMocks || config.googleClientId !== null;

export const googleRedirectUri = (): string => location.origin + GOOGLE_CALLBACK_PATH;

/**
 * Call it straight from the click handler, before any `await`: browsers block pop-ups that are not opened
 * in response to a user action.
 */
export function openGooglePopup(): Window {
  const width = 500;
  const height = 640;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  const popup = window.open(
    'about:blank',
    'google-sign-in',
    `popup,width=${width},height=${height},left=${left},top=${top}`,
  );
  if (!popup) throw popupError(GOOGLE_POPUP_ERRORS.POPUP_BLOCKED);
  return popup;
}

/** A BroadcastChannel reaches only this origin and does not need `window.opener`. */
export function postGoogleCallback(result: GoogleCallbackResult): void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(result);
  channel.close();
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function authorizeUrl(start: GoogleAuthStart, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: config.googleClientId ?? 'mock-client-id',
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email',
    state: start.state,
    nonce: start.nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  const base = config.useMocks ? location.origin + MOCK_GOOGLE_PATH : GOOGLE_AUTHORIZE_URL;
  return `${base}?${params}`;
}

function waitForCode(popup: Window, state: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(CHANNEL);

    const finish = (settle: () => void) => {
      clearTimeout(timer);
      channel.close();
      signal.removeEventListener('abort', onAbort);
      popup.close();
      settle();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener('abort', onAbort);

    channel.onmessage = ({ data }: MessageEvent<GoogleCallbackResult>) => {
      if (data?.state !== state) return;
      if (data.code) {
        const code = data.code;
        finish(() => resolve(code));
      } else {
        const code =
          data.error === 'access_denied'
            ? GOOGLE_POPUP_ERRORS.POPUP_CLOSED
            : GOOGLE_POPUP_ERRORS.FAILED;
        finish(() => reject(popupError(code)));
      }
    };

    // Never `popup.closed`: Google can detach the popup with COOP, and it then reports closed while still open.
    const timer = setTimeout(
      () => finish(() => reject(popupError(GOOGLE_POPUP_ERRORS.TIMEOUT))),
      TIMEOUT_MS,
    );
  });
}

export async function signInWithGoogle(
  popup: Window,
  start: () => Promise<GoogleAuthStart>,
  signal: AbortSignal,
): Promise<GoogleAuthInput> {
  const closePopup = () => popup.close();
  signal.addEventListener('abort', closePopup);
  try {
    const [started, { verifier, challenge }] = await Promise.all([start(), pkce()]);
    signal.throwIfAborted();
    popup.location.href = authorizeUrl(started, challenge);
    const code = await waitForCode(popup, started.state, signal);
    return { code, state: started.state, codeVerifier: verifier, redirectUri: googleRedirectUri() };
  } catch (error) {
    popup.close();
    throw error;
  } finally {
    signal.removeEventListener('abort', closePopup);
  }
}
