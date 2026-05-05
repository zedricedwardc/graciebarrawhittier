/**
 * Zod schemas + TS types shared between API routes and UI controller.
 * The Request schemas validate untrusted input at the HTTP boundary.
 */
import { z } from 'zod';

export const ProgramKeyEnum = z.enum(['tiny', 'lc1', 'lc2', 'juniors', 'adults']);
export type ProgramKey = z.infer<typeof ProgramKeyEnum>;

export const AvailabilityRequest = z.object({
  program: ProgramKeyEnum,
  from: z.iso.date(),
  to: z.iso.date(),
});
export type AvailabilityRequest = z.infer<typeof AvailabilityRequest>;

export interface AvailabilitySlot {
  startISO: string;   // e.g. "2026-05-06T15:00:00-07:00"
  endISO: string;
  label: string;      // "Tue, May 6 · 3:00 PM"
}

export type AvailabilityResponse =
  | { ok: true; slots: AvailabilitySlot[] }
  | { ok: false; code: 'GHL_UNAVAILABLE' | 'INVALID_RANGE' };

export const BookingRequest = z.object({
  program: ProgramKeyEnum,
  slotStartISO: z.iso.datetime({ offset: true }),
  parent: z.object({
    firstName: z.string().min(1).max(50),
    lastName:  z.string().min(1).max(50),
    email:     z.email(),
    phone:     z.string().regex(/^\+?[\d\s\-().]{10,20}$/),
  }),
  trainee: z.object({
    firstName: z.string().min(1).max(50),
    age:       z.number().int().min(3).max(99),
    isSelf:    z.boolean(),
  }),
  marketingConsent: z.boolean(),
  // Anti-spam
  website: z.string().optional(),
  ts:      z.number().int(),
});
export type BookingRequest = z.infer<typeof BookingRequest>;

export type BookingResponse =
  | { ok: true; appointmentId: string }
  | { ok: false; code: 'SLOT_TAKEN' | 'GHL_FAILED' | 'INVALID_INPUT' | 'RATE_LIMITED'; message?: string; alternates?: AvailabilitySlot[] };
