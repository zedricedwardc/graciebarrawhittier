#!/usr/bin/env node
/**
 * discover-btm-calendars — fetch GHL calendars and match BTM ones to env vars.
 *
 * Run AFTER you've created the 5 BTM calendars in the GHL UI. Prints env-var
 * lines (GHL_CAL_BTM_*) for paste into Vercel + .env.
 *
 * Usage:
 *   npx tsx scripts/discover-btm-calendars.ts
 *
 * Matching rule: each program's calendar is identified by name matches against
 * the BTM-flavored variants. Acceptable name patterns (case-insensitive):
 *   - "BTM Tiny", "Back to the Mats Tiny", "BTM — Tiny Champions" (any of these)
 *   - Same pattern for LC1, LC2, Juniors, Adults
 *
 * Env required:
 *   GHL_PIT_TOKEN     — Private Integration Token
 *   GHL_LOCATION_ID   — sub-account location ID
 */

import { config as loadEnv } from 'dotenv';

loadEnv();

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

interface Calendar {
  id: string;
  name: string;
  isActive?: boolean;
}

interface CalendarsResponse {
  calendars?: Calendar[];
}

async function ghl<T>(path: string): Promise<T> {
  const token = process.env.GHL_PIT_TOKEN;
  if (!token) throw new Error('GHL_PIT_TOKEN env var not set');
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GHL GET ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function locationId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error('GHL_LOCATION_ID env var not set');
  return id;
}

const PROGRAM_KEYS = ['TINY', 'LC1', 'LC2', 'JUNIORS', 'ADULTS'] as const;

/** Per-program patterns — case-insensitive substring match against calendar.name. */
const NAME_PATTERNS: Record<(typeof PROGRAM_KEYS)[number], string[]> = {
  TINY:    ['tiny'],
  LC1:     ['little champions 1', 'lc1', 'little champ 1'],
  LC2:     ['little champions 2', 'lc2', 'little champ 2'],
  JUNIORS: ['junior'],
  ADULTS:  ['adult'],
};

const BTM_MARKERS = ['btm', 'back to the mats', 'back-to-the-mats', 're-enrollment', 'reenrollment'];

function matchProgram(name: string): (typeof PROGRAM_KEYS)[number] | null {
  const lower = name.toLowerCase();
  if (!BTM_MARKERS.some((m) => lower.includes(m))) return null;
  for (const key of PROGRAM_KEYS) {
    if (NAME_PATTERNS[key].some((p) => lower.includes(p))) return key;
  }
  return null;
}

async function main(): Promise<void> {
  console.log('Fetching calendars from GHL…\n');

  const r = await ghl<CalendarsResponse>(
    `/calendars/?locationId=${encodeURIComponent(locationId())}`,
  );
  const calendars = r.calendars ?? [];
  console.log(`Found ${calendars.length} total calendars.\n`);

  const matches = new Map<(typeof PROGRAM_KEYS)[number], Calendar>();
  const unmatched: Calendar[] = [];

  for (const cal of calendars) {
    const program = matchProgram(cal.name);
    if (program && !matches.has(program)) {
      matches.set(program, cal);
    } else if (program) {
      console.warn(`  ⚠️  Multiple BTM matches for ${program}: keeping "${matches.get(program)?.name}", ignoring "${cal.name}"`);
    }
  }

  // Surface BTM-marked calendars that didn't match any program tier
  for (const cal of calendars) {
    const lower = cal.name.toLowerCase();
    if (BTM_MARKERS.some((m) => lower.includes(m)) && !matchProgram(cal.name)) {
      unmatched.push(cal);
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('BTM CALENDAR DISCOVERY RESULTS');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const key of PROGRAM_KEYS) {
    const cal = matches.get(key);
    if (cal) {
      console.log(`  ✅  ${key.padEnd(8)} → "${cal.name}" (${cal.id})`);
    } else {
      console.log(`  ❌  ${key.padEnd(8)} → no BTM calendar found`);
    }
  }

  if (unmatched.length > 0) {
    console.log('\nBTM-marked calendars that did not match any program tier:');
    for (const cal of unmatched) {
      console.log(`  ⚠️   "${cal.name}" (${cal.id})`);
    }
    console.log('  → Rename to include "tiny", "lc1", "lc2", "junior", or "adult".');
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('ENV VAR LINES (paste into Vercel + .env)');
  console.log('═══════════════════════════════════════════════════════\n');

  for (const key of PROGRAM_KEYS) {
    const cal = matches.get(key);
    if (cal) {
      console.log(`GHL_CAL_BTM_${key}=${cal.id}`);
    } else {
      console.log(`# GHL_CAL_BTM_${key}=  # MISSING — create the calendar in GHL UI first`);
    }
  }

  console.log('');

  const missing = PROGRAM_KEYS.filter((k) => !matches.has(k));
  if (missing.length > 0) {
    console.log(`⚠️  ${missing.length} of 5 BTM calendars missing. Create them in GHL UI:`);
    console.log('    Settings → Calendars → New Calendar (or clone the trial-flow calendars)');
    console.log('    Name pattern: "BTM <Program>" — e.g. "BTM Tiny Champions"');
    console.log('    Then re-run this script.\n');
    process.exit(1);
  }

  console.log('✅ All 5 BTM calendars resolved.');
}

main().catch((err) => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});
