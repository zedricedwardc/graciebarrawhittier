/**
 * POST /api/cancel
 *
 * Customer-initiated cancellation from the confirmation page or signed
 * email link. Verifies HMAC token, updates the GHL appointment status to
 * "cancelled", and dispatches to handleCancellation for the opp + audit.
 *
 * Body: { appointmentId, contactId, token, reason? }
 *   token = HMAC-SHA256(`${appointmentId}|${contactId}|${exp}`, CANCEL_SIGNING_KEY)
 *
 * Idempotency: appointment_id is the natural key — second call no-ops.
 */

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { verifyCancelToken } from '../../lib/cancel-token';
import { handleCancellation } from '../../lib/ghl-adapter';
import { ghlFetch, GhlError } from '../../lib/ghl-rate-limit';
import { idempotency } from '../../lib/idempotency';

export const prerender = false;

const CancelRequest = z.object({
  appointmentId: z.string().min(1).max(120),
  contactId: z.string().min(1).max(120),
  token: z.string().min(20).max(2000),
  reason: z.string().max(500).optional(),
});

type CancelResponse =
  | { ok: true; isReplay: boolean }
  | { ok: false; code: 'INVALID_INPUT' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'GHL_FAILED' };

export const POST: APIRoute = async ({ request }) => {
  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ ok: false, code: 'INVALID_INPUT' }); }
  const parsed = CancelRequest.safeParse(payload);
  if (!parsed.success) return json({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  // Verify HMAC token (constant-time)
  const verified = verifyCancelToken(body.token);
  if (!verified.ok) {
    if (verified.code === 'EXPIRED') return json({ ok: false, code: 'EXPIRED_TOKEN' });
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }
  // Token must match the appointment + contact IDs (anti-tampering)
  if (verified.payload.appointmentId !== body.appointmentId ||
      verified.payload.contactId !== body.contactId) {
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }

  // Idempotency on appointment_id
  const idemKey = `cancel|${body.appointmentId}`;
  if (idempotency.check(idemKey)) {
    return json({ ok: true, isReplay: true });
  }

  try {
    // Update appointment status in GHL
    await ghlFetch(`/calendars/events/appointments/${encodeURIComponent(body.appointmentId)}`, {
      method: 'PUT',
      json: { appointmentStatus: 'cancelled' },
      version: '2021-04-15', // calendars API uses older version
    });

    // Dispatch to adapter for opp + audit
    await handleCancellation({
      contactId: body.contactId,
      appointmentId: body.appointmentId,
      reason: body.reason,
      source: 'customer',
      appointmentAlreadyCancelled: true, // we just did it
    });

    idempotency.set(idemKey, { handled: true }, 7 * 24 * 3600);
    return json({ ok: true, isReplay: false });
  } catch (err) {
    console.error('[cancel] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return json({ ok: false, code: 'GHL_FAILED' });
  }
};

function json(body: CancelResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
