/**
 * POST /api/webhooks/ghl/appointment-status
 *
 * Mirrors appointment-status changes made in the GHL calendar UI (Appointment
 * List View) onto the opportunity that owns the appointment.
 *
 * Fired by a GHL Workflow with trigger:
 *   "Appointment Status Changed → Calendar=any"  (WORKFLOW_ID_APPT_STATUS_WEBHOOK)
 *
 * Headers: X-GBW-Secret
 *
 * Behavior — see APPOINTMENT_STATUS_TRANSITIONS in config/ghl-schema.ts:
 *   - confirmed / new     → no-op (booking already set the opp's booked stage)
 *   - showed              → move owning opp to its pipeline's "attended" stage
 *   - noshow              → move owning opp to NO-SHOW
 *   - cancelled / invalid → abandon the opp (or, for credit opps, return it to
 *                           CREDIT ACTIVE — the trial pass is still valid)
 *
 * Every move is stage-guarded: it applies only while the opp is still awaiting
 * classification, so a manual reclassification by an admin isn't overridden.
 *
 * Always returns 200 (ok:false on logical errors) so GHL doesn't retry
 * indefinitely. Returns 401 only on auth failure.
 */

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { verifyGhlWebhook } from '../../../../lib/webhook-secrets';
import { handleAppointmentStatusChange, type AppointmentStatus } from '../../../../lib/ghl-adapter';
import { idempotency } from '../../../../lib/idempotency';
import { GhlError } from '../../../../lib/ghl-rate-limit';

export const prerender = false;

const AppointmentStatusPayload = z.object({
  appointment_id: z.string().min(1),
  contact_id: z.string().min(1),
  status: z.string().min(1),
  reason: z.string().optional(),
  ts: z.union([z.string(), z.number()]).optional(),
});

/** See stage-changed.ts for rationale — robust against GHL payload quirks. */
function normalizeAppointmentPayload(raw: unknown): Record<string, string> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cd = (r.customData && typeof r.customData === 'object' ? r.customData : {}) as Record<string, unknown>;
  const a = (r.appointment && typeof r.appointment === 'object' ? r.appointment : {}) as Record<string, unknown>;
  const pick = (...specs: Array<{ from: 'cd' | 'top' | 'a'; key: string }>): string => {
    for (const { from, key } of specs) {
      const src = from === 'cd' ? cd : from === 'a' ? a : r;
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
  return {
    appointment_id: pick({ from: 'cd', key: 'appointment_id' }, { from: 'top', key: 'appointment_id' }, { from: 'a', key: 'id' }),
    contact_id:     pick({ from: 'cd', key: 'contact_id' }, { from: 'top', key: 'contact_id' }),
    status:         pick({ from: 'cd', key: 'status' }, { from: 'top', key: 'appointment_status' }, { from: 'a', key: 'status' }),
    reason:         pick({ from: 'cd', key: 'reason' }),
    ts:             pick({ from: 'cd', key: 'ts' }, { from: 'top', key: 'date_created' }),
  };
}

/**
 * Map a raw GHL appointment status to our actionable enum. Returns null for
 * statuses we deliberately ignore (`confirmed`, `new`, anything unknown).
 * Normalizes by lowercasing + stripping non-letters, so "No Show", "no-show"
 * and "noshow" all collapse to the same value.
 */
function classifyStatus(raw: string): AppointmentStatus | null {
  const s = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (s === 'showed') return 'showed';
  if (s === 'noshow') return 'noshow';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'invalid') return 'invalid';
  return null; // confirmed, new, unknown — nothing to mirror
}

export const POST: APIRoute = async ({ request }) => {
  if (!verifyGhlWebhook(request)) {
    return new Response(JSON.stringify({ ok: false, code: 'INVALID_SECRET' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let raw: unknown;
  try { raw = await request.json(); } catch { return ok({ ok: false, code: 'INVALID_INPUT' }); }
  const normalized = normalizeAppointmentPayload(raw);
  const parsed = AppointmentStatusPayload.safeParse(normalized);
  if (!parsed.success) {
    return ok({
      ok: false,
      code: 'INVALID_INPUT',
      normalized,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  const body = parsed.data;

  const status = classifyStatus(body.status);
  if (!status) {
    // confirmed / new / unknown — nothing to mirror.
    return ok({ ok: true, code: 'NO_OP' });
  }

  const idemKey = `appt-status|${body.appointment_id}|${status}|${body.ts ?? ''}`;
  if (idempotency.check(idemKey)) {
    return ok({ ok: true, code: 'IDEMPOTENT_REPLAY' });
  }

  try {
    const result = await handleAppointmentStatusChange({
      contactId: body.contact_id,
      appointmentId: body.appointment_id,
      status,
      reason: body.reason,
    });
    idempotency.set(idemKey, { handled: true }, 60);
    return ok({ ok: true, ...result });
  } catch (err) {
    console.error('[webhook appointment-status] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return ok({ ok: false, code: 'GHL_FAILED' });
  }
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
