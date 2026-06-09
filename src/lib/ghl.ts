/**
 * Server-only GoHighLevel API v2 client.
 * NEVER import this from a component or anywhere reachable by the browser bundle.
 *
 * Endpoints used:
 *   GET  /calendars/{calendarId}/free-slots?startDate=ms&endDate=ms&timezone=America/Los_Angeles
 *   POST /contacts/upsert
 *   POST /contacts/search
 *   POST /calendars/events/appointments
 *   GET  /opportunities/search
 *
 * VERIFY: payload shapes must be validated against the GBW sub-account
 * before this is trusted in production.
 */

// Auth + transport are owned by ghl-rate-limit. We re-export GhlError so existing
// callers don't have to change imports, and we provide a thin `request()` shim
// for code that still uses the old method/body convention.
import { ghlFetch, GhlError as RateLimitGhlError } from './ghl-rate-limit';

export const GhlError = RateLimitGhlError;
export type GhlError = InstanceType<typeof RateLimitGhlError>;

export function readEnv(key: string): string | undefined {
  const fromVite = (import.meta.env as Record<string, string | undefined>)[key];
  return fromVite ?? process.env[key];
}

function locationId(): string {
  const l = readEnv('GHL_LOCATION_ID');
  if (!l) throw new Error('GHL_LOCATION_ID env var not set');
  return l;
}

/**
 * Legacy request shim — delegates to ghlFetch. Kept so the existing call sites
 * in this file work unchanged. New code should call ghlFetch directly.
 *
 * Calendar endpoints use Version `2021-04-15`; everything else uses the wrapper's
 * DEFAULT_VERSION. Pass `version` to override per-call.
 */
async function request(
  path: string,
  init: RequestInit & { version?: string } = {},
): Promise<unknown> {
  const method = (init.method as 'GET' | 'POST' | 'PUT' | 'DELETE') ?? 'GET';
  const body = typeof init.body === 'string' ? init.body : undefined;
  return ghlFetch(path, {
    method,
    body,
    version: init.version,
    headers: init.headers as Record<string, string> | undefined,
  });
}

// Calendar endpoints require this older API version (per existing test contract).
const CALENDAR_VERSION = '2021-04-15';

// ── Free slots ───────────────────────────────────────────────────────────
export interface GetFreeSlotsArgs {
  calendarId: string;
  startDate: number; // epoch ms
  endDate: number;   // epoch ms
}

/**
 * GHL returns free slots as `{ "<YYYY-MM-DD>": { "slots": [iso, iso, ...] } }`.
 * We flatten to a Set of ISO start strings.
 */
export async function getFreeSlots(args: GetFreeSlotsArgs): Promise<Set<string>> {
  const { calendarId, startDate, endDate } = args;
  const url =
    `/calendars/${encodeURIComponent(calendarId)}/free-slots` +
    `?startDate=${startDate}&endDate=${endDate}` +
    `&timezone=${encodeURIComponent('America/Los_Angeles')}`;
  const data = (await request(url, { version: CALENDAR_VERSION })) as Record<string, { slots?: string[] }>;
  const out = new Set<string>();
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('_')) continue; // skip envelope keys like "_dates_"
    if (Array.isArray(v?.slots)) for (const s of v.slots) out.add(s);
  }
  return out;
}

// ── Contacts ─────────────────────────────────────────────────────────────
export interface UpsertContactArgs {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  marketingConsent?: boolean;
  /**
   * GHL native contact `source` attribute. Drives the native Lead Source
   * report on the studio dashboard. Pass a `LeadChannel` value (e.g. "Website Leads").
   * Last-touch: an upsert of an existing contact overwrites their prior source.
   */
  source?: string;
}

export async function upsertContact(args: UpsertContactArgs): Promise<string> {
  const data = (await request('/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify({
      locationId: locationId(),
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      phone: args.phone,
      ...(args.source ? { source: args.source } : {}),
      // Tag for source visibility in GHL UI:
      tags: ['kickstart-funnel'],
    }),
  })) as { contact?: { id?: string }; id?: string };
  const id = data?.contact?.id ?? data?.id;
  if (!id) {
    throw new GhlError(500, JSON.stringify(data), '/contacts/upsert', 'upsertContact: no contact id in response');
  }
  return id;
}

/**
 * Search for a contact by email + lastName (used by /api/rebook-lookup).
 * Returns the contact's full record + custom fields, or null if no match.
 *
 * GHL `/contacts/search` is a POST with filter array. We require BOTH email
 * AND lastName to match — raises enumeration cost vs. email-only.
 */
export interface ContactRecord {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  customFields?: Array<{ id: string; key?: string; value?: unknown; field_value?: unknown }>;
}

/**
 * Search for a contact by email only. Returns the first match, or null.
 * Used by the /rebook lookup flow: parent enters email + trainee's first name,
 * we resolve the contact by email and disambiguate the trainee via the
 * Credit Monitoring opp's `trainee_first_name` CF.
 */
export async function searchContactByEmail(email: string): Promise<ContactRecord | null> {
  const body = {
    locationId: locationId(),
    pageLimit: 5,
    filters: [{ field: 'email', operator: 'eq', value: email.toLowerCase() }],
  };
  const data = (await request('/contacts/search', {
    method: 'POST',
    body: JSON.stringify(body),
  })) as { contacts?: ContactRecord[] };
  return data.contacts?.[0] ?? null;
}

export async function searchContactByEmailAndLastName(args: {
  email: string;
  lastName: string;
}): Promise<ContactRecord | null> {
  // GHL's `/contacts/search` with `lastName eq` returns 0 results in practice;
  // `contains` works. Exact-match client-side to keep the contract tight.
  const body = {
    locationId: locationId(),
    pageLimit: 20,
    filters: [
      { field: 'email', operator: 'eq', value: args.email.toLowerCase() },
      { field: 'lastName', operator: 'contains', value: args.lastName },
    ],
  };
  const data = (await request('/contacts/search', {
    method: 'POST',
    body: JSON.stringify(body),
  })) as { contacts?: ContactRecord[] };
  const wanted = args.lastName.trim().toLowerCase();
  const match = (data.contacts ?? []).find(
    (c) => (c.lastName ?? '').trim().toLowerCase() === wanted,
  );
  return match ?? null;
}

// ── Opportunities ────────────────────────────────────────────────────────
export interface OpportunityRecord {
  id: string;
  name?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: 'open' | 'won' | 'lost' | 'abandoned';
  contactId?: string;
  customFields?: Array<{ id: string; key?: string; value?: unknown; field_value?: unknown }>;
}

/**
 * Search opportunities for a contact within a pipeline (optionally filtered to open).
 * Used by the rebook flow to detect existing Trial Conversion / Trial Credit Monitoring
 * opportunities for the contact, so we can update in place rather than create duplicates.
 */
/**
 * Fetch a single opportunity by ID. Used by webhook handlers to read the
 * opp's CFs (trainee_key, program, etc.) directly rather than trusting
 * workflow merge tags, which can silently fall back to contact-level values
 * that collide across siblings.
 */
export async function getOpportunity(oppId: string): Promise<OpportunityRecord | null> {
  try {
    const data = (await request(`/opportunities/${encodeURIComponent(oppId)}`)) as {
      opportunity?: OpportunityRecord;
    };
    return data.opportunity ?? null;
  } catch (err) {
    if (err instanceof GhlError && err.status === 404) return null;
    throw err;
  }
}

export async function searchOpportunities(args: {
  contactId: string;
  pipelineId?: string;
  status?: 'open' | 'won' | 'lost' | 'abandoned' | 'all';
  limit?: number;
}): Promise<OpportunityRecord[]> {
  const params = new URLSearchParams({
    location_id: locationId(),
    contact_id: args.contactId,
    limit: String(args.limit ?? 20),
  });
  if (args.pipelineId) params.set('pipeline_id', args.pipelineId);
  if (args.status && args.status !== 'all') params.set('status', args.status);
  const data = (await request(`/opportunities/search?${params.toString()}`)) as {
    opportunities?: OpportunityRecord[];
  };
  return data.opportunities ?? [];
}

/**
 * Update an opportunity. Supports stage move (within or across pipelines),
 * status change, name change, and custom field updates in a single call.
 *
 * customFields accepts either `{ id }` or `{ key }` to identify the field.
 * Pass either a value via `field_value` (GHL's preferred name) or `value`.
 */
export interface UpdateOpportunityArgs {
  pipelineId?: string;
  pipelineStageId?: string;
  status?: 'open' | 'won' | 'lost' | 'abandoned';
  name?: string;
  monetaryValue?: number;
  customFields?: Array<
    | { id: string; field_value: string | number | boolean | null }
    | { key: string; field_value: string | number | boolean | null }
  >;
}

export async function updateOpportunity(id: string, patch: UpdateOpportunityArgs): Promise<OpportunityRecord> {
  const data = (await request(`/opportunities/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })) as { opportunity?: OpportunityRecord };
  if (!data.opportunity) {
    throw new GhlError(
      500,
      JSON.stringify(data),
      `/opportunities/${id}`,
      `updateOpportunity ${id}: no opportunity in response`,
    );
  }
  return data.opportunity;
}

/** Fetch a contact by ID. Returns null if not found (404). */
export async function getContact(contactId: string): Promise<ContactRecord | null> {
  try {
    const data = (await request(`/contacts/${encodeURIComponent(contactId)}`)) as {
      contact?: ContactRecord;
    };
    return data.contact ?? null;
  } catch (err) {
    if (err instanceof GhlError && err.status === 404) return null;
    throw err;
  }
}

export interface CalendarRecord {
  id: string;
  name?: string;
  calendarType?: string;
  appointmentPerSlot?: number | string;
}

export async function getCalendar(calendarId: string): Promise<CalendarRecord | null> {
  try {
    const data = (await request(
      `/calendars/${encodeURIComponent(calendarId)}`,
      { version: CALENDAR_VERSION },
    )) as { calendar?: CalendarRecord } & CalendarRecord;
    if (data.calendar) return data.calendar;
    if (data.id) return data;
    return null;
  } catch (err) {
    if (err instanceof GhlError && err.status === 404) return null;
    throw err;
  }
}

/** Update a contact (custom fields, name, etc.). */
export interface UpdateContactArgs {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  /**
   * GHL native contact `source` attribute. Unlike `/contacts/upsert` — which
   * only sets `source` when *creating* a contact — this PUT reliably overwrites
   * it on existing contacts too. Set it here to guarantee the native Lead
   * Source value lands regardless of whether the contact already existed.
   */
  source?: string;
  customFields?: Array<{ id: string; field_value: string | number | boolean | null }>;
}

export async function updateContact(contactId: string, patch: UpdateContactArgs): Promise<ContactRecord> {
  const data = (await request(`/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })) as { contact?: ContactRecord };
  if (!data.contact) {
    throw new GhlError(500, JSON.stringify(data), `/contacts/${contactId}`, 'updateContact: no contact in response');
  }
  return data.contact;
}

/** Add tags to a contact. Idempotent; GHL dedupes. */
export async function addContactTags(contactId: string, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  await request(`/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tags }),
  });
}

/** Remove tags from a contact. */
export async function removeContactTags(contactId: string, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  await request(`/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: 'DELETE',
    body: JSON.stringify({ tags }),
  });
}

/**
 * Add contact to a workflow (programmatic enrollment).
 * No-op if workflowId is empty (so Phase 2 can run before all workflows are wired).
 */
export async function addContactToWorkflow(contactId: string, workflowId: string): Promise<void> {
  if (!workflowId) return;
  await request(`/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Remove contact from a workflow. No-op if workflowId empty. */
export async function removeContactFromWorkflow(contactId: string, workflowId: string): Promise<void> {
  if (!workflowId) return;
  await request(`/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`, {
    method: 'DELETE',
  });
}

/** Add a note on a contact for audit trail. */
export async function addContactNote(contactId: string, body: string): Promise<void> {
  await request(`/contacts/${encodeURIComponent(contactId)}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

/**
 * Permanently delete an opportunity. Used by handleBtmBooking() to remove
 * the parent's FORMER STUDENT opp once a per-trainee booking happens
 * (trainee opp replaces it). Cannot be undone via API — caller should be sure.
 *
 * Returns void on success. Logs (non-fatal) on 404 — the opp is already gone.
 */
export async function deleteOpportunity(opportunityId: string): Promise<void> {
  await request(`/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'DELETE',
  });
}

// ── Opportunity create ───────────────────────────────────────────────────

export interface CreateOpportunityArgs {
  pipelineId: string;
  pipelineStageId: string;
  contactId: string;
  name: string;
  status?: 'open' | 'won' | 'lost' | 'abandoned';
  monetaryValue?: number;
  source?: string;
  customFields?: Array<{ id: string; field_value: string | number | boolean | null }>;
}

export async function createOpportunity(args: CreateOpportunityArgs): Promise<OpportunityRecord> {
  const data = (await request('/opportunities/', {
    method: 'POST',
    body: JSON.stringify({
      locationId: locationId(),
      pipelineId: args.pipelineId,
      pipelineStageId: args.pipelineStageId,
      contactId: args.contactId,
      name: args.name,
      status: args.status ?? 'open',
      monetaryValue: args.monetaryValue ?? 0,
      source: args.source,
      customFields: args.customFields,
    }),
  })) as { opportunity?: OpportunityRecord };
  if (!data.opportunity) {
    throw new GhlError(500, JSON.stringify(data), '/opportunities/', 'createOpportunity: no opportunity in response');
  }
  return data.opportunity;
}

// ── Appointments ─────────────────────────────────────────────────────────
export interface CreateAppointmentArgs {
  calendarId: string;
  contactId: string;
  startISO: string;
  endISO: string;
  title: string;
  ignoreFreeSlotValidation?: boolean;
  assignedUserId?: string;
}

export async function createAppointment(args: CreateAppointmentArgs): Promise<string> {
  const data = (await request('/calendars/events/appointments', {
    method: 'POST',
    version: CALENDAR_VERSION,
    body: JSON.stringify({
      calendarId: args.calendarId,
      locationId: locationId(),
      contactId: args.contactId,
      startTime: args.startISO,
      endTime: args.endISO,
      title: args.title,
      appointmentStatus: 'confirmed',
      toNotify: true, // fire native confirmation email/SMS
      ...(args.ignoreFreeSlotValidation ? { ignoreFreeSlotValidation: true } : {}),
      ...(args.assignedUserId ? { assignedUserId: args.assignedUserId } : {}),
    }),
  })) as { id?: string; appointment?: { id?: string } };
  const id = data?.id ?? data?.appointment?.id;
  if (!id) {
    throw new GhlError(
      500,
      JSON.stringify(data),
      '/calendars/events/appointments',
      'createAppointment: no id in response',
    );
  }
  return id;
}

/**
 * Cancel an appointment by flipping its status to "cancelled". GHL's native
 * appointment-trigger automations remove the cancelled appointment from its
 * reminder workflow run — appointment-scoped, so other appointments for the
 * same contact are unaffected. Used by the rebook flow to retire the prior
 * appointment when a trainee reschedules.
 */
export async function cancelAppointment(appointmentId: string): Promise<void> {
  await request(`/calendars/events/appointments/${appointmentId}`, {
    method: 'PUT',
    version: CALENDAR_VERSION,
    body: JSON.stringify({ appointmentStatus: 'cancelled' }),
  });
}

export interface CalendarEventRecord {
  id: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  calendarId?: string;
  contactId?: string;
  appointmentStatus?: string;
  assignedUserId?: string;
}

export async function getCalendarEvents(args: {
  calendarId: string;
  startTime: number;
  endTime: number;
}): Promise<CalendarEventRecord[]> {
  const params = new URLSearchParams({
    locationId: locationId(),
    calendarId: args.calendarId,
    startTime: String(args.startTime),
    endTime: String(args.endTime),
  });
  const data = (await request(
    `/calendars/events?${params.toString()}`,
    { version: CALENDAR_VERSION },
  )) as { events?: CalendarEventRecord[] };
  return data.events ?? [];
}

export interface AppointmentRecord {
  id: string;
  startTime?: string;
  endTime?: string;
  calendarId?: string;
  contactId?: string;
  appointmentStatus?: string;
}

/**
 * Fetch an appointment by ID. The bot-booking webhook uses this to read the
 * appointment's real ISO startTime/endTime: GHL's {{appointment.start_time}}
 * merge tag renders a locale-formatted string ("Tuesday, May 19, 2026 5:00 PM")
 * that is NOT a valid value for an opportunity DATE custom field.
 */
export async function getAppointment(appointmentId: string): Promise<AppointmentRecord | null> {
  try {
    const data = (await request(
      `/calendars/events/appointments/${encodeURIComponent(appointmentId)}`,
      { version: CALENDAR_VERSION },
    )) as { event?: AppointmentRecord; appointment?: AppointmentRecord; id?: string; startTime?: string };
    if (data.event?.startTime) return data.event;
    if (data.appointment?.startTime) return data.appointment;
    if (data.id && data.startTime) return data as AppointmentRecord;
    return null;
  } catch (err) {
    if (err instanceof GhlError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Add a note to an appointment so it appears in the appointment's Notes tab.
 * Distinct from contact notes (which live on the contact, not the appointment).
 * Used by /api/book to write structured booking details right after the
 * appointment is created — replaces the workflow-driven note that was
 * rendering "Date:" blank from a bad merge field.
 */
export async function createAppointmentNote(appointmentId: string, body: string): Promise<void> {
  await request(`/calendars/appointments/${encodeURIComponent(appointmentId)}/notes`, {
    method: 'POST',
    version: CALENDAR_VERSION,
    body: JSON.stringify({ body }),
  });
}
