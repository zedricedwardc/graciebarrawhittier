/**
 * Recurring weekly class template per program, in America/Los_Angeles local time.
 * Source of truth for trial-eligible class times — verified against Schedule-2.pdf.
 * Adults: only Fundamentals (GB1) — Advanced/Top Team excluded for trials.
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
    { weekday: 1, hour: 15, minute: 0, durationMin: 45 }, // Mon 3pm
    { weekday: 3, hour: 15, minute: 0, durationMin: 45 }, // Wed 3pm
    { weekday: 2, hour: 16, minute: 0, durationMin: 45 }, // Tue 4pm
    { weekday: 4, hour: 16, minute: 0, durationMin: 45 }, // Thu 4pm
  ],
  lc1: [
    { weekday: 1, hour: 16, minute: 0, durationMin: 45 }, // Mon 4pm
    { weekday: 3, hour: 16, minute: 0, durationMin: 45 }, // Wed 4pm
    { weekday: 2, hour: 15, minute: 0, durationMin: 45 }, // Tue 3pm
    { weekday: 4, hour: 15, minute: 0, durationMin: 45 }, // Thu 3pm
    { weekday: 6, hour: 10, minute: 0, durationMin: 45 }, // Sat 10am
  ],
  lc2: [
    { weekday: 1, hour: 18, minute: 0, durationMin: 45 }, // Mon 6pm
    { weekday: 3, hour: 18, minute: 0, durationMin: 45 }, // Wed 6pm
    { weekday: 2, hour: 17, minute: 0, durationMin: 45 }, // Tue 5pm
    { weekday: 4, hour: 17, minute: 0, durationMin: 45 }, // Thu 5pm
    { weekday: 6, hour: 10, minute: 0, durationMin: 45 }, // Sat 10am
  ],
  juniors: [
    { weekday: 1, hour: 17, minute: 0, durationMin: 60 }, // Mon 5pm
    { weekday: 3, hour: 17, minute: 0, durationMin: 60 }, // Wed 5pm
    { weekday: 2, hour: 18, minute: 0, durationMin: 60 }, // Tue 6pm
    { weekday: 4, hour: 18, minute: 0, durationMin: 60 }, // Thu 6pm
    { weekday: 6, hour: 11, minute: 0, durationMin: 60 }, // Sat 11am
  ],
  adults: [
    { weekday: 1, hour: 11, minute: 0, durationMin: 60 }, // Mon 11am
    { weekday: 2, hour: 11, minute: 0, durationMin: 60 }, // Tue 11am
    { weekday: 3, hour: 11, minute: 0, durationMin: 60 }, // Wed 11am
    { weekday: 4, hour: 11, minute: 0, durationMin: 60 }, // Thu 11am
    { weekday: 1, hour: 19, minute: 0, durationMin: 60 }, // Mon 7pm
    { weekday: 2, hour: 19, minute: 0, durationMin: 60 }, // Tue 7pm
    { weekday: 3, hour: 19, minute: 0, durationMin: 60 }, // Wed 7pm
    { weekday: 4, hour: 19, minute: 0, durationMin: 60 }, // Thu 7pm
    { weekday: 6, hour: 12, minute: 0, durationMin: 60 }, // Sat 12pm
  ],
};
