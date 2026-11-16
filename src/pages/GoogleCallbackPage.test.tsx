import { screen } from '@testing-library/react';
import type { GoogleCallbackResult } from '../features/auth/googlePopup';
import { renderApp } from '../test/render';

function listen() {
  const channel = new BroadcastChannel('google-auth');
  const received = new Promise<GoogleCallbackResult>((resolve) => {
    channel.onmessage = (event: MessageEvent<GoogleCallbackResult>) => resolve(event.data);
  });
  return { received, close: () => channel.close() };
}

describe('GoogleCallbackPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it("hands Google's answer to the app window and closes the popup", async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const channel = listen();
    try {
      renderApp('/auth/google/callback?state=s-1&code=c-1');
      expect(await channel.received).toEqual({ state: 's-1', code: 'c-1', error: null });
      expect(close).toHaveBeenCalled();
    } finally {
      channel.close();
    }
  });

  it('does nothing without a state, e.g. when opened directly', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    renderApp('/auth/google/callback');
    expect(await screen.findByText(/you can close this window/i)).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });
});
