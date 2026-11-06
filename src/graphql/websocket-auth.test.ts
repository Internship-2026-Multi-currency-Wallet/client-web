import { createClient } from 'graphql-ws';
import { serverTimeSubscription } from '../features/server-time/server-time.rates-service';
import { server } from '../mocks/server';
import { signInForTest } from '../test/auth';
import { errorResponse, newLog, refreshHandler, walletCore } from '../test/graphql-handlers';
import { accessToken, loadSession } from './session';
import { subscribe } from './client';

// graphql-ws itself is not under test, only what we hand it: the function it calls on every (re)connect.
vi.mock('graphql-ws', () => ({ createClient: vi.fn(() => ({ subscribe: vi.fn() })) }));

type ConnectionParams = () => Promise<Record<string, string>>;

// The socket client is created once per service and then cached, so the options are captured on the first use.
let captured: ConnectionParams | undefined;
function connectionParams(): ConnectionParams {
  if (!captured) {
    subscribe('ratesService', serverTimeSubscription, { next: () => undefined });
    captured = vi.mocked(createClient).mock.calls[0][0].connectionParams as ConnectionParams;
  }
  return captured;
}

describe('websocket authentication', () => {
  it('renews an expired token before connecting (a reconnect after sleep must not use a dead token)', async () => {
    signInForTest({ expired: true });
    const stale = accessToken();
    const log = newLog();
    server.use(refreshHandler(log));

    const params = await connectionParams()();

    expect(log.refresh).toBe(1);
    expect(accessToken()).not.toBe(stale);
    expect(params).toEqual({ Authorization: `Bearer ${accessToken()}` });
  });

  it('shares one refresh between concurrent connection attempts', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(refreshHandler(log));
    const params = connectionParams();

    const [a, b] = await Promise.all([params(), params()]);

    expect(log.refresh).toBe(1);
    expect(a).toEqual(b);
    expect(a.Authorization).toBe(`Bearer ${accessToken()}`);
  });

  it('does not refresh while the token is still valid', async () => {
    signInForTest();
    const log = newLog();
    server.use(refreshHandler(log));

    expect(await connectionParams()()).toEqual({ Authorization: `Bearer ${accessToken()}` });
    expect(log.refresh).toBe(0);
  });

  it('does not connect with a dead token when the refresh fails temporarily, and keeps the session', async () => {
    signInForTest({ expired: true });
    server.use(
      walletCore.mutation('RefreshSession', () => errorResponse('INTERNAL', { status: 503 })),
    );

    await expect(connectionParams()()).rejects.toThrow(/could not be renewed/);
    expect(loadSession()).not.toBeNull();
  });

  it('does not connect once the refresh session is over', async () => {
    signInForTest({ expired: true, refreshable: false });

    await expect(connectionParams()()).rejects.toThrow(/could not be renewed/);
    expect(loadSession()).toBeNull();
  });

  it('keeps the dev-user fallback for an anonymous visitor and never refreshes', async () => {
    const log = newLog();
    server.use(refreshHandler(log));

    expect(await connectionParams()()).toEqual({ Authorization: 'Dev 1:wallet' }); // the test env's dev user
    expect(log.refresh).toBe(0);
  });
});
