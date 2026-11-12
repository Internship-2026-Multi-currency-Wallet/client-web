import { expect, test } from '@playwright/test';
import { brand } from '../src/brand/brand.ts';

test('the raw HTML carries the brand title, favicon and manifest link before any JS runs', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain(`<title>${brand.siteName}</title>`);
  expect(html).toMatch(new RegExp(`<link[^>]*rel="icon"[^>]*href="${brand.faviconUrl}"`));
  expect(html).toMatch(/<link[^>]*rel="manifest"/);
});

test('the tab title, favicon and manifest link follow the brand in the browser', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle(`Login · ${brand.siteName}`);
  const icon = page.locator('link[rel=icon]');
  await expect(icon).toHaveAttribute('href', brand.faviconUrl);
  expect((await request.get(brand.faviconUrl)).status()).toBe(200);
  await expect(page.locator('link[rel=manifest]')).toHaveCount(1);
});

test('the web manifest is built from the brand', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.headers()['content-type']).toContain('manifest+json');
  const manifest = await response.json();
  expect(manifest.name).toBe(brand.siteName);
  expect(manifest.icons[0].src).toBe(brand.faviconUrl);
});

test('the header logo is shown with the brand name', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: brand.siteName })).toBeVisible();
});
