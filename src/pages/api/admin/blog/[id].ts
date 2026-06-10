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
import { updatePost, archivePost } from '../../../../lib/ghl-blog';
import { requireAdmin, json } from '../../../../lib/admin-api';

export const prerender = false;

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
    await updatePost(id, parsed.data);
    return json(200, { ok: true });
  } catch (err) {
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
