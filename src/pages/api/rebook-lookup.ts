/**
 * POST /api/rebook-lookup
 *
 * Fallback path for the /rebook page when a customer doesn't have (or lost) the
 * magic-link reminder. Matches contact by email + lastName, then verifies they
 * have an open Trial Credit Monitoring opportunity. On success, mints a
 * short-lived rebook token (15-min expiry) so the page can proceed identically
 * to the magic-link flow.
 *
 * Anti-enumeration:
 *   - Rate-limited to 5 requests / IP / hour
 *   - Generic NOT_FOUND on miss (no email-existence leak)
 *   - Requires email AND lastName (raises cost vs. email-only)
 *
 * Returns: { ok:true, sessionToken, traineeName, creditsRemaining, traineeKey }
 *          | { ok:false, code:'INVALID_INPUT' | 'NOT_FOUND' | 'RATE_LIMITED' | 'GHL_FAILED' }
 *
 * NOTE: this endpoint is functional today but depends on the customer having an
 * open Credit Monitoring opp with `trainee_key` and `credits_remaining_display`
 * custom fields populated — which is delivered by Phase 4. Until then, lookup
 * succeeds for contacts but returns NOT_FOUND if the credit opp doesn't exist yet.
 */

import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import {
  searchContactByEmailAndLastName,
  searchOpportunities,
  GhlError,
  readEnv,
  type ContactRecord,
  type OpportunityRecord,
} from '../../lib/ghl';
import { signRebookToken } from '../../lib/rebook-token';

export const prerender = false;

const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX_PER_WINDOW = 5;

// Module-scoped — survives across requests on a warm Fluid Compute instance.
const buckets = new Map<string, { count: number; firstSeen: number }>();

const RebookLookupRequest = z.object({
  email: z.email().max(254).transform((s) => s.toLowerCase().trim()),
  lastName: z.string().min(1).max(100).transform((s) => s.trim()),
});

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Layer 1 — Per-IP rate limit.
  const ip = clientAddress || 'unknown';
  if (!checkRate(ip)) {
    return json({ ok: false, code: 'RATE_LIMITED' }, 429);
  }

  // Layer 2 — Validate body.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, code: 'INVALID_INPUT' });
  }
  const parsed = RebookLookupRequest.safeParse(payload);
  if (!parsed.success) {
    return json({ ok: false, code: 'INVALID_INPUT' });
  }
  const { email, lastName } = parsed.data;

  // Layer 3 — Find the contact in GHL.
  let contact: ContactRecord | null;
  try {
    contact = await searchContactByEmailAndLastName({ email, lastName });
  } catch (err) {
    console.error(
      '[rebook-lookup] searchContact failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err,
    );
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }
  if (!contact) {
    // Generic miss — don't leak whether email exists.
    return json({ ok: false, code: 'NOT_FOUND' });
  }

  // Layer 4 — Find an open Trial Credit Monitoring opp for this contact.
  const creditPipelineId = readEnv('PIPELINE_ID_CREDIT_MON');
  if (!creditPipelineId) {
    console.error('[rebook-lookup] PIPELINE_ID_CREDIT_MON env var not set');
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  let opps: OpportunityRecord[] = [];
  try {
    opps = await searchOpportunities({
      contactId: contact.id,
      pipelineId: creditPipelineId,
      status: 'open',
    });
  } catch (err) {
    console.error(
      '[rebook-lookup] searchOpportunities failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err,
    );
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  // Pick the first open opp. If multiple trainees on this contact, the customer
  // will see whichever was returned first — UI offers a "switch trainee" path
  // (future enhancement).
  const activeOpp = opps[0];
  if (!activeOpp) {
    return json({ ok: false, code: 'NOT_FOUND' });
  }

  const traineeKey = readCfValue(activeOpp.customFields, 'trainee_key') ?? '';
  const traineeName =
    readCfValue(activeOpp.customFields, 'trainee_first_name') ??
    contact.firstName ??
    'there';
  const program = readCfValue(activeOpp.customFields, 'program') ?? 'adults';
  const creditsDisplay = Number(
    readCfValue(activeOpp.customFields, 'credits_remaining_display') ?? '0',
  );

  if (!traineeKey) {
    // Opp exists but trainee_key not populated — Phase 4 hasn't run yet.
    return json({ ok: false, code: 'NOT_FOUND' });
  }

  // Mint a short-lived session token (15 minutes — just long enough to pick a slot).
  const sessionToken = signRebookToken({
    contactId: contact.id,
    traineeKey,
    ttlDays: 1 / 96, // 15 minutes
  });

  return json({
    ok: true,
    sessionToken,
    contactId: contact.id,
    traineeName,
    traineeKey,
    program,
    creditsRemaining: Number.isFinite(creditsDisplay) ? creditsDisplay : 0,
  });
};

function readCfValue(
  fields: ContactRecord['customFields'],
  key: string,
): string | null {
  if (!fields) return null;
  for (const f of fields) {
    if (f.key === key || f.id === key) {
      const v = (f.value ?? f.field_value) as unknown;
      if (v == null) return null;
      return String(v);
    }
  }
  return null;
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
