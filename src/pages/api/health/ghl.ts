/**
 * GET /api/health/ghl?key=<HEALTH_KEY>
 *
 * Bootstrap + drift-detection endpoint. Verifies that the live GHL state
 * matches config/ghl-schema.ts and that env vars resolve.
 *
 * Used both as an onboarding diagnostic (after operator finishes UI work) and
 * as an ongoing health check (cron every 6h in production, post drift to admin).
 *
 * Behavior:
 *   1. Verifies HEALTH_KEY in query string (so /api/health/ghl isn't a public scrape target)
 *   2. Refreshes pipeline cache → checks all schema pipelines + stages exist live
 *   3. Refreshes contact custom-field cache → checks all schema CFs exist live
 *   4. Verifies expected env vars are set
 *   5. Returns ok:true if everything matches; ok:false with `drift` array otherwise
 */

import type { APIRoute } from 'astro';
import { refreshPipelines, snapshotPipelines } from '../../../lib/ghl-pipelines';
import { refreshContactCustomFields, snapshotCustomFields } from '../../../lib/ghl-custom-fields';
import { currentRateLimit, GhlError } from '../../../lib/ghl-rate-limit';
import { readEnv } from '../../../lib/ghl';
import { ENV_VARS } from '../../../../config/ghl-schema';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const provided = url.searchParams.get('key') ?? '';
  const expected = readEnv('HEALTH_KEY');
  if (!expected) {
    return json({ ok: false, error: 'HEALTH_KEY env var not set on server.' }, 500);
  }
  if (provided !== expected) {
    return json({ ok: false, error: 'INVALID_KEY' }, 401);
  }

  const drift: string[] = [];
  const result: Record<string, unknown> = {
    ok: false,
    timestamp: new Date().toISOString(),
  };

  // ─── 1. PIT verification (implicit — first GHL call below will 401 if bad) ──

  // ─── 2. Pipelines ────────────────────────────────────────────────────────
  try {
    const pipelineResult = await refreshPipelines();
    result.pipelines = {
      resolved: pipelineResult.resolved,
      missing: pipelineResult.missing,
    };
    for (const m of pipelineResult.missing) {
      drift.push(`Pipeline missing in GHL: ${m}`);
    }
  } catch (err) {
    const msg = err instanceof GhlError
      ? `Pipeline fetch failed: ${err.status} ${err.bodyText.slice(0, 100)}`
      : `Pipeline fetch failed: ${(err as Error).message}`;
    result.pipelines = { error: msg };
    drift.push(msg);
  }

  // ─── 3. Contact custom fields ────────────────────────────────────────────
  try {
    const cfResult = await refreshContactCustomFields();
    result.contactCustomFields = {
      resolved: cfResult.resolved,
      missing: cfResult.missing,
    };
    for (const m of cfResult.missing) {
      drift.push(`Contact custom field missing in GHL: ${m}`);
    }
  } catch (err) {
    const msg = err instanceof GhlError
      ? `Contact CF fetch failed: ${err.status} ${err.bodyText.slice(0, 100)}`
      : `Contact CF fetch failed: ${(err as Error).message}`;
    result.contactCustomFields = { error: msg };
    drift.push(msg);
  }

  // ─── 4. Opportunity custom fields (best-effort — discovered lazily via opp reads) ──
  try {
    result.opportunityCustomFields = snapshotCustomFields().opportunity;
    const oppMissing = (result.opportunityCustomFields as { missing: string[] }).missing;
    if (oppMissing.length > 0) {
      drift.push(
        `Opportunity custom fields not yet discovered: ${oppMissing.join(', ')} ` +
        `(discovered lazily; not necessarily missing — read any opp first)`,
      );
    }
  } catch {
    // Non-fatal
  }

  // ─── 5. Env vars ─────────────────────────────────────────────────────────
  const envMissing: string[] = [];
  for (const v of ENV_VARS) {
    if (!v.required) continue;
    const value = readEnv(v.key);
    if (!value || value.trim() === '') envMissing.push(v.key);
  }
  result.env = {
    expected: ENV_VARS.length,
    requiredMissing: envMissing,
  };
  for (const m of envMissing) drift.push(`Required env var not set: ${m}`);

  // ─── 6. Snapshot (for env-var population) ───────────────────────────────
  try {
    const snap = await snapshotPipelines();
    result.resolved = {
      pipelines: snap.pipelines,
      // Opportunity CF map (whatever's been discovered so far)
      ...snapshotCustomFields(),
    };
  } catch {
    // Non-fatal — captured in earlier sections
  }

  result.rateLimit = currentRateLimit();
  result.drift = drift;
  result.ok = drift.length === 0;

  return json(result, 200);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
