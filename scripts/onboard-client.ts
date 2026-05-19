#!/usr/bin/env node
/**
 * onboard-client — bootstrap a new GHL sub-account against config/ghl-schema.ts.
 *
 * Run with: `npm run onboard:ghl` (add this to package.json scripts).
 *
 * Three modes:
 *   1. CHECKLIST    — Print everything the operator needs to manually create in GHL UI.
 *                     This is the first invocation for every new client.
 *   2. DISCOVER     — After operator finishes UI work, query GHL to find IDs of the
 *                     pipelines, stages, custom fields, and workflows they created.
 *                     Writes the IDs to .env.client.local for copy-paste into Vercel.
 *   3. PROVISION    — Create the API-creatable assets (custom values, default tags).
 *                     Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run onboard:ghl              # interactive: prompts for mode
 *   npm run onboard:ghl checklist    # print checklist only
 *   npm run onboard:ghl discover     # discover IDs after manual UI work
 *   npm run onboard:ghl provision    # create custom values + base tags
 *
 * Env required:
 *   GHL_PIT_TOKEN           — Private Integration Token for the new sub-account
 *   GHL_LOCATION_ID         — sub-account location ID
 *
 * Output (DISCOVER mode): writes .env.client.local with discovered IDs.
 */

import {
  PIPELINES,
  CONTACT_CUSTOM_FIELDS,
  OPPORTUNITY_CUSTOM_FIELDS,
  CUSTOM_VALUES,
  WORKFLOWS,
  TAGS,
  ENV_VARS,
} from '../config/ghl-schema.js';
import { writeFileSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

// Load .env so PIT + LOCATION_ID are available
loadEnv();

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION_DEFAULT = '2021-07-28';

// ─── GHL HTTP helper (script-local; doesn't share Astro lib because that uses
//     import.meta.env which isn't populated outside the Astro runtime). ───────

interface FetchOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  version?: string;
}

async function ghl<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = process.env.GHL_PIT_TOKEN;
  if (!token) throw new Error('GHL_PIT_TOKEN env var not set (in .env or environment)');
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: opts.method ?? 'GET',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: opts.version ?? GHL_VERSION_DEFAULT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GHL ${opts.method ?? 'GET'} ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function locationId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error('GHL_LOCATION_ID env var not set (in .env or environment)');
  return id;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

type Mode = 'checklist' | 'discover' | 'provision';

const MODE: Mode = (process.argv[2] as Mode) || 'checklist';

const RULE = '─'.repeat(72);
const SECTION = '═'.repeat(72);

function header(title: string): void {
  console.log('\n' + SECTION);
  console.log(`  ${title}`);
  console.log(SECTION);
}

function subheader(title: string): void {
  console.log('\n' + RULE);
  console.log(`  ${title}`);
  console.log(RULE);
}

// ─── CHECKLIST mode ─────────────────────────────────────────────────────────

function printChecklist(): void {
  header('GHL Onboarding Checklist — Gracie Barra Whittier template');
  console.log(`
This script does not create pipelines, custom fields, or workflows automatically —
GHL's API does not support creating those programmatically (verified 2026-05-08).
Follow this checklist in GHL UI, then re-run \`npm run onboard:ghl discover\`.

Estimated time: 30–60 minutes.
`);

  // ─── Step 1: pipelines ────────────────────────────────────────────────────
  subheader('STEP 1 — Create 3 pipelines in GHL → Settings → Pipelines');
  for (const p of Object.values(PIPELINES)) {
    console.log(`\n  Pipeline: ${p.name}`);
    console.log(`    Description: ${p.description}`);
    console.log(`    Stages (in order, top to bottom):`);
    for (const stage of p.stages) {
      const isWon = stage === p.wonStage;
      const isLost = p.lostStages.includes(stage);
      const status = isWon ? ' [mark as WON]' : isLost ? ' [mark as LOST]' : '';
      console.log(`      • ${stage}${status}`);
    }
  }

  // ─── Step 2: contact custom fields ────────────────────────────────────────
  subheader('STEP 2 — Create Contact Custom Fields in GHL → Settings → Custom Fields → Contact');
  for (const f of CONTACT_CUSTOM_FIELDS) {
    console.log(`  • Field Key: ${f.fieldKey}`);
    console.log(`      Label: ${f.label}`);
    console.log(`      Type:  ${f.type}`);
    console.log(`      Description: ${f.description}`);
    console.log('');
  }

  // ─── Step 3: opportunity custom fields ────────────────────────────────────
  subheader('STEP 3 — Create Opportunity Custom Fields in GHL → Settings → Custom Fields → Opportunity');
  console.log('  IMPORTANT: These need to be available across ALL 3 pipelines.');
  console.log('');
  for (const f of OPPORTUNITY_CUSTOM_FIELDS) {
    console.log(`  • Field Key: ${f.fieldKey}`);
    console.log(`      Label: ${f.label}`);
    console.log(`      Type:  ${f.type}`);
    console.log(`      Description: ${f.description}`);
    console.log('');
  }

  // ─── Step 4: workflows ────────────────────────────────────────────────────
  subheader('STEP 4 — Create Workflows in GHL → Automation → Workflows');
  console.log(`  ${WORKFLOWS.length} workflows total. Group them by purpose.\n`);
  for (const w of WORKFLOWS) {
    console.log(`  • ${w.name}`);
    console.log(`      Env var:     ${w.envVarKey}`);
    console.log(`      Description: ${w.description}`);
    console.log(`      Trigger:     ${formatTrigger(w.trigger)}`);
    if (w.callsWebsiteWebhook) {
      console.log(`      Action:      Webhook → POST ${w.callsWebsiteWebhook.path}`);
      console.log(`                   Custom Header: X-GBW-Secret: {{custom_values.ghl_webhook_secret}}`);
      console.log(`                   (or paste the GHL_WEBHOOK_SECRET env value directly)`);
    }
    console.log('');
  }

  // ─── Step 5: env vars ─────────────────────────────────────────────────────
  subheader('STEP 5 — Set required env vars in Vercel project (or .env)');
  console.log(`  ${ENV_VARS.filter((v) => v.required).length} required env vars.`);
  console.log('  Generate secrets with: openssl rand -hex 32 (or 16 for HEALTH_KEY).');
  console.log('  Pipeline + workflow IDs are populated by `npm run onboard:ghl discover` after Step 4.');
  console.log('');
  for (const v of ENV_VARS) {
    const tag = v.required ? '[REQUIRED]' : '[optional]';
    console.log(`  ${tag} ${v.key}`);
    console.log(`           ${v.description}`);
  }

  // ─── Final ────────────────────────────────────────────────────────────────
  header('Next steps');
  console.log(`
  1. Complete Steps 1–4 in GHL UI.
  2. Run: npm run onboard:ghl provision
       Creates Custom Values + base tags via API. Idempotent.
  3. Run: npm run onboard:ghl discover
       Discovers pipeline + workflow IDs and writes .env.client.local.
  4. Copy .env.client.local values into Vercel project env vars.
  5. Trigger a Vercel redeploy.
  6. Open https://<your-domain>/api/health/ghl?key=<HEALTH_KEY>
       Returns ok:true and lists any drift.
`);
}

function formatTrigger(t: (typeof WORKFLOWS)[number]['trigger']): string {
  switch (t.type) {
    case 'manual_enroll':
      return 'Manual enrollment (called via API by website)';
    case 'opp_stage_changed':
      return `Opportunity Stage Changed → Pipeline=${t.pipelineKey} → Stage=${t.enterStage}`;
    case 'opp_stage_any':
      return `Opportunity Stage Changed → Pipeline=${t.pipelineKey} → Any stage`;
    case 'appointment_status_changed':
      return `Appointment Status Changed → Calendar=${t.calendarFilter}`;
    case 'webhook_inbound':
      return `Inbound Webhook (${t.description})`;
  }
}

// ─── DISCOVER mode ──────────────────────────────────────────────────────────

async function runDiscover(): Promise<void> {
  header('Discover IDs from live GHL state');

  const drift: string[] = [];
  const envLines: string[] = [
    '# Generated by `npm run onboard:ghl discover` on ' + new Date().toISOString(),
    '# Copy these into your Vercel project Environment Variables.',
    '#',
    '# Required secrets (NOT discoverable — generate manually with `openssl rand -hex 32`):',
    '#   GHL_WEBHOOK_SECRET   CANCEL_SIGNING_KEY   REBOOK_SIGNING_KEY   HEALTH_KEY',
    '',
  ];

  // ─── 1. Pipelines ────────────────────────────────────────────────────────
  subheader('1. Pipelines');
  let livePipelines: { id: string; name: string; stages?: { id: string; name: string }[] }[] = [];
  try {
    const r = await ghl<{ pipelines: typeof livePipelines }>(
      `/opportunities/pipelines?locationId=${encodeURIComponent(locationId())}`,
    );
    livePipelines = r.pipelines ?? [];
  } catch (err) {
    drift.push(`Pipeline fetch failed: ${(err as Error).message}`);
    console.error(`  ❌ ${(err as Error).message}`);
    return finishDiscover(drift, envLines);
  }
  const liveByName = new Map(livePipelines.map((p) => [normalize(p.name), p]));
  for (const def of Object.values(PIPELINES)) {
    const live = liveByName.get(normalize(def.name));
    if (!live) {
      drift.push(`Pipeline missing: ${def.name}`);
      console.log(`  ❌ ${def.name} — not found in GHL`);
      continue;
    }
    envLines.push(`PIPELINE_ID_${def.key}=${live.id}`);
    console.log(`  ✅ ${def.name} = ${live.id}`);
    // Verify stages
    const liveStages = new Set((live.stages ?? []).map((s) => normalize(s.name)));
    for (const stage of def.stages) {
      if (!liveStages.has(normalize(stage))) {
        drift.push(`Stage missing in "${def.name}": ${stage}`);
        console.log(`     ⚠️  stage missing: ${stage}`);
      }
    }
  }

  // ─── 2. Contact custom fields ────────────────────────────────────────────
  subheader('2. Contact custom fields');
  type RawCf = { id: string; fieldKey?: string; name?: string; model?: string };
  let liveContactCfs: RawCf[] = [];
  try {
    const r = await ghl<{ customFields: RawCf[] }>(
      `/locations/${encodeURIComponent(locationId())}/customFields?model=all`,
    );
    liveContactCfs = r.customFields ?? [];
  } catch (err) {
    drift.push(`Contact CF fetch failed: ${(err as Error).message}`);
    console.error(`  ❌ ${(err as Error).message}`);
  }
  const cfByKey = new Map<string, RawCf>();
  for (const f of liveContactCfs) {
    if (!f.fieldKey) continue;
    cfByKey.set(f.fieldKey, f);
    // GHL stores `<model>.<bare>` (e.g. "contact.trainee_key").
    // Index the bare-key form so schema lookups match.
    const dot = f.fieldKey.indexOf('.');
    if (dot > 0) cfByKey.set(f.fieldKey.slice(dot + 1), f);
  }
  for (const def of CONTACT_CUSTOM_FIELDS) {
    const live = cfByKey.get(def.fieldKey);
    if (!live) {
      drift.push(`Contact CF missing: ${def.fieldKey}`);
      console.log(`  ❌ ${def.fieldKey} — not found in GHL`);
    } else {
      console.log(`  ✅ ${def.fieldKey} = ${live.id}`);
    }
  }

  // Opportunity CFs are discovered lazily off opp records — flag for awareness only.
  console.log(
    `\n  ℹ️  Opportunity custom fields (${OPPORTUNITY_CUSTOM_FIELDS.length} expected) — ` +
      `verify in GHL UI; they're discovered lazily at runtime when opps are read.`,
  );

  // ─── 3. Workflows ────────────────────────────────────────────────────────
  subheader('3. Workflows');
  type RawWf = { id: string; name: string };
  let liveWorkflows: RawWf[] = [];
  try {
    const r = await ghl<{ workflows: RawWf[] }>(
      `/workflows/?locationId=${encodeURIComponent(locationId())}`,
    );
    liveWorkflows = r.workflows ?? [];
  } catch (err) {
    // Some GHL versions use /workflows; others use a different path. Fail soft.
    console.warn(`  ⚠️  Workflow list endpoint failed: ${(err as Error).message}`);
    console.warn(`     You may need to copy workflow IDs from GHL UI manually.`);
  }
  const wfByName = new Map(liveWorkflows.map((w) => [normalize(w.name), w]));
  for (const w of WORKFLOWS) {
    const live = wfByName.get(normalize(w.name));
    if (!live) {
      drift.push(`Workflow missing: ${w.name}`);
      console.log(`  ❌ ${w.name} — not found in GHL`);
      envLines.push(`# ${w.envVarKey}=  # workflow not found: "${w.name}"`);
    } else {
      envLines.push(`${w.envVarKey}=${live.id}`);
      console.log(`  ✅ ${w.name} = ${live.id}`);
    }
  }

  finishDiscover(drift, envLines);
}

function finishDiscover(drift: string[], envLines: string[]): void {
  // ─── 4. Write .env.client.local ─────────────────────────────────────────
  subheader('4. Writing .env.client.local');
  const out = envLines.join('\n') + '\n';
  writeFileSync('.env.client.local', out, 'utf8');
  console.log(`  ✅ Wrote .env.client.local (${envLines.length} lines)`);

  // ─── 5. Drift report ─────────────────────────────────────────────────────
  if (drift.length === 0) {
    header('✅ All schema entries resolved against live GHL state.');
    console.log(`
  Next steps:
    1. Copy contents of .env.client.local into Vercel project env vars
    2. Set the 4 secrets manually (GHL_WEBHOOK_SECRET, CANCEL_SIGNING_KEY,
       REBOOK_SIGNING_KEY, HEALTH_KEY) using openssl rand -hex 32
    3. Trigger a Vercel redeploy
    4. Verify: GET /api/health/ghl?key=<HEALTH_KEY>
       Should return { ok: true, drift: [] }
`);
  } else {
    header(`⚠️  ${drift.length} drift entries found`);
    for (const d of drift) console.log(`  • ${d}`);
    console.log(`
  Action required:
    Fix the drift entries above in GHL UI (typically by creating the
    missing pipelines/stages/CFs/workflows with the EXACT names from
    config/ghl-schema.ts), then re-run \`npm run onboard:ghl discover\`.
`);
  }
}

// ─── PROVISION mode ─────────────────────────────────────────────────────────

async function runProvision(): Promise<void> {
  header('Provision API-creatable assets (Custom Values)');

  // Tags don't need provisioning — created implicitly on first contact apply.
  // Just log what's expected:
  subheader('Tags (created implicitly when first applied)');
  for (const t of TAGS) {
    console.log(`  • ${t.name}  — ${t.description}`);
  }

  // ─── Custom Values ──────────────────────────────────────────────────────
  subheader('Custom Values (creating idempotently)');

  // 1. Fetch existing
  type RawCv = { id: string; name?: string; fieldKey?: string; value?: unknown };
  let existing: RawCv[] = [];
  try {
    const r = await ghl<{ customValues: RawCv[] }>(
      `/locations/${encodeURIComponent(locationId())}/customValues`,
    );
    existing = r.customValues ?? [];
  } catch (err) {
    console.error(`  ❌ Could not list existing custom values: ${(err as Error).message}`);
    console.error(`     Aborting — fix the API access first.`);
    process.exit(1);
  }
  // GHL stores Custom Value fieldKey as a Mustache template
  // (e.g. "{{ custom_values.trial_credits_default }}") and the `key` field is null.
  // Match by name (1:1 with schema.name) instead.
  const existingByName = new Map<string, RawCv>();
  for (const cv of existing) {
    if (cv.name) existingByName.set(cv.name.trim().toLowerCase(), cv);
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const def of CUSTOM_VALUES) {
    const live = existingByName.get(def.name.trim().toLowerCase());
    if (live) {
      console.log(`  ⏭️  ${def.fieldKey} already exists (${live.id}) — skipping`);
      skipped++;
      continue;
    }
    try {
      await ghl(`/locations/${encodeURIComponent(locationId())}/customValues`, {
        method: 'POST',
        body: { name: def.name, value: def.defaultValue },
      });
      console.log(`  ✅ created ${def.fieldKey} = "${def.defaultValue}"`);
      created++;
    } catch (err) {
      console.error(`  ❌ failed to create ${def.fieldKey}: ${(err as Error).message}`);
      failed++;
    }
  }

  // ─── Custom Fields (Contact + Opportunity) ──────────────────────────────
  subheader('Custom Fields (creating idempotently)');

  // Fetch existing contact + opportunity CFs (model=all returns both)
  type RawCf = { id: string; name?: string; fieldKey?: string; model?: string; dataType?: string };
  let existingCfs: RawCf[] = [];
  try {
    const r = await ghl<{ customFields: RawCf[] }>(
      `/locations/${encodeURIComponent(locationId())}/customFields?model=all`,
    );
    existingCfs = r.customFields ?? [];
  } catch (err) {
    console.error(`  ❌ Could not list existing custom fields: ${(err as Error).message}`);
    console.error(`     Aborting field provisioning — fix the API access first.`);
    process.exit(1);
  }

  // Index by `model.bareKey`. Derive model from the fieldKey prefix because
  // the LIST endpoint doesn't always include a `model` field on the record.
  const cfByKey = new Map<string, RawCf>();
  for (const f of existingCfs) {
    if (!f.fieldKey) continue;
    const dot = f.fieldKey.indexOf('.');
    if (dot > 0) {
      // Already prefixed (e.g. "opportunity.trainee_key") — use as-is.
      cfByKey.set(f.fieldKey, f);
    } else {
      // Bare — fall back to whatever model the record claims, default contact.
      cfByKey.set(`${f.model ?? 'contact'}.${f.fieldKey}`, f);
    }
  }

  // Map our schema CustomFieldType → GHL dataType
  const TYPE_MAP: Record<string, string> = {
    TEXT: 'TEXT',
    TEXTAREA: 'LARGE_TEXT',
    NUMBER: 'NUMERICAL',
    DATE: 'DATE',
    DROPDOWN_SINGLE: 'SINGLE_OPTIONS',
  };

  async function provisionCfBatch(
    defs: readonly { fieldKey: string; label: string; type: string; options?: readonly string[] }[],
    model: 'contact' | 'opportunity',
  ): Promise<{ created: number; skipped: number; failed: number }> {
    let c = 0, s = 0, fc = 0;
    for (const def of defs) {
      const lookupKey = `${model}.${def.fieldKey}`;
      if (cfByKey.has(lookupKey)) {
        console.log(`  ⏭️  [${model}] ${def.fieldKey} already exists — skipping`);
        s++;
        continue;
      }
      const dataType = TYPE_MAP[def.type];
      if (!dataType) {
        console.error(`  ❌ [${model}] ${def.fieldKey}: unknown schema type "${def.type}"`);
        fc++;
        continue;
      }
      // SINGLE_OPTIONS fields require their selectable options at create time.
      if (dataType === 'SINGLE_OPTIONS' && (!def.options || def.options.length === 0)) {
        console.error(`  ❌ [${model}] ${def.fieldKey}: DROPDOWN_SINGLE field has no options`);
        fc++;
        continue;
      }
      try {
        await ghl(`/locations/${encodeURIComponent(locationId())}/customFields`, {
          method: 'POST',
          body: {
            name: def.label,
            dataType,
            model,
            ...(def.options ? { options: [...def.options] } : {}),
          },
        });
        console.log(`  ✅ [${model}] created ${def.fieldKey} (${dataType})`);
        c++;
      } catch (err) {
        console.error(`  ❌ [${model}] failed ${def.fieldKey}: ${(err as Error).message}`);
        fc++;
      }
    }
    return { created: c, skipped: s, failed: fc };
  }

  console.log(`\n  Contact custom fields (${CONTACT_CUSTOM_FIELDS.length}):`);
  const contactRes = await provisionCfBatch(CONTACT_CUSTOM_FIELDS, 'contact');
  console.log(`\n  Opportunity custom fields (${OPPORTUNITY_CUSTOM_FIELDS.length}):`);
  const oppRes = await provisionCfBatch(OPPORTUNITY_CUSTOM_FIELDS, 'opportunity');

  const cfCreated = contactRes.created + oppRes.created;
  const cfSkipped = contactRes.skipped + oppRes.skipped;
  const cfFailed = contactRes.failed + oppRes.failed;

  // ─── Summary ────────────────────────────────────────────────────────────
  header(`Provision complete`);
  console.log(`  Custom Values:  ${created} created, ${skipped} skipped, ${failed} failed`);
  console.log(`  Custom Fields:  ${cfCreated} created, ${cfSkipped} skipped, ${cfFailed} failed`);
  if (failed > 0 || cfFailed > 0) {
    console.log(`\n  ⚠️  Some failures — re-run after fixing, or create manually in GHL UI.`);
    process.exit(1);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  switch (MODE) {
    case 'checklist':
      printChecklist();
      break;
    case 'discover':
      await runDiscover();
      break;
    case 'provision':
      await runProvision();
      break;
    default:
      console.error(`Unknown mode: ${MODE}. Use one of: checklist | discover | provision`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('onboard-client failed:', err);
  process.exit(1);
});
