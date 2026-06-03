#!/usr/bin/env node
/**
 * audit-ghl-inventory — full sub-account inventory with usage signals.
 *
 * Schema-agnostic. Reports what's actually IN the sub-account and how much
 * it's being used (opp counts per pipeline stage, populated CFs on contacts,
 * workflow status, etc.).
 *
 * Usage: tsx scripts/audit-ghl-inventory.ts
 */

import { config as loadEnv } from 'dotenv';
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
    throw new Error(`${res.status}: ${t.slice(0, 200)}`);
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
  console.log('\n' + HEAVY);
  console.log('  ' + t);
  console.log(HEAVY);
}
function sub(t: string) {
  console.log('\n' + t);
  console.log(RULE);
}

async function tryFetch<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.log(`  ⚠️  ${label}: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  console.log(`Sub-account inventory: ${locId()}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // ─── 1. Location info ────────────────────────────────────────────────────
  section('1. LOCATION INFO');
  const loc = await tryFetch('location', async () => {
    return await ghl<{ location: Record<string, unknown> }>(
      `/locations/${encodeURIComponent(locId())}`,
    );
  });
  if (loc?.location) {
    const l = loc.location as Record<string, unknown>;
    console.log(`  Name:     ${l.name ?? '?'}`);
    console.log(`  Business: ${l.business ?? '?'}`);
    console.log(`  Address:  ${l.address ?? '?'}, ${l.city ?? '?'}, ${l.state ?? '?'} ${l.postalCode ?? ''}`);
    console.log(`  Phone:    ${l.phone ?? '?'}`);
    console.log(`  Email:    ${l.email ?? '?'}`);
    console.log(`  Website:  ${l.website ?? '?'}`);
    console.log(`  Timezone: ${l.timezone ?? '?'}`);
    console.log(`  Country:  ${l.country ?? '?'}`);
  }

  // ─── 2. Pipelines + opp counts per stage ─────────────────────────────────
  section('2. PIPELINES + OPP COUNTS PER STAGE');
  type Stage = { id: string; name: string };
  type Pipe = { id: string; name: string; stages?: Stage[] };
  const pipeResp = await tryFetch('pipelines', () =>
    ghl<{ pipelines: Pipe[] }>(`/opportunities/pipelines?locationId=${encodeURIComponent(locId())}`),
  );
  const pipes = pipeResp?.pipelines ?? [];

  for (const p of pipes) {
    sub(`Pipeline: ${p.name}  (id=${p.id})`);
    // Count opps per stage by searching with pipelineStageId
    let totalInPipe = 0;
    for (const s of p.stages ?? []) {
      const search = await tryFetch(`opp count ${p.name}/${s.name}`, () =>
        ghl<{ meta?: { total?: number }; opportunities?: unknown[] }>(
          `/opportunities/search?location_id=${encodeURIComponent(locId())}` +
            `&pipeline_id=${encodeURIComponent(p.id)}` +
            `&pipeline_stage_id=${encodeURIComponent(s.id)}&limit=1`,
        ),
      );
      const n = search?.meta?.total ?? search?.opportunities?.length ?? 0;
      totalInPipe += n;
      const marker = n > 0 ? '🟢' : '⚪';
      console.log(`  ${marker} ${n.toString().padStart(5)}  ${s.name}`);
    }
    console.log(`  ──────────────  Total in pipeline: ${totalInPipe}`);
  }

  // ─── 3. Custom Fields with usage signal ──────────────────────────────────
  section('3. CUSTOM FIELDS');
  type Cf = {
    id: string;
    name?: string;
    fieldKey?: string;
    model?: string;
    dataType?: string;
    placeholder?: string;
    position?: number;
    picklistOptions?: unknown[];
    isAllowedCustomOption?: boolean;
    standard?: boolean;
    isMultipleFile?: boolean;
    documentType?: string;
    options?: unknown[];
  };
  const cfResp = await tryFetch('custom fields', () =>
    ghl<{ customFields: Cf[] }>(
      `/locations/${encodeURIComponent(locId())}/customFields?model=all`,
    ),
  );
  const cfs = cfResp?.customFields ?? [];

  // Bucket by model (derived from fieldKey prefix or model field)
  const byModel = new Map<string, Cf[]>();
  for (const f of cfs) {
    const m = f.fieldKey?.includes('.')
      ? f.fieldKey.split('.')[0]!
      : (f.model ?? 'unknown');
    if (!byModel.has(m)) byModel.set(m, []);
    byModel.get(m)!.push(f);
  }

  for (const [model, list] of byModel) {
    sub(`${model.toUpperCase()} fields (${list.length})`);
    list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    for (const f of list) {
      const key = f.fieldKey?.includes('.') ? f.fieldKey : `${model}.${f.fieldKey}`;
      console.log(`  ${(f.dataType ?? '?').padEnd(16)} ${(f.name ?? '?').padEnd(50).slice(0, 50)} ${key}`);
    }
  }

  // Usage check: sample contacts to see which CFs are actually populated
  sub('CF usage — sampling 100 contacts to see which fields have data');
  const contactsSample = await tryFetch('contact sample', () =>
    ghl<{ contacts?: { customFields?: { id: string; value?: unknown }[] }[] }>(
      `/contacts/?locationId=${encodeURIComponent(locId())}&limit=100`,
    ),
  );
  const cfHits = new Map<string, number>();
  let sampleSize = 0;
  if (contactsSample?.contacts) {
    sampleSize = contactsSample.contacts.length;
    for (const c of contactsSample.contacts) {
      for (const v of c.customFields ?? []) {
        if (v.value !== null && v.value !== undefined && v.value !== '') {
          cfHits.set(v.id, (cfHits.get(v.id) ?? 0) + 1);
        }
      }
    }
  }
  console.log(`  Sampled ${sampleSize} contacts.`);
  const cfById = new Map(cfs.map((f) => [f.id, f]));
  const sortedHits = Array.from(cfHits.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedHits.length === 0) {
    console.log('  (no populated contact CFs in sample — sub-account may have no contacts or PIT lacks scope)');
  } else {
    console.log(`  Populated CFs in sample (sorted by hit count):`);
    for (const [id, n] of sortedHits) {
      const f = cfById.get(id);
      const pct = ((n / sampleSize) * 100).toFixed(0);
      console.log(`    ${n.toString().padStart(3)}/${sampleSize}  (${pct}%)  ${f?.name ?? id}`);
    }
    // CFs with zero hits
    const unhit = cfs.filter((f) => !cfHits.has(f.id) && (f.fieldKey?.startsWith('contact.') || f.model === 'contact'));
    if (unhit.length > 0) {
      console.log(`\n  Contact CFs with ZERO data in sample (${unhit.length}):`);
      for (const f of unhit) console.log(`    ${f.name ?? f.fieldKey}`);
    }
  }

  // ─── 4. Custom Values ────────────────────────────────────────────────────
  section('4. CUSTOM VALUES');
  type Cv = { id: string; name?: string; fieldKey?: string; value?: unknown };
  const cvResp = await tryFetch('custom values', () =>
    ghl<{ customValues: Cv[] }>(`/locations/${encodeURIComponent(locId())}/customValues`),
  );
  const cvs = cvResp?.customValues ?? [];
  cvs.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  sub(`Custom Values (${cvs.length}) — sorted by name`);
  for (const c of cvs) {
    const v = String(c.value ?? '');
    const filled = v.trim() === '' ? '⚪ empty' : '🟢 set  ';
    const shortVal = v.length > 50 ? v.slice(0, 47) + '...' : v;
    console.log(`  ${filled}  ${(c.name ?? '?').padEnd(55).slice(0, 55)}  ${shortVal}`);
  }

  // ─── 5. Workflows ────────────────────────────────────────────────────────
  section('5. WORKFLOWS');
  type Wf = { id: string; name: string; status?: string; version?: number; updatedAt?: string };
  const wfResp = await tryFetch('workflows', () =>
    ghl<{ workflows: Wf[] }>(`/workflows/?locationId=${encodeURIComponent(locId())}`),
  );
  const wfs = wfResp?.workflows ?? [];
  const published = wfs.filter((w) => w.status === 'published');
  const drafts = wfs.filter((w) => w.status !== 'published');
  sub(`Workflows: ${wfs.length} total  (${published.length} published / ${drafts.length} draft)`);
  console.log('  PUBLISHED (active):');
  published.sort((a, b) => a.name.localeCompare(b.name));
  for (const w of published) {
    console.log(`    🟢  ${w.name}`);
  }
  console.log('\n  DRAFT (inactive):');
  drafts.sort((a, b) => a.name.localeCompare(b.name));
  for (const w of drafts) {
    console.log(`    ⚪  ${w.name}`);
  }

  // ─── 6. Calendars ────────────────────────────────────────────────────────
  section('6. CALENDARS');
  type Cal = {
    id: string;
    name?: string;
    description?: string;
    isActive?: boolean;
    slug?: string;
    eventColor?: string;
    slotDuration?: number;
    slotDurationUnit?: string;
    appoinmentPerSlot?: number;
    appoinmentPerDay?: number;
    locationConfigurations?: unknown[];
    teamMembers?: { userId: string }[];
  };
  const calResp = await tryFetch('calendars', () =>
    ghl<{ calendars: Cal[] }>(`/calendars/?locationId=${encodeURIComponent(locId())}`),
  );
  const cals = calResp?.calendars ?? [];
  sub(`Calendars (${cals.length})`);
  for (const c of cals) {
    const dur = c.slotDuration ? `${c.slotDuration}${c.slotDurationUnit ?? ''}` : '?';
    const team = c.teamMembers?.length ?? 0;
    const active = c.isActive === false ? '⚪ inactive' : '🟢 active  ';
    console.log(`  ${active}  ${(c.name ?? '?').padEnd(45)}  slot=${dur}  team=${team}  id=${c.id}`);
  }

  // ─── 7. Tags ────────────────────────────────────────────────────────────
  section('7. TAGS');
  const tagResp = await tryFetch('tags (requires locations/tags.readonly)', () =>
    ghl<{ tags: { id?: string; name: string }[] }>(
      `/locations/${encodeURIComponent(locId())}/tags`,
    ),
  );
  if (tagResp?.tags) {
    sub(`Tags (${tagResp.tags.length})`);
    tagResp.tags.sort((a, b) => a.name.localeCompare(b.name));
    for (const t of tagResp.tags) console.log(`  ${t.name}`);
  } else {
    console.log('  ⚠️  Tag fetch failed — PIT missing `locations/tags.readonly` scope.');
    console.log('     Add the scope in GHL Settings → Private Integrations → edit your PIT.');
  }

  // ─── 8. Users / team members ─────────────────────────────────────────────
  section('8. USERS / TEAM');
  const userResp = await tryFetch('users (requires users.readonly)', () =>
    ghl<{ users: { id: string; name?: string; email?: string; role?: string; type?: string }[] }>(
      `/users/?locationId=${encodeURIComponent(locId())}`,
    ),
  );
  if (userResp?.users) {
    sub(`Users (${userResp.users.length})`);
    userResp.users.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    for (const u of userResp.users) {
      console.log(`  ${(u.role ?? '?').padEnd(10)}  ${(u.name ?? '?').padEnd(30)}  ${u.email ?? ''}`);
    }
  }

  // ─── 9. Forms / surveys ──────────────────────────────────────────────────
  section('9. FORMS & SURVEYS');
  const formResp = await tryFetch('forms', () =>
    ghl<{ forms: { id: string; name: string }[] }>(
      `/forms/?locationId=${encodeURIComponent(locId())}`,
    ),
  );
  if (formResp?.forms) {
    sub(`Forms (${formResp.forms.length})`);
    for (const f of formResp.forms) console.log(`  ${f.name}  (id=${f.id})`);
  }
  const survResp = await tryFetch('surveys', () =>
    ghl<{ surveys: { id: string; name: string }[] }>(
      `/surveys/?locationId=${encodeURIComponent(locId())}`,
    ),
  );
  if (survResp?.surveys) {
    sub(`Surveys (${survResp.surveys.length})`);
    for (const s of survResp.surveys) console.log(`  ${s.name}  (id=${s.id})`);
  }

  // ─── 10. Snapshots applied ───────────────────────────────────────────────
  section('10. APPLIED SNAPSHOTS');
  const snapResp = await tryFetch('snapshots (may require agency-level token)', () =>
    ghl<{ snapshots: { id: string; name: string; type?: string }[] }>(
      `/snapshots/?locationId=${encodeURIComponent(locId())}`,
    ),
  );
  if (snapResp?.snapshots) {
    sub(`Snapshots (${snapResp.snapshots.length})`);
    for (const s of snapResp.snapshots) console.log(`  ${s.name}  (type=${s.type ?? '?'}, id=${s.id})`);
  }

  // ─── 11. Total contact + opp counts ──────────────────────────────────────
  section('11. RAW VOLUME COUNTS');
  const contactCount = await tryFetch('contact count', () =>
    ghl<{ meta?: { total?: number } }>(
      `/contacts/?locationId=${encodeURIComponent(locId())}&limit=1`,
    ),
  );
  console.log(`  Total contacts: ${contactCount?.meta?.total ?? '?'}`);

  // ─── 12. Email/SMS templates ─────────────────────────────────────────────
  section('12. EMAIL & SMS TEMPLATES');
  const emailResp = await tryFetch('email templates', () =>
    ghl<{ templates: { id: string; name: string; type?: string }[] }>(
      `/conversations/email/templates?locationId=${encodeURIComponent(locId())}`,
    ),
  );
  if (emailResp?.templates) {
    sub(`Email templates (${emailResp.templates.length})`);
    for (const t of emailResp.templates) console.log(`  ${t.name}  (id=${t.id})`);
  }

  console.log('\n' + HEAVY);
  console.log('  Inventory complete.');
  console.log(HEAVY);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
