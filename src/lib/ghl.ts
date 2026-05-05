/**
 * Server-only GoHighLevel API v2 client.
 * NEVER import this from a component or anywhere reachable by the browser bundle.
 *
 * Endpoints used:
 *   GET  /calendars/{calendarId}/free-slots?startDate=ms&endDate=ms&timezone=America/Los_Angeles
 *   POST /contacts/upsert
 *   POST /calendars/events/appointments
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

function token(): string {
  const t = process.env.GHL_PIT_TOKEN;
  if (!t) throw new Error('GHL_PIT_TOKEN env var not set');
  return t;
}
function locationId(): string {
  const l = process.env.GHL_LOCATION_ID;
  if (!l) throw new Error('GHL_LOCATION_ID env var not set');
  return l;
}

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
