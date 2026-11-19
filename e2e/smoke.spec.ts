import { expect, test, type Page } from '@playwright/test';

/** Logs in as the mocks' built-in user: the wallet pages need a session. */
async function logIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill('demo@example.com');
  await page.getByLabel(/^Password/).fill('Demo1234!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
}

test('home shows health, the signed-in user and live server time (mocks)', async ({ page }) => {
  await logIn(page);
  await expect(page.getByTestId('health')).toContainText('Connected to wallet-core: wallet-core');
  await expect(page.getByTestId('me')).toContainText('Authenticated user: 1 (permissions: wallet)');

  const serverTime = page.getByTestId('server-time');
  await expect(serverTime).toHaveText(/^\d{4}-\d{2}-\d{2}T/);
  const first = await serverTime.textContent();
  await expect(serverTime).not.toHaveText(first ?? '', { timeout: 5000 });
});

test('unknown URLs show the 404 page', async ({ page }) => {
  await logIn(page);
  await page.goto('/nope');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go home' }).click();
  await expect(page).toHaveURL('/');
});

test('every page opens directly and from the menu, with no console warnings', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') problems.push(message.text());
  });

  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible();
  await logIn(page);
  for (const [url, heading] of [
    ['/', 'Welcome'],
    ['/wallet', 'Wallet'],
    ['/nope', 'Page not found'],
  ]) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Wallet' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Wallet' })).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible();

  expect(problems).toEqual([]);
});

test('the login page does not download the other pages', async ({ page }) => {
  const pages: string[] = [];
  page.on('request', (request) => {
    const match = /\/src\/pages\/(\w+)\.tsx/.exec(request.url());
    if (match) pages.push(match[1]);
  });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  expect(pages).toEqual(['LoginPage']);
});
