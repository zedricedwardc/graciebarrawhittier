/**
 * POST /api/rebook-context
 *
 * Magic-link entry path for /rebook. Accepts a long-lived rebook token,
 * verifies it, fetches fresh context from GHL, and returns the multi-trainee
 * dashboard payload merged from BOTH the Trial Credit Monitoring and Trial
 * Conversion pipelines — one card per trainee with a `status`
 * (`enrolled` / `active` / `exhausted` / `pending`).
 *
 * The response includes a `contactToken` (15-min contact-scoped token for the
 * add-a-new-person action) plus `tokenTraineeKey` pointing at the trainee the
 * magic link was minted for (so the page can pre-expand that card). Each
 * active/exhausted card also carries its own short-lived session token for
 * /api/book — keeps the magic-link token out of subsequent request bodies.
 *
 * Returns:
 *   { ok: true, contactId, contactToken, tokenTraineeKey, trainees: [...] }
 *   | { ok: false, code: 'INVALID_TOKEN' | 'NOT_FOUND' | 'GHL_FAILED' }
 */

import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import {
  searchOpportunities,
  GhlError,
  type OpportunityRecord,
} from '../../lib/ghl';
import { getPipelineId } from '../../lib/ghl-pipelines';
import { signRebookToken, verifyRebookToken } from '../../lib/rebook-token';
import {
  extractOppFacts,
  resolveTraineeCards,
  CONTACT_SCOPED_TRAINEE_KEY,
  type OppFacts,
} from '../../lib/rebook-cards';
import type { TraineeCard } from './rebook-lookup';

export const prerender = false;

const RebookContextRequest = z.object({
  token: z.string().min(20).max(2000),
});

export const POST: APIRoute = async ({ request }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }
  const parsed = RebookContextRequest.safeParse(payload);
  if (!parsed.success) {
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }

  const verified = verifyRebookToken(parsed.data.token);
  if (!verified.ok) {
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }
  const { contactId, traineeKey: tokenTraineeKey } = verified.payload;

  let creditPipelineId: string;
  let trialPipelineId: string;
  try {
    [creditPipelineId, trialPipelineId] = await Promise.all([
      getPipelineId('CREDIT_MON'),
      getPipelineId('TRIAL_CONV'),
    ]);
  } catch (err) {
    console.error('[rebook-context] could not resolve pipelines', err);
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  let creditOpps: OpportunityRecord[] = [];
  let trialOpps: OpportunityRecord[] = [];
  try {
    [creditOpps, trialOpps] = await Promise.all([
      searchOpportunities({ contactId, pipelineId: creditPipelineId, status: 'open' }),
      searchOpportunities({ contactId, pipelineId: trialPipelineId, status: 'all' }),
    ]);
  } catch (err) {
    console.error(
      '[rebook-context] searchOpportunities failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err,
    );
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  const factsArrays = await Promise.all([
    ...creditOpps.map((o) => extractOppFacts(o, 'CREDIT_MON')),
    ...trialOpps.map((o) => extractOppFacts(o, 'TRIAL_CONV')),
  ]);
  const facts: OppFacts[] = factsArrays.filter((f): f is OppFacts => f !== null);

  const trainees: TraineeCard[] = resolveTraineeCards(facts).map((r) => ({
    traineeName: r.traineeName,
    traineeKey: r.traineeKey,
    program: r.program,
    status: r.status,
    creditsRemaining: r.creditsRemaining,
    lastAttendanceISO: r.lastAttendanceISO,
    nextClassISO: r.nextClassISO,
    sessionToken:
      r.status === 'active' || r.status === 'exhausted'
        ? signRebookToken({ contactId, traineeKey: r.traineeKey, ttlDays: 1 / 96 })
        : undefined,
  }));

  if (trainees.length === 0) {
    return json({ ok: false, code: 'NOT_FOUND' });
  }

  const contactToken = signRebookToken({
    contactId,
    traineeKey: CONTACT_SCOPED_TRAINEE_KEY,
    ttlDays: 1 / 96,
  });

  return json({
    ok: true,
    contactId,
    contactToken,
    tokenTraineeKey,
    trainees,
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
