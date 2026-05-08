/**
 * POST /api/rebook-context
 *
 * Magic-link entry path for /rebook. Accepts a long-lived rebook token
 * (minted at trial activation in Phase 4 and stored on the Trial Credit
 * Monitoring opportunity's `rebook_link_token` custom field), verifies it,
 * fetches fresh credit context from GHL, and returns the same shape as
 * /api/rebook-lookup so the page can use a single render path.
 *
 * Returns: { ok:true, sessionToken, contactId, traineeName, traineeKey, program, creditsRemaining }
 *          | { ok:false, code: 'INVALID_TOKEN' | 'NOT_FOUND' | 'GHL_FAILED' }
 *
 * The returned `sessionToken` is a fresh short-lived (15-min) token used by
 * subsequent /api/book calls during this rebook session — keeps the magic
 * link itself out of HTTP request bodies after the initial validation.
 */

import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import {
  searchOpportunities,
  GhlError,
  readEnv,
  type OpportunityRecord,
} from '../../lib/ghl';
import { getOppCfValueByKey } from '../../lib/ghl-opportunities';
import { signRebookToken, verifyRebookToken } from '../../lib/rebook-token';

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
  const { contactId, traineeKey } = verified.payload;

  const creditPipelineId = readEnv('PIPELINE_ID_CREDIT_MON');
  if (!creditPipelineId) {
    console.error('[rebook-context] PIPELINE_ID_CREDIT_MON env var not set');
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

  // Find the opp matching the trainee_key from the token. Iterate opps and use
  // async getOppCfValueByKey (since GET responses strip key/fieldKey).
  let matchOpp: OpportunityRecord | undefined;
  for (const o of opps) {
    const k = await getOppCfValueByKey<string>(o, 'trainee_key');
    if (k === traineeKey) { matchOpp = o; break; }
  }
  if (!matchOpp) {
    return json({ ok: false, code: 'NOT_FOUND' });
  }

  const traineeName =
    (await getOppCfValueByKey<string>(matchOpp, 'trainee_first_name')) ?? 'there';
  const program = (await getOppCfValueByKey<string>(matchOpp, 'program')) ?? 'adults';
  const creditsRaw = await getOppCfValueByKey<string | number>(matchOpp, 'credits_remaining');
  const creditsRemaining = Number(creditsRaw ?? 0);

  // Mint a short-lived session token (15 min) so subsequent calls don't pass the
  // long-lived magic-link token around.
  const sessionToken = signRebookToken({
    contactId,
    traineeKey,
    ttlDays: 1 / 96,
  });

  return json({
    ok: true,
    sessionToken,
    contactId,
    traineeName,
    traineeKey,
    program,
    creditsRemaining: Number.isFinite(creditsRemaining) ? creditsRemaining : 0,
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
