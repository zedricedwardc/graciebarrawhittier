/**
 * POST /api/rebook-context
 *
 * Magic-link entry path for /rebook. Accepts a long-lived rebook token
 * (minted at trial activation in Phase 4 and stored on the Trial Credit
 * Monitoring opportunity's `rebook_link_token` custom field), verifies it,
 * fetches fresh credit context from GHL, and returns the multi-trainee
 * dashboard payload — same shape as /api/rebook-lookup, plus a
 * `tokenTraineeKey` flag pointing at the trainee the magic link was minted
 * for (so the page can pre-expand that card).
 *
 * Returns:
 *   { ok: true, contactId, tokenTraineeKey, trainees: [...] }
 *   | { ok: false, code: 'INVALID_TOKEN' | 'NOT_FOUND' | 'GHL_FAILED' }
 *
 * Each trainee in the response carries its own short-lived (15-min) session
 * token used by /api/book — keeps the magic-link token out of subsequent
 * request bodies after the initial validation.
 */

import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import {
  searchOpportunities,
  GhlError,
  type OpportunityRecord,
} from '../../lib/ghl';
import { getOppCfValueByKey } from '../../lib/ghl-opportunities';
import { getPipelineId } from '../../lib/ghl-pipelines';
import { signRebookToken, verifyRebookToken } from '../../lib/rebook-token';
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
  try {
    creditPipelineId = await getPipelineId('CREDIT_MON');
  } catch (err) {
    console.error('[rebook-context] could not resolve Credit Mon pipeline', err);
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  let opps: OpportunityRecord[] = [];
  try {
    opps = await searchOpportunities({
      contactId,
      pipelineId: creditPipelineId,
      status: 'open',
    });
  } catch (err) {
    console.error(
      '[rebook-context] searchOpportunities failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err,
    );
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  // Build a card for every open Credit-Monitoring opp; the page will pre-expand
  // the one matching the token's traineeKey.
  const trainees = await opps.reduce(async (accP, o) => {
    const acc = await accP;
    const tk = (await getOppCfValueByKey<string>(o, 'trainee_key')) ?? '';
    const tn = (await getOppCfValueByKey<string>(o, 'trainee_first_name')) ?? '';
    if (!tk || !tn) return acc;
    const program = (await getOppCfValueByKey<string>(o, 'program')) ?? 'adults';
    const creditsRaw = await getOppCfValueByKey<string | number>(o, 'credits_remaining');
    const creditsRemaining = Number(creditsRaw ?? 0);
    const lastAttendanceISO = (await getOppCfValueByKey<string>(o, 'last_attendance_iso')) ?? null;
    acc.push({
      traineeName: tn.trim(),
      traineeKey: tk,
      program,
      creditsRemaining: Number.isFinite(creditsRemaining) ? creditsRemaining : 0,
      lastAttendanceISO,
      sessionToken: signRebookToken({
        contactId,
        traineeKey: tk,
        ttlDays: 1 / 96,
      }),
    });
    return acc;
  }, Promise.resolve([] as TraineeCard[]));

  if (trainees.length === 0) {
    return json({ ok: false, code: 'NOT_FOUND' });
  }

  return json({
    ok: true,
    contactId,
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
