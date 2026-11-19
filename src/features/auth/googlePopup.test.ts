import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_POPUP_ERRORS, signInWithGoogle } from './googlePopup';

const realSetTimeout = globalThis.setTimeout;
const waitForRealTime = () => new Promise<void>((resolve) => realSetTimeout(resolve, 0));

const TEN_MINUTES_MS = 10 * 60 * 1000;

function fakePopup() {
  const popup = { closed: false, location: { href: 'about:blank' } };
  return Object.assign(popup, {
    close() {
      popup.closed = true;
    },
  }) as unknown as Window & { closed: boolean };
}

describe('signInWithGoogle', () => {
  afterEach(() => vi.useRealTimers());

  it('gives up with GOOGLE_TIMEOUT when no answer comes before the sign-in expires', async () => {
    // Only the timers the flow waits on are faked: the PKCE hash is real asynchronous work.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const popup = fakePopup();
    const flow = signInWithGoogle(
      popup,
      () => Promise.resolve({ state: 's-timeout', nonce: 'n', expiresAt: '' }),
      new AbortController().signal,
    );
    const outcome = flow.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    // The clock only starts once the flow has sent the popup to Google.
    while (popup.location.href === 'about:blank') await waitForRealTime();

    vi.advanceTimersByTime(TEN_MINUTES_MS + 1000);

    expect(await outcome).toEqual({
      code: GOOGLE_POPUP_ERRORS.TIMEOUT,
      message: GOOGLE_POPUP_ERRORS.TIMEOUT,
    });
    expect(popup.closed).toBe(true);
  });
});
