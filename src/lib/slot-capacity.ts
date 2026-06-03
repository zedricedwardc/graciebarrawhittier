import type { AvailabilitySlot } from './booking-types';

export interface CapacityEvent {
  id?: string;
  startTime?: string;
  appointmentStatus?: string;
}

export interface SlotCapacityDecision {
  available: boolean;
  requiresFreeSlotOverride: boolean;
}

const NON_BLOCKING_STATUSES = new Set(['cancelled', 'canceled', 'invalid']);

export function appointmentPerSlot(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export function filterSlotsByCapacity(args: {
  slots: AvailabilitySlot[];
  events: CapacityEvent[];
  freeStartISOs?: Set<string>;
  appointmentPerSlot: number;
}): AvailabilitySlot[] {
  return args.slots.filter((slot) => decideSlotCapacity({
    slot,
    events: args.events,
    freeStartISOs: args.freeStartISOs,
    appointmentPerSlot: args.appointmentPerSlot,
  }).available);
}

export function decideSlotCapacity(args: {
  slot: AvailabilitySlot;
  events: CapacityEvent[];
  freeStartISOs?: Set<string>;
  appointmentPerSlot: number;
}): SlotCapacityDecision {
  const capacity = appointmentPerSlot(args.appointmentPerSlot);
  const slotKey = Date.parse(args.slot.startISO);
  if (Number.isNaN(slotKey)) return { available: false, requiresFreeSlotOverride: false };

  const freeStarts = new Set<number>();

  for (const startISO of args.freeStartISOs ?? []) {
    const key = Date.parse(startISO);
    if (!Number.isNaN(key)) freeStarts.add(key);
  }

  let activeCount = 0;
  for (const event of args.events) {
    if (!event.startTime || !countsAgainstCapacity(event.appointmentStatus)) continue;
    const key = Date.parse(event.startTime);
    if (Number.isNaN(key)) continue;
    if (key === slotKey) activeCount++;
  }

  if (activeCount >= capacity) return { available: false, requiresFreeSlotOverride: false };
  if (activeCount > 0) return { available: true, requiresFreeSlotOverride: !freeStarts.has(slotKey) };
  return { available: freeStarts.has(slotKey), requiresFreeSlotOverride: false };
}

function countsAgainstCapacity(status: string | undefined): boolean {
  if (!status) return true;
  return !NON_BLOCKING_STATUSES.has(status.trim().toLowerCase());
}
