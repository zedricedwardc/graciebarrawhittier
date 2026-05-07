/**
 * /api/book edge cases — anti-abuse layers and Zod validation.
 * These do NOT create real GHL appointments (they intentionally fail before that point).
 */
import { test, expect } from '@playwright/test';
import { isoDateOffset } from './_helpers';

const VALID_PARENT = {
  firstName: 'QATest',
  lastName: 'Bot',
  email: 'qa-test@example.com',
  phone: '5625550100',
};
const VALID_TRAINEE = { firstName: 'QATest', age: 25, isSelf: true };
// A slot that almost certainly won't be free — far past or invalid.
const FAKE_SLOT = `${isoDateOffset(20)}T03:33:00-07:00`;

test.describe('/api/book — Zod validation', () => {
  test('invalid program returns INVALID_INPUT', async ({ request }) => {
    const r = await request.post('/api/book', {
      data: {
        program: 'martians',
        slotStartISO: FAKE_SLOT,
        parent: VALID_PARENT,
        trainee: VALID_TRAINEE,
        marketingConsent: false,
        ts: Date.now() - 10_000,
      },
    });
    const b = await r.json();
    expect(b.ok).toBe(false);
    expect(b.code).toBe('INVALID_INPUT');
  });

  test('invalid email returns INVALID_INPUT', async ({ request }) => {
    const r = await request.post('/api/book', {
      data: {
        program: 'adults',
        slotStartISO: FAKE_SLOT,
        parent: { ...VALID_PARENT, email: 'not-an-email' },
        trainee: VALID_TRAINEE,
        marketingConsent: false,
        ts: Date.now() - 10_000,
      },
    });
    const b = await r.json();
    expect(b.ok).toBe(false);
    expect(b.code).toBe('INVALID_INPUT');
  });

  test('invalid phone returns INVALID_INPUT', async ({ request }) => {
    const r = await request.post('/api/book', {
      data: {
        program: 'adults',
        slotStartISO: FAKE_SLOT,
        parent: { ...VALID_PARENT, phone: 'abc' },
        trainee: VALID_TRAINEE,
        marketingConsent: false,
        ts: Date.now() - 10_000,
      },
    });
    const b = await r.json();
    expect(b.ok).toBe(false);
    expect(b.code).toBe('INVALID_INPUT');
  });

  test('age out of range returns INVALID_INPUT', async ({ request }) => {
    const r = await request.post('/api/book', {
      data: {
        program: 'adults',
        slotStartISO: FAKE_SLOT,
        parent: VALID_PARENT,
        trainee: { ...VALID_TRAINEE, age: 1 },
        marketingConsent: false,
        ts: Date.now() - 10_000,
      },
    });
    const b = await r.json();
    expect(b.ok).toBe(false);
    expect(b.code).toBe('INVALID_INPUT');
  });

  test('malformed JSON returns INVALID_INPUT', async ({ request }) => {
    const r = await request.post('/api/book', {
      headers: { 'content-type': 'application/json' },
      data: 'not json{{',
    });
    const b = await r.json();
    expect(b.ok).toBe(false);
    expect(b.code).toBe('INVALID_INPUT');
  });
});

test.describe('/api/book — anti-abuse layers', () => {
  test('honeypot field non-empty → silent OK with spam-discarded', async ({ request }) => {
    const r = await request.post('/api/book', {
      data: {
        program: 'adults',
        slotStartISO: FAKE_SLOT,
        parent: VALID_PARENT,
        trainee: VALID_TRAINEE,
        marketingConsent: false,
        website: 'http://spammer.example',
        ts: Date.now() - 10_000,
      },
    });
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b.appointmentId).toBe('spam-discarded');
  });

  test('dwell too short (ts now) → silent OK with spam-discarded', async ({ request }) => {
    const r = await request.post('/api/book', {
      data: {
        program: 'adults',
        slotStartISO: FAKE_SLOT,
        parent: VALID_PARENT,
        trainee: VALID_TRAINEE,
        marketingConsent: false,
        ts: Date.now(), // <3s elapsed
      },
    });
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b.appointmentId).toBe('spam-discarded');
  });
});
