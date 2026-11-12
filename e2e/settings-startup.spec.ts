import { expect, type Page, test } from '@playwright/test';

// App served WITHOUT MSW (see playwright.config.ts), so `page.route` fakes wallet-core here.
test.use({ baseURL: 'http://localhost:4181' });

const settings = [
  { key: 'auth.googleLogin', value: true },
  { key: 'auth.phoneRequiredAt', value: 'never' },
  { key: 'products.enabled', value: ['wallet'] },
];

/** The wallet pages need a login (E1-1): start with a stored, still valid session (no wallet-core call needed). */
async function signedIn(page: Page) {
  await page.addInitScript(() => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    localStorage.setItem(
      'wallet.session',
      JSON.stringify({
        accessToken: 'e2e-access-token',
        accessTokenExpiresAt: expiresAt,
        user: { id: '1', email: 'demo@example.com', phone: null },
      }),
    );
  });
}

/** Answers wallet-core; `publicSettings` calls are counted and answered by `respond`. */
async function fakeWalletCore(page: Page, respond: (call: number) => 'fail' | 'ok') {
  const counter = { publicSettings: 0 };
  await page.route('**/wallet-core/graphql', async (route) => {
    const { operationName } = route.request().postDataJSON() as { operationName?: string };
    if (operationName !== 'PublicSettings') {
      return route.fulfill({ json: { data: null, errors: [{ message: 'not mocked' }] } });
    }
    counter.publicSettings += 1;
    if (respond(counter.publicSettings) === 'fail') {
      return route.fulfill({ status: 503, body: 'down' });
    }
    return route.fulfill({ json: { data: { publicSettings: settings } } });
  });
  return counter;
}

test('app renders after one successful PublicSettings request', async ({ page }) => {
  await signedIn(page);
  const counter = await fakeWalletCore(page, () => 'ok');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  expect(counter.publicSettings).toBe(1);
});

test('failed initial settings show an error, Retry recovers the app', async ({ page }) => {
  await signedIn(page);
  const counter = await fakeWalletCore(page, (call) => (call === 1 ? 'fail' : 'ok'));
  await page.goto('/');
  await expect(page.getByText('Could not load the app settings.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  expect(counter.publicSettings).toBe(2);
});
