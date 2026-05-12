#!/usr/bin/env node
/**
 * audit-ghl — comprehensive bidirectional drift audit of the GHL sub-account
 * against config/ghl-schema.ts AND src/ code references.
 *
 * Usage: tsx scripts/audit-ghl.ts
 *
 * Reports five classes of issue:
 *   1. MISSING_IN_LIVE   — schema declares it, GHL doesn't have it
 *   2. ORPHAN_IN_LIVE    — GHL has it, schema doesn't declare it
 *   3. NAME_DRIFT        — fieldKey/name mismatch between schema & live
 *   4. SCHEMA_DEAD       — schema declares it, no src/ code reads/writes it
 *   5. CODE_ONLY         — src/ references it, schema doesn't declare it
 */

import {
  PIPELINES,
  CONTACT_CUSTOM_FIELDS,
  OPPORTUNITY_CUSTOM_FIELDS,
  CUSTOM_VALUES,
  WORKFLOWS,
  TAGS,
} from '../config/ghl-schema.js';
import { config as loadEnv } from 'dotenv';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

loadEnv();

const GHL_BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

async function ghl<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = process.env.GHL_PIT_TOKEN;
  if (!token) throw new Error('GHL_PIT_TOKEN not set');
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: opts.method ?? 'GET',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: VERSION,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GHL ${opts.method ?? 'GET'} ${path} → ${res.status}: ${t.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function locId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error('GHL_LOCATION_ID not set');
  return id;
}

const norm = (s: string) => s.trim().toLowerCase();

// ─── Walk src/ to build a corpus for code-reference checks ─────────────────
function walk(dir: string, exts = ['.ts', '.tsx', '.astro']): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const srcFiles = walk('src');
const srcCorpus = srcFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
const refsCode = (needle: string): boolean => srcCorpus.includes(needle);

// ─── Banner ────────────────────────────────────────────────────────────────
const RULE = '─'.repeat(78);
function section(t: string) {
  console.log('\n' + '═'.repeat(78));
  console.log('  ' + t);
  console.log('═'.repeat(78));
}
function sub(t: string) {
  console.log('\n' + t);
  console.log(RULE);
}

async function main() {
  console.log(`Auditing GHL location: ${locId()}`);
  console.log(`PIT: ${(process.env.GHL_PIT_TOKEN ?? '').slice(0, 12)}…`);
  console.log(`Time: ${new Date().toISOString()}`);

  const issues: { class: string; item: string }[] = [];
  const push = (cls: string, item: string) => issues.push({ class: cls, item });

  // ─── PIPELINES ───────────────────────────────────────────────────────────
  section('1. PIPELINES');
  type LivePipe = { id: string; name: string; stages?: { id: string; name: string }[] };
  let livePipes: LivePipe[] = [];
  try {
    const r = await ghl<{ pipelines: LivePipe[] }>(
      `/opportunities/pipelines?locationId=${encodeURIComponent(locId())}`,
    );
    livePipes = r.pipelines ?? [];
  } catch (e) {
    console.error(`❌ Pipeline fetch failed: ${(e as Error).message}`);
    push('FETCH_FAILED', 'pipelines');
  }
  const liveByName = new Map(livePipes.map((p) => [norm(p.name), p]));
  const expectedNames = new Set(Object.values(PIPELINES).map((p) => norm(p.name)));

  for (const def of Object.values(PIPELINES)) {
    const live = liveByName.get(norm(def.name));
    if (!live) {
      console.log(`❌ MISSING:  ${def.name}`);
      push('MISSING_IN_LIVE', `pipeline:${def.name}`);
      continue;
    }
    console.log(`✅ ${def.name}  (id=${live.id})`);
    const liveStages = new Set((live.stages ?? []).map((s) => norm(s.name)));
    const expectedStages = new Set(def.stages.map(norm));
    for (const s of def.stages) {
      if (!liveStages.has(norm(s))) {
        console.log(`   ❌ stage missing: ${s}`);
        push('MISSING_IN_LIVE', `pipeline:${def.name}/stage:${s}`);
      }
    }
    for (const s of live.stages ?? []) {
      if (!expectedStages.has(norm(s.name))) {
        console.log(`   ⚠️  extra live stage (not in schema): ${s.name}`);
        push('ORPHAN_IN_LIVE', `pipeline:${def.name}/stage:${s.name}`);
      }
    }
  }
  for (const live of livePipes) {
    if (!expectedNames.has(norm(live.name))) {
      console.log(`⚠️  ORPHAN live pipeline (not in schema): ${live.name}`);
      push('ORPHAN_IN_LIVE', `pipeline:${live.name}`);
    }
  }

  // ─── CUSTOM FIELDS (contact + opportunity) ───────────────────────────────
  section('2. CUSTOM FIELDS');
  type LiveCf = { id: string; name?: string; fieldKey?: string; model?: string; dataType?: string };
  let liveCfs: LiveCf[] = [];
  try {
    const r = await ghl<{ customFields: LiveCf[] }>(
      `/locations/${encodeURIComponent(locId())}/customFields?model=all`,
    );
    liveCfs = r.customFields ?? [];
  } catch (e) {
    console.error(`❌ CF fetch failed: ${(e as Error).message}`);
    push('FETCH_FAILED', 'custom-fields');
  }

  const cfByModelKey = new Map<string, LiveCf>(); // "model.barekey" → live
  const allLiveKeys = new Set<string>();
  for (const f of liveCfs) {
    if (!f.fieldKey) continue;
    const dot = f.fieldKey.indexOf('.');
    if (dot > 0) {
      cfByModelKey.set(f.fieldKey, f);
      allLiveKeys.add(f.fieldKey);
    } else {
      const m = f.model ?? 'contact';
      cfByModelKey.set(`${m}.${f.fieldKey}`, f);
      allLiveKeys.add(`${m}.${f.fieldKey}`);
    }
  }

  function auditCfs(
    defs: readonly { fieldKey: string; label: string; type: string; setBy: string }[],
    model: 'contact' | 'opportunity',
  ) {
    sub(`${model.toUpperCase()} fields — schema declares ${defs.length}`);
    for (const def of defs) {
      const lookup = `${model}.${def.fieldKey}`;
      const live = cfByModelKey.get(lookup);
      const codeRef = refsCode(def.fieldKey);
      if (!live) {
        console.log(`❌ MISSING in live: ${lookup} ("${def.label}")`);
        push('MISSING_IN_LIVE', `cf:${lookup}`);
      } else {
        const codeFlag = codeRef ? '' : '   ⚠️ NEVER READ IN src/';
        console.log(`✅ ${lookup}  (id=${live.id})${codeFlag}`);
        if (!codeRef) push('SCHEMA_DEAD', `cf:${lookup}`);
      }
    }
  }
  auditCfs(CONTACT_CUSTOM_FIELDS, 'contact');
  auditCfs(OPPORTUNITY_CUSTOM_FIELDS, 'opportunity');

  // Orphans: live CFs not in schema
  sub('Live CFs not declared in schema (orphans)');
  const schemaKeys = new Set([
    ...CONTACT_CUSTOM_FIELDS.map((f) => `contact.${f.fieldKey}`),
    ...OPPORTUNITY_CUSTOM_FIELDS.map((f) => `opportunity.${f.fieldKey}`),
  ]);
  let orphanCount = 0;
  for (const f of liveCfs) {
    if (!f.fieldKey) continue;
    const k = f.fieldKey.includes('.') ? f.fieldKey : `${f.model ?? 'contact'}.${f.fieldKey}`;
    if (!schemaKeys.has(k)) {
      console.log(`⚠️  ORPHAN: ${k}  (live id=${f.id}, label="${f.name ?? '?'}")`);
      push('ORPHAN_IN_LIVE', `cf:${k}`);
      orphanCount++;
    }
  }
  if (orphanCount === 0) console.log('  (none)');

  // ─── CUSTOM VALUES ───────────────────────────────────────────────────────
  section('3. CUSTOM VALUES');
  type LiveCv = { id: string; name?: string; fieldKey?: string; value?: unknown };
  let liveCvs: LiveCv[] = [];
  try {
    const r = await ghl<{ customValues: LiveCv[] }>(
      `/locations/${encodeURIComponent(locId())}/customValues`,
    );
    liveCvs = r.customValues ?? [];
  } catch (e) {
    console.error(`❌ CV fetch failed: ${(e as Error).message}`);
    push('FETCH_FAILED', 'custom-values');
  }

  // GHL keys CVs by `name` (1:1 with schema name); fieldKey may be Mustache template.
  const cvByName = new Map(liveCvs.map((c) => [norm(c.name ?? ''), c]));

  sub('Custom Values — schema vs live');
  for (const def of CUSTOM_VALUES) {
    const live = cvByName.get(norm(def.name));
    const codeRef = refsCode(def.fieldKey);
    if (!live) {
      console.log(`❌ MISSING: "${def.name}"  (schema fieldKey=${def.fieldKey})`);
      push('MISSING_IN_LIVE', `cv:${def.fieldKey}`);
      continue;
    }
    // Try to extract the actual GHL-generated fieldKey from the template
    const liveKeyRaw = String(live.fieldKey ?? '');
    const m = /custom_values\.([\w]+)/.exec(liveKeyRaw);
    const liveKey = m ? m[1] : '';
    const keyDrift = liveKey && liveKey !== def.fieldKey;
    const codeFlag = codeRef ? '' : '   ⚠️ NEVER READ IN src/';
    const driftFlag = keyDrift ? `   ❗ KEY DRIFT: schema="${def.fieldKey}" live="${liveKey}"` : '';
    console.log(`✅ "${def.name}"  value="${String(live.value ?? '')}"${codeFlag}${driftFlag}`);
    if (!codeRef) push('SCHEMA_DEAD', `cv:${def.fieldKey}`);
    if (keyDrift) push('NAME_DRIFT', `cv:schema=${def.fieldKey},live=${liveKey}`);
  }

  // Orphans: live CVs not in schema
  sub('Live CVs not declared in schema (orphans)');
  const schemaCvNames = new Set(CUSTOM_VALUES.map((c) => norm(c.name)));
  let orphanCv = 0;
  for (const c of liveCvs) {
    if (!schemaCvNames.has(norm(c.name ?? ''))) {
      const liveKeyRaw = String(c.fieldKey ?? '');
      const m = /custom_values\.([\w]+)/.exec(liveKeyRaw);
      console.log(`⚠️  ORPHAN: "${c.name}"  (fieldKey=${m ? m[1] : '?'}, value="${String(c.value ?? '')}")`);
      push('ORPHAN_IN_LIVE', `cv:${c.name}`);
      orphanCv++;
    }
  }
  if (orphanCv === 0) console.log('  (none)');

  // ─── WORKFLOWS ───────────────────────────────────────────────────────────
  section('4. WORKFLOWS');
  type LiveWf = { id: string; name: string; status?: string };
  let liveWfs: LiveWf[] = [];
  try {
    const r = await ghl<{ workflows: LiveWf[] }>(
      `/workflows/?locationId=${encodeURIComponent(locId())}`,
    );
    liveWfs = r.workflows ?? [];
  } catch (e) {
    console.error(`❌ Workflow fetch failed: ${(e as Error).message}`);
    push('FETCH_FAILED', 'workflows');
  }
  const wfByName = new Map(liveWfs.map((w) => [norm(w.name), w]));
  const schemaWfNames = new Set(WORKFLOWS.map((w) => norm(w.name)));

  sub('Schema workflows vs live');
  for (const w of WORKFLOWS) {
    const live = wfByName.get(norm(w.name));
    const codeRef = refsCode(w.envVarKey);
    if (!live) {
      console.log(`❌ MISSING: ${w.name}`);
      push('MISSING_IN_LIVE', `wf:${w.name}`);
      continue;
    }
    const codeFlag = codeRef ? '' : '   ℹ️  envVarKey not read in src/ (fired by GHL, not website)';
    console.log(`✅ ${w.name}  (id=${live.id}, status=${live.status ?? '?'})${codeFlag}`);
    if (!codeRef) push('SCHEMA_DEAD', `wf:${w.envVarKey}`);
  }

  sub('Live workflows not declared in schema (orphans)');
  let orphanWf = 0;
  for (const w of liveWfs) {
    if (!schemaWfNames.has(norm(w.name))) {
      console.log(`⚠️  ORPHAN: ${w.name}  (id=${w.id}, status=${w.status ?? '?'})`);
      push('ORPHAN_IN_LIVE', `wf:${w.name}`);
      orphanWf++;
    }
  }
  if (orphanWf === 0) console.log('  (none)');

  // ─── CALENDARS ───────────────────────────────────────────────────────────
  section('5. CALENDARS');
  type LiveCal = { id: string; name?: string };
  let liveCals: LiveCal[] = [];
  try {
    const r = await ghl<{ calendars: LiveCal[] }>(
      `/calendars/?locationId=${encodeURIComponent(locId())}`,
    );
    liveCals = r.calendars ?? [];
  } catch (e) {
    console.error(`❌ Calendar fetch failed: ${(e as Error).message}`);
    push('FETCH_FAILED', 'calendars');
  }

  // Compare against env-set calendar IDs
  const calEnvVars = [
    'GHL_CAL_TINY', 'GHL_CAL_LC1', 'GHL_CAL_LC2', 'GHL_CAL_JUNIORS', 'GHL_CAL_ADULTS',
    'GHL_CAL_BTM_TINY', 'GHL_CAL_BTM_LC1', 'GHL_CAL_BTM_LC2', 'GHL_CAL_BTM_JUNIORS', 'GHL_CAL_BTM_ADULTS',
  ];
  const liveById = new Map(liveCals.map((c) => [c.id, c]));
  sub(`Live calendars (${liveCals.length})`);
  for (const c of liveCals) console.log(`  ${c.id}  "${c.name ?? '?'}"`);

  sub('Env-mapped calendars');
  for (const v of calEnvVars) {
    const id = process.env[v];
    if (!id) {
      console.log(`⚠️  ${v} not set in env`);
      continue;
    }
    const live = liveById.get(id);
    if (!live) {
      console.log(`❌ ${v}=${id} → not in live (stale ID?)`);
      push('MISSING_IN_LIVE', `cal:${v}=${id}`);
    } else {
      console.log(`✅ ${v}=${id}  "${live.name}"`);
    }
  }

  // ─── TAGS ───────────────────────────────────────────────────────────────
  section('6. TAGS');
  type LiveTag = { id?: string; name: string };
  let liveTags: LiveTag[] = [];
  try {
    const r = await ghl<{ tags: LiveTag[] }>(
      `/locations/${encodeURIComponent(locId())}/tags`,
    );
    liveTags = r.tags ?? [];
  } catch (e) {
    console.warn(`⚠️  Tag fetch failed (endpoint may not be available): ${(e as Error).message}`);
  }
  const liveTagSet = new Set(liveTags.map((t) => norm(t.name)));

  sub('Schema tags vs live');
  for (const t of TAGS) {
    const inLive = liveTagSet.has(norm(t.name));
    // Tag may be referenced via template `source-${input.source}` — match the prefix too
    const codeRef = refsCode(t.name) || (t.name.startsWith('source-') && refsCode('source-${'));
    const live = inLive ? '✅ live' : '— not yet applied to any contact';
    const code = codeRef ? '✅ code' : '⚠️  not in src/';
    console.log(`${live.padEnd(40)} ${code.padEnd(20)} ${t.name}`);
    if (!codeRef) push('SCHEMA_DEAD', `tag:${t.name}`);
  }

  sub('Live tags not declared in schema (orphans)');
  const schemaTagSet = new Set(TAGS.map((t) => norm(t.name)));
  let orphanTags = 0;
  for (const t of liveTags) {
    const n = norm(t.name);
    if (!schemaTagSet.has(n) && !n.startsWith('source-')) {
      console.log(`⚠️  ORPHAN: ${t.name}`);
      push('ORPHAN_IN_LIVE', `tag:${t.name}`);
      orphanTags++;
    }
  }
  if (orphanTags === 0) console.log('  (none)');

  // ─── CODE-ONLY workflows (referenced in src/ but not in schema) ──────────
  section('7. CODE-ONLY references (in src/, missing from schema)');
  const codeOnlyWf = ['WORKFLOW_ID_ADMIN_NOTIFICATION', 'WORKFLOW_ID_CANCEL_FOLLOWUP'];
  const schemaEnvKeys = new Set(WORKFLOWS.map((w) => w.envVarKey));
  for (const k of codeOnlyWf) {
    if (refsCode(k) && !schemaEnvKeys.has(k)) {
      console.log(`⚠️  ${k}  — read by src/ but not in WORKFLOWS schema`);
      push('CODE_ONLY', `wf:${k}`);
    }
  }

  // ─── SUMMARY ─────────────────────────────────────────────────────────────
  section('SUMMARY');
  const byClass = new Map<string, number>();
  for (const i of issues) byClass.set(i.class, (byClass.get(i.class) ?? 0) + 1);
  if (issues.length === 0) {
    console.log('✅ No issues found. Schema, live GHL state, and src/ code all aligned.');
  } else {
    for (const [cls, n] of byClass) console.log(`  ${cls}: ${n}`);
    console.log(`\n  Total: ${issues.length} items flagged`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
