/**
 * POST /api/rebook-lookup
 *
 * Fallback path for the /rebook page when a customer doesn't have (or lost) the
 * magic-link reminder. Matches contact by email, then disambiguates the trainee
 * by `trainee_first_name` on the Trial Credit Monitoring opp — so a parent with
 * three kids can pick which child's pass to use.
 *
 * Anti-enumeration:
 *   - Rate-limited to 20 requests / IP / hour
 *   - Generic NOT_FOUND on miss (no email-existence leak)
 *
 * Returns: { ok:true, sessionToken, traineeName, creditsRemaining, traineeKey }
 *          | { ok:false, code:'INVALID_INPUT' | 'NOT_FOUND' | 'RATE_LIMITED' | 'GHL_FAILED' }
 */

import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import {
  searchContactByEmail,
  searchOpportunities,
  GhlError,
  type ContactRecord,
  type OpportunityRecord,
} from '../../lib/ghl';
import { getOppCfValueByKey } from '../../lib/ghl-opportunities';
import { getPipelineId } from '../../lib/ghl-pipelines';
import { signRebookToken } from '../../lib/rebook-token';

export const prerender = false;

const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX_PER_WINDOW = 20;

// Module-scoped — survives across requests on a warm Fluid Compute instance.
const buckets = new Map<string, { count: number; firstSeen: number }>();

const RebookLookupRequest = z.object({
  email: z.email().max(254).transform((s) => s.toLowerCase().trim()),
  traineeFirstName: z.string().min(1).max(100).transform((s) => s.trim()),
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
  const { email, traineeFirstName } = parsed.data;

  // Layer 3 — Find the contact in GHL by email.
  let contact: ContactRecord | null;
  try {
    contact = await searchContactByEmail(email);
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
  let creditPipelineId: string;
  try {
    creditPipelineId = await getPipelineId('CREDIT_MON');
  } catch (err) {
    console.error('[rebook-lookup] could not resolve Credit Mon pipeline', err);
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

  // Match the opp by trainee_first_name (case-insensitive). Lets a parent with
  // multiple kids on one contact pick which child's pass to use.
  const wantedFirst = traineeFirstName.toLowerCase();
  let activeOpp: OpportunityRecord | undefined;
  let traineeKey = '';
  let traineeName = '';
  for (const o of opps) {
    const first = (await getOppCfValueByKey<string>(o, 'trainee_first_name')) ?? '';
    if (first.trim().toLowerCase() === wantedFirst) {
      activeOpp = o;
      traineeName = first.trim();
      traineeKey = (await getOppCfValueByKey<string>(o, 'trainee_key')) ?? '';
      break;
    }
  }
  if (!activeOpp || !traineeKey) {
    return json({ ok: false, code: 'NOT_FOUND' });
  }

  const program = (await getOppCfValueByKey<string>(activeOpp, 'program')) ?? 'adults';
  const creditsRaw = await getOppCfValueByKey<string | number>(activeOpp, 'credits_remaining');
  const creditsRemaining = Number(creditsRaw ?? 0);

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
    creditsRemaining: Number.isFinite(creditsRemaining) ? creditsRemaining : 0,
  });
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
