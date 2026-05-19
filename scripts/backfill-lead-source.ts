/**
 * One-time backfill — migrate legacy website contacts to the two-layer
 * lead-source model.
 *
 * The old opt-in code wrote the GHL native contact `source` as "Website" and
 * stored only the page-level slug in the `lead_source` CF. The current model
 * resolves the channel + readable `optin_page` page label per slug via the
 * LEAD_SOURCES registry (see src/lib/lead-types.ts).
 *
 * For every contact whose native `source` is "Website" or "Website Leads",
 * this script:
 *   - sets `source` → the channel the contact's `lead_source` slug resolves to
 *     (page opt-ins → "Website Leads"; the /offer QR page → "Walk-In"), or
 *     "Website Leads" when the slug is missing/unmappable
 *   - sets the `optin_page` CF from that same slug, when it maps to a known
 *     LEAD_SOURCES registry entry
 *
 * It only writes the fields that actually differ, so it is idempotent and
 * safe to re-run. Contacts with any other `source` (Walk-In, Referral, BTM
 * imports, ...) are left untouched.
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

/** Legacy + current native `source` values that this migration owns. */
const WEBSITE_SOURCE_VALUES = new Set(['Website', 'Website Leads']);
/** Channel for contacts whose `lead_source` slug is missing or unmappable. */
const DEFAULT_CHANNEL = 'Website Leads';

// slug → { channel, pageLabel }, derived from the single-source-of-truth registry.
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
  let websiteContacts = 0;
  let sourceRenames = 0;
  let optinPageSets = 0;
  let unknownSlug = 0;
  let alreadyCorrect = 0;
  let updated = 0;
  let failed = 0;

  let searchAfter: unknown[] | undefined;
  for (let page = 1; ; page++) {
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
      if (!c.source || !WEBSITE_SOURCE_VALUES.has(c.source)) continue;
      websiteContacts++;

      const cfById = new Map((c.customFields ?? []).map((f) => [f.id, f.value]));
      const slug = String(cfById.get(leadSourceCfId) ?? '').trim();
      const currentOptinPage = String(cfById.get(optinPageCfId) ?? '').trim();
      const desiredLabel = slug ? SLUG_TO_PAGE_LABEL.get(slug) : undefined;
      if (slug && !desiredLabel) unknownSlug++;

      const desiredChannel = (slug && SLUG_TO_CHANNEL.get(slug)) || DEFAULT_CHANNEL;
      const needsSource = c.source !== desiredChannel;
      const needsOptinPage = Boolean(desiredLabel) && currentOptinPage !== desiredLabel;
      if (!needsSource && !needsOptinPage) {
        alreadyCorrect++;
        continue;
      }
      if (needsSource) sourceRenames++;
      if (needsOptinPage) optinPageSets++;

      const update: Record<string, unknown> = {};
      if (needsSource) update.source = desiredChannel;
      if (needsOptinPage) {
        update.customFields = [{ id: optinPageCfId, field_value: desiredLabel }];
      }

      const who = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.id;
      if (!APPLY) {
        const parts: string[] = [];
        if (needsSource) parts.push(`source "${c.source}" → "${desiredChannel}"`);
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
  console.log('  ──────────────────────────────────────────────');
  console.log(`  Contacts scanned:            ${scanned}`);
  console.log(`  Website-channel contacts:    ${websiteContacts}`);
  console.log(`  Already correct (skipped):   ${alreadyCorrect}`);
  console.log(`  Source renames ${APPLY ? 'applied' : 'planned'}:      ${sourceRenames}`);
  console.log(`  optin_page sets ${APPLY ? 'applied' : 'planned'}:     ${optinPageSets}`);
  console.log(`  Unmappable lead_source slug: ${unknownSlug} (source still migrated, optin_page left blank)`);
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
