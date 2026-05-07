/**
 * Regression — calendar fetch from GHL via /api/availability.
 * Confirms the deleted-calendar bug doesn't reappear and all 5 programs return slots.
 */
import { test, expect } from '@playwright/test';
import { PROGRAMS, isoDateOffset, todayInLA } from './_helpers';

const today = todayInLA();
const TODAY_ISO = `${today.year}-${String(today.month).padStart(2,'0')}-${String(today.day).padStart(2,'0')}`;
const PLUS_28 = isoDateOffset(28);

test.describe('Calendar availability — regression', () => {
  for (const program of PROGRAMS) {
    test(`program=${program} returns slots`, async ({ request }) => {
      const r = await request.get(`/api/availability?program=${program}&from=${TODAY_ISO}&to=${PLUS_28}`);
      expect(r.status()).toBe(200);
      const body = await r.json();
      expect(body.ok, `expected ok:true for ${program}, got code=${body.code}`).toBe(true);
      expect(Array.isArray(body.slots)).toBe(true);
      // Sanity — at least one slot in the next 4 weeks for each program.
      expect(body.slots.length, `${program} returned 0 slots`).toBeGreaterThan(0);
    });
  }

  test('every slot has a valid ISO start, end, label', async ({ request }) => {
    const r = await request.get(`/api/availability?program=adults&from=${TODAY_ISO}&to=${PLUS_28}`);
    const body = await r.json();
    expect(body.ok).toBe(true);
    for (const s of body.slots) {
      expect(typeof s.startISO).toBe('string');
      expect(typeof s.endISO).toBe('string');
      expect(typeof s.label).toBe('string');
      expect(Number.isFinite(Date.parse(s.startISO))).toBe(true);
      expect(Number.isFinite(Date.parse(s.endISO))).toBe(true);
      // Slot must be in the future.
      expect(Date.parse(s.startISO)).toBeGreaterThan(Date.now());
    }
  });
});

test.describe('Availability — edge cases', () => {
  test('invalid program returns INVALID_RANGE', async ({ request }) => {
    const r = await request.get(`/api/availability?program=foo&from=${TODAY_ISO}&to=${PLUS_28}`);
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_RANGE');
  });

  test('range >35 days returns INVALID_RANGE', async ({ request }) => {
    const r = await request.get(`/api/availability?program=adults&from=${TODAY_ISO}&to=${isoDateOffset(60)}`);
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_RANGE');
  });

  test('to before from returns INVALID_RANGE', async ({ request }) => {
    const r = await request.get(`/api/availability?program=adults&from=${PLUS_28}&to=${TODAY_ISO}`);
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_RANGE');
  });

  test('garbage date returns INVALID_RANGE', async ({ request }) => {
    const r = await request.get(`/api/availability?program=adults&from=banana&to=apple`);
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_RANGE');
  });
});
