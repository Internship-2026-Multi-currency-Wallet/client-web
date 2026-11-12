import { serverTimeSubscription } from '../features/server-time/server-time.rates-service';
import { server } from '../mocks/server';
import { signInForTest } from '../test/auth';
import { errorResponse, newLog, refreshHandler } from '../test/graphql-handlers';
import { subscribe } from './client';

// The real graphql-ws client against the MSW websocket mock (`ServerTime` in mocks/handlers.ts). Its sockets come from
// the global (MSW-patched) WebSocket at connect time; `sockets.failNext` makes the next one fail like a browser does
// when the server is unreachable.
const sockets = vi.hoisted(() => ({ failNext: false, created: 0 }));
vi.mock('graphql-ws', async (importOriginal) => {
  const actual = await importOriginal<typeof import('graphql-ws')>();
  function FlakyWebSocket(url: string, protocols?: string | string[]) {
    sockets.created += 1;
    if (!sockets.failNext) return new globalThis.WebSocket(url, protocols);
    sockets.failNext = false;
    // What a browser does for a server that is down: `error` (a plain Event), then `close` 1006; it never opens.
    const dead = {
      readyState: 0,
      protocol: '',
      onopen: null,
      onmessage: null,
      onerror: null as ((event: Event) => void) | null,
      onclose: null as ((event: { code: number; reason: string }) => void) | null,
      send: () => undefined,
      close: () => undefined,
    };
    setTimeout(() => {
      dead.readyState = 3;
      dead.onerror?.(new Event('error'));
      dead.onclose?.({ code: 1006, reason: '' });
    });
    return dead;
  }
  Object.assign(FlakyWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  return {
    ...actual,
    createClient: (options: Parameters<typeof actual.createClient>[0]) =>
      actual.createClient({ ...options, webSocketImpl: FlakyWebSocket }),
  };
});

describe('websocket reconnect with an expired token', () => {
  beforeEach(() => vi.spyOn(Math, 'random').mockReturnValue(0)); // shortest graphql-ws retry wait (~1.3 s)
  afterEach(() => vi.restoreAllMocks());

  it('retries after a temporary refresh failure and receives data once the server is back', async () => {
    signInForTest({ expired: true });
    const log = newLog();
    server.use(
      refreshHandler(log, async () =>
        log.refresh === 1 ? errorResponse('INTERNAL', { status: 503 }) : undefined,
      ),
    );
    const next = vi.fn();
    const error = vi.fn();
    const unsubscribe = subscribe('ratesService', serverTimeSubscription, { next, error });

    try {
      await vi.waitFor(() => expect(next).toHaveBeenCalled(), { timeout: 4000 });
      expect(log.refresh).toBe(2);
      expect(error).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('retries when the browser reports a socket error (server unreachable) and then receives data', async () => {
    signInForTest();
    sockets.failNext = true;
    const before = sockets.created;
    const next = vi.fn();
    const error = vi.fn();
    const unsubscribe = subscribe('ratesService', serverTimeSubscription, { next, error });

    try {
      await vi.waitFor(() => expect(next).toHaveBeenCalled(), { timeout: 4000 });
      expect(sockets.created - before).toBe(2); // the failed socket, then the retry
      expect(error).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('gives up when the refresh session is over', async () => {
    signInForTest({ expired: true, refreshable: false });
    const next = vi.fn();
    const error = vi.fn();
    const unsubscribe = subscribe('ratesService', serverTimeSubscription, { next, error });

    try {
      await vi.waitFor(() => expect(error).toHaveBeenCalled());
      expect(next).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
