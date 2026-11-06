import { server } from '../mocks/server';
import { OTHER_USER, storedRecord, TEST_USER, testSession, writeStoredRecord } from '../test/auth';
import { CookieJar, RotatingBackend } from '../test/rotating-backend';
import { rotatingAuthTransport } from '../test/rotating-transport';
import {
  deliverStorageEventsLikeABrowser,
  installTabCleanup,
  loginAs,
  logoutOf,
  openTab,
  parkedOnCookieLock,
  type Tab,
  waitUntilSettledOrParked,
} from '../test/tabs';

/**
 * F2: cross-tab races of the three requests that read or change the shared refresh cookie (Refresh, Login, Logout),
 * run through the REAL frontend modules (`authApi.login`, `authApi.logout` as `useLogout` uses them, `refreshSession`,
 * the session module and the Redux store) in independent "tabs".
 *
 * The server side is the simulation in `rotating-transport.ts` (S1-S4, modeled on the merged wallet-core auth). The
 * browser model (cookie read at send time, `Set-Cookie` applied at delivery, independent of the page) is standard HTTP,
 * but it is a model, not a browser; the real backend and a real browser are covered by the manual integration run.
 *
 * The expected values below are the CORRECT behavior. Tests marked `F2 REPRODUCTION` reproduced the race before Login
 * and Logout took the `wallet.auth-cookie` lock and now guard the fix; they would fail without that lock. The controls
 * (no overlap) never depended on it and must keep passing.
 */
const { gate } = installTabCleanup();

/** Everything that must agree: who owns the cookie, who the storage says, who each tab shows. */
function snapshot(backend: RotatingBackend, jar: CookieJar, ...tabs: Tab[]) {
  return {
    cookieOwner: backend.ownerOf(jar.value),
    persistedUser: storedRecord()?.session?.user.id ?? null,
    redux: tabs.map((tab) => tab.store.getState().auth.user?.id ?? null),
  };
}

function newServer() {
  const backend = new RotatingBackend();
  const jar = new CookieJar();
  const transport = rotatingAuthTransport(backend, jar);
  server.use(...transport.handlers);
  return { backend, jar, transport };
}

/** The user is signed in: the server has a session (the cookie holds its token) and the storage a valid access token. */
function signedIn(backend: RotatingBackend, jar: CookieJar, user = TEST_USER) {
  const token = backend.login(user.id);
  jar.value = token;
  writeStoredRecord('generation-0', {
    ...testSession(user),
    accessToken: `access-${user.id}-${token}`,
  });
}

const DEMO = 'demo@example.com'; // user 1
const OTHER = 'other@example.com'; // user 2

describe('the combined test transport', () => {
  it('counts refreshes live: a getter, not a value copied when the transport was created', async () => {
    const { backend, jar, transport } = newServer();
    expect(transport.refreshCalls).toBe(0);

    signedIn(backend, jar);
    const tab = await openTab();
    await tab.client.refreshSession();

    expect(transport.refreshCalls).toBe(1);
    expect(backend.events.filter((event) => event.startsWith('refresh:'))).toHaveLength(1);
  });
});

describe('F2-A: two Logins as different users in two tabs', () => {
  it('F2 REPRODUCTION: a stale Login answer must not leave the cookie of one user next to the session of another', async () => {
    const { backend, jar, transport } = newServer();
    deliverStorageEventsLikeABrowser();
    const tabA = await openTab();
    const tabB = await openTab();
    const deliveryA = gate();
    transport.login.plan(1, { delivery: deliveryA.promise }); // A (user 1) is handled first, its answer is slow

    const loginA = loginAs(tabA, DEMO);
    await transport.login.consumed(1); // the server made a session for user 1; A has not heard back
    let settledB = false;
    const loginB = loginAs(tabB, OTHER).then((r) => ((settledB = true), r)); // user 2, answered at once
    await waitUntilSettledOrParked(() => settledB); // B waits for A on the cookie lock (without the lock B would finish at once)

    deliveryA.open(); // A's answer (and its Set-Cookie) lands last
    await loginA;
    await loginB;
    await vi.waitFor(() => {
      const { persistedUser, redux } = snapshot(backend, jar, tabA, tabB);
      expect(redux).toEqual([persistedUser, persistedUser]); // both tabs have heard of the winner
    });

    const after = snapshot(backend, jar, tabA, tabB);
    expect(after.persistedUser).not.toBeNull(); // somebody is signed in
    expect(after.cookieOwner).toBe(after.persistedUser); // ... and the cookie is THEIR cookie

    // No later silent account switch: renewing the session keeps the user.
    const before = after.persistedUser;
    await tabB.client.refreshSession();
    expect([before, null]).toContain(storedRecord()?.session?.user.id ?? null);
  });
});

describe('F2-B: Logout in tab A overlapping a Login in tab B', () => {
  it("F2 REPRODUCTION: the late answer of A's Logout must not delete the cookie of B's new session", async () => {
    const { backend, jar, transport } = newServer();
    signedIn(backend, jar, TEST_USER);
    deliverStorageEventsLikeABrowser();
    const tabA = await openTab();
    const tabB = await openTab();
    const deliveryLogout = gate();
    transport.logout.plan(1, { delivery: deliveryLogout.promise }); // A's logout answer is slow

    void logoutOf(tabA); // signs A out at once (tombstone) and sends the request with the cookie of the old session
    await transport.logout.consumed(1); // the server has revoked it; the answer (Set-Cookie: delete) is on its way
    await tabA.session.sessionWritesSettled();
    await vi.waitFor(() => expect(tabB.store.getState().auth.status).toBe('anonymous')); // B shows the login form

    let settledB = false;
    const loginB = loginAs(tabB, OTHER).then((r) => ((settledB = true), r));
    await waitUntilSettledOrParked(() => settledB); // B waits for the logout on the cookie lock (without the lock B would log in at once)

    deliveryLogout.open(); // the old logout answer lands now
    await loginB;

    expect(snapshot(backend, jar, tabA, tabB)).toEqual({
      cookieOwner: OTHER_USER.id, // B's session keeps ITS cookie
      persistedUser: OTHER_USER.id,
      redux: [OTHER_USER.id, OTHER_USER.id],
    });
    await expect(tabB.client.refreshSession()).resolves.toBe(true); // B can still renew its session
  });

  it('control: a Login that starts after the Logout was answered keeps its cookie (no overlap)', async () => {
    const { backend, jar } = newServer();
    signedIn(backend, jar, TEST_USER);
    deliverStorageEventsLikeABrowser();
    const tabA = await openTab();
    const tabB = await openTab();

    await logoutOf(tabA);
    await vi.waitFor(() => expect(tabB.store.getState().auth.status).toBe('anonymous'));
    await loginAs(tabB, OTHER);

    expect(snapshot(backend, jar, tabB)).toEqual({
      cookieOwner: OTHER_USER.id,
      persistedUser: OTHER_USER.id,
      redux: [OTHER_USER.id],
    });
    await expect(tabB.client.refreshSession()).resolves.toBe(true);
  });
});

describe('F2-C: Refresh in tab A overlapping a Login in tab B', () => {
  it('F2 REPRODUCTION: the Set-Cookie of an old Refresh must not replace the cookie of a newer Login', async () => {
    const { backend, jar, transport } = newServer();
    signedIn(backend, jar, TEST_USER);
    deliverStorageEventsLikeABrowser();
    const tabA = await openTab();
    const tabB = await openTab(); // its login form was open before A's session existed on screen: the submit still works
    const deliveryRefresh = gate();
    transport.plan(1, { delivery: deliveryRefresh.promise }); // A's refresh answer is slow

    const refreshA = tabA.client.refreshSession();
    await transport.consumed(1); // the server rotated user 1's token: R1 -> R2
    let settledB = false;
    const loginB = loginAs(tabB, OTHER).then((r) => ((settledB = true), r));
    await waitUntilSettledOrParked(() => settledB);

    deliveryRefresh.open(); // A's refresh answer, with the user-1 cookie, lands last
    await refreshA;
    await loginB;

    const after = snapshot(backend, jar, tabA, tabB);
    expect(after.persistedUser).toBe(OTHER_USER.id); // the Login is the newest word
    expect(after.cookieOwner).toBe(OTHER_USER.id); // so the cookie must be user 2's, not the one from the Refresh

    // The local generation check dropped A's stale WRITE (that part works); a later refresh must keep user 2.
    await tabB.client.refreshSession();
    expect(storedRecord()?.session?.user.id).toBe(OTHER_USER.id);
  });

  it('control: a Login after the Refresh finished keeps its cookie', async () => {
    const { backend, jar } = newServer();
    signedIn(backend, jar, TEST_USER);
    const tabA = await openTab();
    const tabB = await openTab();

    await tabA.client.refreshSession();
    await loginAs(tabB, OTHER);

    expect(snapshot(backend, jar)).toMatchObject({
      cookieOwner: OTHER_USER.id,
      persistedUser: OTHER_USER.id,
    });
  });
});

describe('F2-D: Logout in tab B overlapping a Refresh in tab A', () => {
  /**
   * S3 matters here: the real Logout revokes only the session of the cookie it carries (by hash), so an old Logout
   * can miss the token a newer Refresh rotated to. That residual server-side race is not fixable in the client.
   */
  it('F2 REPRODUCTION (under S3): after logout no usable refresh token is left, neither on the server nor in the cookie', async () => {
    const { backend, jar, transport } = newServer();
    signedIn(backend, jar, TEST_USER);
    deliverStorageEventsLikeABrowser();
    const tabA = await openTab();
    const tabB = await openTab();
    const deliveryRefresh = gate();
    transport.plan(1, { delivery: deliveryRefresh.promise });

    const refreshA = tabA.client.refreshSession();
    await transport.consumed(1); // R1 -> R2 on the server; the browser still holds R1
    let settledLogout = false;
    const logoutB = logoutOf(tabB).then((r) => ((settledLogout = true), r)); // the old logout carries R1
    await waitUntilSettledOrParked(() => settledLogout);

    deliveryRefresh.open(); // the refresh answer sets the cookie to R2
    await refreshA;
    await logoutB;

    expect(storedRecord()?.session ?? null).toBeNull(); // locally logged out (this part is F3 and works)
    expect(backend.validTokens()).toEqual([]); // no live refresh token survives the logout
    expect(jar.value).toBeNull(); // and the browser keeps no cookie of the ended session
  });

  it('control: a Logout after the Refresh finished revokes the rotated token', async () => {
    const { backend, jar } = newServer();
    signedIn(backend, jar, TEST_USER);
    const tabA = await openTab();
    const tabB = await openTab();

    await tabA.client.refreshSession();
    await logoutOf(tabB);

    expect(backend.validTokens()).toEqual([]);
    expect(jar.value).toBeNull();
  });
});

describe('F2-E: a Refresh answer for another user than the stored session', () => {
  it('F2 REPRODUCTION: the session must not silently switch from user 2 to user 1', async () => {
    const { backend, jar } = newServer();
    // The storage holds user 2's session, but the cookie belongs to user 1 (the state the races above can leave).
    writeStoredRecord('generation-0', {
      ...testSession(OTHER_USER),
      accessToken: 'access-2-old',
    });
    jar.value = backend.login(TEST_USER.id);
    const tab = await openTab();
    expect(tab.store.getState().auth.user?.id).toBe(OTHER_USER.id);

    await tab.client.refreshSession();

    expect(storedRecord()?.session?.user.id ?? null).not.toBe(TEST_USER.id); // not user 1 without a login
    expect(tab.store.getState().auth.user?.id ?? null).not.toBe(TEST_USER.id);
  });
});

/** What the fix guarantees beyond the four races: stale operations are never SENT, and the lock policy. */
describe('F2: login and logout under the cookie lock', () => {
  it('a Login that lost against another Login while waiting for the lock is never sent', async () => {
    const { backend, jar, transport } = newServer();
    deliverStorageEventsLikeABrowser();
    const tabA = await openTab();
    const tabB = await openTab();
    const deliveryA = gate();
    transport.login.plan(1, { delivery: deliveryA.promise });

    const loginA = loginAs(tabA, DEMO);
    await transport.login.consumed(1);
    const loginB = loginAs(tabB, OTHER);
    await vi.waitFor(() => expect(parkedOnCookieLock()).toBe(true));
    deliveryA.open();

    expect((await loginA).data?.id).toBe('1');
    const rejected = await loginB;
    expect('error' in rejected && rejected.error).toMatchObject({ code: 'SESSION_CHANGED' });
    expect(transport.login.calls).toBe(1); // user 2's login never reached the server: no stray session or cookie
    expect(backend.validTokens()).toEqual(['R1']);
    expect(snapshot(backend, jar, tabA, tabB)).toEqual({
      cookieOwner: '1',
      persistedUser: '1',
      redux: ['1', '1'],
    });
  });

  it('an older Logout does not revoke or clear the session and cookie of a NEWER Login', async () => {
    const { backend, jar, transport } = newServer();
    signedIn(backend, jar, TEST_USER);
    deliverStorageEventsLikeABrowser();
    const tabA = await openTab();
    const tabB = await openTab();

    const logoutGeneration = tabA.session.clearSession(); // A: signed out locally; its request is still to come
    await tabA.session.sessionWritesSettled();
    await vi.waitFor(() => expect(tabB.store.getState().auth.status).toBe('anonymous'));
    await loginAs(tabB, OTHER); // B logs in as user 2 meanwhile
    const result = await tabA.store.dispatch(
      tabA.authApi.endpoints.logout.initiate(logoutGeneration),
    );

    expect(result).toMatchObject({ data: false }); // not sent: it is not the latest event of the session any more
    expect(transport.logout.calls).toBe(0);
    expect(snapshot(backend, jar, tabB)).toEqual({
      cookieOwner: OTHER_USER.id,
      persistedUser: OTHER_USER.id,
      redux: [OTHER_USER.id],
    });
  });

  it('a pending Logout is sent although its own local tombstone already changed the generation', async () => {
    const { backend, jar, transport } = newServer();
    signedIn(backend, jar, TEST_USER);
    const tab = await openTab();

    const generation = tab.session.clearSession();
    await tab.session.sessionWritesSettled(); // the tombstone is written: the record has the logout's generation
    const result = await tab.store.dispatch(tab.authApi.endpoints.logout.initiate(generation));

    expect(result).toMatchObject({ data: true });
    expect(transport.logout.calls).toBe(1);
    expect(backend.validTokens()).toEqual([]);
    expect(jar.value).toBeNull();
  });

  it('a Logout the caller gave up on while waiting for the lock is not sent', async () => {
    const { backend, jar, transport } = newServer();
    signedIn(backend, jar, TEST_USER);
    const tab = await openTab();
    const deliveryRefresh = gate();
    transport.plan(1, { delivery: deliveryRefresh.promise });
    const refresh = tab.client.refreshSession(); // holds the cookie lock
    await transport.consumed(1);

    const call = logoutOf(tab);
    await vi.waitFor(() => expect(parkedOnCookieLock()).toBe(true));
    call.abort(); // useLogout does this after its timeout
    await call;
    deliveryRefresh.open();
    await refresh;

    expect(transport.logout.calls).toBe(0);
    expect(storedRecord()?.session ?? null).toBeNull(); // locally logged out regardless
  });

  it('if the cookie lock cannot be taken a Login is refused and NOTHING is sent', async () => {
    const { transport } = newServer();
    const tab = await openTab();
    const real = navigator.locks.request.bind(navigator.locks) as (
      ...a: unknown[]
    ) => Promise<unknown>;
    vi.spyOn(navigator.locks, 'request').mockImplementation(((name: string, ...rest: unknown[]) =>
      name === 'wallet.auth-cookie'
        ? Promise.reject(new DOMException('no lock', 'AbortError'))
        : real(name, ...rest)) as never);

    const result = await loginAs(tab, DEMO);

    expect('error' in result && result.error).toMatchObject({ code: 'AUTH_COOKIE_LOCK' });
    expect(transport.login.calls).toBe(0);
    expect(storedRecord()?.session ?? null).toBeNull();
  });

  it('without the Web Locks API login and logout still work (uncoordinated, with a warning) while refresh refuses', async () => {
    const { backend, jar, transport } = newServer();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const realLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    try {
      const tab = await openTab();
      expect((await loginAs(tab, DEMO)).data?.id).toBe('1');
      expect(snapshot(backend, jar, tab)).toEqual({
        cookieOwner: '1',
        persistedUser: '1',
        redux: ['1'],
      });
      // The session module warns about its own best-effort storage updates; the cookie lock warns once about the cookie.
      const cookieWarnings = warn.mock.calls.filter(([text]) =>
        /without cross-tab coordination/.test(String(text)),
      );
      expect(cookieWarnings).toHaveLength(1);

      await expect(tab.client.refreshSession()).rejects.toMatchObject({
        name: 'AuthCookieLockError',
        reason: 'unavailable',
      });
      expect(transport.refreshCalls).toBe(0);

      await logoutOf(tab);
      expect(backend.validTokens()).toEqual([]);
      expect(jar.value).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'locks', { value: realLocks, configurable: true });
    }
  });
});
