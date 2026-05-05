import { describe, it, expect } from 'vitest';
import { generateSlots } from './slot-resolver';

describe('generateSlots', () => {
  it('expands one weekly Monday slot across a 14-day range', () => {
    // 2026-05-04 is a Monday in America/Los_Angeles
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-17',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(),
      now: new Date('2026-05-04T08:00:00-07:00'),
      minLeadMinutes: 60,
    });

    // Tiny: Mon 3pm, Wed 3pm, Tue 4pm, Thu 4pm — across 2 weeks = 8 slots
    expect(slots).toHaveLength(8);
    expect(slots[0]!.label).toContain('Mon');
    expect(slots[0]!.startISO).toBe('2026-05-04T15:00:00-07:00');
  });

  it('subtracts a slot that exactly matches a booked startISO', () => {
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-10',
      bookedStartISOs: new Set(['2026-05-04T15:00:00-07:00']),
      blackoutDates: new Set(),
      now: new Date('2026-05-04T08:00:00-07:00'),
      minLeadMinutes: 60,
    });

    expect(slots.find((s) => s.startISO === '2026-05-04T15:00:00-07:00')).toBeUndefined();
  });

  it('subtracts all slots on a blackout date', () => {
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-04',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(['2026-05-04']),
      now: new Date('2026-05-04T08:00:00-07:00'),
      minLeadMinutes: 60,
    });

    expect(slots).toHaveLength(0);
  });

  it('excludes slots starting within minLeadMinutes of now', () => {
    // It's 14:30 PT on Mon 2026-05-04. Mon 3pm slot is 30 min away → excluded if leadMin=60.
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-04',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(),
      now: new Date('2026-05-04T14:30:00-07:00'),
      minLeadMinutes: 60,
    });

    expect(slots.find((s) => s.startISO === '2026-05-04T15:00:00-07:00')).toBeUndefined();
  });

  it('handles a date range that crosses a Sunday (no classes Sunday)', () => {
    // Sun 2026-05-10 → Mon 2026-05-11. Tiny has Mon class → 1 slot.
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-10',
      toISODate:   '2026-05-11',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(),
      now: new Date('2026-05-10T08:00:00-07:00'),
      minLeadMinutes: 60,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0]!.startISO).toBe('2026-05-11T15:00:00-07:00');
  });

  it('produces human-readable labels with weekday + month + time', () => {
    const slots = generateSlots({
      programKey: 'adults',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-04',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(),
      now: new Date('2026-05-04T06:00:00-07:00'),
      minLeadMinutes: 60,
    });
    expect(slots[0]!.label).toMatch(/Mon, May 4 · 11:00 AM/);
  });
});
