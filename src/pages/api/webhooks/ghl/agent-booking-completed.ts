/**
 * POST /api/webhooks/ghl/agent-booking-completed
 *
 * Backflow hook for the SMS AI booking agent. Fired by a GHL Workflow with
 * trigger:
 *   "Workflow Triggered" (invoked from the bot's `Trigger a Workflow` action
 *   at the end of its appointment-booking sequence)
 *
 * Headers: X-GBW-Secret
 *
 * Purpose:
 *   The bot creates an appointment via GHL's native Appointment Booking
 *   action, which bypasses /api/book — so none of the pipeline orchestration
 *   in handleBooking() runs. This webhook bridges that gap: it receives the
 *   appointment + trainee data the bot captured, then calls handleBooking()
 *   to create the Trial Conversion opp, move the Lead Acquisition opp to
 *   INTRO BOOKED (WON), set trainee CFs, and add audit notes.
 *
 * Behavior:
 *   - Idempotent on (appointment_id, trainee_key) for 60s — replays no-op
 *   - Derives program from age (overrides whatever calendar the bot used)
 *   - If contact has `back-to-the-mats-import` tag: log warning + still
 *     orchestrate as trial (bot is trial-only; BTM bookings should go
 *     through the /back-to-the-mats page). Admin can manually clean up.
 *   - Tags the contact `source-agent-booking` for funnel attribution
 *
 * Always returns 200 with ok:false on logical errors so GHL doesn't retry
 * indefinitely. Returns 401 only on auth failure.
 */

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { verifyGhlWebhook } from '../../../../lib/webhook-secrets';
import { handleBooking } from '../../../../lib/ghl-adapter';
import { getContact, addContactTags } from '../../../../lib/ghl';
import { findOpps } from '../../../../lib/ghl-opportunities';
import { idempotency } from '../../../../lib/idempotency';
import { GhlError } from '../../../../lib/ghl-rate-limit';
import type { ProgramKey } from '../../../../data/programs';

export const prerender = false;

const AgentBookingPayload = z.object({
  appointment_id: z.string().min(1),
  contact_id: z.string().min(1),
  appointment_start_iso: z.string().min(1),
  /** Optional — only present if the bot booked for the contact themselves. */
  is_self: z.boolean().optional(),
  /** Trainee first name. For self-bookings, leave empty or set to contact's first name. */
  child_name: z.string().optional(),
  /** Trainee age as a number 3-99. Numeric string accepted too. */
  child_age: z.union([z.number(), z.string()]).optional(),
  /** GHL appointment.date_created or workflow firing time. Used for idempotency. */
  ts: z.union([z.string(), z.number()]).optional(),
});

/**
 * Normalize the raw webhook payload — GHL's workflow webhook delivers a
 * layered shape:
 *   - Top-level: appointment + contact native fields
 *   - customData: whatever the workflow webhook config maps via merge tags
 *
 * Prefer customData (lets the workflow override the natives), fall back to
 * top-level so the integration works even with sparse customData mapping.
 * Unparsed merge tags like "{{appointment.id}}" are rejected (the merge
 * field didn't resolve — workflow misconfig).
 */
function normalizePayload(raw: unknown): Record<string, string | number | boolean> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cd = (r.customData && typeof r.customData === 'object' ? r.customData : {}) as Record<string, unknown>;
  const a = (r.appointment && typeof r.appointment === 'object' ? r.appointment : {}) as Record<string, unknown>;
  const c = (r.contact && typeof r.contact === 'object' ? r.contact : {}) as Record<string, unknown>;

  const pickStr = (...specs: Array<{ from: 'cd' | 'top' | 'a' | 'c'; key: string }>): string => {
    for (const { from, key } of specs) {
      const src = from === 'cd' ? cd : from === 'a' ? a : from === 'c' ? c : r;
      const v = src[key];
      if (typeof v === 'string') {
        const t = v.trim();
        if (t && !t.includes('{{')) return t;
      } else if (typeof v === 'number') {
        return String(v);
      }
    }
    return '';
  };

  const pickBool = (...specs: Array<{ from: 'cd' | 'top'; key: string }>): boolean | undefined => {
    for (const { from, key } of specs) {
      const src = from === 'cd' ? cd : r;
      const v = src[key];
      if (typeof v === 'boolean') return v;
      if (typeof v === 'string') {
        const t = v.trim().toLowerCase();
        if (t === 'true' || t === 'yes' || t === '1') return true;
        if (t === 'false' || t === 'no' || t === '0') return false;
      }
    }
    return undefined;
  };

  const out: Record<string, string | number | boolean> = {
    appointment_id:        pickStr({ from: 'cd', key: 'appointment_id' }, { from: 'top', key: 'appointment_id' }, { from: 'a', key: 'id' }),
    contact_id:            pickStr({ from: 'cd', key: 'contact_id' }, { from: 'top', key: 'contact_id' }, { from: 'c', key: 'id' }),
    appointment_start_iso: pickStr({ from: 'cd', key: 'appointment_start_iso' }, { from: 'top', key: 'start_time' }, { from: 'a', key: 'startTime' }),
    child_name:            pickStr({ from: 'cd', key: 'child_name' }, { from: 'cd', key: 'trainee_first_name' }),
    child_age:             pickStr({ from: 'cd', key: 'child_age' }, { from: 'cd', key: 'age_hidden' }, { from: 'cd', key: 'trainee_age' }),
    ts:                    pickStr({ from: 'cd', key: 'ts' }, { from: 'top', key: 'date_created' }),
  };
  const isSelf = pickBool({ from: 'cd', key: 'is_self' }, { from: 'cd', key: 'trainee_is_self' });
  if (isSelf !== undefined) out.is_self = isSelf;
  return out;
}

function programFromAge(age: number): ProgramKey {
  if (age <= 4) return 'tiny';
  if (age <= 6) return 'lc1';
  if (age <= 9) return 'lc2';
  if (age <= 15) return 'juniors';
  return 'adults';
}

const PROGRAM_NAME: Record<ProgramKey, string> = {
  tiny: 'Tiny Champions',
  lc1: 'Little Champions 1',
  lc2: 'Little Champions 2',
  juniors: 'Juniors Jiu-Jitsu',
  adults: 'Adults Brazilian Jiu-Jitsu',
};

function computeEndISO(startISO: string, program: ProgramKey): string {
  // Same logic as /api/book — 60 min for adults/juniors, 45 min everything else.
  const duration = program === 'adults' || program === 'juniors' ? 60 : 45;
  const start = Date.parse(startISO);
  if (!Number.isFinite(start)) return startISO;
  return new Date(start + duration * 60_000).toISOString();
}

export const POST: APIRoute = async ({ request }) => {
  if (!verifyGhlWebhook(request)) {
    return new Response(JSON.stringify({ ok: false, code: 'INVALID_SECRET' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let raw: unknown;
  try { raw = await request.json(); } catch {
    return ok({ ok: false, code: 'INVALID_INPUT' });
  }
  const normalized = normalizePayload(raw);
  const parsed = AgentBookingPayload.safeParse(normalized);
  if (!parsed.success) {
    console.error('[agent-booking-completed] validation failed', {
      normalized,
      errors: parsed.error.issues,
    });
    return ok({
      ok: false,
      code: 'INVALID_INPUT',
      normalized,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  const body = parsed.data;

  // Parse age safely.
  const age = Number(body.child_age);
  if (!Number.isFinite(age) || age < 3 || age > 99) {
    return ok({ ok: false, code: 'INVALID_AGE', received: body.child_age });
  }

  // Idempotency: appointment_id is unique. 60s TTL — catches GHL retries
  // without blocking legitimate manual re-runs during testing.
  const idemKey = `agent-booking|${body.appointment_id}|${body.ts ?? ''}`;
  if (idempotency.check(idemKey)) {
    return ok({ ok: true, code: 'IDEMPOTENT_REPLAY' });
  }

  // Look up the contact for parent info (name, email, phone).
  let contact;
  try {
    contact = await getContact(body.contact_id);
  } catch (err) {
    const detail = err instanceof GhlError ? { status: err.status, message: err.message.slice(0, 200) } : { err: String(err) };
    console.error('[agent-booking-completed] getContact failed', detail);
    return ok({ ok: false, code: 'GHL_FAILED', detail });
  }
  if (!contact) {
    return ok({ ok: false, code: 'CONTACT_NOT_FOUND', contact_id: body.contact_id });
  }

  // Safety check: if contact is a former student (BTM target), the bot
  // shouldn't have booked them as a trial. Log + proceed — admin should
  // manually clean up. Bot prompt should be updated to hand over to Alex
  // when this tag is present.
  //
  // ContactRecord doesn't declare `tags` in its TS type (shared interface in
  // src/lib/ghl.ts focuses on the fields most callers read), but the GHL
  // response includes them. Read via cast rather than mutating the shared type.
  const rawTags = (contact as { tags?: unknown[] }).tags ?? [];
  const tags = rawTags.map((t: unknown) => String(t).toLowerCase());
  if (tags.includes('back-to-the-mats-import') || tags.includes('return-class-booked')) {
    console.warn('[agent-booking-completed] bot booked a former student as trial', {
      contactId: body.contact_id,
      appointmentId: body.appointment_id,
      tags,
    });
  }

  // Resolve trainee data. If is_self === true (or child_name matches the
  // contact's first name), the booking is for the contact themselves.
  const childName = (body.child_name ?? '').trim();
  const contactFirst = (contact.firstName ?? '').trim();
  const contactLast = (contact.lastName ?? '').trim();
  const inferredSelf = body.is_self === true ||
    (!childName) ||
    (childName.toLowerCase() === contactFirst.toLowerCase());

  const traineeFirstName = inferredSelf ? (contactFirst || 'Trainee') : childName;
  const program = programFromAge(age);
  const slotEndISO = computeEndISO(body.appointment_start_iso, program);

  try {
    await handleBooking({
      contactId: body.contact_id,
      appointmentId: body.appointment_id,
      parent: {
        firstName: contactFirst || traineeFirstName,
        lastName: contactLast,
        email: contact.email ?? '',
        phone: contact.phone ?? '',
      },
      trainee: {
        firstName: traineeFirstName,
        age,
        isSelf: inferredSelf,
      },
      program,
      programName: PROGRAM_NAME[program],
      slotStartISO: body.appointment_start_iso,
      slotEndISO,
      flow: 'trial',
    });

    // Audit tag for funnel attribution. addContactTags is idempotent in GHL.
    try {
      await addContactTags(body.contact_id, ['source-agent-booking']);
    } catch (err) {
      // Tag failure is non-fatal — booking orchestration already succeeded.
      console.warn('[agent-booking-completed] tag add failed (non-fatal)', err);
    }

    idempotency.set(idemKey, { handled: true }, 60);
    return ok({ ok: true, program, isSelf: inferredSelf });
  } catch (err) {
    const detail = err instanceof GhlError
      ? { status: err.status, message: err.message.slice(0, 400), body: err.bodyText.slice(0, 400), path: err.path }
      : { err: String(err).slice(0, 400) };
    console.error('[agent-booking-completed] handleBooking failed', detail);
    return ok({ ok: false, code: 'GHL_FAILED', detail });
  }
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
