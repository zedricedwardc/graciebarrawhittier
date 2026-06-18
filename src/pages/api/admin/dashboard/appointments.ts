/**
 * GET /api/admin/dashboard/appointments
 *
 * Next-7-day appointments across the trial + (present) BTM calendars, each
 * joined to its contact's lead source. Admin-token gated (the `t` query param
 * OR the `x-admin-token` header).
 *
 * Response: { ok: true, appointments, warnings } | { ok: false, code, message? }
 *
 * A ~60s in-module response cache keeps the page's manual / auto refresh from
 * re-running the N+1 contact lookups on every poll. Serverless-warm best-effort
 * (a cold instance simply recomputes) — correctness-neutral.
 */

import type { APIRoute } from 'astro';
import { GhlError } from '../../../../lib/ghl-rate-limit';
import { getUpcomingAppointments } from '../../../../lib/dashboard-data';
import { requireAdmin, json } from '../../../../lib/admin-api';

export const prerender = false;

const CACHE_TTL_MS = 60_000;
let cache: { at: number; body: Awaited<ReturnType<typeof getUpcomingAppointments>> } | null = null;

export const GET: APIRoute = async ({ request, url }) => {
  const auth = requireAdmin(request, url);
  if (!auth.ok) return json(401, { ok: false, code: 'INVALID_TOKEN' });

  try {
    if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
      cache = { at: Date.now(), body: await getUpcomingAppointments() };
    }
    return json(200, { ok: true, appointments: cache.body.appointments, warnings: cache.body.warnings });
  } catch (err) {
    console.error('[admin/dashboard appointments] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return json(502, { ok: false, code: 'GHL_FAILED', message: 'Could not load appointments.' });
  }
};
