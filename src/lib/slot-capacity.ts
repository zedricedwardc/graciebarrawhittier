import type { AvailabilitySlot } from './booking-types';

export interface CapacityEvent {
  id?: string;
  startTime?: string;
  appointmentStatus?: string;
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
  const capacity = appointmentPerSlot(args.appointmentPerSlot);
  const activeCounts = new Map<number, number>();
  const freeStarts = new Set<number>();

  for (const startISO of args.freeStartISOs ?? []) {
    const key = Date.parse(startISO);
    if (!Number.isNaN(key)) freeStarts.add(key);
  }

  for (const event of args.events) {
    if (!event.startTime || !countsAgainstCapacity(event.appointmentStatus)) continue;
    const key = Date.parse(event.startTime);
    if (Number.isNaN(key)) continue;
    activeCounts.set(key, (activeCounts.get(key) ?? 0) + 1);
  }

  return args.slots.filter((slot) => {
    const key = Date.parse(slot.startISO);
    if (Number.isNaN(key)) return false;
    const activeCount = activeCounts.get(key) ?? 0;
    if (activeCount >= capacity) return false;
    if (activeCount > 0) return true;
    return freeStarts.has(key);
  });
}

function countsAgainstCapacity(status: string | undefined): boolean {
  if (!status) return true;
  return !NON_BLOCKING_STATUSES.has(status.trim().toLowerCase());
}
