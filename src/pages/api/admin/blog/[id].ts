/**
 * PUT    /api/admin/blog/[id] — update a post (only provided fields change).
 * DELETE /api/admin/blog/[id] — soft-delete (set status ARCHIVED).
 *
 * Both are admin-token gated (the `t` query param OR the `x-admin-token`
 * header). Update body mirrors create but all fields optional.
 */

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { GhlError } from '../../../../lib/ghl-rate-limit';
import { updatePost, archivePost, getPostById } from '../../../../lib/ghl-blog';
import { requireAdmin, json } from '../../../../lib/admin-api';

export const prerender = false;

// GET /api/admin/blog/[id] — fetch one post (incl. rawHTML) to prefill the editor.
export const GET: APIRoute = async ({ request, url, params }) => {
  const auth = requireAdmin(request, url);
  if (!auth.ok) return json(401, { ok: false, code: 'INVALID_TOKEN' });

  const id = params.id;
  if (!id) return json(400, { ok: false, code: 'INVALID_INPUT' });

  try {
    const post = await getPostById(id);
    if (!post) return json(404, { ok: false, code: 'NOT_FOUND' });
    return json(200, {
      ok: true,
      // bodyFallback: rawHTML is the description fallback, not the stored body —
      // the editor should warn before letting an edit overwrite the real body.
      post: { id: post.id, title: post.title, rawHTML: post.rawHTML, imageUrl: post.imageUrl, slug: post.slug, bodyFallback: post.bodyFallback },
    });
  } catch (err) {
    console.error('[admin/blog get] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return json(502, { ok: false, code: 'GHL_FAILED', message: 'Could not load the post.' });
  }
};

const UpdatePostRequest = z.object({
  title: z.string().min(1).max(300).optional(),
  rawHTML: z.string().min(1).max(500_000).optional(),
  imageUrl: z.string().min(1).max(2000).optional(),
  description: z.string().max(2000).optional(),
  imageAltText: z.string().max(500).optional(),
});

export const PUT: APIRoute = async ({ request, url, params }) => {
  const auth = requireAdmin(request, url);
  if (!auth.ok) return json(401, { ok: false, code: 'INVALID_TOKEN' });

  const id = params.id;
  if (!id) return json(400, { ok: false, code: 'INVALID_INPUT' });

  let payload: unknown;
  try { payload = await request.json(); } catch { return json(400, { ok: false, code: 'INVALID_INPUT' }); }
  const parsed = UpdatePostRequest.safeParse(payload);
  if (!parsed.success) return json(400, { ok: false, code: 'INVALID_INPUT' });

  try {
    const { bodyPersisted } = await updatePost(id, parsed.data);
    // bodyPersisted: false → the GHL update succeeded but the body blob save
    // failed; the UI should warn that a re-save is needed.
    return json(200, { ok: true, bodyPersisted });
  } catch (err) {
    if (err instanceof GhlError && err.status === 404) {
      // Post no longer published (deleted by another admin) — don't resurrect it.
      return json(404, { ok: false, code: 'NOT_FOUND', message: 'This post no longer exists — refresh the list.' });
    }
    console.error('[admin/blog update] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return json(502, { ok: false, code: 'GHL_FAILED', message: 'Could not update the post.' });
  }
};

export const DELETE: APIRoute = async ({ request, url, params }) => {
  const auth = requireAdmin(request, url);
  if (!auth.ok) return json(401, { ok: false, code: 'INVALID_TOKEN' });

  const id = params.id;
  if (!id) return json(400, { ok: false, code: 'INVALID_INPUT' });

  try {
    await archivePost(id);
    return json(200, { ok: true });
  } catch (err) {
    console.error('[admin/blog archive] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return json(502, { ok: false, code: 'GHL_FAILED', message: 'Could not delete the post.' });
  }
};
