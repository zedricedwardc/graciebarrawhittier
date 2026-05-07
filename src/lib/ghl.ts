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

export async function searchContactByEmailAndLastName(args: {
  email: string;
  lastName: string;
}): Promise<ContactRecord | null> {
  const body = {
    locationId: locationId(),
    pageLimit: 5,
    filters: [
      { field: 'email', operator: 'eq', value: args.email.toLowerCase() },
      { field: 'lastName', operator: 'eq', value: args.lastName },
    ],
  };
  const data = (await request('/contacts/search', {
    method: 'POST',
    body: JSON.stringify(body),
  })) as { contacts?: ContactRecord[] };
  const contact = data.contacts?.[0];
  return contact ?? null;
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

/** Update a contact (custom fields, name, etc.). */
export interface UpdateContactArgs {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
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
