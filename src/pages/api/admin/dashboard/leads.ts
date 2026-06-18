/**
 * GET /api/admin/dashboard/leads?range=7d|30d|90d|mtd
 *
 * New-contact counts per LeadChannel over the requested window. Admin-token
 * gated (the `t` query param OR the `x-admin-token` header).
 *
 * Response: { ok: true, breakdown } | { ok: false, code, message? }
 * Invalid/missing range → 400 INVALID_INPUT.
 *
 * A ~60s in-module response cache (keyed by range) keeps the page's range
 * toggle / auto refresh from re-running the contact search on every poll.
 */

import type { APIRoute } from 'astro';
import { GhlError } from '../../../../lib/ghl-rate-limit';
import { getLeadBreakdown, type LeadRange } from '../../../../lib/dashboard-data';
import { requireAdmin, json } from '../../../../lib/admin-api';

export const prerender = false;

const RANGES: readonly LeadRange[] = ['7d', '30d', '90d', 'mtd'];

const CACHE_TTL_MS = 60_000;
const cache = new Map<LeadRange, { at: number; breakdown: Awaited<ReturnType<typeof getLeadBreakdown>> }>();

export const GET: APIRoute = async ({ request, url }) => {
  const auth = requireAdmin(request, url);
  if (!auth.ok) return json(401, { ok: false, code: 'INVALID_TOKEN' });

  const range = url.searchParams.get('range') as LeadRange | null;
  if (!range || !RANGES.includes(range)) return json(400, { ok: false, code: 'INVALID_INPUT' });

  try {
    const hit = cache.get(range);
    if (!hit || Date.now() - hit.at > CACHE_TTL_MS) {
      cache.set(range, { at: Date.now(), breakdown: await getLeadBreakdown(range) });
    }
    return json(200, { ok: true, breakdown: cache.get(range)!.breakdown });
  } catch (err) {
    console.error('[admin/dashboard leads] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return json(502, { ok: false, code: 'GHL_FAILED', message: 'Could not load lead breakdown.' });
  }
};
