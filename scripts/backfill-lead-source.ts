/**
 * One-time backfill — convert existing contacts to the channel-based
 * lead-source model.
 *
 * Early opt-ins stored a page-level slug ("homepage-optin", "kids-optin", ...)
 * in the `lead_source` custom field. The current model stores, per the
 * LEAD_SOURCES registry (src/lib/lead-types.ts):
 *   - `lead_source` CF      → the coarse channel (Website Leads / Walk-In / ...)
 *   - `optin_page` CF       → the readable page label (Homepage / Kids Page ...)
 *   - native `source` attr  → the same channel as `lead_source`
 *
 * `lead_source` is what the studio dashboard's Lead Source widget groups by, so
 * it must hold the channel, not the slug. This script walks every contact and,
 * for each one whose `lead_source` CF still holds a known page slug:
 *   - rewrites `lead_source` → the slug's channel
 *   - sets `optin_page` → the slug's page label (if not already set)
 *   - sets native `source` → the channel, but only when the current source is
 *     blank or a value this migration owns (blank / Website / Website Leads /
 *     Walk-In). A deliberate non-owned source (Referral, a GHL form name, ...)
 *     is left untouched.
 *
 * Contacts whose `lead_source` already holds a channel are treated as migrated
 * and skipped, so the script is idempotent and safe to re-run. Contacts with
 * no `lead_source` value, or an unrecognized one, are left untouched.
 *
 * Dry-run by default — prints the plan and writes nothing. Pass `--apply` to
 * perform the updates.
 *
 *   npx tsx scripts/backfill-lead-source.ts            # dry-run
 *   npx tsx scripts/backfill-lead-source.ts --apply    # perform updates
 */

import { config as loadEnv } from 'dotenv';
import { LEAD_SOURCES, LEAD_CHANNELS } from '../src/lib/lead-types';

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

const CHANNELS = new Set<string>(LEAD_CHANNELS);
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
  const optinPageCfId = await resolveCfId('optin_page');
  console.log(`  lead_source CF: ${leadSourceCfId}`);
  console.log(`  optin_page  CF: ${optinPageCfId}\n`);

  let scanned = 0;
  let optinContacts = 0;
  let leadSourceSets = 0;
  let optinPageSets = 0;
  let sourceSets = 0;
  let keptCustomSource = 0;
  let unknownValue = 0;
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
      const leadSource = String(cfById.get(leadSourceCfId) ?? '').trim();
      if (!leadSource) continue; // not an opt-in contact

      // `lead_source` may still hold a page slug (pre-migration) or already
      // hold a channel (migrated). Resolve the channel + page label from it.
      let channel: string;
      let pageLabel: string | undefined;
      if (SLUG_TO_CHANNEL.has(leadSource)) {
        channel = SLUG_TO_CHANNEL.get(leadSource)!;
        pageLabel = SLUG_TO_PAGE_LABEL.get(leadSource);
      } else if (CHANNELS.has(leadSource)) {
        channel = leadSource; // already migrated
      } else {
        unknownValue++;
        continue; // unrecognized — leave it alone
      }
      optinContacts++;

      const currentSource = String(c.source ?? '').trim();
      const currentOptinPage = String(cfById.get(optinPageCfId) ?? '').trim();

      const needsLeadSource = leadSource !== channel;
      const needsOptinPage = pageLabel !== undefined && currentOptinPage !== pageLabel;
      const sourceOwned = OWNED_SOURCE_VALUES.has(currentSource);
      const needsSource = currentSource !== channel && sourceOwned;
      if (currentSource !== channel && !sourceOwned) keptCustomSource++;

      if (!needsLeadSource && !needsOptinPage && !needsSource) {
        noChange++;
        continue;
      }
      if (needsLeadSource) leadSourceSets++;
      if (needsOptinPage) optinPageSets++;
      if (needsSource) sourceSets++;

      const cfUpdates: Array<{ id: string; field_value: string }> = [];
      if (needsLeadSource) cfUpdates.push({ id: leadSourceCfId, field_value: channel });
      if (needsOptinPage) cfUpdates.push({ id: optinPageCfId, field_value: pageLabel! });
      const update: Record<string, unknown> = {};
      if (needsSource) update.source = channel;
      if (cfUpdates.length) update.customFields = cfUpdates;

      const who = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.id;
      if (!APPLY) {
        const parts: string[] = [];
        if (needsLeadSource) parts.push(`lead_source "${leadSource}" → "${channel}"`);
        if (needsOptinPage) parts.push(`optin_page → "${pageLabel}"`);
        if (needsSource) parts.push(`source "${currentSource || '(none)'}" → "${channel}"`);
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

  const verb = APPLY ? 'set' : 'to set';
  console.log('\n');
  console.log('  ──────────────────────────────────────────────');
  console.log(`  ${'Contacts scanned:'.padEnd(34)}${scanned}`);
  console.log(`  ${'Opt-in contacts:'.padEnd(34)}${optinContacts}`);
  console.log(`  ${'Already correct (skipped):'.padEnd(34)}${noChange}`);
  console.log(`  ${`lead_source channel ${verb}:`.padEnd(34)}${leadSourceSets}`);
  console.log(`  ${`optin_page ${verb}:`.padEnd(34)}${optinPageSets}`);
  console.log(`  ${`native source ${verb}:`.padEnd(34)}${sourceSets}`);
  console.log(`  ${'Kept deliberate non-owned source:'.padEnd(34)}${keptCustomSource}`);
  console.log(`  ${'Unrecognized lead_source value:'.padEnd(34)}${unknownValue} (left untouched)`);
  if (APPLY) {
    console.log(`  ${'Contacts updated:'.padEnd(34)}${updated}`);
    console.log(`  ${'Failed:'.padEnd(34)}${failed}`);
  } else {
    console.log('\n  DRY RUN — no contacts were modified. Re-run with --apply to write.');
  }
  console.log('  ──────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('\n  Backfill aborted:', err);
  process.exit(1);
});
