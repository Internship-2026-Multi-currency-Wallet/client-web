import { expect, test } from '@playwright/test';

test('home shows health, dev user and live server time (mocks)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('health')).toContainText('Connected to wallet-core: wallet-core');
  await expect(page.getByTestId('me')).toContainText('Dev user: 1 (permissions: wallet)');

  const serverTime = page.getByTestId('server-time');
  await expect(serverTime).toHaveText(/^\d{4}-\d{2}-\d{2}T/);
  const first = await serverTime.textContent();
  await expect(serverTime).not.toHaveText(first ?? '', { timeout: 5000 });
});

test('unknown URLs show the 404 page', async ({ page }) => {
  await page.goto('/nope');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go home' }).click();
  await expect(page).toHaveURL('/');
});
