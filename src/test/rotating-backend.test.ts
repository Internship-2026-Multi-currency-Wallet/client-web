import {
  CookieJar,
  gate,
  loginOverNetwork,
  logoutOverNetwork,
  refreshOverNetwork,
  RotatingBackend,
} from './rotating-backend';

function sessionOf(userId: string) {
  const backend = new RotatingBackend();
  const jar = new CookieJar();
  jar.value = backend.login(userId);
  return { backend, jar };
}

describe('RotatingBackend: single-use refresh tokens', () => {
  it('consumes R1 and issues R2 in one step', () => {
    const backend = new RotatingBackend();
    const r1 = backend.login('1');
    const response = backend.consume(r1);
    expect(response).toEqual({ ok: true, userId: '1', token: 'R2' });
    expect(backend.validTokens()).toEqual(['R2']);
  });

  it('exactly one of two concurrent attempts with R1 succeeds', async () => {
    const { backend, jar } = sessionOf('1'); // both "tabs" send the cookie R1
    const results = await Promise.all([
      refreshOverNetwork(backend, jar),
      refreshOverNetwork(backend, jar),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(backend.validTokens()).toHaveLength(1); // one live successor, not two
  });

  it('R1 is invalid after rotation, with no grace period', () => {
    const backend = new RotatingBackend();
    const r1 = backend.login('1');
    backend.consume(r1);
    expect(backend.isValid(r1)).toBe(false);
    expect(backend.consume(r1)).toEqual({ ok: false });
    expect(backend.consume(null)).toEqual({ ok: false });
    expect(backend.isValid('R2')).toBe(true); // the failed attempt did not revoke the successor
  });

  it('tells who owns a valid token (a pure read, nothing is consumed)', () => {
    const backend = new RotatingBackend();
    const r1 = backend.login('7');
    expect(backend.ownerOf(r1)).toBe('7');
    expect(backend.ownerOf(r1)).toBe('7');
    expect(backend.ownerOf('nope')).toBeNull();
    expect(backend.ownerOf(null)).toBeNull();
    backend.revoke(r1);
    expect(backend.ownerOf(r1)).toBeNull();
  });

  it('logout revokes the session of the cookie it carries, and a later refresh fails', async () => {
    const { backend, jar } = sessionOf('1');
    await logoutOverNetwork(backend, jar);
    expect(jar.value).toBeNull();
    expect(backend.validTokens()).toEqual([]);
    await expect(refreshOverNetwork(backend, jar)).resolves.toEqual({ ok: false });
  });
});

describe('RotatingBackend: controllable timing (no sleeps)', () => {
  it('separates server-side consumption from response delivery', async () => {
    const { backend, jar } = sessionOf('1');
    const delivery = gate();
    const call = refreshOverNetwork(backend, jar, { delivery: delivery.promise });
    await Promise.resolve(); // let the request reach the server
    await Promise.resolve();

    // The server has consumed R1 already, the browser has not heard back: the cookie still says R1.
    expect(backend.validTokens()).toEqual(['R2']);
    expect(jar.value).toBe('R1');
    delivery.open();
    await call;
    expect(jar.value).toBe('R2');
  });

  it('order A arrives first, B second, but B is delivered first: B fails, A applies its cookie last', async () => {
    const { backend, jar } = sessionOf('1');
    const arrivalA = gate();
    const arrivalB = gate();
    const deliveryA = gate();
    const deliveryB = gate();
    const a = refreshOverNetwork(backend, jar, {
      arrival: arrivalA.promise,
      delivery: deliveryA.promise,
    });
    const b = refreshOverNetwork(backend, jar, {
      arrival: arrivalB.promise,
      delivery: deliveryB.promise,
    });

    arrivalA.open();
    await Promise.resolve();
    arrivalB.open();
    deliveryB.open();
    await expect(b).resolves.toEqual({ ok: false }); // B's answer reaches the client before A's
    expect(jar.value).toBe('R1'); // a failure changes no cookie
    deliveryA.open();
    await expect(a).resolves.toMatchObject({ ok: true, token: 'R2' });
    expect(jar.value).toBe('R2');
    expect(backend.events).toEqual(['login:1:R1', 'refresh:R1:ok->R2', 'refresh:R1:invalid']);
  });

  it('the opposite arrival order flips which request wins', async () => {
    const { backend, jar } = sessionOf('1');
    const arrivalA = gate();
    const arrivalB = gate();
    const a = refreshOverNetwork(backend, jar, { arrival: arrivalA.promise });
    const b = refreshOverNetwork(backend, jar, { arrival: arrivalB.promise });
    arrivalB.open();
    await Promise.resolve();
    arrivalA.open();
    expect(await b).toMatchObject({ ok: true });
    expect(await a).toEqual({ ok: false });
  });

  it('models a late login cookie overwritten by a stale refresh response (the F2 hazard)', async () => {
    const { backend, jar } = sessionOf('1');
    const refreshDelivery = gate();
    const refresh = refreshOverNetwork(backend, jar, { delivery: refreshDelivery.promise });
    await Promise.resolve();
    await Promise.resolve();
    await loginOverNetwork(backend, jar, '2'); // another tab logs in as user 2: the jar holds user 2's token
    expect(backend.validTokens()).toContain(jar.value);
    refreshDelivery.open();
    await refresh;
    // The refresh response was applied AFTER the login: the cookie now belongs to user 1's session.
    expect(backend.consume(jar.value)).toMatchObject({ ok: true, userId: '1' });
  });
});

describe('the fixture stays out of production persistence and locks', () => {
  it('does not touch localStorage, document.cookie or navigator.locks', async () => {
    const request = vi.spyOn(navigator.locks, 'request');
    const { backend, jar } = sessionOf('1');
    await refreshOverNetwork(backend, jar);
    await logoutOverNetwork(backend, jar);
    await loginOverNetwork(backend, jar, '2');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });
});
