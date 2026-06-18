/**
 * Admin dashboard aggregators — the testable core behind the two widgets.
 *
 * Server-only (pulls live from `./ghl`). Two exports:
 *   - getUpcomingAppointments(): next-7-day appointments across the trial +
 *     (present) BTM calendars, each joined to its contact's lead source.
 *   - getLeadBreakdown(range): new-contact counts per LeadChannel over a window.
 *
 * Templatable per CLAUDE.md: calendars come from `GHL_CAL_*` env (resolved via
 * `src/data/programs.ts`), channels from `LEAD_CHANNELS` — no GBW hardcodes.
 */

import { getCalendarEvents, getContact, searchContactsByDateRange, readEnv, type ContactRecord } from './ghl';
import { programs, type BookingFlow } from '../data/programs';
import { LEAD_CHANNELS, type LeadChannel } from './lead-types';

export type AppointmentFlow = 'trial' | 'btm';

export interface UpcomingAppointment {
  id: string;
  contactId: string | null;
  contactName: string;          // "" → rendered as "Unknown contact"
  startTimeISO: string;
  endTimeISO: string | null;
  program: string;              // e.g. "Adults BJJ" (from calendar→program map)
  flow: AppointmentFlow;
  source: string;               // a LeadChannel value, or "Unknown"
  status: string;               // appointmentStatus (confirmed/…)
}

export type LeadRange = '7d' | '30d' | '90d' | 'mtd';

export interface LeadBreakdown {
  range: LeadRange;
  sinceISO: string;
  total: number;
  channels: Array<{ channel: string; count: number; pct: number }>; // all 6 + "Other", desc by count
}

const DAY_MS = 86_400_000;
/** The "unmatched / unknown source" bucket on the lead-breakdown widget. */
const OTHER = 'Other';

/**
 * Resolve the configured calendars from env via the program map. Each program
 * contributes its trial calendar (always required) and its BTM calendar (only
 * when the optional `GHL_CAL_BTM_*` var is set — silently skipped otherwise).
 */
interface CalendarTarget {
  calendarId: string;
  program: string;
  flow: AppointmentFlow;
}

function resolveCalendars(): CalendarTarget[] {
  const out: CalendarTarget[] = [];
  for (const p of programs) {
    for (const flow of ['trial', 'btm'] as BookingFlow[]) {
      const envVar = flow === 'btm' ? p.btmCalendarIdEnvVar : p.calendarIdEnvVar;
      const calendarId = readEnv(envVar);
      if (!calendarId) continue; // BTM (and any unset trial) calendars skipped silently
      out.push({ calendarId, program: p.name, flow });
    }
  }
  return out;
}

/** Read a custom-field value by key from a contact record (handles shape drift). */
function cfValueByKey(contact: ContactRecord | null, key: string): string | undefined {
  for (const cf of contact?.customFields ?? []) {
    if (cf.key !== key) continue;
    const v = cf.field_value ?? cf.value;
    if (v != null && String(v).trim() !== '') return String(v);
  }
  return undefined;
}

/**
 * Resolve a contact's lead source to a `LeadChannel`. Prefers the native
 * `source` attribute, falls back to the `lead_source` CF. Returns the matched
 * channel, or `null` when nothing maps to one of the 6 channels.
 */
function contactChannel(contact: ContactRecord | null): LeadChannel | null {
  const raw = (contact?.source ?? '').trim() || cfValueByKey(contact, 'lead_source') || '';
  const match = LEAD_CHANNELS.find((ch) => ch === raw);
  return match ?? null;
}

/** Build a contact's display name from first/last; "" when neither is present. */
function contactName(contact: ContactRecord | null): string {
  const name = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();
  return name;
}

/**
 * Next-7-day appointments across the configured trial + BTM calendars, joined
 * to each contact's lead source. Per-calendar failures degrade gracefully:
 * the calendar is skipped, a `warnings[]` entry is added, and the rest render.
 * Contact lookups are deduped via a request-scoped Map (one fetch per distinct
 * contactId); a failed/absent contact yields source "Unknown" and a blank name.
 */
export async function getUpcomingAppointments(opts?: { now?: Date }): Promise<{
  appointments: UpcomingAppointment[];
  warnings: string[];
}> {
  const now = opts?.now ?? new Date();
  const startTime = now.getTime();
  const endTime = startTime + 7 * DAY_MS;

  const calendars = resolveCalendars();
  const warnings: string[] = [];

  // Fetch each calendar's events; collect (event + program/flow) or a warning.
  const perCalendar = await Promise.all(
    calendars.map(async (cal) => {
      try {
        const events = await getCalendarEvents({ calendarId: cal.calendarId, startTime, endTime });
        return events.map((ev) => ({ ev, cal }));
      } catch {
        warnings.push(`${cal.program} ${cal.flow === 'btm' ? 'BTM' : 'trial'} calendar fetch failed`);
        return [];
      }
    }),
  );
  const rows = perCalendar.flat();

  // N+1 contact-source join, deduped through a request-scoped cache.
  const contactCache = new Map<string, ContactRecord | null>();
  async function resolveContact(contactId: string): Promise<ContactRecord | null> {
    if (contactCache.has(contactId)) return contactCache.get(contactId)!;
    let record: ContactRecord | null = null;
    try {
      record = await getContact(contactId);
    } catch {
      record = null; // contact fetch failure → treated as Unknown source
    }
    contactCache.set(contactId, record);
    return record;
  }

  const appointments: UpcomingAppointment[] = [];
  for (const { ev, cal } of rows) {
    const contactId = ev.contactId ?? null;
    const record = contactId ? await resolveContact(contactId) : null;
    const channel = contactChannel(record);
    appointments.push({
      id: ev.id,
      contactId,
      contactName: contactName(record),
      startTimeISO: ev.startTime ?? '',
      endTimeISO: ev.endTime ?? null,
      program: cal.program,
      flow: cal.flow,
      source: channel ?? 'Unknown',
      status: ev.appointmentStatus ?? '',
    });
  }

  appointments.sort((a, b) => a.startTimeISO.localeCompare(b.startTimeISO));
  return { appointments, warnings };
}

/** Resolve a lead range to its inclusive `since` boundary, given `now`. */
function sinceForRange(range: LeadRange, now: Date): Date {
  switch (range) {
    case '7d':
      return new Date(now.getTime() - 7 * DAY_MS);
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS);
    case '90d':
      return new Date(now.getTime() - 90 * DAY_MS);
    case 'mtd':
      return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }
}

/**
 * New-contact counts per LeadChannel over the requested window. Each contact is
 * bucketed by native `source` (fallback `lead_source` CF) into one of the 6
 * `LEAD_CHANNELS`; anything else lands in "Other". The result always lists all
 * 6 channels + "Other" (zeros included), sorted descending by count. Percentages
 * are of `total`, safe at total 0 (no divide-by-zero).
 */
export async function getLeadBreakdown(range: LeadRange, opts?: { now?: Date }): Promise<LeadBreakdown> {
  const now = opts?.now ?? new Date();
  const since = sinceForRange(range, now);

  const { contacts, total } = await searchContactsByDateRange({
    startMs: since.getTime(),
    endMs: now.getTime(),
  });

  // Seed every channel (+ Other) at zero so the shape is stable.
  const counts = new Map<string, number>([...LEAD_CHANNELS.map((c) => [c, 0] as const), [OTHER, 0]]);
  for (const c of contacts) {
    const channel = contactChannel(c);
    const bucket = channel ?? OTHER;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const denominator = total > 0 ? total : 0;
  const channels = Array.from(counts.entries())
    .map(([channel, count]) => ({
      channel,
      count,
      pct: denominator > 0 ? Math.round((count / denominator) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return { range, sinceISO: since.toISOString(), total, channels };
}
