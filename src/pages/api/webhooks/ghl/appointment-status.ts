/**
 * POST /api/webhooks/ghl/appointment-status
 *
 * Mirrors cancellations made directly in GHL UI (not via /api/cancel).
 * Fired by a GHL Workflow with trigger:
 *   "Appointment Status Changed → Calendar=any"
 *
 * Headers: X-GBW-Secret
 *
 * Behavior:
 *   - status = "cancelled" AND prev_status != "cancelled":
 *       handleCancellation() with source=admin (skips the appointment-update
 *       step since GHL already changed it)
 *   - other status changes: no-op (showed/no-show etc. flow through pipeline
 *     stage changes already)
 */

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { verifyGhlWebhook } from '../../../../lib/webhook-secrets';
import { handleCancellation } from '../../../../lib/ghl-adapter';
import { idempotency } from '../../../../lib/idempotency';
import { GhlError } from '../../../../lib/ghl-rate-limit';

export const prerender = false;

const AppointmentStatusPayload = z.object({
  appointment_id: z.string().min(1),
  contact_id: z.string().min(1),
  status: z.string().min(1),
  prev_status: z.string().optional(),
  reason: z.string().optional(),
  ts: z.union([z.string(), z.number()]).optional(),
});

/** See stage-changed.ts for rationale — robust against GHL payload quirks. */
function normalizeAppointmentPayload(raw: unknown): Record<string, string | number> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cd = (r.customData && typeof r.customData === 'object' ? r.customData : {}) as Record<string, unknown>;
  const a = (r.appointment && typeof r.appointment === 'object' ? r.appointment : {}) as Record<string, unknown>;
  const pick = (...specs: Array<{ from: 'cd' | 'top' | 'a'; key: string }>): string => {
    for (const { from, key } of specs) {
      const src = from === 'cd' ? cd : from === 'a' ? a : r;
      const v = src[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return '';
  };
  return {
    appointment_id: pick({ from: 'cd', key: 'appointment_id' }, { from: 'top', key: 'appointment_id' }, { from: 'a', key: 'id' }),
    contact_id:     pick({ from: 'cd', key: 'contact_id' }, { from: 'top', key: 'contact_id' }),
    status:         pick({ from: 'cd', key: 'status' }, { from: 'top', key: 'appointment_status' }, { from: 'a', key: 'status' }),
    prev_status:    pick({ from: 'cd', key: 'prev_status' }, { from: 'top', key: 'previous_status' }, { from: 'a', key: 'previous_status' }),
    reason:         pick({ from: 'cd', key: 'reason' }),
    ts:             pick({ from: 'cd', key: 'ts' }, { from: 'top', key: 'date_created' }),
  };
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

  const status = body.status.trim().toLowerCase();
  const prev = (body.prev_status ?? '').trim().toLowerCase();

  if (status !== 'cancelled' || prev === 'cancelled') {
    // No-op; only mirror genuine cancellation transitions.
    return ok({ ok: true, code: 'NO_OP' });
  }

  const idemKey = `appt-status|${body.appointment_id}|${status}|${body.ts ?? ''}`;
  if (idempotency.check(idemKey)) {
    return ok({ ok: true, code: 'IDEMPOTENT_REPLAY' });
  }

  try {
    await handleCancellation({
      contactId: body.contact_id,
      appointmentId: body.appointment_id,
      reason: body.reason,
      source: 'admin',
      appointmentAlreadyCancelled: true,
    });
    idempotency.set(idemKey, { handled: true }, 24 * 3600);
    return ok({ ok: true });
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
