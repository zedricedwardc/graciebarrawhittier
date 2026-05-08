/**
 * POST /api/webhooks/ghl/credit-stage-changed  (Trial Credit Monitoring)
 *
 * Receives backflow when an opportunity in the Trial Credit Monitoring
 * pipeline changes stage. Fired by a GHL Workflow with trigger:
 *   "Opportunity Stage Changed → Pipeline=Trial Credit Monitoring → Any stage"
 *
 * Headers: X-GBW-Secret
 *
 * Behavior dispatched by `to_stage`:
 *   - ATTENDED APPOINTMENT  → handleCreditDecrement() decrements credits,
 *                             auto-moves to CREDIT ACTIVE or CREDITS EXHAUSTED
 *   - LOST                  → set status lost, zero out credits, push Lead Acq
 *                             back to NURTURE CAMPAIGN
 *   - WON ENROLLED          → set status won; mark Trial Conv opp won too
 *   - NO-SHOW               → handler is no-op; auto_move_immediate to CREDIT ACTIVE
 *                             happens via campaign workflow
 *   - other stages          → no-op
 */

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { verifyGhlWebhook } from '../../../../lib/webhook-secrets';
import { handleCreditDecrement } from '../../../../lib/ghl-adapter';
import {
  findOpps,
  setOppStatus,
  moveStage,
  getOppCfValue,
} from '../../../../lib/ghl-opportunities';
import { updateOpportunity } from '../../../../lib/ghl';
import { cfPayload } from '../../../../lib/ghl-custom-fields';
import { idempotency } from '../../../../lib/idempotency';
import { GhlError } from '../../../../lib/ghl-rate-limit';

export const prerender = false;

const CreditStagePayload = z.object({
  opp_id: z.string().min(1),
  contact_id: z.string().min(1),
  to_stage: z.string().min(1),
  from_stage: z.string().optional(),
  trainee_key: z.string().optional(),
  last_appointment_start_iso: z.string().optional(),
  ts: z.union([z.string(), z.number()]).optional(),
});

export const POST: APIRoute = async ({ request }) => {
  if (!verifyGhlWebhook(request)) {
    return new Response(JSON.stringify({ ok: false, code: 'INVALID_SECRET' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: unknown;
  try { payload = await request.json(); } catch { return ok({ ok: false, code: 'INVALID_INPUT' }); }
  const parsed = CreditStagePayload.safeParse(payload);
  if (!parsed.success) return ok({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  const idemKey = `credit-stage|${body.opp_id}|${body.to_stage}|${body.ts ?? ''}`;
  if (idempotency.check(idemKey)) {
    return ok({ ok: true, code: 'IDEMPOTENT_REPLAY' });
  }

  try {
    const stage = body.to_stage.trim().toUpperCase();
    switch (stage) {
      case 'ATTENDED APPOINTMENT': {
        if (!body.last_appointment_start_iso) {
          return ok({ ok: false, code: 'MISSING_TRIAL_DATE' });
        }
        await handleCreditDecrement({
          contactId: body.contact_id,
          oppId: body.opp_id,
          trialDateISO: body.last_appointment_start_iso,
          traineeKey: body.trainee_key,
        });
        break;
      }
      case 'LOST': {
        // Set credit opp credits to 0 + status lost (single update for atomicity)
        const cfs = await cfPayload('opportunity', { credits_remaining: 0 });
        await updateOpportunity(body.opp_id, { status: 'lost', customFields: cfs });
        // Cross-pipeline-move Lead Acq back to NURTURE CAMPAIGN
        const leadOpps = await findOpps({
          contactId: body.contact_id,
          pipelineKey: 'LEAD_ACQ',
          status: 'won',
          limit: 5,
        });
        const leadOpp = leadOpps[0];
        if (leadOpp) {
          await moveStage({
            oppId: leadOpp.id,
            pipelineKey: 'LEAD_ACQ',
            stageName: 'NURTURE CAMPAIGN',
          });
        }
        break;
      }
      case 'WON ENROLLED': {
        await setOppStatus(body.opp_id, 'won');
        // Mark matching Trial Conv opp as won too
        if (body.trainee_key) {
          const trialOpps = await findOpps({
            contactId: body.contact_id,
            pipelineKey: 'TRIAL_CONV',
            status: 'open',
            limit: 20,
          });
          const matching = trialOpps.find(
            (o) => getOppCfValue<string>(o, 'trainee_key')?.toLowerCase() ===
                   body.trainee_key!.toLowerCase(),
          );
          if (matching) {
            await moveStage({
              oppId: matching.id,
              pipelineKey: 'TRIAL_CONV',
              stageName: 'STUDENT ENROLLED (WON)',
            });
          }
        }
        break;
      }
      // NO-SHOW, CREDIT ACTIVE, ANOTHER TRIAL BOOKED, APPOINTMENT TODAY,
      // CREDITS EXHAUSTED, REACTIVATION: handled by campaign workflows /
      // auto-move-after declarations.
      default:
        break;
    }
    idempotency.set(idemKey, { handled: true }, 24 * 3600);
    return ok({ ok: true });
  } catch (err) {
    console.error('[webhook credit-stage-changed] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return ok({ ok: false, code: 'GHL_FAILED' });
  }
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
