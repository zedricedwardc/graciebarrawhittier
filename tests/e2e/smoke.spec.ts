/**
 * Smoke tests — does the site load and is the booking API alive?
 */
import { test, expect } from '@playwright/test';

test.describe('Smoke', () => {
  test('homepage renders with expected hero', async ({ page }) => {
    const r = await page.goto('/');
    expect(r?.status()).toBeLessThan(400);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('kickstart page renders booking flow', async ({ page }) => {
    const r = await page.goto('/kickstart');
    expect(r?.status()).toBeLessThan(400);
    await expect(page.locator('#booking-flow')).toBeVisible();
  });

  test('availability API returns ok for adults program', async ({ request }) => {
    const r = await request.get(`/api/availability?program=adults&from=${todayDate()}&to=${plus(28)}`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.slots)).toBe(true);
  });
});

function todayDate(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}
function plus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
