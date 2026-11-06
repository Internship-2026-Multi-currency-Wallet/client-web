import { expect, test } from '@playwright/test';

// Runs against the MSW mock of the wallet-core auth contract (see src/mocks/auth-handlers.ts).
const user = { email: 'e2e.user@example.com', password: 'Secret123!' };

test('sign up → log in → log out → log in', async ({ page }) => {
  // The wallet is closed to anonymous visitors.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('link', { name: 'Sign up' }).click();
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible(); // the new page, not the old form
  await page.getByLabel(/^Email/).fill(user.email);
  await page.getByLabel(/^Password/).fill(user.password);
  await page.getByLabel(/^Phone/).fill('+380501234567');
  await page.getByRole('button', { name: 'Sign up' }).click();

  // Registration does not log in: back to Login with a notice.
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Account created. Log in to continue.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0);

  await page.getByLabel(/^Email/).fill(user.email);
  await page.getByLabel(/^Password/).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();

  // The session survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel(/^Email/).fill(user.email);
  await page.getByLabel(/^Password/).fill(user.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});

test('a wrong password shows a generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill('demo@example.com');
  await page.getByLabel(/^Password/).fill('Wrong1234!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
});

test('mocks: a backend request without a handler is reported, not silently sent to the network', async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') warnings.push(message.text());
  });
  await page.goto('/login');
  // The app renders only after the mock worker is up (top-level await in main.tsx).
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.evaluate(`fetch('http://localhost:3000/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'mutation NoSuchOperation { logout }', operationName: 'NoSuchOperation' }),
  }).catch(() => undefined)`);
  await expect.poll(() => warnings.join('\n')).toMatch(/without a matching request handler/i);
});

test('mocks: the page is controlled by the service worker, so the real login request is intercepted', async ({
  page,
}) => {
  const failed: string[] = [];
  page.on('requestfailed', (request) => failed.push(`${request.method()} ${request.url()}`));
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(await page.evaluate('navigator.serviceWorker.controller !== null')).toBe(true);
  await page.getByLabel(/^Email/).fill('demo@example.com');
  await page.getByLabel(/^Password/).fill('Demo1234!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  expect(failed).toEqual([]); // nothing reached the (absent) backend on :3000
});

/** The session inside the shared record `{ generation, session }` (null when signed out). */
const storedSession = (page: import('@playwright/test').Page) =>
  page.evaluate(
    `(() => { const raw = localStorage.getItem('wallet.session'); return raw ? JSON.parse(raw).session : null; })()`,
  );

test.describe('two tabs of one browser', () => {
  const login = async (page: import('@playwright/test').Page) => {
    await page.goto('/login');
    await page.getByLabel(/^Email/).fill('demo@example.com');
    await page.getByLabel(/^Password/).fill('Demo1234!');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  };

  test('a refresh that finishes in tab A after tab B logged out does not bring the session back', async ({
    context,
  }) => {
    const a = await context.newPage();
    // Tab A never hears about tab B (its `storage` listener is blocked) and its refresh answer is held back, i.e.
    // the worst timing: the answer arrives after B's logout and before any storage event.
    await a.addInitScript(`
      window.addEventListener('storage', (event) => event.stopImmediatePropagation(), true);
      window.__openGate = () => {};
      const gate = new Promise((resolve) => { window.__openGate = resolve; });
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (String(args[1] && args[1].body).includes('RefreshSession')) await gate;
        return response;
      };
    `);
    await login(a);

    await a.evaluate(
      `void (window.__refreshing = import('/src/graphql/client.ts').then((client) => client.refreshSession()))`,
    );
    const b = await context.newPage();
    await b.goto('/');
    await expect(b.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await b.getByRole('button', { name: 'Log out' }).click();
    await expect(b).toHaveURL(/\/login$/);

    await a.evaluate('window.__openGate()');
    expect(await a.evaluate('window.__refreshing')).toBe(false);
    expect(await storedSession(a)).toBeNull();
  });

  test('a logout in tab B logs tab A out too', async ({ context }) => {
    const a = await context.newPage();
    await login(a);
    const b = await context.newPage();
    await b.goto('/');
    await b.getByRole('button', { name: 'Log out' }).click();
    await expect(a).toHaveURL(/\/login$/);
  });

  test('logout in tab A is immediate even while another tab holds the session lock, and a stale refresh cannot undo it', async ({
    context,
  }) => {
    const a = await context.newPage();
    // Record every write of a session into the shared record, and hold the refresh answer back (as above).
    await a.addInitScript(`
      window.__sessionWrites = [];
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'wallet.session') window.__sessionWrites.push(JSON.parse(value).session ? 'session' : 'none');
        return setItem.call(this, key, value);
      };
      const gate = new Promise((resolve) => { window.__openGate = resolve; });
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (String(args[1] && args[1].body).includes('RefreshSession')) await gate;
        return response;
      };
    `);
    await login(a);
    await a.evaluate('window.__sessionWrites.length = 0');

    // Tab B is in the middle of its own session write: it holds the real Web Lock.
    const b = await context.newPage();
    await b.goto('/login');
    await b.evaluate(
      `void navigator.locks.request('wallet.session', () => new Promise((resolve) => { window.__releaseLock = resolve; }))`,
    );

    // Tab A: a refresh gets its answer and queues for the lock, BEHIND tab B; then the user logs out.
    await a.evaluate(
      `void (window.__refreshing = import('/src/graphql/client.ts').then((client) => client.refreshSession()))`,
    );
    await a.evaluate('window.__openGate()');
    await expect
      .poll(() => a.evaluate(`navigator.locks.query().then((state) => state.pending.length)`))
      .toBeGreaterThan(0);
    // The UI must not wait for the lock: the logout is visible at once.
    await a.getByRole('button', { name: 'Log out' }).click();
    await expect(a).toHaveURL(/\/login$/);

    await b.evaluate('window.__releaseLock()');
    expect(await a.evaluate('window.__refreshing')).toBe(false);
    await expect.poll(() => storedSession(a)).toBeNull();
    // The only write tab A made after the logout is the logout itself: the session never came back.
    expect(await a.evaluate('window.__sessionWrites')).toEqual(['none']);
  });
});
