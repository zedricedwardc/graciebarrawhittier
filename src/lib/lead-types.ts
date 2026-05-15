/**
 * Zod schema + types for /api/lead.
 *
 * Phase 2: replaces the transitional webhook-proxy schema with a richer one
 * that supports trainee data + structured source enum. The endpoint now talks
 * to GHL directly via ghl-adapter.handleOptIn.
 */

import { z } from 'zod';

export const SOURCES = [
  'homepage-optin',
  'kids-optin',
  'adults-optin',
  'contact-form',
  'qr-offer-optin',
] as const;

export type LeadSource = (typeof SOURCES)[number];

/**
 * Either `name` (combined) or `firstName`+`lastName` must be provided.
 * Endpoint normalizes to firstName + lastName before calling handleOptIn.
 */
export const LeadRequest = z
  .object({
    name: z.string().min(1).max(100).optional(),
    firstName: z.string().max(80).optional(),
    lastName: z.string().max(80).optional(),
    email: z.email().max(120),
    phone: z.string().regex(/^\+?[\d\s\-().]{7,40}$/),
  message: z.string().max(2000).optional(),
  source: z.enum(SOURCES),
  page: z.string().max(200),

  /** Optional trainee data (children, or self-bookings with explicit isSelf=true). */
  trainee: z
    .object({
      firstName: z.string().min(1).max(80),
      lastName: z.string().max(80).optional(),
      /** YYYY-MM-DD. Required for child bookings via the booking flow; optional here. */
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      program: z.enum(['kids', 'juniors', 'adults']).optional(),
      isSelf: z.boolean().optional(),
    })
    .optional(),

    // Anti-spam
    website: z.string().optional(),
    ts: z.number().int(),
  })
  .refine((v) => Boolean(v.name) || (Boolean(v.firstName) && Boolean(v.lastName)), {
    message: 'Either `name` or both `firstName` and `lastName` must be provided',
  });
export type LeadRequest = z.infer<typeof LeadRequest>;

export type LeadResponse =
  | { ok: true; contactId: string; opportunityId: string | null; isReplay: boolean }
  | { ok: false; code: 'INVALID_INPUT' | 'RATE_LIMITED' | 'GHL_FAILED' | 'NOT_CONFIGURED'; message?: string };
