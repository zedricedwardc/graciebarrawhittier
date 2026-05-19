/**
 * POST /api/rebook-lookup
 *
 * Email-only lookup for the multi-trainee rebook dashboard. Matches contact
 * by email, then returns ALL their open Trial Credit Monitoring opps (one
 * card per trainee) — the page renders a dashboard and the customer picks
 * which trainee to book for.
 *
 * Each returned trainee carries its own short-lived session token that the
 * /api/book rebook path verifies against the trainee_key on submission.
 *
 * Anti-enumeration:
 *   - Rate-limited to 20 requests / IP / hour
 *   - Generic NOT_FOUND on miss (no email-existence leak)
 *
 * Returns:
 *   { ok: true, contactId, trainees: [{ traineeName, traineeKey, program,
 *     creditsRemaining, lastAttendanceISO, sessionToken }, ...] }
 *   | { ok: false, code: 'INVALID_INPUT' | 'NOT_FOUND' | 'RATE_LIMITED' | 'GHL_FAILED' }
 *
 * NOT_FOUND fires when:
 *   - Contact doesn't exist for that email, OR
 *   - Contact exists but has no OPEN credit-pipeline opps (no active passes)
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
import { getPipelineId } from '../../lib/ghl-pipelines';
import { signRebookToken } from '../../lib/rebook-token';
import {
  extractOppFacts,
  resolveTraineeCards,
  CONTACT_SCOPED_TRAINEE_KEY,
  type OppFacts,
} from '../../lib/rebook-cards';

export const prerender = false;

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 20;

const buckets = new Map<string, { count: number; firstSeen: number }>();

const RebookLookupRequest = z.object({
  email: z.email().max(254).transform((s) => s.toLowerCase().trim()),
});

export interface TraineeCard {
  traineeName: string;
  traineeKey: string;
  program: string;
  status: 'enrolled' | 'active' | 'exhausted' | 'pending';
  creditsRemaining: number;
  lastAttendanceISO: string | null;
  /** Booked class start ISO — set only for `pending` cards. */
  pendingClassISO: string | null;
  /**
   * 15-min token authorizing /api/book against this trainee. Present only on
   * `active` / `exhausted` cards — `enrolled` / `pending` have no booking action.
   */
  sessionToken?: string;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ip = clientAddress || 'unknown';
  if (!checkRate(ip)) {
    return json({ ok: false, code: 'RATE_LIMITED' }, 429);
  }

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
  const { email } = parsed.data;

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
    return json({ ok: false, code: 'NOT_FOUND' });
  }

  let creditPipelineId: string;
  try {
    creditPipelineId = await getPipelineId('CREDIT_MON');
  } catch (err) {
    console.error('[rebook-lookup] could not resolve Credit Mon pipeline', err);
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  let trialPipelineId: string;
  try {
    trialPipelineId = await getPipelineId('TRIAL_CONV');
  } catch (err) {
    console.error('[rebook-lookup] could not resolve Trial Conversion pipeline', err);
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  let creditOpps: OpportunityRecord[] = [];
  let trialOpps: OpportunityRecord[] = [];
  try {
    [creditOpps, trialOpps] = await Promise.all([
      searchOpportunities({ contactId: contact.id, pipelineId: creditPipelineId, status: 'open' }),
      searchOpportunities({ contactId: contact.id, pipelineId: trialPipelineId, status: 'all' }),
    ]);
  } catch (err) {
    console.error(
      '[rebook-lookup] searchOpportunities failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err,
    );
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  const facts: OppFacts[] = [];
  for (const o of creditOpps) {
    const f = await extractOppFacts(o, 'CREDIT_MON');
    if (f) facts.push(f);
  }
  for (const o of trialOpps) {
    const f = await extractOppFacts(o, 'TRIAL_CONV');
    if (f) facts.push(f);
  }

  const resolved = resolveTraineeCards(facts);
  const trainees: TraineeCard[] = resolved.map((r) => ({
    traineeName: r.traineeName,
    traineeKey: r.traineeKey,
    program: r.program,
    status: r.status,
    creditsRemaining: r.creditsRemaining,
    lastAttendanceISO: r.lastAttendanceISO,
    pendingClassISO: r.pendingClassISO,
    sessionToken:
      r.status === 'active' || r.status === 'exhausted'
        ? signRebookToken({ contactId: contact.id, traineeKey: r.traineeKey, ttlDays: 1 / 96 })
        : undefined,
  }));

  if (trainees.length === 0) {
    return json({ ok: false, code: 'NOT_FOUND' });
  }

  const contactToken = signRebookToken({
    contactId: contact.id,
    traineeKey: CONTACT_SCOPED_TRAINEE_KEY,
    ttlDays: 1 / 96,
  });

  return json({
    ok: true,
    contactId: contact.id,
    contactToken,
    trainees,
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
