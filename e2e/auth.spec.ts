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

test.describe('two tabs of one browser', () => {
  const login = async (page: import('@playwright/test').Page) => {
    await page.goto('/login');
    await page.getByLabel(/^Email/).fill('demo@example.com');
    await page.getByLabel(/^Password/).fill('Demo1234!');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  };

  test('a logout in tab B logs tab A out too', async ({ context }) => {
    const a = await context.newPage();
    await login(a);
    const b = await context.newPage();
    await b.goto('/');
    await b.getByRole('button', { name: 'Log out' }).click();
    await expect(a).toHaveURL(/\/login$/);
  });
});
