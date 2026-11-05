import { server } from '../mocks/server';
import { deliverStorageEvent } from './auth';
import type { FakeLockManager } from './fake-locks';
import { type Gate, gate as newGate } from './rotating-backend';

/**
 * Helpers for tests that run the REAL frontend modules as several browser tabs.
 *
 * A "tab" is an independent set of module instances (`vi.resetModules()` + dynamic imports): its own `session.ts`
 * state, its own `refreshInFlight`, its own Redux store and logout coordinator. All tabs share `localStorage`, the
 * Web Lock manager and (set up by the test) one fixture server and cookie jar.
 */
export interface Tab {
  client: typeof import('../graphql/client');
  session: typeof import('../graphql/session');
  authApi: typeof import('../features/auth/authApi').authApi;
  coordinator: typeof import('../features/auth/logoutCoordinator');
  store: ReturnType<typeof import('../app/store').createStore>;
  timeouts: typeof import('../graphql/cookie-lock').AUTH_COOKIE_TIMEOUTS;
}

/** Opens a tab. Its Redux store is created from what the shared storage holds at this moment. */
export async function openTab(): Promise<Tab> {
  vi.resetModules();
  const client = await import('../graphql/client');
  const session = await import('../graphql/session');
  const { authApi } = await import('../features/auth/authApi');
  const coordinator = await import('../features/auth/logoutCoordinator');
  const { createStore } = await import('../app/store');
  const { AUTH_COOKIE_TIMEOUTS } = await import('../graphql/cookie-lock');
  return {
    client,
    session,
    authApi,
    coordinator,
    store: createStore(),
    timeouts: AUTH_COOKIE_TIMEOUTS,
  };
}

/** The real login mutation (RTK Query endpoint -> `authApi` queryFn -> `request`). Never rejects. */
export function loginAs(tab: Tab, email: string) {
  return tab.store.dispatch(tab.authApi.endpoints.login.initiate({ email, password: 'Fixture1!' }));
}

/**
 * What `useLogout` does, minus the UI (navigation, the 5 s timer): clear the local session first, then the real logout
 * mutation, tracked by the logout coordinator.
 */
export function logoutOf(tab: Tab) {
  const generation = tab.session.clearSession();
  const call = tab.store.dispatch(tab.authApi.endpoints.logout.initiate(generation));
  tab.coordinator.trackLogout(call);
  return call;
}

export const locks = () => navigator.locks as unknown as FakeLockManager;

export const AUTH_COOKIE_LOCK = 'wallet.auth-cookie';
export const parkedOnCookieLock = () => locks().pending(AUTH_COOKIE_LOCK) > 0;

/**
 * Waits until `settled()` is true OR a request is parked on the cookie lock: "the tab has done everything it can".
 * (Today nothing is parked for Login/Logout; after the F2 fix the second tab waits for the lock instead of sending.)
 */
export function waitUntilSettledOrParked(settled: () => boolean) {
  return vi.waitFor(() => {
    if (!settled() && !parkedOnCookieLock()) throw new Error('not yet');
  });
}

/**
 * jsdom does not deliver `storage` events within one window, browsers do to the OTHER tabs. This makes every write of
 * the session record reach all tab instances (the writer hears its own write too, which is harmless).
 */
export function deliverStorageEventsLikeABrowser() {
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

/**
 * Registers the cleanup every such test file needs: tabs outlive a failed assertion and their requests / lock waits
 * would run into the next test. After each test: restore spies, open every gate made by the returned `gate()`, then
 * wait (by events, not by time) until no request is in flight and no lock is held or awaited.
 * Call once at the top level of the test file; use the returned `gate()` for every gate.
 */
export function installTabCleanup(): { gate: () => Gate } {
  const opened: Gate[] = [];
  const inFlight = new Set<string>();
  const onStart = ({ requestId, request }: { requestId: string; request: Request }) => {
    inFlight.add(requestId);
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
    opened.splice(0).forEach((g) => g.open());
    for (let round = 0; round < 3; round += 1) {
      await vi.waitFor(() => {
        if (inFlight.size > 0 || locks().isBusy()) throw new Error('tabs are still working');
      });
      await new Promise((resolve) => setTimeout(resolve, 0)); // one macrotask: let the last continuations run
    }
  });

  return {
    gate: () => {
      const g = newGate();
      opened.push(g);
      return g;
    },
  };
}
