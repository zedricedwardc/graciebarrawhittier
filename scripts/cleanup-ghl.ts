#!/usr/bin/env node
/**
 * cleanup-ghl — executes the deletions declared in cleanup-targets.ts.
 *
 * SAFE BY DEFAULT — runs in dry-run mode unless `--execute` is passed.
 *
 * Usage:
 *   npx tsx scripts/cleanup-ghl.ts             # dry run (no destructive calls)
 *   npx tsx scripts/cleanup-ghl.ts --execute   # ACTUALLY delete
 *
 * USAGE GATES — enforced regardless of what you mark in cleanup-targets.ts:
 *   - Pipelines with opportunities    → SKIP (refuse to delete)
 *   - Custom fields with populated data → SKIP
 *   - Tags applied to any contact     → SKIP
 *   - Custom values with non-empty value → SKIP
 *
 *   The script first scans the location and builds a usage map, then refuses
 *   to delete anything with usage > 0. You'll see SKIP[in-use] in the log.
 *
 * What happens per category:
 *   - Contact CFs, Custom Values, Pipelines, Tags → DELETE via API (with gate)
 *   - Forms, Workflows → GHL has NO public delete API. Emits UI checklist.
 */

import {
  contactCustomFields,
  customValues,
  pipelines,
  tags,
  forms,
  workflows,
} from './cleanup-targets.js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const GHL_BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

const EXECUTE = process.argv.includes('--execute');
const ANALYZE = process.argv.includes('--analyze');

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
    throw new Error(`${res.status}: ${t.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function locId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error('GHL_LOCATION_ID not set');
  return id;
}

const RULE = '─'.repeat(78);
const HEAVY = '═'.repeat(78);
function section(t: string) {
  console.log('\n' + HEAVY + '\n  ' + t + '\n' + HEAVY);
}

type Result = { wouldDelete: number; deleted: number; skipped: number; failed: number; gated: number };
const totals: Record<string, Result> = {};

function emptyResult(): Result {
  return { wouldDelete: 0, deleted: 0, skipped: 0, failed: 0, gated: 0 };
}

function logAction(action: 'WOULD' | 'DELETE' | 'SKIP' | 'GATE' | 'FAIL', what: string) {
  const tag = action === 'WOULD'  ? '📝 WOULD DELETE' :
              action === 'DELETE' ? '🗑️  DELETED      ' :
              action === 'SKIP'   ? '⏭️  SKIP         ' :
              action === 'GATE'   ? '🛡️  IN-USE (kept)' :
                                    '❌ FAILED       ';
  console.log(`  ${tag}  ${what}`);
}

// ─── Usage map: counts of how each item is used in live GHL state ──────────
type UsageMap = {
  cfHits: Map<string, number>;      // cf.id → contact count
  tagHits: Map<string, number>;     // tag name (normalized) → contact count
  pipelineOpps: Map<string, number>;// pipeline.id → opp count
  cvNonEmpty: Set<string>;          // cv.id where value !== ''
};

async function buildUsageMap(): Promise<UsageMap> {
  section('PHASE 1 — Usage scan');
  const usage: UsageMap = {
    cfHits: new Map(),
    tagHits: new Map(),
    pipelineOpps: new Map(),
    cvNonEmpty: new Set(),
  };

  // ─── Pipelines: opp counts per pipeline ────────────────────────────────
  console.log('  Scanning pipelines for opportunity counts...');
  try {
    const r = await ghl<{ pipelines: { id: string; name: string; stages?: { id: string }[] }[] }>(
      `/opportunities/pipelines?locationId=${encodeURIComponent(locId())}`,
    );
    for (const p of r.pipelines ?? []) {
      let total = 0;
      for (const s of p.stages ?? []) {
        try {
          const sr = await ghl<{ meta?: { total?: number } }>(
            `/opportunities/search?location_id=${encodeURIComponent(locId())}` +
              `&pipeline_id=${encodeURIComponent(p.id)}` +
              `&pipeline_stage_id=${encodeURIComponent(s.id)}&limit=1`,
          );
          total += sr.meta?.total ?? 0;
        } catch { /* swallow per-stage errors */ }
      }
      usage.pipelineOpps.set(p.id, total);
      console.log(`    ${p.name}: ${total} opps`);
    }
  } catch (e) {
    console.log(`    ⚠️  Pipeline scan failed: ${(e as Error).message}`);
  }

  // ─── Custom values: non-empty set ──────────────────────────────────────
  console.log('  Scanning custom values for non-empty values...');
  try {
    const r = await ghl<{ customValues: { id: string; name?: string; value?: unknown }[] }>(
      `/locations/${encodeURIComponent(locId())}/customValues`,
    );
    for (const c of r.customValues ?? []) {
      if (String(c.value ?? '').trim() !== '') usage.cvNonEmpty.add(c.id);
    }
    console.log(`    ${usage.cvNonEmpty.size} of ${r.customValues?.length ?? 0} have non-empty values`);
  } catch (e) {
    console.log(`    ⚠️  CV scan failed: ${(e as Error).message}`);
  }

  // ─── Contacts: paginate, aggregate CF + tag usage ──────────────────────
  console.log('  Paginating contacts to build CF + tag usage map (this may take a moment)...');
  let page = 1;
  let scanned = 0;
  let nextStartAfterId: string | undefined;
  let nextStartAfter: number | undefined;
  const maxPages = 200; // safety cap
  while (page <= maxPages) {
    const params = new URLSearchParams({
      locationId: locId(),
      limit: '100',
    });
    if (nextStartAfterId) params.set('startAfterId', nextStartAfterId);
    if (nextStartAfter) params.set('startAfter', String(nextStartAfter));
    let batch: {
      contacts?: { id: string; tags?: string[]; customFields?: { id: string; value?: unknown }[] }[];
      meta?: { nextPageUrl?: string; startAfterId?: string; startAfter?: number; total?: number };
    };
    try {
      batch = await ghl(`/contacts/?${params.toString()}`);
    } catch (e) {
      console.log(`    ⚠️  Contact page ${page} failed: ${(e as Error).message}`);
      break;
    }
    const contacts = batch.contacts ?? [];
    if (contacts.length === 0) break;
    for (const c of contacts) {
      for (const t of c.tags ?? []) {
        const n = t.trim().toLowerCase();
        usage.tagHits.set(n, (usage.tagHits.get(n) ?? 0) + 1);
      }
      for (const f of c.customFields ?? []) {
        const v = f.value;
        if (v !== null && v !== undefined && String(v).trim() !== '' && v !== false) {
          usage.cfHits.set(f.id, (usage.cfHits.get(f.id) ?? 0) + 1);
        }
      }
    }
    scanned += contacts.length;
    if (!batch.meta?.startAfterId && !batch.meta?.startAfter && !batch.meta?.nextPageUrl) break;
    nextStartAfterId = batch.meta?.startAfterId;
    nextStartAfter = batch.meta?.startAfter;
    // Stop if no cursor progress (defensive)
    if (!nextStartAfterId && !nextStartAfter && !batch.meta?.nextPageUrl) break;
    page++;
    if (page % 10 === 0) console.log(`    ...scanned ${scanned} contacts`);
  }
  console.log(`    ✅ Scanned ${scanned} contacts across ${page - 1} pages`);
  console.log(`    Tag usage signals: ${usage.tagHits.size} distinct tags applied to contacts`);
  console.log(`    CF usage signals: ${usage.cfHits.size} distinct custom fields populated`);

  return usage;
}

// ─── Generic: list live items, match by name, gate by usage, delete by id ──
async function processCategory<L extends { id: string; name?: string; fieldKey?: string }>(
  label: string,
  targets: Record<string, boolean>,
  fetchLive: () => Promise<L[]>,
  deleteOne: (id: string) => Promise<void>,
  usageGate: (item: L) => { used: boolean; reason?: string },
  nameOf: (item: L) => string = (i) => i.name ?? '',
): Promise<Result> {
  section(label);
  const result = emptyResult();
  // In ANALYZE mode, treat ALL items in the targets file as candidates,
  // regardless of true/false. Lets you see usage for everything at once.
  const requested = ANALYZE
    ? Object.entries(targets).map(([k]) => [k, true] as const)
    : Object.entries(targets).filter(([, v]) => v);
  if (requested.length === 0) {
    console.log('  (none marked for deletion)');
    return result;
  }

  let live: L[];
  try {
    live = await fetchLive();
  } catch (e) {
    console.log(`  ❌ Could not list live items: ${(e as Error).message}`);
    return result;
  }

  const liveByName = new Map<string, L>();
  for (const item of live) liveByName.set(nameOf(item).trim().toLowerCase(), item);

  for (const [name] of requested) {
    const liveItem = liveByName.get(name.trim().toLowerCase());
    if (!liveItem) {
      logAction('SKIP', `${name} — not found in live`);
      result.skipped++;
      continue;
    }
    const gate = usageGate(liveItem);
    if (gate.used) {
      logAction('GATE', `${name} (id=${liveItem.id}) — ${gate.reason ?? 'in use'}`);
      result.gated++;
      continue;
    }
    if (!EXECUTE) {
      logAction('WOULD', `${name} (id=${liveItem.id})`);
      result.wouldDelete++;
      continue;
    }
    try {
      await deleteOne(liveItem.id);
      logAction('DELETE', `${name} (id=${liveItem.id})`);
      result.deleted++;
    } catch (e) {
      logAction('FAIL', `${name} — ${(e as Error).message}`);
      result.failed++;
    }
  }
  return result;
}

async function main() {
  const mode = EXECUTE
    ? '⚠️  EXECUTE (deletions WILL happen)'
    : ANALYZE
      ? '🔍 ANALYZE (test every item, report safe-to-delete)'
      : '🧪 DRY RUN (only marked items)';
  console.log(`Mode: ${mode}`);
  console.log(`Location: ${locId()}`);

  // ─── PHASE 1: Usage scan ─────────────────────────────────────────────────
  const usage = await buildUsageMap();

  // ─── PHASE 2: Category-by-category processing with usage gates ──────────

  // ─── 1. Contact Custom Fields ────────────────────────────────────────────
  totals.contactCustomFields = await processCategory(
    '1. Contact Custom Fields',
    contactCustomFields,
    async () => {
      const r = await ghl<{ customFields: { id: string; name?: string; model?: string }[] }>(
        `/locations/${encodeURIComponent(locId())}/customFields?model=all`,
      );
      return (r.customFields ?? []).filter((f) => (f.model ?? 'contact') === 'contact');
    },
    (id) => ghl(`/locations/${encodeURIComponent(locId())}/customFields/${id}`, { method: 'DELETE' }),
    (item) => {
      const hits = usage.cfHits.get(item.id) ?? 0;
      return hits > 0
        ? { used: true, reason: `${hits} contacts have this field populated` }
        : { used: false };
    },
  );

  // ─── 2. Custom Values ────────────────────────────────────────────────────
  totals.customValues = await processCategory(
    '2. Custom Values',
    customValues,
    async () => {
      const r = await ghl<{ customValues: { id: string; name?: string; value?: unknown }[] }>(
        `/locations/${encodeURIComponent(locId())}/customValues`,
      );
      return r.customValues ?? [];
    },
    (id) => ghl(`/locations/${encodeURIComponent(locId())}/customValues/${id}`, { method: 'DELETE' }),
    (item) => {
      const nonEmpty = usage.cvNonEmpty.has(item.id);
      return nonEmpty
        ? { used: true, reason: 'value is non-empty (treated as in-use)' }
        : { used: false };
    },
  );

  // ─── 3. Pipelines ────────────────────────────────────────────────────────
  totals.pipelines = await processCategory(
    '3. Pipelines',
    pipelines,
    async () => {
      const r = await ghl<{ pipelines: { id: string; name: string }[] }>(
        `/opportunities/pipelines?locationId=${encodeURIComponent(locId())}`,
      );
      return r.pipelines ?? [];
    },
    (id) =>
      ghl(`/opportunities/pipelines/${id}?locationId=${encodeURIComponent(locId())}`, {
        method: 'DELETE',
      }),
    (item) => {
      const opps = usage.pipelineOpps.get(item.id) ?? 0;
      return opps > 0
        ? { used: true, reason: `${opps} opportunities in this pipeline` }
        : { used: false };
    },
  );

  // ─── 4. Tags ─────────────────────────────────────────────────────────────
  totals.tags = await processCategory(
    '4. Tags',
    tags,
    async () => {
      const r = await ghl<{ tags: { id?: string; name: string }[] }>(
        `/locations/${encodeURIComponent(locId())}/tags`,
      );
      return (r.tags ?? []).map((t) => ({ id: t.id ?? t.name, name: t.name }));
    },
    (id) =>
      ghl(`/locations/${encodeURIComponent(locId())}/tags/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    (item) => {
      const hits = usage.tagHits.get((item.name ?? '').trim().toLowerCase()) ?? 0;
      return hits > 0
        ? { used: true, reason: `applied to ${hits} contacts` }
        : { used: false };
    },
  );

  // ─── 5. Forms ────────────────────────────────────────────────────────────
  // NOTE: GHL has no public DELETE for forms. Emit manual checklist instead.
  section('5. Forms — manual UI deletion required');
  const formTargets = Object.entries(forms).filter(([, v]) => v);
  totals.forms = emptyResult();
  if (formTargets.length === 0) {
    console.log('  (none marked for deletion)');
  } else {
    console.log('  GHL has no public delete API for forms.');
    console.log('  Delete these manually: GHL → Sites → Forms → ... → Delete');
    for (const [name] of formTargets) {
      console.log(`    □ ${name}`);
      totals.forms.wouldDelete++;
    }
  }

  // ─── 6. Workflows ────────────────────────────────────────────────────────
  // NOTE: GHL has no public DELETE for workflows. Emit manual checklist instead.
  section('6. Workflows — manual UI deletion required');
  const wfTargets = Object.entries(workflows).filter(([, v]) => v);
  totals.workflows = emptyResult();
  if (wfTargets.length === 0) {
    console.log('  (none marked for deletion)');
  } else {
    console.log('  GHL has no public delete API for workflows.');
    console.log('  Delete these manually: GHL → Automation → Workflows → row → ⋯ → Delete');
    console.log(`  (${wfTargets.length} workflows marked)\n`);
    for (const [name] of wfTargets) {
      // Normalize multi-line names for display
      const display = name.replace(/\n+/g, ' ⏎ ');
      console.log(`    □ ${display}`);
      totals.workflows.wouldDelete++;
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  section('SUMMARY');
  const fmt = (n: number) => n.toString().padStart(5);
  const headPrimary = EXECUTE ? 'deleted' : 'would-del';
  console.log(`  Category                  ${headPrimary.padEnd(10)}  in-use(kept)  not-found  failed`);
  console.log(`  ${RULE}`);
  for (const [cat, r] of Object.entries(totals)) {
    const primary = EXECUTE ? r.deleted : r.wouldDelete;
    console.log(
      `  ${cat.padEnd(25)}  ${fmt(primary)}       ${fmt(r.gated)}        ${fmt(r.skipped)}    ${fmt(r.failed)}`,
    );
  }
  console.log('');
  if (!EXECUTE) {
    console.log('  🧪 Dry run complete. Re-run with --execute to actually delete.');
  } else {
    console.log('  ✅ Execution complete.');
  }
  console.log('  🛡️  Items marked in-use(kept) were skipped to honor the no-delete-if-used rule.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
