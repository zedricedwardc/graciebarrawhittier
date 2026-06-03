/**
 * E2E — full booking flow on the live site.
 * Creates a REAL appointment and contact in GHL.
 *
 * Identifiable test data:
 *   parent.firstName = "QATest"
 *   parent.lastName  = "Bot"
 *   parent.email     = qa-test-<ts>@example.com
 *   parent.phone     = 5625550100
 *
 * Cleanup: search GHL for contacts named "QATest Bot" and the appointments tied to them.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('book Adults class — survey → calendar → slot → form → success', async ({ page }) => {
  const ts = Date.now();
  const testEmail = `qa-test-${ts}@example.com`;

  // Capture the /api/book POST so we can read the response body.
  const bookResponsePromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/book') && resp.request().method() === 'POST',
    { timeout: 60_000 },
  );

  // Capture availability calls so we can assert calendar fetch happened.
  const availabilityCalls: { url: string; status: number }[] = [];
  page.on('response', (resp) => {
    if (resp.url().includes('/api/availability')) {
      availabilityCalls.push({ url: resp.url(), status: resp.status() });
    }
  });

  await page.goto('/kickstart');
  await expect(page.locator('#booking-flow')).toBeVisible();

  // STEP 1 — survey: "Myself" auto-selects adults program.
  await page.click('button[data-booking-for="self"]');

  // STEP 2 — calendar should appear with a month label.
  await expect(page.locator('[data-step="date"]:not([hidden])')).toBeVisible();
  await expect(page.locator('[data-month-label]')).not.toHaveText(/^\s*$/);

  // Wait for at least one bookable date to appear (calendar fetch from GHL).
  const enabledDate = page.locator('[data-step="date"]:not([hidden]) button[data-date]:not([disabled])').first();
  await enabledDate.waitFor({ state: 'visible', timeout: 30_000 });

  expect(availabilityCalls.length, 'expected at least one /api/availability call').toBeGreaterThan(0);
  expect(availabilityCalls[0]!.status, 'availability call should be 2xx').toBeLessThan(400);

  await enabledDate.click();

  // STEP 3 — slot picker: pick the first available slot.
  await expect(page.locator('[data-step="slot"]:not([hidden])')).toBeVisible();
  const firstSlot = page.locator('[data-step="slot"]:not([hidden]) [data-slot-list] button').first();
  await firstSlot.waitFor({ state: 'visible', timeout: 15_000 });
  await firstSlot.click();

  // STEP 4 — trainee form. isSelf=true → student block hidden.
  await expect(page.locator('[data-step="form"]:not([hidden])')).toBeVisible();
  const form = page.locator('[data-step="form"]:not([hidden]) form[data-trainee-form]');

  await form.locator('input[name="parentFirst"]').fill('QATest');
  await form.locator('input[name="parentLast"]').fill('Bot');
  await form.locator('input[name="email"]').fill(testEmail);
  await form.locator('input[name="phone"]').fill('5625550100');

  // Wait past dwell threshold (3 sec) before submitting. Page was loaded ~5+ sec ago already
  // (we did a calendar fetch + clicks), so this should already be safe — but be explicit.
  await page.waitForTimeout(3500);

  await form.locator('button[data-submit]').click();

  const bookResp = await bookResponsePromise;
  const bookBody = await bookResp.json();

  console.log('[booking] /api/book response:', JSON.stringify(bookBody, null, 2));
  expect(bookResp.status(), 'POST /api/book should return 200').toBe(200);
  expect(bookBody.ok, `expected ok:true, got code=${bookBody.code} message=${bookBody.message}`).toBe(true);
  expect(typeof bookBody.appointmentId).toBe('string');
  expect(bookBody.appointmentId, 'appointmentId must not be the spam-discarded sentinel').not.toBe('spam-discarded');

  // STEP 5 — success state visible with confirmation copy.
  await expect(page.locator('[data-step="success"]:not([hidden])')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-step="success"]:not([hidden]) h3')).toContainText(/Booked/i);

  console.log(`[booking] CREATED IN GHL — appointmentId=${bookBody.appointmentId}`);
  console.log(`[booking] contact email used: ${testEmail}`);
});
