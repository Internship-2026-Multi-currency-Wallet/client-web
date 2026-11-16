import { waitFor } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { postGoogleCallback } from '../features/auth/googlePopup';
import type { PublicSettingsQuery } from '../gql/wallet-core/graphql';
import { mockGoogleCode } from '../mocks/google-handlers';
import { server } from '../mocks/server';
import { walletCore } from './graphql-handlers';

/**
 * Replaces `window.open` with a fake popup and plays Google's part: `approve` / `deny` are what Google's
 * redirect to the callback page sends, `closeByUser` is the user closing the window. Restore with
 * `vi.restoreAllMocks()`.
 */
export function stubGooglePopup() {
  const popup = {
    closed: false,
    location: { href: 'about:blank' },
    close() {
      this.closed = true;
    },
  };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

  /** Waits until the app sent the popup to Google. */
  async function authorizeUrl(): Promise<URL> {
    await waitFor(() => expect(popup.location.href).not.toBe('about:blank'));
    return new URL(popup.location.href);
  }

  async function answer(result: { code: string | null; error: string | null }) {
    const state = (await authorizeUrl()).searchParams.get('state');
    if (!state) throw new Error('no state in the Google URL');
    postGoogleCallback({ state, ...result });
  }

  return {
    popup,
    open,
    authorizeUrl,
    approve: (googleEmail: string) => answer({ code: mockGoogleCode(googleEmail), error: null }),
    deny: () => answer({ code: null, error: 'access_denied' }),
    async closeByUser() {
      await authorizeUrl();
      popup.closed = true;
    },
  };
}

/** The mock settings with `auth.googleLogin` switched off. */
export function googleLoginOff(): void {
  server.use(
    walletCore.query<PublicSettingsQuery>('PublicSettings', () =>
      HttpResponse.json({
        data: {
          publicSettings: [
            { key: 'auth.googleLogin', value: false },
            { key: 'auth.phoneRequiredAt', value: 'never' },
            { key: 'products.enabled', value: ['wallet'] },
          ],
        },
      }),
    ),
  );
}
