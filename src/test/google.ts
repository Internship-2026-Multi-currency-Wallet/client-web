import { waitFor } from '@testing-library/react';
import { postGoogleCallback } from '../features/auth/googlePopup';
import { mockGoogleCode, setMockGoogleLogin } from '../mocks/google-handlers';

/** Restore the `window.open` spy with `vi.restoreAllMocks()`. */
export function stubGooglePopup() {
  const popup = {
    closed: false,
    location: { href: 'about:blank' },
    close() {
      this.closed = true;
    },
  };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

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

export function googleLoginOff(): void {
  setMockGoogleLogin(false);
}
