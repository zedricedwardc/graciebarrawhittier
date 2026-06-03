import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import {
  BookingRequest,
  RebookBookingRequest,
  type BookingResponse,
  type AvailabilitySlot,
} from '../../lib/booking-types';
import { getProgram, getCalendarIdEnvVar, type ProgramKey } from '../../data/programs';
import {
  upsertContact,
  createAppointment,
  createAppointmentNote,
  getCalendar,
  getCalendarEvents,
  getFreeSlots,
  getContact,
  GhlError,
  readEnv,
} from '../../lib/ghl';
import { handleBooking, exitNurtureWorkflows, toAcademyLocalDate } from '../../lib/ghl-adapter';
import { findOpps, findByTraineeKey, moveStage, getOppCfValueByKey } from '../../lib/ghl-opportunities';
import { cfPayload } from '../../lib/ghl-custom-fields';
import { generateSlots } from '../../lib/slot-resolver';
import { appointmentPerSlot, decideSlotCapacity, type SlotCapacityDecision } from '../../lib/slot-capacity';
import { blackouts } from '../../data/blackouts';
import { verifyRebookToken } from '../../lib/rebook-token';

function redactBookingForLog(b: BookingRequest): Record<string, unknown> {
  const emailHash = createHash('sha256').update(b.parent.email).digest('hex').slice(0, 12);
  return {
    program: b.program,
    slotStartISO: b.slotStartISO,
    parent: { emailHash, hasPhone: Boolean(b.parent.phone), hasName: Boolean(b.parent.firstName && b.parent.lastName) },
    trainee: { age: b.trainee.age, isSelf: b.trainee.isSelf },
  };
}

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

  // ─── Branch: rebook (active-trial student) vs. initial booking ─────────
  // Rebook payload has a `rebook` object; initial booking has `parent` + `trainee`.
  // We dispatch by trying RebookBookingRequest first when `rebook` field exists.
  if (payload && typeof payload === 'object' && 'rebook' in (payload as Record<string, unknown>)) {
    return handleRebook(payload, clientAddress || 'unknown');
  }

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

  const calendarEnvVar = getCalendarIdEnvVar(body.program, body.flow);
  const calendarId = readEnv(calendarEnvVar);
  if (!calendarId) {
    console.error('[book] missing calendar env var', calendarEnvVar);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Calendar not configured.' });
  }

  // Re-validate that the class still has capacity.
  let slotDecision: SlotCapacityDecision;
  try {
    slotDecision = await getSlotCapacityDecision({
      calendarId,
      program: body.program,
      slotStartISO: body.slotStartISO,
    });
  } catch (err) {
    console.error('[book] re-validate capacity failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not verify slot availability.' });
  }
  if (!slotDecision.available) {
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
      err instanceof GhlError ? { status: err.status, body: err.bodyText, ctx: redactBookingForLog(body) } : { err, ctx: redactBookingForLog(body) });
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not create contact.' });
  }

  const endISO = computeEndISO(body.slotStartISO, body.program);
  const traineeName = body.trainee.isSelf ? body.parent.firstName : body.trainee.firstName;
  const titleVerb = body.flow === 'btm' ? 're-enroll' : 'trial';
  const title = `${getProgram(body.program).name} ${titleVerb} — ${traineeName} (${body.trainee.age})`;

  let appointmentId: string;
  try {
    appointmentId = await createAppointment({
      calendarId, contactId,
      startISO: body.slotStartISO,
      endISO,
      title,
      ignoreFreeSlotValidation: slotDecision.requiresFreeSlotOverride,
      assignedUserId: slotDecision.assignedUserId,
    });
  } catch (err) {
    console.error('[book] createAppointment failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText, ctx: redactBookingForLog(body) } : { err, ctx: redactBookingForLog(body) });
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not create appointment.' });
  }

  // Write a structured appointment note (replaces the old GHL workflow note
  // step that was rendering "Date:" blank). Non-fatal — booking is already
  // confirmed if this fails.
  try {
    await createAppointmentNote(appointmentId, formatBookingNote({
      title,
      slotStartISO: body.slotStartISO,
      parent: body.parent,
    }));
  } catch (err) {
    console.warn('[book] createAppointmentNote failed (non-fatal)',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
  }

  // Phase 3: dispatch to ghl-adapter for opportunity orchestration
  // (replaces the legacy fire-and-forget GHL_APPOINTMENT_WEBHOOK_URL).
  let opportunityId: string | undefined;
  let isRebook = false;
  try {
    const result = await handleBooking({
      contactId,
      appointmentId,
      parent: body.parent,
      trainee: {
        firstName: body.trainee.firstName,
        age: body.trainee.age,
        isSelf: body.trainee.isSelf,
      },
      program: body.program,
      programName: getProgram(body.program).name,
      slotStartISO: body.slotStartISO,
      slotEndISO: endISO,
      flow: body.flow,
    });
    opportunityId = result.opportunityId;
    isRebook = result.isRebook;
  } catch (err) {
    // Appointment was created; opp orchestration failed. Log and return success
    // so the user sees the booking confirmation. Backflow webhooks (Phase 4)
    // can reconcile, OR admin can verify manually.
    console.error('[book] handleBooking failed (appointment did succeed)',
      err instanceof GhlError ? { status: err.status, body: err.bodyText, path: err.path } : err);
  }

  return json({ ok: true, appointmentId, opportunityId, isRebook });
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

function formatBookingNote(args: {
  title: string;
  slotStartISO: string;
  parent: { firstName: string; lastName: string; email: string; phone: string };
}): string {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(args.slotStartISO));
  const parentName = `${args.parent.firstName} ${args.parent.lastName}`.trim();
  return [
    args.title,
    '',
    `When: ${when}`,
    '',
    `Parent: ${parentName}`,
    `Phone: ${args.parent.phone}`,
    `Email: ${args.parent.email}`,
  ].join('\n');
}

// ─── Rebook flow (active-trial student) ──────────────────────────────────
/**
 * Handles bookings from /rebook.astro for customers who already have an active
 * trial credit pass. Skips the contact-create step (contact already exists),
 * verifies the session token from /api/rebook-context or /api/rebook-lookup,
 * creates the appointment, then updates the existing Trial Credit Monitoring
 * opportunity to ANOTHER TRIAL BOOKED.
 *
 * Does NOT create a new Trial Conversion opportunity — the credit opp tracks
 * usage of the existing trial pass.
 */
async function handleRebook(payload: unknown, ip: string): Promise<Response> {
  const parsed = RebookBookingRequest.safeParse(payload);
  if (!parsed.success) return json({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  // Honeypot + dwell-time + rate-limit (parity with initial booking).
  if (body.website && body.website.length > 0) {
    return json({ ok: true, appointmentId: 'spam-discarded', isRebook: true });
  }
  const elapsed = Date.now() - body.ts;
  if (elapsed < MIN_DWELL_MS) {
    return json({ ok: true, appointmentId: 'spam-discarded', isRebook: true });
  }
  if (!checkRate(ip)) {
    return json({ ok: false, code: 'RATE_LIMITED' });
  }

  // Verify the session token. Confirms contactId + traineeKey haven't been forged.
  const verified = verifyRebookToken(body.rebook.sessionToken);
  if (!verified.ok) {
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }
  if (verified.payload.contactId !== body.rebook.contactId ||
      verified.payload.traineeKey !== body.rebook.traineeKey) {
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }

  // Resolve calendar for program.
  const calendarId = readEnv(getProgram(body.program).calendarIdEnvVar);
  if (!calendarId) {
    console.error('[book/rebook] missing calendar env var', getProgram(body.program).calendarIdEnvVar);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Calendar not configured.' });
  }

  // Re-validate slot capacity (parity with initial booking).
  let slotDecision: SlotCapacityDecision;
  try {
    slotDecision = await getSlotCapacityDecision({
      calendarId,
      program: body.program,
      slotStartISO: body.slotStartISO,
    });
  } catch (err) {
    console.error('[book/rebook] re-validate capacity failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not verify slot availability.' });
  }
  if (!slotDecision.available) {
    const alternates = nextAlternates(body.program, body.slotStartISO, 3);
    return json({ ok: false, code: 'SLOT_TAKEN', alternates });
  }

  // Confirm the contact still exists (defensive — token might be stale).
  let contact;
  try {
    contact = await getContact(body.rebook.contactId);
  } catch (err) {
    console.error('[book/rebook] getContact failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not load contact.' });
  }
  if (!contact) {
    return json({ ok: false, code: 'NOT_FOUND', message: 'Contact not found.' });
  }

  // Find the matching Trial Credit Monitoring opportunity for this trainee.
  // Uses schema-resolved IDs via findOpps (no per-stage env vars).
  let creditOpp;
  try {
    const opps = await findOpps({
      contactId: body.rebook.contactId,
      pipelineKey: 'CREDIT_MON',
      status: 'open',
    });
    creditOpp = await findByTraineeKey(opps, body.rebook.traineeKey);
  } catch (err) {
    console.error('[book/rebook] findOpps failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not find active trial pass.' });
  }
  if (!creditOpp) {
    return json({ ok: false, code: 'NOT_FOUND', message: 'No active trial pass for this trainee.' });
  }

  // Create the appointment. Title carries the trainee name from the credit opp.
  const traineeName =
    (await getOppCfValueByKey<string>(creditOpp, 'trainee_first_name')) ??
    contact.firstName ??
    'Trainee';
  const endISO = computeEndISO(body.slotStartISO, body.program);
  const title = `${getProgram(body.program).name} (rebook) — ${traineeName}`;

  let appointmentId: string;
  try {
    appointmentId = await createAppointment({
      calendarId,
      contactId: body.rebook.contactId,
      startISO: body.slotStartISO,
      endISO,
      title,
      ignoreFreeSlotValidation: slotDecision.requiresFreeSlotOverride,
      assignedUserId: slotDecision.assignedUserId,
    });
  } catch (err) {
    console.error('[book/rebook] createAppointment failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not create appointment.' });
  }

  try {
    await createAppointmentNote(appointmentId, formatBookingNote({
      title,
      slotStartISO: body.slotStartISO,
      parent: {
        firstName: contact.firstName ?? '',
        lastName:  contact.lastName  ?? '',
        email:     contact.email     ?? '',
        phone:     contact.phone     ?? '',
      },
    }));
  } catch (err) {
    console.warn('[book/rebook] createAppointmentNote failed (non-fatal)',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
  }

  // Update the credit opp: move to ANOTHER TRIAL BOOKED + record appointment.
  try {
    const cfs = await cfPayload('opportunity', {
      last_appointment_id: appointmentId,
      last_appointment_start_iso: body.slotStartISO,
      appointment_date: toAcademyLocalDate(body.slotStartISO),
    });
    await moveStage({
      oppId: creditOpp.id,
      pipelineKey: 'CREDIT_MON',
      stageName: 'ANOTHER TRIAL BOOKED',
      customFields: cfs,
    });
  } catch (err) {
    // Appointment was created — opp update failure is logged but not fatal for the user.
    // Backflow webhook will reconcile, OR admin can move manually.
    console.error('[book/rebook] moveStage failed (appointment did succeed)',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
  }

  await exitNurtureWorkflows(body.rebook.contactId, 'credit');

  return json({
    ok: true,
    appointmentId,
    opportunityId: creditOpp.id,
    isRebook: true,
  });
}

async function getSlotCapacityDecision(args: {
  calendarId: string;
  program: ProgramKey;
  slotStartISO: string;
}): Promise<SlotCapacityDecision> {
  const slotMs = Date.parse(args.slotStartISO);
  const [calendar, events] = await Promise.all([
    getCalendar(args.calendarId),
    getCalendarEvents({
      calendarId: args.calendarId,
      startTime: slotMs - 60_000,
      endTime: slotMs + 60_000,
    }),
  ]);
  const freeStartISOs = await getFreeSlots({
    calendarId: args.calendarId,
    startDate: slotMs - 60_000,
    endDate: slotMs + 60_000,
  });
  const endISO = computeEndISO(args.slotStartISO, args.program);
  return decideSlotCapacity({
    slot: { startISO: args.slotStartISO, endISO, label: args.slotStartISO },
    events,
    freeStartISOs,
    appointmentPerSlot: appointmentPerSlot(calendar?.appointmentPerSlot),
  });
}
