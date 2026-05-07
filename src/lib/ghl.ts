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

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-04-15';

export class GhlError extends Error {
  name: string = 'GhlError';
  status: number;
  bodyText: string;
  constructor(status: number, bodyText: string, msg: string) {
    super(msg);
    this.status = status;
    this.bodyText = bodyText;
  }
}

function readEnv(key: string): string | undefined {
  // Astro/Vite exposes .env vars via import.meta.env in dev/build;
  // Vercel injects production env into process.env at runtime.
  // Read both so a single token works everywhere.
  const fromVite = (import.meta.env as Record<string, string | undefined>)[key];
  return fromVite ?? process.env[key];
}

function token(): string {
  const t = readEnv('GHL_PIT_TOKEN');
  if (!t) throw new Error('GHL_PIT_TOKEN env var not set');
  return t;
}
function locationId(): string {
  const l = readEnv('GHL_LOCATION_ID');
  if (!l) throw new Error('GHL_LOCATION_ID env var not set');
  return l;
}

export { readEnv };

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Version: VERSION,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GhlError(res.status, text, `GHL ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

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
  const data = (await request(url)) as Record<string, { slots?: string[] }>;
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
  if (!id) throw new GhlError(500, JSON.stringify(data), 'upsertContact: no contact id in response');
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
    throw new GhlError(500, JSON.stringify(data), `updateOpportunity ${id}: no opportunity in response`);
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
  if (!id) throw new GhlError(500, JSON.stringify(data), 'createAppointment: no id in response');
  return id;
}
