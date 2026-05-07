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
 *
 * NOTE: Phase 0 implementation is the CHECKLIST printer + scaffolded DISCOVER/PROVISION.
 * Discover and Provision API calls are stubbed — they call into ghl-adapter which lands
 * in Phase 1. Once Phase 1 ships, fill in the TODOs.
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
  console.log(`
  TODO (Phase 1): implement once src/lib/ghl-pipelines.ts and ghl-custom-fields.ts ship.
  Will:
    1. GET /opportunities/pipelines?locationId=<id>  → match by name → write PIPELINE_ID_*
    2. GET /custom-fields/...                         → match by fieldKey → cache for runtime
    3. GET /workflows                                 → match by name → write WORKFLOW_ID_*
    4. Compose .env.client.local from results
    5. Print drift report (any schema entries with no live match)
`);
  process.exit(0);
}

// ─── PROVISION mode ─────────────────────────────────────────────────────────

async function runProvision(): Promise<void> {
  header('Provision API-creatable assets (Custom Values, base tags)');
  console.log(`
  TODO (Phase 1): implement once src/lib/ghl.ts has createCustomValue + addTag.
  Will:
    1. For each entry in CUSTOM_VALUES: PUT /locations/:id/customValues (idempotent upsert)
    2. For each entry in TAGS: ensure tag exists (created implicitly on first contact apply)
    3. Print summary of what was created vs. already existed
`);

  console.log('\n  Custom values that would be created:');
  for (const cv of CUSTOM_VALUES) {
    console.log(`    • ${cv.fieldKey} = "${cv.defaultValue}"  (${cv.description})`);
  }

  console.log('\n  Tags that would be ensured:');
  for (const t of TAGS) {
    console.log(`    • ${t.name}  — ${t.description}`);
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
