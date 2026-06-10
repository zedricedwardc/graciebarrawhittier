#!/usr/bin/env node
/**
 * onboard-blog — resolve the three GHL_BLOG_* IDs and (optionally) create the
 * "Website Blog" GHL custom-menu link that surfaces the custom blog editor.
 *
 * This is the SLICE-4 (onboarding/config) companion to `scripts/onboard-client.ts`.
 * It's a focused, separately-invoked script (not folded into onboard-client.ts)
 * because the blog feature is optional per gym and the menu-link write is a
 * higher-risk, one-time operation that wants its own explicit confirmation gate.
 *
 * Run with: `npm run onboard:blog` (mode defaults to `discover`).
 *
 * Two modes:
 *   1. DISCOVER  — Query GHL to resolve GHL_BLOG_ID, GHL_BLOG_AUTHOR_ID,
 *                  GHL_BLOG_DEFAULT_CATEGORY_ID (first blog site / author /
 *                  category). Appends them to .env.client.local. Read-only.
 *   2. MENU      — Mint a signed admin token and create the "Website Blog"
 *                  custom-menu link (POST /custom-menus/). This WRITES to GHL,
 *                  so it is a DRY-RUN by default — pass `--write` to actually
 *                  create the menu. Always prints the signed admin URL so it
 *                  can be configured manually if the write is skipped/fails.
 *
 * Usage:
 *   npm run onboard:blog                 # discover IDs (read-only), append to .env.client.local
 *   npm run onboard:blog discover        # same as above
 *   npm run onboard:blog menu            # DRY-RUN: print the menu payload + signed URL, no write
 *   npm run onboard:blog menu -- --write # actually create the custom menu in GHL
 *
 * Env required:
 *   GHL_PIT_TOKEN        — Private Integration Token (scopes: blogs/list.readonly,
 *                          blogs/author.readonly, blogs/category.readonly, and
 *                          custom-menu-link.write for the menu step). See
 *                          docs/replication/blog-setup.md.
 *   GHL_LOCATION_ID      — sub-account location ID.
 *   ADMIN_SIGNING_KEY    — HMAC key (>= 32 chars) used to sign the menu URL token
 *                          (menu mode only).
 *   PUBLIC_SITE_URL      — Public site origin for the menu URL, no trailing slash.
 *                          Optional: defaults to SITE_URL_DEFAULT below (the
 *                          astro.config `site`). Override per gym.
 *
 * Output (DISCOVER mode): appends GHL_BLOG_* lines to .env.client.local.
 */

import { createHmac } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

// Load .env so PIT + LOCATION_ID + ADMIN_SIGNING_KEY are available.
loadEnv();

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION_DEFAULT = '2021-07-28';

// Default public site origin (matches astro.config.mjs `site`). Override per gym
// via PUBLIC_SITE_URL. Templatable — no other GBW-specific hardcode in this file.
const SITE_URL_DEFAULT = 'https://www.graciebarrawhittier.com';

// ─── GHL HTTP helper (script-local; mirrors scripts/onboard-client.ts — the
//     Astro lib uses import.meta.env which isn't populated outside the runtime). ─

interface FetchOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  version?: string;
}

async function ghl<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = process.env.GHL_PIT_TOKEN;
  if (!token) throw new Error('GHL_PIT_TOKEN env var not set (in .env or environment)');
  const res = await fetch(`${GHL_BASE}${path}`, {
    method: opts.method ?? 'GET',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: opts.version ?? GHL_VERSION_DEFAULT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GHL ${opts.method ?? 'GET'} ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function locationId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error('GHL_LOCATION_ID env var not set (in .env or environment)');
  return id;
}

function siteUrl(): string {
  return (process.env.PUBLIC_SITE_URL || SITE_URL_DEFAULT).replace(/\/+$/, '');
}

/**
 * Mint an admin token. Intentionally re-implements the exact format of
 * `signAdminToken` from src/lib/admin-token.ts — that module reads
 * `import.meta.env.ADMIN_SIGNING_KEY`, which is `undefined` outside the Astro/Vite
 * runtime and throws when imported into a plain tsx script. The token format
 * (HMAC-SHA256 of `${scope}|${exp}`, base64url payload + "." + signature) MUST
 * stay in sync with admin-token.ts. Default scope 'blog', default TTL 365 days.
 */
function signAdminTokenLocal(args: { scope?: 'blog'; ttlDays?: number } = {}): string {
  const key = process.env.ADMIN_SIGNING_KEY;
  if (!key || key.length < 32) {
    throw new Error('ADMIN_SIGNING_KEY env var must be set to a string of length >= 32');
  }
  const scope = args.scope ?? 'blog';
  const ttlDays = args.ttlDays ?? 365;
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86_400;
  const payload = `${scope}|${exp}`;
  const sig = createHmac('sha256', key).update(payload).digest();
  const b64url = (input: Buffer | string): string =>
    (typeof input === 'string' ? Buffer.from(input, 'utf8') : input)
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${b64url(payload)}.${b64url(sig)}`;
}

type Mode = 'discover' | 'menu';

const RULE = '─'.repeat(72);
const SECTION = '═'.repeat(72);

function header(title: string): void {
  console.log('\n' + SECTION);
  console.log(`  ${title}`);
  console.log(SECTION);
}

function subheader(title: string): void {
  console.log('\n' + RULE);
  console.log(`  ${title}`);
  console.log(RULE);
}

// ─── Resolve a "first item" from one of GHL's array-wrapping shapes ──────────
// GHL list responses inconsistently wrap the array under different keys; probe
// the documented/likely ones so this is resilient across API versions.
function firstFrom(resp: unknown, keys: string[]): Record<string, unknown> | null {
  if (Array.isArray(resp)) return (resp[0] as Record<string, unknown>) ?? null;
  if (resp && typeof resp === 'object') {
    for (const k of keys) {
      const v = (resp as Record<string, unknown>)[k];
      if (Array.isArray(v) && v.length > 0) return v[0] as Record<string, unknown>;
    }
  }
  return null;
}

function idOf(item: Record<string, unknown> | null): string | null {
  if (!item) return null;
  const id = item.id ?? item._id;
  return typeof id === 'string' ? id : null;
}

function labelOf(item: Record<string, unknown> | null): string {
  if (!item) return '';
  return String(item.name ?? item.title ?? item.label ?? '(unnamed)');
}

// ─── DISCOVER mode ──────────────────────────────────────────────────────────

async function runDiscover(): Promise<void> {
  header('Discover GHL_BLOG_* IDs from live GHL state');
  console.log(
    '\n  Resolves: GHL_BLOG_ID (first blog site), GHL_BLOG_AUTHOR_ID (first author),\n' +
      '  GHL_BLOG_DEFAULT_CATEGORY_ID (first category). Read-only — appends to .env.client.local.\n',
  );

  const loc = encodeURIComponent(locationId());
  const resolved: Record<string, string> = {};
  let warnings = 0;

  // ─── 1. Blog site → GHL_BLOG_ID ───────────────────────────────────────────
  subheader('1. Blog site (GHL_BLOG_ID)');
  try {
    const r = await ghl<unknown>(`/blogs/site/all?locationId=${loc}&skip=0&limit=10`);
    const first = firstFrom(r, ['data', 'blogs', 'sites']);
    const id = idOf(first);
    if (id) {
      resolved.GHL_BLOG_ID = id;
      console.log(`  ✅ GHL_BLOG_ID = ${id}  ("${labelOf(first)}")`);
    } else {
      warnings++;
      console.warn('  ⚠️  No blog site found. Create one in GHL → Sites → Blogs first,');
      console.warn('      then re-run `npm run onboard:blog discover`.');
    }
  } catch (err) {
    warnings++;
    console.error(`  ❌ Blog site fetch failed: ${(err as Error).message}`);
  }

  // ─── 2. Author → GHL_BLOG_AUTHOR_ID ───────────────────────────────────────
  subheader('2. Default author (GHL_BLOG_AUTHOR_ID)');
  try {
    const r = await ghl<unknown>(`/blogs/authors?locationId=${loc}&limit=10&offset=0`);
    const first = firstFrom(r, ['data', 'authors']);
    const id = idOf(first);
    if (id) {
      resolved.GHL_BLOG_AUTHOR_ID = id;
      console.log(`  ✅ GHL_BLOG_AUTHOR_ID = ${id}  ("${labelOf(first)}")`);
    } else {
      warnings++;
      console.warn('  ⚠️  No blog author found. Create an author in GHL → Sites → Blogs');
      console.warn('      → Authors first, then re-run discover.');
    }
  } catch (err) {
    warnings++;
    console.error(`  ❌ Author fetch failed: ${(err as Error).message}`);
  }

  // ─── 3. Category → GHL_BLOG_DEFAULT_CATEGORY_ID ───────────────────────────
  subheader('3. Default category (GHL_BLOG_DEFAULT_CATEGORY_ID)');
  try {
    const r = await ghl<unknown>(`/blogs/categories?locationId=${loc}&limit=10&offset=0`);
    const first = firstFrom(r, ['data', 'categories']);
    const id = idOf(first);
    if (id) {
      resolved.GHL_BLOG_DEFAULT_CATEGORY_ID = id;
      console.log(`  ✅ GHL_BLOG_DEFAULT_CATEGORY_ID = ${id}  ("${labelOf(first)}")`);
    } else {
      warnings++;
      console.warn('  ⚠️  No blog category found. Create a category in GHL → Sites → Blogs');
      console.warn('      → Categories first, then re-run discover.');
    }
  } catch (err) {
    warnings++;
    console.error(`  ❌ Category fetch failed: ${(err as Error).message}`);
  }

  // ─── 4. Append resolved IDs to .env.client.local ──────────────────────────
  subheader('4. Writing .env.client.local');
  const keys = Object.keys(resolved);
  if (keys.length === 0) {
    console.warn('  ⚠️  Nothing resolved — not writing. Create the blog assets in GHL first.');
  } else {
    const lines = [
      '',
      `# Blog IDs — appended by \`npm run onboard:blog discover\` on ${new Date().toISOString()}`,
      ...keys.map((k) => `${k}=${resolved[k]}`),
      '',
    ];
    // Append (don't clobber) — onboard-client.ts discover writes pipeline/workflow
    // IDs to the same file; this run only adds the blog IDs.
    appendFileSync('.env.client.local', lines.join('\n'), 'utf8');
    console.log(`  ✅ Appended ${keys.length} blog ID(s) to .env.client.local`);
  }

  // ─── 5. Summary ───────────────────────────────────────────────────────────
  if (warnings === 0 && keys.length === 3) {
    header('✅ All three GHL_BLOG_* IDs resolved.');
    console.log('\n  Next: paste them into Vercel env, then run `npm run onboard:blog menu`\n');
  } else {
    header(`⚠️  ${warnings} warning(s) — see above`);
    console.log(
      '\n  Resolve the warnings (create missing blog site / author / category in GHL),\n' +
        '  then re-run `npm run onboard:blog discover`.\n',
    );
  }
}

// ─── MENU mode ──────────────────────────────────────────────────────────────

async function runMenu(write: boolean): Promise<void> {
  header('Create "Website Blog" custom-menu link');

  // Build the signed admin URL (always — it's the manual fallback too).
  let url: string;
  let token: string;
  try {
    token = signAdminTokenLocal({});
    url = `${siteUrl()}/admin/blog?t=${token}`;
  } catch (err) {
    console.error(`  ❌ Could not mint admin token: ${(err as Error).message}`);
    process.exit(1);
  }

  const payload = {
    title: 'Website Blog',
    url,
    icon: { name: 'pen-to-square', fontFamily: 'fas' },
    showOnCompany: false,
    showOnLocation: true,
    showToAllLocations: false,
    openMode: 'iframe' as const,
    locations: [] as string[],
    userRole: 'admin' as const,
  };

  console.log('\n  Signed admin URL (configure manually if you skip the write):');
  console.log(`\n    ${url}\n`);
  console.log('  Custom-menu payload (POST /custom-menus/):');
  console.log(JSON.stringify({ ...payload, url: `${siteUrl()}/admin/blog?t=<signed-token>` }, null, 2));

  if (!write) {
    header('DRY-RUN — no write performed');
    console.log(
      '\n  This is a one-time GHL write. Re-run with `--write` to actually create the menu:\n' +
        '\n    npm run onboard:blog menu -- --write\n' +
        '\n  Or paste the signed URL above into a custom menu link manually in\n' +
        '  GHL → Settings → Custom Menu Links (Open Mode: iframe, Role: Admin).\n',
    );
    return;
  }

  subheader('Creating the custom menu (--write)');
  try {
    const r = await ghl<{ customMenu?: { id?: string }; id?: string }>('/custom-menus/', {
      method: 'POST',
      body: payload,
    });
    const id = r?.customMenu?.id ?? r?.id ?? '(unknown)';
    console.log(`  ✅ Created custom menu "Website Blog" (id=${id})`);
    console.log('\n  Note: the menu URL embeds a long-lived signed token. Rotating');
    console.log('  ADMIN_SIGNING_KEY invalidates it — re-run this menu step after rotating.\n');
  } catch (err) {
    console.error(`  ❌ Custom-menu create failed: ${(err as Error).message}`);
    console.error('     Configure the menu manually using the signed URL printed above.');
    process.exit(1);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = ((args.find((a) => !a.startsWith('--')) as Mode) || 'discover') as Mode;
  const write = args.includes('--write');

  switch (mode) {
    case 'discover':
      await runDiscover();
      break;
    case 'menu':
      await runMenu(write);
      break;
    default:
      console.error(`Unknown mode: ${mode}. Use one of: discover | menu`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('onboard-blog failed:', err);
  process.exit(1);
});
