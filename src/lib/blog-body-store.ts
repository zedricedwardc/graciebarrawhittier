/**
 * Server-only post-body store (Vercel Blob).
 *
 * WHY THIS EXISTS: GHL's Blogs API can write `rawHTML` but never returns it —
 * the list endpoint omits the field and there is no single-post GET ("route not
 * yet supported by the IAM Service"). So GHL remains the index (titles, dates,
 * images, slugs) while the body HTML is persisted here, keyed by GHL post id,
 * and read back for the public post page and the admin editor.
 *
 * Pathname: blog/{postId}.json  →  { rawHTML }
 *
 * READS ARE DIRECT-URL, NOT list(): @vercel/blob's list() is eventually
 * consistent — a blob written moments ago can be missing from list() for up to
 * ~1 min, which made fresh edits read back stale (and the stale result then sat
 * in the 5-min app cache). With addRandomSuffix:false the URL is deterministic
 * (`{storeBase}/blog/{postId}.json`), so we learn the store base once — from a
 * put() result, the BLOB_STORE_BASE_URL env if set, or a one-time list() — and
 * fetch the URL directly with a cache-busting query param.
 *
 * Store is public-access; bodies are public content anyway (they render on the
 * website). Requires BLOB_READ_WRITE_TOKEN (auto-injected when the Blob store
 * is connected to the Vercel project; pull locally via `vercel env pull`).
 *
 * All functions are best-effort and never throw: a missing/unreachable blob
 * degrades to '' (callers fall back to the GHL description), and a failed save
 * is logged AND reported (saveBody returns false) so callers can surface
 * "body not persisted" to the admin — the post itself already exists in GHL.
 */

import { put, del, list } from '@vercel/blob';
import { readEnv } from './ghl';

function pathFor(postId: string): string {
  return `blog/${postId}.json`;
}

/**
 * The @vercel/blob SDK reads process.env.BLOB_READ_WRITE_TOKEN internally, but
 * in `astro dev` env files land on import.meta.env, not process.env. Resolve
 * the token through readEnv (import.meta.env ?? process.env) and bridge it
 * into process.env so the SDK sees it in every environment.
 */
function hasToken(): boolean {
  const t = readEnv('BLOB_READ_WRITE_TOKEN');
  if (!t) return false;
  if (!process.env.BLOB_READ_WRITE_TOKEN) process.env.BLOB_READ_WRITE_TOKEN = t;
  return true;
}

// Store base URL (e.g. https://xxxx.public.blob.vercel-storage.com). Constant
// per store; learned once per instance and remembered.
let storeBase: string | null = null;

function learnBase(blobUrl: string, pathname: string): void {
  // blobUrl ends with /<pathname>; strip it to get the base.
  if (blobUrl.endsWith(`/${pathname}`)) {
    storeBase = blobUrl.slice(0, blobUrl.length - pathname.length - 1);
  }
}

async function resolveBase(): Promise<string | null> {
  if (storeBase) return storeBase;
  const fromEnv = readEnv('BLOB_STORE_BASE_URL');
  if (fromEnv) {
    storeBase = fromEnv.replace(/\/+$/, '');
    return storeBase;
  }
  // One-time learn from any existing blob. list() consistency doesn't matter
  // here — ANY blob (however old) reveals the store base.
  try {
    const { blobs } = await list({ prefix: 'blog/', limit: 1 });
    const blob = blobs[0];
    if (blob) {
      learnBase(blob.url, blob.pathname);
      return storeBase;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Persist a post's body HTML. Best-effort: never throws, logs failures.
 * Returns true when the body was persisted, false when it wasn't (no token,
 * or the put failed) so callers can surface the miss to the admin.
 */
export async function saveBody(postId: string, rawHTML: string): Promise<boolean> {
  if (!postId) return false;
  if (!hasToken()) {
    console.warn('[blog-body-store] BLOB_READ_WRITE_TOKEN not set — body not persisted', { postId });
    return false;
  }
  try {
    const result = await put(pathFor(postId), JSON.stringify({ rawHTML }), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      // Bodies change on edit; reads cache-bust anyway. Keep CDN TTL minimal.
      cacheControlMaxAge: 60,
    });
    learnBase(result.url, pathFor(postId));
    return true;
  } catch (err) {
    console.error('[blog-body-store] save failed (post exists in GHL; body not readable until re-saved)', {
      postId,
      err: String(err).slice(0, 200),
    });
    return false;
  }
}

/**
 * Read a post's body HTML. Returns '' when absent/unreachable (callers fall
 * back to the GHL description). Direct deterministic-URL fetch with a
 * cache-buster — immune to list()'s eventual consistency, so a body saved
 * milliseconds ago reads back correctly.
 */
export async function readBody(postId: string): Promise<string> {
  if (!postId || !hasToken()) return '';
  try {
    const base = await resolveBase();
    if (!base) return ''; // empty store and no env override — nothing to read
    const res = await fetch(`${base}/${pathFor(postId)}?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return ''; // 404 = no stored body (pre-blob post)
    const data = (await res.json()) as { rawHTML?: string };
    return typeof data.rawHTML === 'string' ? data.rawHTML : '';
  } catch (err) {
    console.warn('[blog-body-store] read failed', { postId, err: String(err).slice(0, 200) });
    return '';
  }
}

/** Delete a post's stored body (on archive). Best-effort. */
export async function deleteBody(postId: string): Promise<void> {
  if (!postId || !hasToken()) return;
  try {
    const base = await resolveBase();
    if (base) {
      await del(`${base}/${pathFor(postId)}`);
      return;
    }
    // No base learnable — fall back to list lookup.
    const { blobs } = await list({ prefix: pathFor(postId), limit: 1 });
    if (blobs[0]) await del(blobs[0].url);
  } catch (err) {
    console.warn('[blog-body-store] delete failed (non-fatal)', { postId, err: String(err).slice(0, 200) });
  }
}

/** Test-only: reset the learned store base. */
export function __resetBodyStore(): void {
  storeBase = null;
}
