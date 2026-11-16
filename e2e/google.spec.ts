import { expect, test, type Page } from '@playwright/test';

// Runs against the MSW mock of Google login: the popup shows the mock Google screen (src/pages/MockGooglePage.tsx).
const demo = { email: 'demo@example.com', password: 'Demo1234!' };

async function logInWithPassword(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(demo.email);
  await page.getByLabel(/^Password/).fill(demo.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
}

/** Clicks the button that opens the Google popup and returns the popup once the mock Google screen shows. */
async function openGoogle(page: Page, button: string) {
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: button }).click(),
  ]);
  await expect(popup.getByRole('heading', { name: 'Mock Google sign-in' })).toBeVisible();
  return popup;
}

async function chooseGoogleAccount(popup: Page, email: string) {
  await popup.getByLabel('Google email').fill(email);
  await popup.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
}

test('link Google in account settings, then log in with it', async ({ page }) => {
  await logInWithPassword(page);
  await page.getByRole('link', { name: 'Account' }).click();
  await expect(page.getByText(/^Not linked/)).toBeVisible();

  await chooseGoogleAccount(
    await openGoogle(page, 'Link Google account'),
    'e2e.google@example.com',
  );
  await expect(page.getByText('e2e.google@example.com')).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await chooseGoogleAccount(
    await openGoogle(page, 'Continue with Google'),
    'e2e.google@example.com',
  );
  // Logged in as the linked user and back on the page that required the login.
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();
  await expect(page.getByText(demo.email)).toBeVisible();
});

test('closing the Google window explains it and allows a retry', async ({ page }) => {
  await page.goto('/login');
  const popup = await openGoogle(page, 'Continue with Google');
  await popup.close();

  await expect(page.getByText('Closed the Google window? Cancel to try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled.');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
});

test('a Google account that is not linked cannot log in', async ({ page }) => {
  await page.goto('/login');
  await chooseGoogleAccount(await openGoogle(page, 'Continue with Google'), 'nobody@example.com');

  await expect(page.getByRole('alert')).toContainText('not linked to any account');
  await expect(page).toHaveURL(/\/login$/);
});
