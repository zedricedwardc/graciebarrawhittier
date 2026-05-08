/**
 * POST /api/webhooks/ghl/stage-changed  (Trial Conversion pipeline)
 *
 * Receives backflow when an opportunity in the Trial Conversion pipeline
 * changes stage. Fired by a GHL Workflow with trigger:
 *   "Opportunity Stage Changed → Pipeline=Trial Conversion → Any stage"
 *
 * Headers: X-GBW-Secret (required, constant-time verified)
 *
 * Behavior dispatched by `to_stage`:
 *   - TRIAL ACTIVE NURTURE  → handleAttendance() creates Credit Monitoring opp
 *   - LOST / COLD           → cross-pipeline-move Lead Acq to NURTURE CAMPAIGN
 *   - STUDENT ENROLLED (WON) → set status won; close Credit opp if exists
 *   - other stages          → no-op (campaign workflows handle themselves)
 *
 * Always returns 200 with ok:false on logical errors so GHL doesn't infinite-retry.
 * Only returns non-200 on auth failure.
 */

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { verifyGhlWebhook } from '../../../../lib/webhook-secrets';
import { handleAttendance } from '../../../../lib/ghl-adapter';
import { findOpps, setOppStatus, moveStage, getOppCfValue } from '../../../../lib/ghl-opportunities';
import { idempotency } from '../../../../lib/idempotency';
import { GhlError } from '../../../../lib/ghl-rate-limit';

export const prerender = false;

// Flat snake_case payload (workflow webhook config sends pre-flattened fields).
const StageChangedPayload = z.object({
  opp_id: z.string().min(1),
  contact_id: z.string().min(1),
  to_stage: z.string().min(1),
  from_stage: z.string().optional(),
  trainee_key: z.string().optional(),
  trainee_first_name: z.string().optional(),
  parent_last_name: z.string().optional(),
  program: z.string().optional(),
  last_appointment_start_iso: z.string().optional(),
  ts: z.union([z.string(), z.number()]).optional(),
});

/**
 * Normalize the raw webhook payload to our flat schema shape.
 *
 * GHL's webhook fires a layered payload:
 *   - Top level: auto-populated standard fields (id, contact_id, pipleline_stage*, ...)
 *   - customData: whatever the user mapped in the workflow webhook action body
 *
 * (* yes, GHL natively spells it "pipleline_stage" — keeping the typo for compat.)
 *
 * We prefer customData (lets users override) but fall back to top-level so the
 * integration works even if a user fat-fingers a merge tag.
 */
function normalizeStagePayload(raw: unknown): Record<string, string | number> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cd = (r.customData && typeof r.customData === 'object' ? r.customData : {}) as Record<string, unknown>;
  const pick = (...keys: Array<{ from: 'cd' | 'top'; key: string }>): string => {
    for (const { from, key } of keys) {
      const v = (from === 'cd' ? cd[key] : r[key]);
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return '';
  };
  return {
    opp_id:                     pick({ from: 'cd', key: 'opp_id' }, { from: 'top', key: 'id' }),
    contact_id:                 pick({ from: 'cd', key: 'contact_id' }, { from: 'top', key: 'contact_id' }),
    to_stage:                   pick(
                                  { from: 'cd', key: 'to_stage' },
                                  { from: 'top', key: 'pipleline_stage' },  // GHL's typo
                                  { from: 'top', key: 'pipeline_stage' },
                                ),
    from_stage:                 pick({ from: 'cd', key: 'from_stage' }),
    trainee_key:                pick({ from: 'cd', key: 'trainee_key' }, { from: 'top', key: 'Last Trainee Key' }),
    trainee_first_name:         pick({ from: 'cd', key: 'trainee_first_name' }),
    parent_last_name:           pick({ from: 'cd', key: 'parent_last_name' }, { from: 'top', key: 'last_name' }),
    program:                    pick({ from: 'cd', key: 'program' }, { from: 'top', key: 'opportunity_source' }, { from: 'top', key: 'source' }),
    last_appointment_start_iso: pick({ from: 'cd', key: 'last_appointment_start_iso' }),
    ts:                         pick({ from: 'cd', key: 'ts' }, { from: 'top', key: 'date_created' }),
  };
}

export const POST: APIRoute = async ({ request }) => {
  if (!verifyGhlWebhook(request)) {
    return new Response(JSON.stringify({ ok: false, code: 'INVALID_SECRET' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let raw: unknown;
  try { raw = await request.json(); } catch {
    console.error('[stage-changed] body not JSON');
    return ok({ ok: false, code: 'INVALID_INPUT' });
  }
  const normalized = normalizeStagePayload(raw);
  const parsed = StageChangedPayload.safeParse(normalized);
  if (!parsed.success) {
    console.error('[stage-changed] validation failed', {
      normalized,
      errors: parsed.error.issues,
    });
    return ok({
      ok: false,
      code: 'INVALID_INPUT',
      normalized,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  const body = parsed.data;

  // Idempotency: prevent double-action on retried deliveries.
  const idemKey = `stage-changed|${body.opp_id}|${body.to_stage}|${body.ts ?? ''}`;
  if (idempotency.check(idemKey)) {
    return ok({ ok: true, code: 'IDEMPOTENT_REPLAY' });
  }

  try {
    const stage = body.to_stage.trim().toUpperCase();
    switch (stage) {
      case 'TRIAL ACTIVE NURTURE': {
        if (!body.trainee_key || !body.trainee_first_name) {
          return ok({ ok: false, code: 'MISSING_TRAINEE_DATA' });
        }
        await handleAttendance({
          contactId: body.contact_id,
          traineeKey: body.trainee_key,
          traineeFirstName: body.trainee_first_name,
          parentLastName: body.parent_last_name,
          program: body.program,
          lastTrialDateISO: body.last_appointment_start_iso ?? new Date().toISOString(),
        });
        break;
      }
      case 'LOST / COLD': {
        // Trial Conv → LOST / COLD: push contact's Lead Acq opp back to NURTURE CAMPAIGN.
        await setOppStatus(body.opp_id, 'lost');
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
      case 'STUDENT ENROLLED (WON)': {
        await setOppStatus(body.opp_id, 'won');
        // Close the matching Credit Mon opp as won, if any
        if (body.trainee_key) {
          const creditOpps = await findOpps({
            contactId: body.contact_id,
            pipelineKey: 'CREDIT_MON',
            status: 'open',
            limit: 20,
          });
          const matchingCredit = creditOpps.find(
            (o) => getOppCfValue<string>(o, 'trainee_key')?.toLowerCase() ===
                   body.trainee_key!.toLowerCase(),
          );
          if (matchingCredit) {
            await moveStage({
              oppId: matchingCredit.id,
              pipelineKey: 'CREDIT_MON',
              stageName: 'WON ENROLLED',
            });
          }
        }
        break;
      }
      // Other stages (INTRO BOOKED, TRIAL APPOINTMENT DONE, NO-SHOW, etc.):
      // campaign workflows + auto-move-after timers handle themselves.
      default:
        break;
    }
    idempotency.set(idemKey, { handled: true }, 24 * 3600);
    return ok({ ok: true });
  } catch (err) {
    const detail = err instanceof GhlError
      ? { status: err.status, message: err.message.slice(0, 400), body: err.bodyText.slice(0, 400), path: err.path }
      : { err: String(err).slice(0, 400) };
    console.error('[webhook stage-changed] failed', detail);
    return ok({ ok: false, code: 'GHL_FAILED', detail });
  }
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
