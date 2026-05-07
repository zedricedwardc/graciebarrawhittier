/**
 * E2E — homepage opt-in form.
 * Submits real data to PUBLIC_GHL_WEBHOOK_URL. A real GHL lead WILL be created.
 * The contact is identifiable by firstName=QATest and a unique email.
 */
import { test, expect } from '@playwright/test';

test('homepage opt-in form submits and redirects to /kickstart', async ({ page }) => {
  const ts = Date.now();
  const testEmail = `qa-test-${ts}@example.com`;
  const testPhone = '5625550100';
  const testName = `QATest Bot${ts}`;

  // After the H1 fix, the browser POSTs to same-origin /api/lead — the GHL webhook
  // is called server-side and is no longer visible from the browser.
  const apiLeadPromise = page.waitForResponse(
    (resp) => resp.request().method() === 'POST' && resp.url().includes('/api/lead'),
    { timeout: 15_000 },
  );

  await page.goto('/');

  // The default-variant form on the homepage uses a single "name" field.
  // Locate by presence of input[name="name"] (the navy variant uses firstName/lastName).
  const form = page.locator('form[data-optin-form]').filter({ has: page.locator('input[name="name"]') }).first();
  await form.scrollIntoViewIfNeeded();

  await form.locator('input[name="name"]').fill(testName);
  await form.locator('input[name="email"]').fill(testEmail);
  await form.locator('input[name="phone"]').fill(testPhone);

  // Submit and await both the network call + redirect.
  await Promise.all([
    page.waitForURL(/\/kickstart/, { timeout: 15_000 }),
    form.locator('button[type="submit"]').click(),
  ]);

  // Webhook fired (we don't fail the test if it didn't — the form may fall back to /api/leads-stub).
  // We do require the redirect (with name/email/phone params) regardless.
  const url = new URL(page.url());
  expect(url.pathname).toBe('/kickstart');
  expect(url.searchParams.get('email')).toBe(testEmail);
  expect(url.searchParams.get('phone')).toBe(testPhone);

  // /api/lead must return 200 — body content is unreadable here because the form
  // navigates away as soon as it parses the response, dropping the network buffer.
  // The redirect happening at all proves the form's own ok:true check passed.
  const resp = await apiLeadPromise;
  expect(resp.status()).toBe(200);
  console.log(`[optin] /api/lead status=${resp.status()}`);
  console.log(`[optin] test data sent: name="${testName}" email="${testEmail}"`);
});
