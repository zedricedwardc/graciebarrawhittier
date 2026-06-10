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
 * Store is public-access; bodies are public content anyway (they render on the
 * website). Requires BLOB_READ_WRITE_TOKEN (auto-injected when the Blob store
 * is connected to the Vercel project; pull locally via `vercel env pull`).
 *
 * All functions are best-effort and never throw: a missing/unreachable blob
 * degrades to '' (callers fall back to the GHL description), and a failed save
 * is logged — the post itself already exists in GHL.
 */

import { put, del, list } from '@vercel/blob';

function pathFor(postId: string): string {
  return `blog/${postId}.json`;
}

function hasToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Persist a post's body HTML. Best-effort: logs + swallows failures. */
export async function saveBody(postId: string, rawHTML: string): Promise<void> {
  if (!postId) return;
  if (!hasToken()) {
    console.warn('[blog-body-store] BLOB_READ_WRITE_TOKEN not set — body not persisted', { postId });
    return;
  }
  try {
    await put(pathFor(postId), JSON.stringify({ rawHTML }), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      // Bodies change on edit — don't let the CDN pin an old version for long.
      cacheControlMaxAge: 60,
    });
  } catch (err) {
    console.error('[blog-body-store] save failed (post exists in GHL; body not readable until re-saved)', {
      postId,
      err: String(err).slice(0, 200),
    });
  }
}

/**
 * Read a post's body HTML. Returns '' when absent/unreachable (callers fall
 * back to the GHL description). Resolves the blob URL via list() so we never
 * have to hardcode the store's base URL.
 */
export async function readBody(postId: string): Promise<string> {
  if (!postId || !hasToken()) return '';
  try {
    const { blobs } = await list({ prefix: pathFor(postId), limit: 1 });
    const blob = blobs[0];
    if (!blob) return '';
    // Cache-bust by upload version: allowOverwrite keeps the same blob URL, so
    // the CDN could otherwise serve the previous body for up to cacheControlMaxAge
    // after an edit. uploadedAt changes on every save → fresh URL per version.
    const version = blob.uploadedAt ? new Date(blob.uploadedAt).getTime() : Date.now();
    const res = await fetch(`${blob.url}?v=${version}`, { cache: 'no-store' });
    if (!res.ok) return '';
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
    const { blobs } = await list({ prefix: pathFor(postId), limit: 1 });
    if (blobs[0]) await del(blobs[0].url);
  } catch (err) {
    console.warn('[blog-body-store] delete failed (non-fatal)', { postId, err: String(err).slice(0, 200) });
  }
}
