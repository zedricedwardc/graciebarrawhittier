/**
 * Recurring weekly class template per program, in America/Los_Angeles local time.
 * Source of truth for trial-eligible class times — verified against Schedule-2.pdf.
 * Adults: only Fundamentals (GB1) — Advanced/Top Team excluded for trials.
 * All trial bookings are 1 hour.
 */
import type { ProgramKey } from './programs';

export const TZ = 'America/Los_Angeles' as const;

/** 0 = Sunday, 6 = Saturday (matches JS `Date.getDay()`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ClassSlot {
  weekday: Weekday;
  hour: number;        // 0–23, local time
  minute: number;      // 0 or 30 typically
  durationMin: number;
}

export const schedule: Record<ProgramKey, ClassSlot[]> = {
  tiny: [
    { weekday: 1, hour: 15, minute: 0, durationMin: 60 }, // Mon 3pm — Section A
    { weekday: 3, hour: 15, minute: 0, durationMin: 60 }, // Wed 3pm — Section A
    { weekday: 2, hour: 16, minute: 0, durationMin: 60 }, // Tue 4pm — Section B
    { weekday: 4, hour: 16, minute: 0, durationMin: 60 }, // Thu 4pm — Section B
  ],
  lc1: [
    { weekday: 1, hour: 16, minute: 0, durationMin: 60 }, // Mon 4pm — Section A
    { weekday: 3, hour: 16, minute: 0, durationMin: 60 }, // Wed 4pm — Section A
    { weekday: 2, hour: 15, minute: 0, durationMin: 60 }, // Tue 3pm — Section B
    { weekday: 4, hour: 15, minute: 0, durationMin: 60 }, // Thu 3pm — Section B
    { weekday: 6, hour: 10, minute: 0, durationMin: 60 }, // Sat 10am — LC1 & 2 combined
  ],
  lc2: [
    { weekday: 1, hour: 18, minute: 0, durationMin: 60 }, // Mon 6pm — Section A
    { weekday: 3, hour: 18, minute: 0, durationMin: 60 }, // Wed 6pm — Section A
    { weekday: 2, hour: 17, minute: 0, durationMin: 60 }, // Tue 5pm — Section B
    { weekday: 4, hour: 17, minute: 0, durationMin: 60 }, // Thu 5pm — Section B
    { weekday: 6, hour: 10, minute: 0, durationMin: 60 }, // Sat 10am — LC1 & 2 combined
  ],
  juniors: [
    { weekday: 1, hour: 17, minute: 0, durationMin: 60 }, // Mon 5pm — Section A
    { weekday: 3, hour: 17, minute: 0, durationMin: 60 }, // Wed 5pm — Section A
    { weekday: 2, hour: 18, minute: 0, durationMin: 60 }, // Tue 6pm — Section B
    { weekday: 4, hour: 18, minute: 0, durationMin: 60 }, // Thu 6pm — Section B
    { weekday: 6, hour: 11, minute: 0, durationMin: 60 }, // Sat 11am — All Sections
  ],
  adults: [
    { weekday: 1, hour: 11, minute: 0, durationMin: 60 }, // Mon 11am — GB1 Fundamentals
    { weekday: 2, hour: 11, minute: 0, durationMin: 60 }, // Tue 11am — GB1 Fundamentals
    { weekday: 3, hour: 11, minute: 0, durationMin: 60 }, // Wed 11am — GB1 Fundamentals
    { weekday: 4, hour: 11, minute: 0, durationMin: 60 }, // Thu 11am — GB1 Fundamentals
    { weekday: 1, hour: 19, minute: 0, durationMin: 60 }, // Mon 7pm — GB1 Fundamentals
    { weekday: 2, hour: 19, minute: 0, durationMin: 60 }, // Tue 7pm — GB1 Fundamentals
    { weekday: 3, hour: 19, minute: 0, durationMin: 60 }, // Wed 7pm — GB1 Fundamentals
    { weekday: 4, hour: 19, minute: 0, durationMin: 60 }, // Thu 7pm — GB1 Fundamentals
    { weekday: 6, hour: 12, minute: 0, durationMin: 60 }, // Sat 12pm — GB1 Fundamentals
  ],
};
