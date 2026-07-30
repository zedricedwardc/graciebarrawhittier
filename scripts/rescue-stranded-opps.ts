#!/usr/bin/env node
/**
 * rescue-stranded-opps — moves opportunities stranded by the Jul 2026 stage-timer
 * failure (missing/misconfigured auto-move tails, see docs/superpowers/plans/
 * 2026-07-31-appointment-collapse-remediation.md) back into the pipeline stage
 * the timer should already have moved them to.
 *
 * Two independent populations, selected by scope:
 *   --scope=leads   (default) Overdue Lead Acquisition opps (never booked, past
 *                    their terminal deadline) → LOST/COLD. Sends no messages —
 *                    this is pure state correction.
 *   --scope=credits Idle Trial Credit Monitoring opps (CREDIT ACTIVE past its
 *                    14-day timer) → REACTIVATION. This FIRES the published
 *                    "Trial Active Reactivation Campaign" — live SMS/email to
 *                    real customers.
 *
 * Dry-run by default. Flags:
 *   --apply           Actually perform the moves (default: print only).
 *   --confirm          Required in addition to --apply whenever any selected
 *                       move has sendsMessages=true (i.e. --scope=credits).
 *   --limit=N           Cap the number of moves this run. Must be a NON-NEGATIVE
 *                       INTEGER. Default: 10 for credits, unlimited for leads.
 *
 * Usage:
 *   npx tsx scripts/rescue-stranded-opps.ts                              # dry-run, leads
 *   npx tsx scripts/rescue-stranded-opps.ts --scope=credits               # dry-run, credits
 *   npx tsx scripts/rescue-stranded-opps.ts --apply                       # APPLY, leads
 *   npx tsx scripts/rescue-stranded-opps.ts --scope=credits --apply --confirm
 *   npx tsx scripts/rescue-stranded-opps.ts --scope=credits --apply --confirm --limit=5
 */

import { config as loadEnv } from 'dotenv';
loadEnv();
// .env carries empty `PIPELINE_ID_*=` placeholders (reserved but unfilled for
// this account shape). dotenv does NOT override an already-set key by
// default, so without `override: true` those empty strings from .env would
// permanently shadow the real IDs in .env.local. Do not remove `override`.
loadEnv({ path: '.env.local', override: true });

import { selectOverdueLeadAcqOpps, selectIdleCreditOpps, type RescueOpp, type RescueMove } from '../src/lib/opp-rescue.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

// ─── Args ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const CONFIRM = argv.includes('--confirm');

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

const SCOPE = argValue('scope') ?? 'leads';
if (SCOPE !== 'leads' && SCOPE !== 'credits') {
  console.error(`FATAL: unknown --scope=${SCOPE} (expected 'leads' or 'credits')`);
  process.exit(1);
}

const limitArg = argValue('limit');
const LIMIT = limitArg !== undefined ? Number(limitArg) : SCOPE === 'credits' ? 10 : Infinity;
// `Infinity` is the leads-scope default (no cap) and is only reachable when no
// --limit was passed — special-case it before the integer check below.
if (!(limitArg === undefined && LIMIT === Infinity)) {
  // A negative limit is NOT a smaller blast radius: moves.slice(0, -5) returns
  // ALL BUT THE LAST 5, and moves are sorted most-overdue-first — so --limit=-5
  // would fire ~26 live reactivation drips instead of 5. Reject anything that is
  // not a non-negative integer, before any network call.
  if (!Number.isInteger(LIMIT) || LIMIT < 0) {
    console.error(
      `FATAL: --limit=${limitArg} is invalid — expected a non-negative integer. ` +
        'Negative values do NOT shrink the batch; they would WIDEN it (slice(0, -N) ' +
        'keeps all but the last N moves).',
    );
    process.exit(1);
  }
}

// Abort loudly before touching the network if the flag combination is unsafe.
if (APPLY && SCOPE === 'credits' && !CONFIRM) {
  console.error(
    'FATAL: --scope=credits --apply requires --confirm — these moves fire the live ' +
      'Trial Active Reactivation Campaign (real SMS/email to real customers).',
  );
  process.exit(1);
}

// ─── GHL HTTP helper ────────────────────────────────────────────────────────

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
    throw new Error(`${res.status} ${path}: ${t.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function locId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error('GHL_LOCATION_ID not set');
  return id;
}

/**
 * Pipeline IDs live in .env.local and were pasted from the GHL UI carrying a
 * UTF-8 BOM (﻿) *inside* the surrounding double quotes — e.g.
 * `PIPELINE_ID_LEAD_ACQ="﻿<pipeline-id>"`. dotenv strips the quotes
 * but not the BOM, so the raw env var is silently 1 char too long unless we
 * strip both here.
 */
function envId(name: string): string {
  let v = process.env[name] ?? '';
  v = v.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  v = v.replace(/﻿/g, '').trim();
  if (!v) throw new Error(`${name} not set (check .env.local)`);
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Stage { id: string; name: string }
interface Pipe { id: string; name: string; stages?: Stage[] }
interface Opp {
  id: string;
  contactId?: string;
  contact?: { id?: string };
  pipelineStageId?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

function contactIdOf(o: Opp): string | undefined {
  return o.contactId ?? o.contact?.id;
}

function resolve(pipes: Pipe[], pipeName: string, stageName: string): { pipeId: string; stageId: string } {
  const p = pipes.find((x) => x.name === pipeName);
  if (!p) throw new Error(`pipeline not found: ${pipeName}`);
  const s = (p.stages ?? []).find((x) => x.name === stageName);
  if (!s) throw new Error(`stage not found: ${pipeName} / ${stageName}`);
  return { pipeId: p.id, stageId: s.id };
}

/** Page through every opp in a pipeline (all statuses — the default omits won/lost). */
async function allOppsInPipeline(pipelineId: string): Promise<Opp[]> {
  const out: Opp[] = [];
  let page = 1;
  const limit = 100;
  for (;;) {
    const data = await ghl<{ opportunities?: Opp[] }>(
      `/opportunities/search?location_id=${encodeURIComponent(locId())}` +
        `&pipeline_id=${encodeURIComponent(pipelineId)}` +
        `&limit=${limit}&page=${page}&status=all`,
    );
    const batch = data.opportunities ?? [];
    out.push(...batch);
    if (batch.length < limit) break;
    page += 1;
    await sleep(150);
  }
  return out;
}

function toRescueOpp(o: Opp, stageNameById: Map<string, string>, trialConvContacts: Set<string>): RescueOpp | undefined {
  const contactId = contactIdOf(o);
  if (!contactId) return undefined;
  const stageName = stageNameById.get(o.pipelineStageId ?? '') ?? `(unknown:${o.pipelineStageId})`;
  return {
    id: o.id,
    contactId,
    stageName,
    createdAt: o.createdAt ?? new Date(0).toISOString(),
    updatedAt: o.updatedAt ?? o.createdAt ?? new Date(0).toISOString(),
    // These searches use status=all; an unknown/missing status must NOT default
    // to 'open' or a won/lost opp would become eligible for mutation.
    status: o.status ?? 'unknown',
    hasTrialConvOpp: trialConvContacts.has(contactId),
  };
}

async function main() {
  console.log(`\nrescue-stranded-opps — scope=${SCOPE} mode=${APPLY ? 'APPLY' : 'DRY-RUN'} limit=${LIMIT === Infinity ? 'none' : LIMIT}\n`);

  const { pipelines } = await ghl<{ pipelines: Pipe[] }>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locId())}`,
  );
  const stageNameById = new Map<string, string>();
  for (const p of pipelines) {
    for (const s of p.stages ?? []) stageNameById.set(s.id, s.name);
  }

  let moves: RescueMove[];

  if (SCOPE === 'leads') {
    const leadAcqOpps = await allOppsInPipeline(envId('PIPELINE_ID_LEAD_ACQ'));
    const trialConvOpps = await allOppsInPipeline(envId('PIPELINE_ID_TRIAL_CONV'));
    const trialConvContacts = new Set(
      trialConvOpps.map(contactIdOf).filter((c): c is string => Boolean(c)),
    );
    const rescueOpps = leadAcqOpps
      .map((o) => toRescueOpp(o, stageNameById, trialConvContacts))
      .filter((r): r is RescueOpp => Boolean(r));
    moves = selectOverdueLeadAcqOpps(rescueOpps, Date.now());
  } else {
    const creditMonOpps = await allOppsInPipeline(envId('PIPELINE_ID_CREDIT_MON'));
    const rescueOpps = creditMonOpps
      .map((o) => toRescueOpp(o, stageNameById, new Set<string>()))
      .filter((r): r is RescueOpp => Boolean(r));
    moves = selectIdleCreditOpps(rescueOpps, Date.now());
  }

  const total = moves.length;
  if (Number.isFinite(LIMIT)) moves = moves.slice(0, LIMIT);

  console.log(`Selected ${moves.length} of ${total} eligible move(s):\n`);
  for (const m of moves) {
    console.log(
      `  ${m.oppId}  ${m.fromStage} → ${m.toStage}  (${m.daysOverdue}d overdue)  status→${m.targetStatus}`,
    );
  }

  if (moves.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  const needsConfirm = moves.some((m) => m.sendsMessages);
  if (needsConfirm && APPLY && !CONFIRM) {
    // Re-checked here (not just for --scope=credits) as a safety net in case
    // future scopes/selectors ever produce sendsMessages=true moves.
    console.error(
      '\nFATAL: selected moves include at least one that sends live messages — pass --confirm to proceed.',
    );
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — nothing changed. Re-run with --apply to execute.');
    return;
  }

  const pipeName = SCOPE === 'leads' ? 'Lead Acquisition' : 'Trial Credit Monitoring';
  let done = 0;
  let failed = 0;
  for (const m of moves) {
    try {
      const { pipeId, stageId } = resolve(pipelines, pipeName, m.toStage);
      await ghl(`/opportunities/${encodeURIComponent(m.oppId)}`, {
        method: 'PUT',
        // Status comes from the move, not the call site: LOST / COLD is a
        // set_status:lost stage per STAGE_TRANSITIONS, and the GHL-side config
        // that should enforce that has drifted (which is why this rescue exists).
        body: { pipelineId: pipeId, pipelineStageId: stageId, status: m.targetStatus },
      });
      done += 1;
    } catch (err) {
      failed += 1;
      console.error(`  FAILED ${m.oppId}: ${String(err).slice(0, 160)}`);
    }
    // Credits fires a live drip per move — spread enrollments out so 31
    // reactivation campaigns don't all start in the same second.
    if (SCOPE === 'credits') await sleep(2000);
  }
  console.log(`\nDone. moved=${done} failed=${failed} of ${moves.length}.`);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
