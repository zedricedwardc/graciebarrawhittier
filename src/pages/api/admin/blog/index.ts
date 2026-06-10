/**
 * POST /api/admin/blog
 *
 * Create a PUBLISHED blog post in GHL Blogs. Admin-token gated (the `t` query
 * param OR the `x-admin-token` header). The featured image must already be
 * hosted in GHL Medias — upload it first via POST /api/admin/blog/upload, then
 * pass the returned `imageUrl` here. We abort before createPost if no imageUrl,
 * so a partial post is never created.
 *
 * Body: { title, rawHTML, imageUrl, description?, imageAltText? }
 * Response: { ok: true, id, slug } | { ok: false, code, message? }
 */

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { GhlError } from '../../../../lib/ghl-rate-limit';
import { createPost } from '../../../../lib/ghl-blog';
import { requireAdmin, json } from '../../../../lib/admin-api';

export const prerender = false;

const CreatePostRequest = z.object({
  title: z.string().min(1).max(300),
  rawHTML: z.string().min(1).max(500_000),
  imageUrl: z.string().min(1).max(2000),
  description: z.string().max(2000).optional(),
  imageAltText: z.string().max(500).optional(),
});

export const POST: APIRoute = async ({ request, url }) => {
  const auth = requireAdmin(request, url);
  if (!auth.ok) return json(401, { ok: false, code: 'INVALID_TOKEN' });

  let payload: unknown;
  try { payload = await request.json(); } catch { return json(400, { ok: false, code: 'INVALID_INPUT' }); }
  const parsed = CreatePostRequest.safeParse(payload);
  if (!parsed.success) return json(400, { ok: false, code: 'INVALID_INPUT' });

  try {
    const { id, slug } = await createPost(parsed.data);
    return json(200, { ok: true, id, slug });
  } catch (err) {
    console.error('[admin/blog create] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return json(502, { ok: false, code: 'GHL_FAILED', message: 'Could not create the post.' });
  }
};
