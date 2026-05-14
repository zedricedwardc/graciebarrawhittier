/**
 * POST /api/rebook-change-program
 *
 * Permanently switches the program on a trainee's active Trial Credit
 * Monitoring opportunity. Called from /rebook when a parent decides their
 * child should be in a different class (e.g. moving up an age group).
 *
 * Auth: same short-lived sessionToken returned by /api/rebook-lookup or
 * /api/rebook-context — token must match contactId + traineeKey.
 *
 * Effect: updates the credit opp's `program` custom field. Subsequent
 * bookings from /rebook for this trainee will default to the new program.
 * Does NOT alter past appointments or in-flight bookings.
 *
 * Returns:
 *   { ok: true, program }
 *   | { ok: false, code: 'INVALID_INPUT' | 'INVALID_TOKEN' | 'NOT_FOUND'
 *                       | 'RATE_LIMITED' | 'GHL_FAILED' }
 */

import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { addContactNote, GhlError } from '../../lib/ghl';
import { findOpps, findByTraineeKey, updateOppFields, getOppCfValueByKey } from '../../lib/ghl-opportunities';
import { cfPayload } from '../../lib/ghl-custom-fields';
import { verifyRebookToken } from '../../lib/rebook-token';
import { getProgram, type ProgramKey } from '../../data/programs';

export const prerender = false;

const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 20;
const buckets = new Map<string, { count: number; firstSeen: number }>();

const PROGRAM_KEYS: [ProgramKey, ...ProgramKey[]] = ['tiny', 'lc1', 'lc2', 'juniors', 'adults'];

const ChangeProgramRequest = z.object({
  contactId: z.string().min(1).max(64),
  traineeKey: z.string().min(1).max(120),
  sessionToken: z.string().min(1).max(512),
  program: z.enum(PROGRAM_KEYS),
});

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ip = clientAddress || 'unknown';
  if (!checkRate(ip)) return json({ ok: false, code: 'RATE_LIMITED' }, 429);

  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ ok: false, code: 'INVALID_INPUT' }); }
  const parsed = ChangeProgramRequest.safeParse(payload);
  if (!parsed.success) return json({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  const verified = verifyRebookToken(body.sessionToken);
  if (!verified.ok) return json({ ok: false, code: 'INVALID_TOKEN' });
  if (verified.payload.contactId !== body.contactId || verified.payload.traineeKey !== body.traineeKey) {
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }

  let creditOpp;
  try {
    const opps = await findOpps({
      contactId: body.contactId,
      pipelineKey: 'CREDIT_MON',
      status: 'open',
    });
    creditOpp = await findByTraineeKey(opps, body.traineeKey);
  } catch (err) {
    console.error('[rebook-change-program] findOpps failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }
  if (!creditOpp) return json({ ok: false, code: 'NOT_FOUND' });

  const previousProgram = (await getOppCfValueByKey<string>(creditOpp, 'program')) ?? '';
  if (previousProgram === body.program) {
    return json({ ok: true, program: body.program });
  }

  try {
    const cfs = await cfPayload('opportunity', { program: body.program });
    await updateOppFields(creditOpp.id, cfs);
  } catch (err) {
    console.error('[rebook-change-program] updateOppFields failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  try {
    const traineeName = (await getOppCfValueByKey<string>(creditOpp, 'trainee_first_name')) ?? 'trainee';
    const fromLabel = previousProgram ? getProgramLabel(previousProgram) : '(unset)';
    const toLabel = getProgram(body.program).name;
    await addContactNote(
      body.contactId,
      `Class changed for ${traineeName}: ${fromLabel} → ${toLabel}. Updated via /rebook.`,
    );
  } catch (err) {
    console.warn('[rebook-change-program] addContactNote failed (non-fatal)',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
  }

  return json({ ok: true, program: body.program });
};

function getProgramLabel(key: string): string {
  try { return getProgram(key as ProgramKey).name; } catch { return key; }
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