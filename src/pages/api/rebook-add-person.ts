/**
 * POST /api/rebook-add-person
 *
 * Books a brand-new family member's first trial class for an existing
 * active-trial customer, from /rebook. Reuses the parent contact (resolved
 * server-side from contactId) so no parent PII travels in the request body.
 *
 * Auth: the contact-scoped token returned by /api/rebook-lookup or
 * /api/rebook-context — a rebook token whose traineeKey is the reserved
 * CONTACT_SCOPED_TRAINEE_KEY sentinel.
 *
 * Effect: creates the appointment + runs handleBooking(flow:'trial'), which
 * creates a Trial Conversion opp at INTRO BOOKED. Does NOT create a credit
 * pass — that happens later at trial activation.
 *
 * Returns:
 *   { ok: true, trainee: { traineeName, traineeKey, program,
 *                          status: 'pending', nextClassISO } }
 *   | { ok: false, code: 'INVALID_INPUT' | 'INVALID_TOKEN' | 'NOT_FOUND'
 *                       | 'SLOT_TAKEN' | 'RATE_LIMITED' | 'GHL_FAILED',
 *       alternates?, message? }
 */
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import {
  getContact,
  getCalendar,
  getCalendarEvents,
  getFreeSlots,
  createAppointment,
  createAppointmentNote,
  GhlError,
  readEnv,
} from '../../lib/ghl';
import { handleBooking } from '../../lib/ghl-adapter';
import { getProgram, type ProgramKey } from '../../data/programs';
import { generateSlots } from '../../lib/slot-resolver';
import { blackouts } from '../../data/blackouts';
import { verifyRebookToken } from '../../lib/rebook-token';
import { CONTACT_SCOPED_TRAINEE_KEY } from '../../lib/rebook-cards';
import { deriveTraineeKey } from '../../lib/trainee-key';
import type { AvailabilitySlot } from '../../lib/booking-types';
import { appointmentPerSlot, decideSlotCapacity, type SlotCapacityDecision } from '../../lib/slot-capacity';

export const prerender = false;

const MIN_DWELL_MS = 3000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 5;
const MIN_LEAD_MINUTES = 60;

const buckets = new Map<string, { count: number; firstSeen: number }>();

const PROGRAM_KEYS: [ProgramKey, ...ProgramKey[]] = ['tiny', 'lc1', 'lc2', 'juniors', 'adults'];

const AddPersonRequest = z.object({
  contactId: z.string().min(1).max(64),
  sessionToken: z.string().min(20).max(512),
  program: z.enum(PROGRAM_KEYS),
  trainee: z.object({
    firstName: z.string().min(1).max(50),
    age: z.number().int().min(3).max(99),
  }),
  slotStartISO: z.iso.datetime({ offset: true }),
  ts: z.number().int(),
  website: z.string().optional(),
});

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ip = clientAddress || 'unknown';

  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ ok: false, code: 'INVALID_INPUT' }); }
  const parsed = AddPersonRequest.safeParse(payload);
  if (!parsed.success) return json({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  if (body.website && body.website.length > 0) {
    return json({ ok: true, trainee: spamTrainee(body.program) });
  }
  if (Date.now() - body.ts < MIN_DWELL_MS) {
    return json({ ok: true, trainee: spamTrainee(body.program) });
  }
  if (!checkRate(ip)) return json({ ok: false, code: 'RATE_LIMITED' }, 429);

  const verified = verifyRebookToken(body.sessionToken);
  if (!verified.ok) return json({ ok: false, code: 'INVALID_TOKEN' });
  if (
    verified.payload.contactId !== body.contactId ||
    verified.payload.traineeKey !== CONTACT_SCOPED_TRAINEE_KEY
  ) {
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }

  const calendarId = readEnv(getProgram(body.program).calendarIdEnvVar);
  if (!calendarId) {
    console.error('[rebook-add-person] missing calendar env var', getProgram(body.program).calendarIdEnvVar);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Calendar not configured.' });
  }

  let slotDecision: SlotCapacityDecision;
  try {
    slotDecision = await getSlotCapacityDecision({
      calendarId,
      program: body.program,
      slotStartISO: body.slotStartISO,
    });
  } catch (err) {
    console.error('[rebook-add-person] capacity check failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not verify slot availability.' });
  }
  if (!slotDecision.available) {
    return json({ ok: false, code: 'SLOT_TAKEN', alternates: nextAlternates(body.program, body.slotStartISO, 3) });
  }

  let contact;
  try {
    contact = await getContact(body.contactId);
  } catch (err) {
    console.error('[rebook-add-person] getContact failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not load contact.' });
  }
  if (!contact) return json({ ok: false, code: 'NOT_FOUND', message: 'Contact not found.' });

  const parent = {
    firstName: contact.firstName ?? '',
    lastName:  contact.lastName  ?? '',
    email:     contact.email     ?? '',
    phone:     contact.phone     ?? '',
  };

  const endISO = computeEndISO(body.slotStartISO, body.program);
  const traineeName = body.trainee.firstName.trim();
  const title = `${getProgram(body.program).name} trial — ${traineeName} (${body.trainee.age})`;

  let appointmentId: string;
  try {
    appointmentId = await createAppointment({
      calendarId,
      contactId: body.contactId,
      startISO: body.slotStartISO,
      endISO,
      title,
      ignoreFreeSlotValidation: slotDecision.requiresFreeSlotOverride,
    });
  } catch (err) {
    console.error('[rebook-add-person] createAppointment failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not create appointment.' });
  }

  try {
    await createAppointmentNote(appointmentId, [
      title, '',
      `When: ${formatWhen(body.slotStartISO)}`, '',
      `Parent: ${`${parent.firstName} ${parent.lastName}`.trim()}`,
      `Phone: ${parent.phone}`,
      `Email: ${parent.email}`,
      '', 'Added via /rebook (add a new person).',
    ].join('\n'));
  } catch (err) {
    console.warn('[rebook-add-person] createAppointmentNote failed (non-fatal)',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
  }

  try {
    await handleBooking({
      contactId: body.contactId,
      appointmentId,
      parent,
      trainee: { firstName: traineeName, age: body.trainee.age, isSelf: false },
      program: body.program,
      programName: getProgram(body.program).name,
      slotStartISO: body.slotStartISO,
      slotEndISO: endISO,
      flow: 'trial',
    });
  } catch (err) {
    console.error('[rebook-add-person] handleBooking failed (appointment did succeed)',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
  }

  const traineeKey = deriveTraineeKey({
    isSelf: false,
    firstName: traineeName,
    lastName: parent.lastName,
  });

  return json({
    ok: true,
    trainee: {
      traineeName,
      traineeKey,
      program: body.program,
      status: 'pending' as const,
      nextClassISO: body.slotStartISO,
    },
  });
};

function spamTrainee(program: ProgramKey) {
  return { traineeName: '', traineeKey: 'spam-discarded', program, status: 'pending' as const, nextClassISO: null };
}

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

function offsetMinutes(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  const parts = offset.slice(1).split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  return sign * (h * 60 + m);
}

function computeEndISO(startISO: string, program: ProgramKey): string {
  const duration = program === 'adults' || program === 'juniors' ? 60 : 45;
  const end = new Date(Date.parse(startISO) + duration * 60_000);
  const offset = startISO.slice(-6);
  const local = new Date(end.getTime() + offsetMinutes(offset) * 60_000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${offset}`;
}

function nextAlternates(program: ProgramKey, takenStartISO: string, count: number): AvailabilitySlot[] {
  const start = takenStartISO.slice(0, 10);
  const endDate = new Date(Date.parse(`${start}T00:00:00Z`) + 14 * 86_400_000);
  return generateSlots({
    programKey: program,
    fromISODate: start,
    toISODate: endDate.toISOString().slice(0, 10),
    bookedStartISOs: new Set([takenStartISO]),
    blackoutDates: new Set(blackouts),
    now: new Date(),
    minLeadMinutes: MIN_LEAD_MINUTES,
  }).slice(0, count);
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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
  return decideSlotCapacity({
    slot: {
      startISO: args.slotStartISO,
      endISO: computeEndISO(args.slotStartISO, args.program),
      label: args.slotStartISO,
    },
    events,
    freeStartISOs,
    appointmentPerSlot: appointmentPerSlot(calendar?.appointmentPerSlot),
  });
}
