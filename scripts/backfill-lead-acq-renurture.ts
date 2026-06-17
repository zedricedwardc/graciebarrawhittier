#!/usr/bin/env node
/**
 * backfill-lead-acq-renurture — one-off backfill for the LOST/COLD re-nurture fix.
 *
 * Context: the stage-changed webhook only moved a Lead Acq opp back to NURTURE
 * CAMPAIGN when the Trial Conv opp went LOST/COLD *and* the Lead Acq opp was
 * status=won. Opps in any other state were silently skipped, so leads whose
 * trial went cold are now sitting in Lead Acq LOST/COLD with no last-chance
 * nurture. This script re-nurtures them.
 *
 * Target (Lead Acq opps currently in LOST/COLD):
 *   --scope=trial (default) : only contacts who ALSO have a Trial Conv LOST/COLD
 *                             opp — i.e. the trial-driven set the fix addresses.
 *   --scope=all             : every Lead Acq LOST/COLD opp (broad sweep — includes
 *                             leads who never booked a trial).
 *
 * Action per target: move the Lead Acq opp to NURTURE CAMPAIGN, status=open.
 * This re-fires the Nurture Campaign workflow (live SMS/email drip) — so this is
 * outward-facing. Dry-run by default; pass --apply to actually mutate.
 *
 * Usage:
 *   tsx scripts/backfill-lead-acq-renurture.ts                 # dry-run, trial scope
 *   tsx scripts/backfill-lead-acq-renurture.ts --scope=all     # dry-run, all cold
 *   tsx scripts/backfill-lead-acq-renurture.ts --apply         # APPLY, trial scope
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

const GHL_BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

const APPLY = process.argv.includes('--apply');

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Stage { id: string; name: string }
interface Pipe { id: string; name: string; stages?: Stage[] }
interface Opp {
  id: string;
  name?: string;
  contactId?: string;
  contact?: { id?: string };
  pipelineStageId?: string;
  status?: string;
}

/** Search a single contact's opps within a pipeline (all statuses). */
async function oppsForContact(pipelineId: string, contactId: string): Promise<Opp[]> {
  const data = await ghl<{ opportunities?: Opp[] }>(
    `/opportunities/search?location_id=${encodeURIComponent(locId())}` +
      `&pipeline_id=${encodeURIComponent(pipelineId)}` +
      `&contact_id=${encodeURIComponent(contactId)}&limit=20`,
  );
  return data.opportunities ?? [];
}

/** Page through every opp in a pipeline stage. */
async function allOppsInStage(pipelineId: string, stageId: string): Promise<Opp[]> {
  const out: Opp[] = [];
  let page = 1;
  const limit = 100;
  for (;;) {
    const data = await ghl<{ opportunities?: Opp[]; meta?: { total?: number } }>(
      `/opportunities/search?location_id=${encodeURIComponent(locId())}` +
        `&pipeline_id=${encodeURIComponent(pipelineId)}` +
        `&pipeline_stage_id=${encodeURIComponent(stageId)}` +
        `&limit=${limit}&page=${page}`,
    );
    const batch = data.opportunities ?? [];
    out.push(...batch);
    if (batch.length < limit) break;
    page += 1;
    await sleep(150); // be gentle on the API
  }
  return out;
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

async function main() {
  console.log(`\nbackfill-lead-acq-renurture — mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const { pipelines } = await ghl<{ pipelines: Pipe[] }>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locId())}`,
  );

  const leadAcqPipe = pipelines.find((p) => p.name === 'Lead Acquisition');
  if (!leadAcqPipe) throw new Error('Lead Acquisition pipeline not found');
  const stageNameById = new Map((leadAcqPipe.stages ?? []).map((s) => [s.id, s.name]));
  const leadAcqNurture = resolve(pipelines, 'Lead Acquisition', 'NURTURE CAMPAIGN');
  const trialCold = resolve(pipelines, 'Trial Conversion', 'LOST / COLD');

  // Contacts whose trial went cold — the population the fix is about.
  const trialColdOpps = await allOppsInStage(trialCold.pipeId, trialCold.stageId);
  const trialColdContacts = [...new Set(trialColdOpps.map(contactIdOf).filter(Boolean) as string[])];
  console.log(`Trial Conversion LOST/COLD: ${trialColdOpps.length} opps, ${trialColdContacts.length} unique contacts\n`);

  // For each, find the current Lead Acq opp and where it sits.
  // Reset target = opp already in NURTURE CAMPAIGN but flagged won/lost. We only
  // change `status` (NOT the stage), so the nurture drip — which is triggered by
  // stage-entry, not status — is NOT re-fired. This just corrects the stale flag
  // so the dashboard count and the auto-move-to-LOST timer behave.
  const dist = new Map<string, number>();
  const resetTargets: { opp: Opp; status: string }[] = [];
  let noLeadOpp = 0;
  for (const cid of trialColdContacts) {
    const opps = await oppsForContact(leadAcqPipe.id, cid);
    const lead = opps[0]; // one Lead Acq opp per parent contact
    if (!lead) { noLeadOpp += 1; dist.set('(no Lead Acq opp)', (dist.get('(no Lead Acq opp)') ?? 0) + 1); continue; }
    const stageName = stageNameById.get(lead.pipelineStageId ?? '') ?? `(unknown:${lead.pipelineStageId})`;
    const label = `${stageName} [${lead.status ?? '?'}]`;
    dist.set(label, (dist.get(label) ?? 0) + 1);
    if (lead.pipelineStageId === leadAcqNurture.stageId && lead.status !== 'open') {
      resetTargets.push({ opp: lead, status: lead.status ?? '?' });
    }
    await sleep(150);
  }

  console.log('Current Lead Acquisition location of those contacts:');
  for (const [k, v] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)}  ${k}`);
  }
  if (noLeadOpp) console.log(`\n(${noLeadOpp} contact(s) have no Lead Acq opp at all — can't re-nurture.)`);

  console.log(`\nIn NURTURE CAMPAIGN but not open → ${resetTargets.length} opp(s) to reset status=open:`);
  for (const t of resetTargets) {
    console.log(`  ${t.opp.id}  ${t.opp.name ?? ''}  (${t.status} → open)`);
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — nothing changed. Re-run with --apply to execute.');
    return;
  }

  let fixed = 0;
  let failed = 0;
  for (const { opp } of resetTargets) {
    try {
      // status-only PUT — no pipelineStageId, so no stage-entry workflow re-fires.
      await ghl(`/opportunities/${encodeURIComponent(opp.id)}`, {
        method: 'PUT',
        body: { status: 'open' },
      });
      fixed += 1;
      await sleep(250);
    } catch (err) {
      failed += 1;
      console.error(`  FAILED ${opp.id}: ${String(err).slice(0, 160)}`);
    }
  }
  console.log(`\nDone. reset=${fixed} failed=${failed} of ${resetTargets.length}.`);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
