import { meQuery } from '../features/system/system.wallet-core';
import { server } from '../mocks/server';
import {
  deliverStorageEvent,
  storedRecord,
  TEST_USER,
  testSession,
  writeStoredRecord,
} from '../test/auth';
import type { FakeLockManager } from '../test/fake-locks';
import { CookieJar, gate as newGate, type Gate, RotatingBackend } from '../test/rotating-backend';
import { rotatingTransport } from '../test/rotating-transport';

/**
 * F1 with the REAL production code: `refreshSession()`, the session module, the Redux store and its restore. Each
 * "tab" is an independent set of module instances (own `refreshInFlight`, own pending state); all tabs share
 * `localStorage`, the Web Lock manager, ONE server model (atomic rotation) and ONE cookie jar.
 *
 * The first two tests reproduced F1 (both tabs ended logged out although the server had issued a valid R2); they
 * pass since refresh runs under the `wallet.auth-cookie` lock. Their assertions are unchanged from the reproduction.
 */
const AUTH_COOKIE_LOCK = 'wallet.auth-cookie';

interface Tab {
  refreshSession: () => Promise<boolean>;
  request: typeof import('./client').request;
  loadSession: typeof import('./session').loadSession;
  onSessionChange: typeof import('./session').onSessionChange;
  createStore: typeof import('../app/store').createStore;
  timeouts: typeof import('./cookie-lock').AUTH_COOKIE_TIMEOUTS;
}

async function openTab(): Promise<Tab> {
  vi.resetModules(); // a fresh registry = the module state of another tab
  const client = await import('./client');
  const session = await import('./session');
  const store = await import('../app/store');
  const cookieLock = await import('./cookie-lock');
  return {
    timeouts: cookieLock.AUTH_COOKIE_TIMEOUTS,
    refreshSession: client.refreshSession,
    request: client.request,
    loadSession: session.loadSession,
    onSessionChange: session.onSessionChange,
    createStore: store.createStore,
  };
}

/** Both tabs hold the same expired session of user 1; the server and the cookie jar hold R1. */
function setup() {
  const backend = new RotatingBackend();
  const jar = new CookieJar();
  jar.value = backend.login(TEST_USER.id); // R1
  const transport = rotatingTransport(backend, jar);
  server.use(...transport.handlers);
  const expired = { ...testSession(TEST_USER, { expired: true }), accessToken: 'expired-token' };
  writeStoredRecord('generation-0', expired);
  return { backend, jar, transport };
}

const locks = () => navigator.locks as unknown as FakeLockManager;
const parkedOnCookieLock = () => locks().pending(AUTH_COOKIE_LOCK) > 0;

/**
 * Waits until `settled()` is true OR a request is parked on the auth-cookie lock. The second tab waits for the lock
 * instead of sending, so "it has done everything it can" must not require its answer.
 */
function waitUntilSettledOrParked(settled: () => boolean) {
  return vi.waitFor(() => {
    if (!settled() && !parkedOnCookieLock()) throw new Error('not yet');
  });
}

/**
 * jsdom does not deliver `storage` events within one window, but browsers deliver them to the OTHER tabs. This makes
 * every write of the session record reach all tab instances (the writer hears its own write too, which is harmless).
 */
function deliverStorageEventsLikeABrowser() {
  const real = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    real.call(this, key, value);
    if (key === 'wallet.session') queueMicrotask(deliverStorageEvent);
  });
}

/** Every gate of a test, so that the cleanup below can open the ones a failed assertion left closed. */
const openedAtCleanup: Gate[] = [];
function gate(): Gate {
  const g = newGate();
  openedAtCleanup.push(g);
  return g;
}

// Tabs outlive a failed assertion: their requests and lock waits would run into the NEXT test. So after every test:
// open all gates, then wait (by events, not by time) until no request is in flight and no lock is held or awaited.
const inFlight = new Set<string>();
const onStart = ({ requestId, request }: { requestId: string; request: Request }) => {
  inFlight.add(requestId);
  // A request the client cancelled (timeout) never gets 'request:end': its abort ends it for us.
  request.signal.addEventListener('abort', () => inFlight.delete(requestId), { once: true });
};
const onEnd = ({ requestId }: { requestId: string }) => void inFlight.delete(requestId);
beforeAll(() => {
  server.events.on('request:start', onStart);
  server.events.on('request:end', onEnd);
});
afterAll(() => {
  server.events.removeListener('request:start', onStart);
  server.events.removeListener('request:end', onEnd);
});
afterEach(async () => {
  vi.restoreAllMocks();
  openedAtCleanup.splice(0).forEach((g) => g.open());
  for (let round = 0; round < 3; round += 1) {
    await vi.waitFor(() => {
      if (inFlight.size > 0 || locks().isBusy()) throw new Error('tabs are still working');
    });
    await new Promise((resolve) => setTimeout(resolve, 0)); // one macrotask: let the last continuations run
  }
});

describe('F1: two tabs refresh with the same rotating refresh token', () => {
  it("B's INVALID_REFRESH_TOKEN must not log out the tab A just refreshed: B waits for A, then reuses its session", async () => {
    const { backend, jar, transport } = setup();
    const deliveryA = gate();
    transport.plan(1, { delivery: deliveryA.promise }); // A: rotates R1 -> R2 now, answer delivered later

    const tabA = await openTab();
    const tabB = await openTab();
    const refreshA = tabA.refreshSession();
    await transport.consumed(1); // the server has rotated R1 -> R2; A has not heard back
    expect(backend.validTokens()).toEqual(['R2']);
    expect(jar.value).toBe('R1');

    let settledB = false;
    const refreshB = tabB.refreshSession().finally(() => (settledB = true)); // B still sends R1
    await waitUntilSettledOrParked(() => settledB); // buggy: B got INVALID and acted on it; fixed: B waits

    deliveryA.open(); // A's success is delivered last
    await expect(refreshA).resolves.toBe(true);
    await expect(refreshB).resolves.toBe(true);

    expect(backend.events).toEqual(['login:1:R1', 'refresh:R1:ok->R2']); // one refresh, no INVALID attempt
    expect(transport.refreshCalls).toBe(1);
    expect(storedRecord().session?.accessToken).toBe('access-1-R2'); // the shared session has the latest token
    expect(tabA.loadSession()?.accessToken).toBe('access-1-R2');
    expect(tabB.loadSession()?.accessToken).toBe('access-1-R2');
    expect(jar.value).toBe('R2');

    // The next refresh works with R2 (nothing was lost).
    await expect(tabB.refreshSession()).resolves.toBe(true);
    expect(backend.events.at(-1)).toBe('refresh:R2:ok->R3');
  });

  it('the same with real stores (both tabs reload with an expired token)', async () => {
    const { backend, transport } = setup();
    const storage = deliverStorageEventsLikeABrowser();
    const deliveryA = gate();
    transport.plan(1, { delivery: deliveryA.promise });

    const tabA = await openTab();
    const tabB = await openTab();
    const storeA = tabA.createStore(); // status 'restoring' -> restoreSession() -> refreshSession()
    await transport.consumed(1);
    const storeB = tabB.createStore();
    await waitUntilSettledOrParked(() => storeB.getState().auth.status !== 'restoring');

    deliveryA.open();
    await vi.waitFor(() => expect(storeA.getState().auth.status).not.toBe('restoring'));
    await vi.waitFor(() => expect(storeB.getState().auth.status).not.toBe('restoring'));

    expect(storeA.getState().auth.status).toBe('authenticated');
    expect(storeB.getState().auth.status).toBe('authenticated');
    expect(storedRecord().session?.accessToken).toBe('access-1-R2');
    expect(backend.events).toEqual(['login:1:R1', 'refresh:R1:ok->R2']);
    storage.mockRestore();
  });

  it("reverse delivery order: the existing token check already protects it (A committed before B's INVALID is handled)", async () => {
    const { backend, jar, transport } = setup();
    const deliveryA = gate();
    const deliveryB = gate();
    transport.plan(1, { delivery: deliveryA.promise });
    transport.plan(2, { delivery: deliveryB.promise }); // B's answer, if B ever sends, is held back

    const tabA = await openTab();
    const tabB = await openTab();
    const changedA = new Promise<void>((resolve) => {
      const off = tabA.onSessionChange(() => (off(), resolve()));
    });
    const refreshA = tabA.refreshSession();
    await transport.consumed(1); // A rotated R1 -> R2; the cookie in the browser is still R1
    const refreshB = tabB.refreshSession();
    // B has either sent R1 (it will be rejected) or is waiting for A (queued on the lock): both are "as far as it gets".
    await vi.waitFor(() => {
      if (transport.refreshCalls < 2 && !parkedOnCookieLock()) throw new Error('not yet');
    });

    deliveryA.open(); // A's success is delivered and committed FIRST
    await expect(refreshA).resolves.toBe(true);
    await changedA;
    expect(storedRecord().session?.accessToken).toBe('access-1-R2');

    deliveryB.open(); // only now B (if it sent) hears INVALID_REFRESH_TOKEN
    await expect(refreshB).resolves.toBe(true); // it sees the newer token: nothing is cleared
    expect(storedRecord().session?.accessToken).toBe('access-1-R2');
    expect(tabB.loadSession()?.accessToken).toBe('access-1-R2');
    expect(backend.events.slice(0, 2)).toEqual(['login:1:R1', 'refresh:R1:ok->R2']);
    expect(backend.validTokens()).toEqual([jar.value]); // exactly one live token and it is the cookie's
    expect(backend.events.filter((event) => event.includes(':ok->'))).toHaveLength(1); // ONE backend rotation
  });
});

describe('refresh inside one tab and after another tab already refreshed', () => {
  it('concurrent failed requests of ONE tab share a single refresh (single-flight)', async () => {
    const { backend, transport } = setup();
    const tab = await openTab();
    const results = await Promise.all([
      tab.request('walletCore', meQuery),
      tab.request('walletCore', meQuery),
      tab.request('walletCore', meQuery),
    ]);

    expect(results.map((r) => r.me.id)).toEqual(['1', '1', '1']);
    expect(transport.refreshCalls).toBe(1);
    expect(backend.events).toEqual(['login:1:R1', 'refresh:R1:ok->R2']); // one rotation, no INVALID
    expect(transport.meCalls.filter((c) => c.accepted)).toHaveLength(3);
  });

  it('a request of tab B rejected for the OLD token is repeated with the token tab A refreshed meanwhile, without another refresh', async () => {
    const { backend, transport } = setup();
    const tabA = await openTab();
    const tabB = await openTab();
    const answer = transport.holdNextMe(); // B's Me (sent with the old token) is answered only later
    const requestB = tabB.request('walletCore', meQuery);

    await expect(tabA.refreshSession()).resolves.toBe(true); // A refreshes and stores the new token
    expect(storedRecord().session?.accessToken).toBe('access-1-R2');
    answer.open(); // B now hears UNAUTHENTICATED for the token it used

    await expect(requestB).resolves.toMatchObject({ me: { id: '1' } });
    expect(transport.refreshCalls).toBe(1); // B reused A's session instead of refreshing
    expect(backend.events).toEqual(['login:1:R1', 'refresh:R1:ok->R2']);
    expect(transport.meCalls.map((c) => c.accepted)).toEqual([false, true]);
    expect(transport.meCalls[1].bearer).toBe('access-1-R2');
  });
});

describe('F1: what the cookie lock does when things go wrong', () => {
  it.each([
    ['logs out', () => writeStoredRecord('logout-generation', null), null],
    [
      'logs in again',
      () => writeStoredRecord('login-generation', { ...testSession(), accessToken: 'newer-login' }),
      'newer-login',
    ],
  ])(
    'a tab waiting for the lock does not send a stale refresh when another tab %s, and nothing newer is overwritten',
    async (_name, change, expectedToken) => {
      const { transport } = setup();
      const deliveryA = gate();
      transport.plan(1, { delivery: deliveryA.promise });
      const tabA = await openTab();
      const tabB = await openTab();
      const refreshA = tabA.refreshSession();
      await transport.consumed(1);
      const refreshB = tabB.refreshSession(); // waits for the cookie lock held by A
      await vi.waitFor(() => expect(parkedOnCookieLock()).toBe(true));

      change(); // a newer generation is committed while B waits and A's answer is still on its way
      deliveryA.open();

      await expect(refreshA).resolves.toBe(false); // A's result is stale: dropped
      await expect(refreshB).resolves.toBe(false); // B's refresh is stale: not even sent
      expect(transport.refreshCalls).toBe(1);
      expect(storedRecord().session?.accessToken ?? null).toBe(expectedToken);
    },
  );

  it('if the cookie lock cannot be taken NOTHING is sent and the session stays as it was', async () => {
    const { transport } = setup();
    const before = JSON.stringify(storedRecord());
    const real = navigator.locks.request.bind(navigator.locks) as (
      ...a: unknown[]
    ) => Promise<unknown>;
    vi.spyOn(navigator.locks, 'request').mockImplementation(((name: string, ...rest: unknown[]) =>
      name === AUTH_COOKIE_LOCK
        ? Promise.reject(new DOMException('no lock', 'AbortError'))
        : real(name, ...rest)) as never);
    const tab = await openTab();

    await expect(tab.refreshSession()).rejects.toMatchObject({ name: 'AuthCookieLockError' });
    expect(transport.refreshCalls).toBe(0); // no uncoordinated rotating refresh
    expect(JSON.stringify(storedRecord())).toBe(before);
  });

  it('without the Web Locks API a refresh fails safely instead of rotating the token uncoordinated', async () => {
    const { transport } = setup();
    const before = JSON.stringify(storedRecord());
    const realLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    try {
      const tab = await openTab();
      await expect(tab.refreshSession()).rejects.toMatchObject({
        name: 'AuthCookieLockError',
        reason: 'unavailable',
      });
      expect(transport.refreshCalls).toBe(0);
      expect(JSON.stringify(storedRecord())).toBe(before);
    } finally {
      Object.defineProperty(navigator, 'locks', { value: realLocks, configurable: true });
    }
  });

  it('a request that times out releases the lock, keeps the session, is not retried and never touches a newer session', async () => {
    const { transport } = setup();
    const never = gate(); // the answer never comes within the timeout
    transport.plan(1, { arrival: never.promise });
    const tab = await openTab();
    tab.timeouts.requestMs = 30;

    const refreshing = tab.refreshSession();
    await transport.sent(1);
    // While the request hangs another tab logs in: that newer session must survive the timeout.
    const newer = { ...testSession(), accessToken: 'newer-login' };
    writeStoredRecord('newer-generation', newer);

    await expect(refreshing).rejects.toMatchObject({
      name: expect.stringMatching(/Abort|Timeout/),
    });
    expect(transport.refreshCalls).toBe(1); // no automatic retry
    expect(storedRecord()).toEqual({ generation: 'newer-generation', session: newer });
    expect(locks().isHeld(AUTH_COOKIE_LOCK)).toBe(false); // the lock was released by the cancellation
  });

  it('a timeout does not clear a session that is still the one that asked', async () => {
    const { transport } = setup();
    const never = gate();
    transport.plan(1, { arrival: never.promise });
    const tab = await openTab();
    tab.timeouts.requestMs = 30;
    const before = JSON.stringify(storedRecord());

    await expect(tab.refreshSession()).rejects.toBeDefined();
    expect(JSON.stringify(storedRecord())).toBe(before); // uncertain outcome: nothing is cleared
  });
});

/**
 * The restoration thunk (`restoreSession`) of a tab that waits for the cookie lock. Its error path must not
 * overwrite a state that something newer already settled (a storage notification of another tab, a login, a logout).
 */
describe('F1: restoring a session while waiting for the cookie lock', () => {
  /**
   * From now on the SECOND cookie-lock request (the one of tab B) is held by the test: it neither takes the lock nor
   * fails until `failB()`. The first (tab A's) works normally.
   */
  function controlSecondCookieLockRequest() {
    const real = navigator.locks.request.bind(navigator.locks) as (
      ...a: unknown[]
    ) => Promise<unknown>;
    let cookieRequests = 0;
    let failB!: () => void;
    const spy = vi.spyOn(navigator.locks, 'request').mockImplementation(((
      name: string,
      ...rest: unknown[]
    ) => {
      if (name !== AUTH_COOKIE_LOCK) return real(name, ...rest);
      cookieRequests += 1;
      if (cookieRequests === 1) return real(name, ...rest);
      return new Promise((_resolve, reject) => {
        failB = () => reject(new DOMException('no lock', 'AbortError'));
      });
    }) as never);
    return { spy, failB: () => failB() };
  }

  /** One macrotask: the continuations of the rejected lock request (the thunk's error path) have run. */
  const afterErrorPath = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('A: a stale lock failure does not turn a session another tab renewed (authenticated) into "unavailable"', async () => {
    const { transport } = setup();
    deliverStorageEventsLikeABrowser();
    const lock = controlSecondCookieLockRequest();
    const deliveryA = gate();
    transport.plan(1, { delivery: deliveryA.promise });

    const tabA = await openTab();
    const tabB = await openTab();
    const refreshA = tabA.refreshSession();
    await transport.consumed(1); // A rotates R1 -> R2 under the cookie lock
    const storeB = tabB.createStore(); // restoring; its lock request is the one the test holds
    expect(storeB.getState().auth.status).toBe('restoring');

    deliveryA.open();
    await expect(refreshA).resolves.toBe(true);
    // B hears about A's session (the generation did not change) and is authenticated.
    await vi.waitFor(() => expect(storeB.getState().auth.status).toBe('authenticated'));

    lock.failB(); // only now B's own, old lock request fails
    await afterErrorPath();

    expect(storeB.getState().auth).toMatchObject({ status: 'authenticated', user: { id: '1' } });
    expect(transport.refreshCalls).toBe(1); // the failure caused no further refresh
  });

  it('B: a genuine lock failure while still restoring shows "unavailable", and Retry can recover', async () => {
    const { transport } = setup();
    const lock = controlSecondCookieLockRequest();
    const tab = await openTab();
    // This tab's request is the FIRST one: make it the held one by occupying the first slot with another request.
    void navigator.locks.request(AUTH_COOKIE_LOCK, () => undefined);
    const store = tab.createStore();
    expect(store.getState().auth.status).toBe('restoring');

    lock.failB();
    await vi.waitFor(() => expect(store.getState().auth.status).toBe('unavailable'));
    expect(transport.refreshCalls).toBe(0); // nothing was sent

    lock.spy.mockRestore(); // Retry (the button of RequireAuth dispatches the same thunk)
    const { restoreSession } = await import('../features/auth/authSlice');
    void store.dispatch(restoreSession());
    await vi.waitFor(() => expect(store.getState().auth.status).toBe('authenticated'));
  });

  it.each([
    ['logout', () => writeStoredRecord('logout-generation', null), 'anonymous', null],
    [
      'login of another user',
      () => writeStoredRecord('login-generation', testSession({ ...TEST_USER, id: '2' })),
      'authenticated',
      '2',
    ],
  ])(
    'C: a stale lock failure does not overwrite a newer %s',
    async (_name, change, status, userId) => {
      setup();
      deliverStorageEventsLikeABrowser();
      const lock = controlSecondCookieLockRequest();
      const tab = await openTab();
      void navigator.locks.request(AUTH_COOKIE_LOCK, () => undefined); // takes the first slot, as in test B
      const store = tab.createStore();
      expect(store.getState().auth.status).toBe('restoring');

      change(); // another tab logs out / logs in while this one waits
      deliverStorageEvent();
      await vi.waitFor(() => expect(store.getState().auth.status).toBe(status));

      lock.failB();
      await afterErrorPath();
      expect(store.getState().auth.status).toBe(status);
      expect(store.getState().auth.user?.id ?? null).toBe(userId);
    },
  );
});

describe('F1: the answer to a refresh is lost after the server rotated the token', () => {
  it('is not retried automatically and does not clear the session by itself (the dead cookie shows up on the NEXT refresh)', async () => {
    const { backend, jar, transport } = setup();
    const lost = gate(); // the answer never reaches the browser within the timeout
    transport.plan(1, { delivery: lost.promise });
    const tab = await openTab();
    tab.timeouts.requestMs = 30;
    const before = JSON.stringify(storedRecord());

    await expect(tab.refreshSession()).rejects.toMatchObject({
      name: expect.stringMatching(/Abort|Timeout/),
    });
    // The server did rotate R1 -> R2, the browser never heard: the cookie is stale, nothing was retried or cleared.
    expect(backend.events).toEqual(['login:1:R1', 'refresh:R1:ok->R2']);
    expect(backend.validTokens()).toEqual(['R2']);
    expect(jar.value).toBe('R1');
    expect(transport.refreshCalls).toBe(1);
    expect(JSON.stringify(storedRecord())).toBe(before);
    expect(locks().isHeld(AUTH_COOKIE_LOCK)).toBe(false);

    // Known limit (no grace period): a later, manual refresh sends the dead cookie and ends the session; that is the
    // server's INVALID_REFRESH_TOKEN, not a local decision.
    await expect(tab.refreshSession()).resolves.toBe(false);
    expect(backend.events.at(-1)).toBe('refresh:R1:invalid');
    expect(storedRecord().session).toBeNull();
  });
});
