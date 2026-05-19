/**
 * Zod schema + types for /api/lead.
 *
 * Phase 2: replaces the transitional webhook-proxy schema with a richer one
 * that supports trainee data + structured source enum. The endpoint now talks
 * to GHL directly via ghl-adapter.handleOptIn.
 */

import { z } from 'zod';
import { OPTIN_PAGE_LABELS, type OptInPageLabel } from '../../config/ghl-schema';

/**
 * Dashboard-facing lead channels — written to the GHL native contact `source`
 * attribute so GHL's native Lead Source report (dashboard Section 5) groups by
 * them directly. The coarse top layer of lead-source tracking.
 *
 * Today only `Website Leads` is produced by this codebase. `Walk-In` is set by
 * the front-desk QR intake form and `Referral` is applied manually — both
 * GHL-side. `Meta Ads` / `Google Ads` activate when ad-funnel landing pages
 * are added as routes in this site (see LEAD_SOURCES below).
 */
export const LEAD_CHANNELS = ['Website Leads', 'Walk-In', 'Meta Ads', 'Google Ads', 'Referral'] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

/** Two reporting layers a page-level opt-in slug resolves to. */
export interface LeadSourceDef {
  /** Coarse channel → GHL native contact `source` (e.g. "Website Leads", "Meta Ads"). */
  channel: LeadChannel;
  /** Human-readable opt-in page → `optin_page` contact CF (e.g. "Kids Page"). */
  pageLabel: OptInPageLabel;
}

/**
 * Opt-in source registry — the single source of truth mapping each page-level
 * opt-in slug to its two reporting layers (channel + page). The slug itself is
 * stored in the `lead_source` CF and a `source-<slug>` tag for internal use.
 *
 * Adding an ad-funnel landing page (a new route in this site) = add one entry
 * here with its ad channel + page label, create the page, and add the label to
 * OPTIN_PAGE_LABELS in config/ghl-schema.ts so the dropdown CF accepts it. The
 * channel then flows automatically to the GHL native Lead Source report.
 */
export const LEAD_SOURCES = {
  'homepage-optin': { channel: 'Website Leads', pageLabel: 'Homepage' },
  'kids-optin':     { channel: 'Website Leads', pageLabel: 'Kids Page' },
  'adults-optin':   { channel: 'Website Leads', pageLabel: 'Adults Page' },
  'contact-form':   { channel: 'Website Leads', pageLabel: 'Contact Page' },
  // /offer QR landing page is still a website visit, not a front-desk Walk-In.
  'qr-offer-optin': { channel: 'Website Leads', pageLabel: 'Offer Page (QR)' },
  // ─── FUTURE — ad-funnel landing pages (new routes in this site) ──────────
  // Uncomment + build the page + add the pageLabel to OPTIN_PAGE_LABELS:
  //   'meta-generic-optin':   { channel: 'Meta Ads',   pageLabel: 'Meta Ad — General' },
  //   'meta-kids-optin':      { channel: 'Meta Ads',   pageLabel: 'Meta Ad — Kids' },
  //   'meta-adults-optin':    { channel: 'Meta Ads',   pageLabel: 'Meta Ad — Adults' },
  //   'google-generic-optin': { channel: 'Google Ads', pageLabel: 'Google Ad — General' },
  //   'google-kids-optin':    { channel: 'Google Ads', pageLabel: 'Google Ad — Kids' },
  //   'google-adults-optin':  { channel: 'Google Ads', pageLabel: 'Google Ad — Adults' },
} as const satisfies Record<string, LeadSourceDef>;

export type LeadSource = keyof typeof LEAD_SOURCES;

/** All opt-in source slugs — non-empty tuple shape for z.enum + iteration. */
export const SOURCES = Object.keys(LEAD_SOURCES) as [LeadSource, ...LeadSource[]];

/** Resolve the dashboard lead channel (GHL native `source`) for an opt-in slug. */
export function channelForSource(source: LeadSource): LeadChannel {
  return LEAD_SOURCES[source].channel;
}

/** Resolve the human-readable opt-in page label (`optin_page` CF) for a slug. */
export function pageLabelForSource(source: LeadSource): OptInPageLabel {
  return LEAD_SOURCES[source].pageLabel;
}

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
