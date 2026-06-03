import { describe, expect, it } from 'vitest';
import type { AvailabilitySlot } from './booking-types';
import { decideSlotCapacity, filterSlotsByCapacity } from './slot-capacity';

const slot = (startISO: string): AvailabilitySlot => ({
  startISO,
  endISO: startISO.replace(':00:00-', ':45:00-'),
  label: startISO,
});

describe('filterSlotsByCapacity', () => {
  it('keeps a class slot when bookings are below calendar capacity', () => {
    const slots = [slot('2026-06-03T16:00:00-07:00')];

    const available = filterSlotsByCapacity({
      slots,
      events: [
        {
          id: 'apt_1',
          startTime: '2026-06-03T16:00:00-07:00',
          appointmentStatus: 'confirmed',
        },
      ],
      appointmentPerSlot: 3,
    });

    expect(available).toEqual(slots);
  });

  it('removes a class slot when active bookings reach calendar capacity', () => {
    const slots = [slot('2026-06-03T16:00:00-07:00')];

    const available = filterSlotsByCapacity({
      slots,
      events: [
        { id: 'apt_1', startTime: '2026-06-03T16:00:00-07:00', appointmentStatus: 'confirmed' },
        { id: 'apt_2', startTime: '2026-06-03T16:00:00-07:00', appointmentStatus: 'new' },
        { id: 'apt_3', startTime: '2026-06-03T16:00:00-07:00', appointmentStatus: 'confirmed' },
      ],
      appointmentPerSlot: 3,
    });

    expect(available).toEqual([]);
  });

  it('does not count cancelled appointments against capacity', () => {
    const slots = [slot('2026-06-03T16:00:00-07:00')];

    const available = filterSlotsByCapacity({
      slots,
      events: [
        { id: 'apt_1', startTime: '2026-06-03T16:00:00-07:00', appointmentStatus: 'cancelled' },
        { id: 'apt_2', startTime: '2026-06-03T16:00:00-07:00', appointmentStatus: 'confirmed' },
      ],
      appointmentPerSlot: 1,
    });

    expect(available).toEqual([]);
  });

  it('removes an empty template slot when GHL does not report it as free', () => {
    const slots = [slot('2026-06-30T16:00:00-07:00')];

    const available = filterSlotsByCapacity({
      slots,
      events: [],
      freeStartISOs: new Set(),
      appointmentPerSlot: 3,
    });

    expect(available).toEqual([]);
  });

  it('keeps an empty template slot when GHL reports it as free', () => {
    const slots = [slot('2026-06-30T16:00:00-07:00')];

    const available = filterSlotsByCapacity({
      slots,
      events: [],
      freeStartISOs: new Set(['2026-06-30T16:00:00-07:00']),
      appointmentPerSlot: 3,
    });

    expect(available).toEqual(slots);
  });

  it('requires a free-slot override for a partially booked class hidden from free-slots', () => {
    const decision = decideSlotCapacity({
      slot: slot('2026-06-03T16:00:00-07:00'),
      events: [
        { id: 'apt_1', startTime: '2026-06-03T16:00:00-07:00', appointmentStatus: 'confirmed' },
      ],
      freeStartISOs: new Set(),
      appointmentPerSlot: 3,
    });

    expect(decision).toEqual({ available: true, requiresFreeSlotOverride: true });
  });

  it('does not require a free-slot override for a slot GHL reports as free', () => {
    const decision = decideSlotCapacity({
      slot: slot('2026-06-30T15:00:00-07:00'),
      events: [],
      freeStartISOs: new Set(['2026-06-30T15:00:00-07:00']),
      appointmentPerSlot: 3,
    });

    expect(decision).toEqual({ available: true, requiresFreeSlotOverride: false });
  });
});
