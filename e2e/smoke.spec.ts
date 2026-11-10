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
