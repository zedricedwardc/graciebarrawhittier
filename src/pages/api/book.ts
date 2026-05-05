import type { APIRoute } from 'astro';
import { BookingRequest, type BookingResponse, type AvailabilitySlot } from '../../lib/booking-types';
import { getProgram, type ProgramKey } from '../../data/programs';
import { upsertContact, createAppointment, getFreeSlots, GhlError } from '../../lib/ghl';
import { generateSlots } from '../../lib/slot-resolver';
import { blackouts } from '../../data/blackouts';

export const prerender = false;

const MIN_DWELL_MS = 3000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 5;
const MIN_LEAD_MINUTES = 60;

// Module-scoped — survives across requests on a warm Fluid Compute instance.
const buckets = new Map<string, { count: number; firstSeen: number }>();

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ ok: false, code: 'INVALID_INPUT' }); }

  const parsed = BookingRequest.safeParse(payload);
  if (!parsed.success) return json({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  // Layer 2 — Honeypot. Silent OK so bots don't learn.
  if (body.website && body.website.length > 0) {
    return json({ ok: true, appointmentId: 'spam-discarded' });
  }

  // Layer 3 — Min dwell time.
  const elapsed = Date.now() - body.ts;
  if (elapsed < MIN_DWELL_MS) {
    return json({ ok: true, appointmentId: 'spam-discarded' });
  }

  // Layer 4 — Per-IP token bucket.
  const ip = clientAddress || 'unknown';
  if (!checkRate(ip)) {
    return json({ ok: false, code: 'RATE_LIMITED' });
  }

  const calendarId = process.env[getProgram(body.program).calendarIdEnvVar];
  if (!calendarId) {
    console.error('[book] missing calendar env var', getProgram(body.program).calendarIdEnvVar);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Calendar not configured.' });
  }

  // Re-validate that the slot is still available.
  const slotMs = Date.parse(body.slotStartISO);
  const windowStart = slotMs - 60_000;
  const windowEnd   = slotMs + 60_000;
  let stillFree: Set<string>;
  try {
    stillFree = await getFreeSlots({ calendarId, startDate: windowStart, endDate: windowEnd });
  } catch (err) {
    console.error('[book] re-validate getFreeSlots failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not verify slot availability.' });
  }
  if (!stillFree.has(body.slotStartISO)) {
    const alternates = nextAlternates(body.program, body.slotStartISO, 3);
    return json({ ok: false, code: 'SLOT_TAKEN', alternates });
  }

  // Write to GHL: contact, then appointment.
  let contactId: string;
  try {
    contactId = await upsertContact({
      firstName: body.parent.firstName,
      lastName:  body.parent.lastName,
      email:     body.parent.email,
      phone:     body.parent.phone,
    });
  } catch (err) {
    console.error('[book] upsertContact failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText, payload: body } : { err, payload: body });
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not create contact.' });
  }

  const endISO = computeEndISO(body.slotStartISO, body.program);
  const traineeName = body.trainee.isSelf ? body.parent.firstName : body.trainee.firstName;
  const title = `${getProgram(body.program).name} trial — ${traineeName} (${body.trainee.age})`;

  let appointmentId: string;
  try {
    appointmentId = await createAppointment({
      calendarId, contactId,
      startISO: body.slotStartISO,
      endISO,
      title,
    });
  } catch (err) {
    console.error('[book] createAppointment failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText, payload: body } : { err, payload: body });
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not create appointment.' });
  }

  return json({ ok: true, appointmentId });
};

function checkRate(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.firstSeen > RATE_WINDOW_MS) {
    buckets.set(ip, { count: 1, firstSeen: now });
    return true;
  }
  if (b.count >= RATE_MAX_PER_WINDOW) return false;
  b.count++;
  return true;
}

function computeEndISO(startISO: string, program: ProgramKey): string {
  // Look up duration from schedule for this program — match by hour/minute/weekday.
  // Cheap fallback: 60 min for adults/juniors, 45 min everything else.
  const duration = program === 'adults' || program === 'juniors' ? 60 : 45;
  const end = new Date(Date.parse(startISO) + duration * 60_000);
  // Preserve original offset suffix.
  const offset = startISO.slice(-6); // "-07:00"
  const local = new Date(end.getTime() + offsetMinutes(offset) * 60_000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth()+1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${offset}`;
}

function offsetMinutes(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  // Safe extraction required by noUncheckedIndexedAccess: split(':') may return
  // fewer elements than expected, so we fall back to 0 for missing parts.
  const parts = offset.slice(1).split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return sign * (h * 60 + m);
}

function nextAlternates(program: ProgramKey, takenStartISO: string, count: number): AvailabilitySlot[] {
  const start = takenStartISO.slice(0, 10);
  const endDate = new Date(Date.parse(`${start}T00:00:00Z`) + 14 * 86_400_000);
  const endStr = endDate.toISOString().slice(0, 10);
  const alts = generateSlots({
    programKey: program,
    fromISODate: start,
    toISODate: endStr,
    bookedStartISOs: new Set([takenStartISO]),
    blackoutDates: new Set(blackouts),
    now: new Date(),
    minLeadMinutes: MIN_LEAD_MINUTES,
  });
  return alts.slice(0, count);
}

function json(body: BookingResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
