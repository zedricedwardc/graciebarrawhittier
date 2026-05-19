/**
 * One-time backfill — apply the two-layer lead-source model to existing
 * contacts.
 *
 * Every opt-in stores a page-level slug in the `lead_source` custom field. The
 * current model also needs, per the LEAD_SOURCES registry (src/lib/lead-types.ts):
 *   - the native `source` attribute set to the channel (Website Leads / Walk-In)
 *   - the `lead_channel` dropdown CF set to that same channel (so dashboard
 *     widgets — which can't group by the native attribute — can group by it)
 *   - the readable `optin_page` dropdown CF set to the page label
 *
 * Early opt-ins are missing some or all: legacy code wrote `source` as
 * "Website", `/contacts/upsert` never sets `source` on a contact that already
 * existed, and `lead_channel` / `optin_page` did not exist yet.
 *
 * This script walks every contact and, for each one carrying a `lead_source`
 * slug that maps to a known registry entry:
 *   - sets `source` → the slug's channel, but only when the current source is
 *     blank or a value this migration owns (blank / Website / Website Leads /
 *     Walk-In). A deliberate non-owned source (Referral, a GHL form name, ...)
 *     is left untouched.
 *   - sets `lead_channel` → the slug's channel.
 *   - sets `optin_page` → the slug's page label.
 *
 * Only fields that actually differ are written, so it is idempotent and safe
 * to re-run. Contacts with no `lead_source` slug are untouched.
 *
 * Dry-run by default — prints the plan and writes nothing. Pass `--apply` to
 * perform the updates.
 *
 *   npx tsx scripts/backfill-lead-source.ts            # dry-run
 *   npx tsx scripts/backfill-lead-source.ts --apply    # perform updates
 */

import { config as loadEnv } from 'dotenv';
import { LEAD_SOURCES } from '../src/lib/lead-types';

loadEnv();

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const APPLY = process.argv.includes('--apply');

/**
 * Native `source` values this migration is allowed to overwrite — blank, the
 * legacy "Website", or either current channel. Any other value was set
 * deliberately (manual Referral, a GHL form name) and is left alone.
 */
const OWNED_SOURCE_VALUES = new Set(['', 'Website', 'Website Leads', 'Walk-In']);

// slug → channel / page label, derived from the single-source-of-truth registry.
const SLUG_TO_CHANNEL = new Map<string, string>(
  Object.entries(LEAD_SOURCES).map(([slug, def]) => [slug, def.channel]),
);
const SLUG_TO_PAGE_LABEL = new Map<string, string>(
  Object.entries(LEAD_SOURCES).map(([slug, def]) => [slug, def.pageLabel]),
);

interface FetchOpts {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
}

async function ghl<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = process.env.GHL_PIT_TOKEN;
  if (!token) throw new Error('GHL_PIT_TOKEN env var not set (in .env or environment)');
  // Retry on 429 (rate limit) with linear backoff.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GHL_BASE}${path}`, {
      method: opts.method ?? 'GET',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 429 && attempt < 5) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GHL ${opts.method ?? 'GET'} ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

function locationId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error('GHL_LOCATION_ID env var not set (in .env or environment)');
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawCf {
  id: string;
  fieldKey?: string;
  name?: string;
}
interface Contact {
  id: string;
  source?: string;
  firstName?: string;
  lastName?: string;
  customFields?: Array<{ id: string; value?: unknown }>;
  searchAfter?: unknown[];
}

/** Resolve a CF id by bare fieldKey (handles the `contact.` prefix GHL adds). */
async function resolveCfId(bareKey: string): Promise<string> {
  const data = await ghl<{ customFields: RawCf[] }>(
    `/locations/${encodeURIComponent(locationId())}/customFields?model=all`,
  );
  for (const f of data.customFields ?? []) {
    const key = f.fieldKey ?? '';
    const bare = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
    if (bare === bareKey) return f.id;
  }
  throw new Error(`Custom field "${bareKey}" not found in GHL — provision it first.`);
}

async function main(): Promise<void> {
  console.log(`\n  Lead-source backfill — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  const leadSourceCfId = await resolveCfId('lead_source');
  const leadChannelCfId = await resolveCfId('lead_channel');
  const optinPageCfId = await resolveCfId('optin_page');
  console.log(`  lead_source  CF: ${leadSourceCfId}`);
  console.log(`  lead_channel CF: ${leadChannelCfId}`);
  console.log(`  optin_page   CF: ${optinPageCfId}\n`);

  let scanned = 0;
  let optinContacts = 0;
  let sourceSets = 0;
  let leadChannelSets = 0;
  let optinPageSets = 0;
  let unknownSlug = 0;
  let keptCustomSource = 0;
  let noChange = 0;
  let updated = 0;
  let failed = 0;

  let searchAfter: unknown[] | undefined;
  for (;;) {
    const body: Record<string, unknown> = { locationId: locationId(), pageLimit: 100 };
    if (searchAfter) body.searchAfter = searchAfter;
    const data = await ghl<{ contacts: Contact[]; total: number }>('/contacts/search', {
      method: 'POST',
      body,
    });
    const contacts = data.contacts ?? [];
    if (contacts.length === 0) break;
    scanned += contacts.length;

    for (const c of contacts) {
      const cfById = new Map((c.customFields ?? []).map((f) => [f.id, f.value]));
      const slug = String(cfById.get(leadSourceCfId) ?? '').trim();
      if (!slug) continue; // not an opt-in contact

      const desiredChannel = SLUG_TO_CHANNEL.get(slug);
      const desiredLabel = SLUG_TO_PAGE_LABEL.get(slug);
      if (!desiredChannel || !desiredLabel) {
        unknownSlug++;
        continue; // legacy/unknown slug — can't map, leave it alone
      }
      optinContacts++;

      const currentSource = String(c.source ?? '').trim();
      const currentLeadChannel = String(cfById.get(leadChannelCfId) ?? '').trim();
      const currentOptinPage = String(cfById.get(optinPageCfId) ?? '').trim();

      const sourceOwned = OWNED_SOURCE_VALUES.has(currentSource);
      const needsSource = currentSource !== desiredChannel && sourceOwned;
      const needsLeadChannel = currentLeadChannel !== desiredChannel;
      const needsOptinPage = currentOptinPage !== desiredLabel;
      if (currentSource !== desiredChannel && !sourceOwned) keptCustomSource++;

      if (!needsSource && !needsLeadChannel && !needsOptinPage) {
        noChange++;
        continue;
      }
      if (needsSource) sourceSets++;
      if (needsLeadChannel) leadChannelSets++;
      if (needsOptinPage) optinPageSets++;

      const cfUpdates: Array<{ id: string; field_value: string }> = [];
      if (needsLeadChannel) cfUpdates.push({ id: leadChannelCfId, field_value: desiredChannel });
      if (needsOptinPage) cfUpdates.push({ id: optinPageCfId, field_value: desiredLabel });
      const update: Record<string, unknown> = {};
      if (needsSource) update.source = desiredChannel;
      if (cfUpdates.length) update.customFields = cfUpdates;

      const who = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.id;
      if (!APPLY) {
        const parts: string[] = [];
        if (needsSource) parts.push(`source "${currentSource || '(none)'}" → "${desiredChannel}"`);
        if (needsLeadChannel) parts.push(`lead_channel → "${desiredChannel}"`);
        if (needsOptinPage) parts.push(`optin_page → "${desiredLabel}" (from ${slug})`);
        console.log(`  · ${who}: ${parts.join('; ')}`);
      } else {
        try {
          await ghl(`/contacts/${encodeURIComponent(c.id)}`, { method: 'PUT', body: update });
          updated++;
          await sleep(120); // ~8 writes/sec — stays under GHL burst limits
        } catch (err) {
          failed++;
          console.error(`  ❌ ${who} (${c.id}): ${(err as Error).message}`);
        }
      }
    }

    const last = contacts[contacts.length - 1];
    searchAfter = last?.searchAfter;
    process.stdout.write(`\r  scanned ${scanned} / ${data.total} ...`);
    if (!searchAfter || contacts.length < 100) break;
  }

  console.log('\n');
  const verb = APPLY ? 'set' : 'to set';
  console.log('  ──────────────────────────────────────────────');
  console.log(`  ${'Contacts scanned:'.padEnd(34)}${scanned}`);
  console.log(`  ${'Opt-in contacts (mappable):'.padEnd(34)}${optinContacts}`);
  console.log(`  ${'Already correct (skipped):'.padEnd(34)}${noChange}`);
  console.log(`  ${`native source ${verb}:`.padEnd(34)}${sourceSets}`);
  console.log(`  ${`lead_channel CF ${verb}:`.padEnd(34)}${leadChannelSets}`);
  console.log(`  ${`optin_page CF ${verb}:`.padEnd(34)}${optinPageSets}`);
  console.log(`  ${'Kept deliberate non-owned source:'.padEnd(34)}${keptCustomSource}`);
  console.log(`  ${'Unmappable lead_source slug:'.padEnd(34)}${unknownSlug} (left untouched)`);
  if (APPLY) {
    console.log(`  Contacts updated:            ${updated}`);
    console.log(`  Failed:                      ${failed}`);
  } else {
    console.log('\n  DRY RUN — no contacts were modified. Re-run with --apply to write.');
  }
  console.log('  ──────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\n  Backfill aborted:', err);
  process.exit(1);
});
