#!/usr/bin/env node
/**
 * audit-messaging-health — read-only compensating control for the Jul 2026
 * booking-collapse failure modes (see docs/superpowers/plans/2026-07-31-
 * appointment-collapse-remediation.md).
 *
 * Stage auto-move timers live hand-configured inside GHL workflows, not driven
 * from STAGE_TRANSITIONS in code, so they can silently drift (they already have
 * once). This script re-derives the four failure-mode signals from live data on
 * every run:
 *   - duplicate outbound sends (same contact/channel/body twice inside 72h)
 *   - unanswered inbound replies (no outbound response within 24h SLA)
 *   - stage-timer health (overdue Lead Acq + idle Credit Monitoring opps)
 *   - weekly outbound volume / SMS failure rate / inbound reply count
 *
 * Read-only. Exits non-zero when ANY gated check fails (recent duplicates,
 * unanswered replies, idle credit opps, overdue Lead Acq opps) OR when the run
 * could not read all the data it needed to judge — see the `degraded` flag. A
 * cron only sees the exit code, so this must never print PASS about data it did
 * not read.
 *
 * Usage:
 *   npx tsx scripts/audit-messaging-health.ts
 *   npm run audit:messaging
 */

import { config as loadEnv } from 'dotenv';
loadEnv();
// .env carries empty `PIPELINE_ID_*=` placeholders (reserved but unfilled for
// this account shape). dotenv does NOT override an already-set key by
// default, so without `override: true` those empty strings from .env would
// permanently shadow the real IDs in .env.local. Do not remove `override`.
loadEnv({ path: '.env.local', override: true });

import { detectDuplicateSends, findUnansweredReplies, normaliseBody, type AuditMessage } from '../src/lib/messaging-audit.js';
import { selectOverdueLeadAcqOpps, selectIdleCreditOpps, type RescueOpp } from '../src/lib/opp-rescue.js';

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
interface Conversation { id: string; contactId?: string }
interface GhlMessage {
  id: string;
  messageType: string;
  contactId?: string;
  direction?: 'inbound' | 'outbound';
  dateAdded: string;
  body?: string;
  status?: string;
}

function contactIdOf(o: Opp): string | undefined {
  return o.contactId ?? o.contact?.id;
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
    // to 'open' or a won/lost opp would become eligible for the mutating path.
    status: o.status ?? 'unknown',
    hasTrialConvOpp: trialConvContacts.has(contactId),
  };
}

const HOUR_MS = 3_600_000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/** GHL page size used for both the conversation list and per-conversation messages. */
const PAGE_LIMIT = 100;

function bucketOffset(hoursApart: number): string {
  if (hoursApart <= 2) return '0-2h';
  if (hoursApart >= 23 && hoursApart <= 25) return '~24h';
  if (hoursApart >= 47 && hoursApart <= 49) return '~48h';
  if (hoursApart >= 50 && hoursApart <= 72) return '50-72h';
  return 'other';
}

async function main() {
  console.log('\naudit-messaging-health — read-only\n');

  // ── 1. Pipelines → stageId → stageName map ────────────────────────────────
  const { pipelines } = await ghl<{ pipelines: Pipe[] }>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locId())}`,
  );
  const stageNameById = new Map<string, string>();
  for (const p of pipelines) {
    for (const s of p.stages ?? []) stageNameById.set(s.id, s.name);
  }

  // ── 2. Opps for the three pipelines (status=all — else won/lost is dropped) ─
  const leadAcqOpps = await allOppsInPipeline(envId('PIPELINE_ID_LEAD_ACQ'));
  const trialConvOpps = await allOppsInPipeline(envId('PIPELINE_ID_TRIAL_CONV'));
  const creditMonOpps = await allOppsInPipeline(envId('PIPELINE_ID_CREDIT_MON'));

  const trialConvContacts = new Set(
    trialConvOpps.map(contactIdOf).filter((c): c is string => Boolean(c)),
  );

  const rescueOpps: RescueOpp[] = [];
  for (const o of [...leadAcqOpps, ...creditMonOpps]) {
    const r = toRescueOpp(o, stageNameById, trialConvContacts);
    if (r) rescueOpps.push(r);
  }

  const now = Date.now();
  const overdueLeadAcq = selectOverdueLeadAcqOpps(rescueOpps, now);
  const idleCredit = selectIdleCreditOpps(rescueOpps, now);

  // ── 3. Conversations + messages ────────────────────────────────────────────
  // Every path that loses data must be counted here and surfaced in the verdict.
  // A detector that reports PASS on data it never read is worse than no detector:
  // the outage this script exists to catch went unnoticed for six weeks.
  const degradedReasons: string[] = [];
  let unrecognisedShapeConvos = 0;
  let truncatedMessageConvos = 0;
  let droppedNoDirectionOrContact = 0;

  const { conversations } = await ghl<{ conversations?: Conversation[] }>(
    `/conversations/search?locationId=${encodeURIComponent(locId())}&limit=${PAGE_LIMIT}` +
      `&sortBy=last_message_date&sort=desc`,
  );
  const convoCount = conversations?.length ?? 0;
  if (convoCount >= PAGE_LIMIT) {
    degradedReasons.push(
      `conversation list hit the limit=${PAGE_LIMIT} cap (${convoCount} returned) — ` +
        'older conversations were never fetched, so every message-derived number below is a floor, not a total.',
    );
  }

  const allMessages: AuditMessage[] = [];
  for (const convo of conversations ?? []) {
    // GHL's published OpenAPI spec documents this endpoint's response as
    // `{ messages: [...] }` (a flat array). Production actually returns it
    // double-wrapped: `{ messages: { lastMessageId, nextPage, messages: [...] },
    // traceId }` — confirmed by a live call. Accept BOTH shapes and warn loudly
    // (never silently count 0) if a future response matches neither, so this
    // fallback is not "cleaned up" back down to a single assumed shape.
    const raw = await ghl<{
      messages?: GhlMessage[] | { messages?: GhlMessage[]; nextPage?: boolean | string | null };
    }>(`/conversations/${encodeURIComponent(convo.id)}/messages?limit=${PAGE_LIMIT}`);
    const wrapper = raw.messages;
    let msgs: GhlMessage[];
    let hasNextPage = false;
    if (Array.isArray(wrapper)) {
      msgs = wrapper; // shape per GHL's published spec
    } else if (Array.isArray(wrapper?.messages)) {
      msgs = wrapper.messages; // shape actually returned in production
      hasNextPage = Boolean(wrapper?.nextPage);
    } else {
      console.warn(
        `  WARN conversation ${convo.id}: unrecognised messages response shape — counted as 0. Investigate before trusting this run.`,
      );
      msgs = [];
      unrecognisedShapeConvos += 1;
    }
    // We deliberately do NOT paginate here — declaring the truncation is what
    // keeps the verdict honest; silently reading page 1 and calling it a total
    // is the failure this guard exists to prevent.
    if (msgs.length >= PAGE_LIMIT || hasNextPage) truncatedMessageConvos += 1;

    for (const m of msgs) {
      if (m.messageType !== 'TYPE_SMS' && m.messageType !== 'TYPE_EMAIL') continue;
      const contactId = m.contactId ?? convo.contactId;
      if (!contactId || !m.direction) {
        droppedNoDirectionOrContact += 1;
        continue;
      }
      allMessages.push({
        id: m.id,
        contactId,
        direction: m.direction,
        messageType: m.messageType,
        body: m.body ?? '',
        status: m.status,
        dateAdded: m.dateAdded,
      });
    }
    await sleep(150);
  }

  if (unrecognisedShapeConvos > 0) {
    degradedReasons.push(
      `${unrecognisedShapeConvos} of ${convoCount} conversation(s) returned an unrecognised messages ` +
        'response shape and were counted as 0 messages — GHL may have changed its response schema.',
    );
  }
  if (truncatedMessageConvos > 0) {
    degradedReasons.push(
      `${truncatedMessageConvos} of ${convoCount} conversation(s) hit the limit=${PAGE_LIMIT} message cap ` +
        'or reported a nextPage — their older messages were never read.',
    );
  }
  const degraded = degradedReasons.length > 0;

  // ── 4. Report ───────────────────────────────────────────────────────────────
  const weekAgo = now - WEEK_MS;

  const duplicates = detectDuplicateSends(allMessages, 72);
  const duplicateContacts = new Set(duplicates.map((d) => d.contactId));
  const dupBuckets = new Map<string, number>();
  for (const d of duplicates) {
    const b = bucketOffset(d.hoursApart);
    dupBuckets.set(b, (dupBuckets.get(b) ?? 0) + 1);
  }
  // Only duplicates whose LATER send landed in the recent window are gated.
  // The historical backlog sits in the fetched history forever (dormant
  // conversations never age out of it), so gating on the lifetime total would
  // be a permanently red alarm — and a permanently red alarm gets ignored,
  // which is exactly how the original outage went unnoticed for six weeks.
  const recentDuplicates = duplicates.filter((d) => Date.parse(d.sentAt) >= weekAgo);

  // Bodyless outbound messages are excluded from duplicate detection (an empty
  // body proves nothing). Report how many, so the exclusion is never invisible.
  const bodylessOutbound = allMessages.filter(
    (m) => m.direction === 'outbound' && normaliseBody(m.body) === '',
  ).length;

  const unanswered = findUnansweredReplies(allMessages, 24, now);

  const weeklyOutbound = allMessages.filter(
    (m) => m.direction === 'outbound' && Date.parse(m.dateAdded) >= weekAgo,
  );
  const weeklyOutboundFailed = weeklyOutbound.filter(
    (m) => m.status === 'failed' || m.status === 'undelivered',
  );
  const weeklyInbound = allMessages.filter(
    (m) => m.direction === 'inbound' && Date.parse(m.dateAdded) >= weekAgo,
  );
  const smsFailureRate = weeklyOutbound.length
    ? Math.round((weeklyOutboundFailed.length / weeklyOutbound.length) * 1000) / 10
    : 0;
  // The failed/undelivered test above is a closed allow-list against an
  // UNDOCUMENTED GHL enum — any other spelling ('bounced', 'rejected', a
  // capitalised variant) would silently count as delivered and report 0%.
  // Print every distinct status seen so an unrecognised value cannot hide.
  const outboundSmsStatuses = new Map<string, number>();
  for (const m of allMessages) {
    if (m.direction !== 'outbound' || m.messageType !== 'TYPE_SMS') continue;
    const k = m.status ?? '(none)';
    outboundSmsStatuses.set(k, (outboundSmsStatuses.get(k) ?? 0) + 1);
  }

  console.log('── Duplicate sends (same contact/channel/body within 72h) ──');
  console.log(
    `  recent (7d)=${recentDuplicates.length} [gated]   historical total=${duplicates.length} [informational]` +
      `   affected contacts=${duplicateContacts.size}`,
  );
  for (const [bucket, count] of ['0-2h', '~24h', '~48h', '50-72h', 'other'].map(
    (b) => [b, dupBuckets.get(b) ?? 0] as [string, number],
  )) {
    if (count > 0) console.log(`    ${bucket.padEnd(7)} ${count}`);
  }
  console.log(`  outbound messages skipped for having no body: ${bodylessOutbound}`);

  // findUnansweredReplies emits one row PER UNANSWERED TURN, not per contact —
  // a single contact can legitimately appear more than once. Report both units
  // so the count doesn't get misread as a conversation count.
  const unansweredContacts = new Set(unanswered.map((u) => u.contactId));
  console.log('\n── Unanswered inbound replies (no outbound reply within 24h) ──');
  console.log(
    `  unanswered turns=${unanswered.length}  affected contacts=${unansweredContacts.size}`,
  );
  for (const u of unanswered.slice(0, 20)) {
    console.log(`    ${u.contactId}  waiting ${u.hoursWaiting}h  "${u.body.slice(0, 60)}"`);
  }

  console.log('\n── Stage-timer health ──');
  console.log(`  overdue Lead Acq opps (should be LOST/COLD): ${overdueLeadAcq.length}`);
  console.log(`  idle Credit Monitoring opps (should be REACTIVATION): ${idleCredit.length}`);

  console.log('\n── Weekly volume (last 7 days) ──');
  console.log(`  outbound SMS/email sent: ${weeklyOutbound.length}`);
  console.log(`  outbound failed/undelivered: ${weeklyOutboundFailed.length} (${smsFailureRate}%)`);
  console.log(`  inbound replies: ${weeklyInbound.length}`);

  console.log('\n── Outbound SMS status histogram (all fetched history) ──');
  if (outboundSmsStatuses.size === 0) {
    console.log('  (no outbound SMS in the fetched window)');
  } else {
    for (const [status, count] of [...outboundSmsStatuses].sort((a, b) => b[1] - a[1])) {
      const known = status === 'failed' || status === 'undelivered' ? '' : '   <- not counted as a failure';
      console.log(`    ${status.padEnd(16)} ${count}${known}`);
    }
  }

  console.log('\n── Data-completeness ──');
  console.log(`  conversations fetched: ${convoCount}`);
  console.log(`  messages kept: ${allMessages.length}`);
  console.log(`  messages dropped (no direction or contactId): ${droppedNoDirectionOrContact}`);

  console.log('');

  // ── 5. Verdict ──────────────────────────────────────────────────────────────
  // Incompleteness outranks every other check: we cannot assert anything about
  // data we did not read, so declare it and exit non-zero regardless.
  if (degraded) {
    console.error('════════════════════════════════════════════════════════════════');
    console.error('INCOMPLETE — this run did not read all data:');
    for (const r of degradedReasons) console.error(`  • ${r}`);
    console.error('');
    console.error('  The checks above are therefore LOWER BOUNDS, not verdicts.');
    console.error('  Not reporting PASS. Fix the data-access gap, then re-run.');
    console.error('════════════════════════════════════════════════════════════════');
    process.exit(1);
  }

  const failures: string[] = [];
  if (recentDuplicates.length > 0) failures.push(`${recentDuplicates.length} recent duplicate send(s)`);
  if (unanswered.length > 0) {
    failures.push(`${unanswered.length} unanswered reply turn(s) across ${unansweredContacts.size} contact(s)`);
  }
  if (idleCredit.length > 0) failures.push(`${idleCredit.length} idle Credit Monitoring opp(s)`);
  if (overdueLeadAcq.length > 0) failures.push(`${overdueLeadAcq.length} overdue Lead Acq opp(s)`);

  if (failures.length > 0) {
    console.error(`FAIL — ${failures.join('; ')}.`);
    process.exit(1);
  }
  console.log(
    'PASS — no recent duplicate sends, no unanswered replies, no idle credit opps, no overdue Lead Acq opps.',
  );
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
