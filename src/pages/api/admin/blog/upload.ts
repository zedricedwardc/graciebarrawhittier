/**
 * POST /api/admin/blog/upload
 *
 * Upload a featured/inline image to GHL Medias and return its hosted URL, which
 * the admin form then passes to POST /api/admin/blog as `imageUrl`. Admin-token
 * gated (the `t` query param OR the `x-admin-token` header).
 *
 * Request: multipart/form-data with a single `file` field.
 * Response: { ok: true, url } | { ok: false, code, message? }
 */

import type { APIRoute } from 'astro';
import { GhlError } from '../../../../lib/ghl-rate-limit';
import { uploadBlogImage } from '../../../../lib/ghl-blog';
import { requireAdmin, json } from '../../../../lib/admin-api';

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export const POST: APIRoute = async ({ request, url }) => {
  const auth = requireAdmin(request, url);
  if (!auth.ok) return json(401, { ok: false, code: 'INVALID_TOKEN' });

  let form: FormData;
  try { form = await request.formData(); } catch { return json(400, { ok: false, code: 'INVALID_INPUT' }); }

  const file = form.get('file');
  if (!(file instanceof File)) return json(400, { ok: false, code: 'INVALID_INPUT', message: 'Missing file.' });
  if (file.size === 0 || file.size > MAX_BYTES) {
    return json(400, { ok: false, code: 'INVALID_INPUT', message: 'File missing or too large (max 10 MB).' });
  }
  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED.has(contentType)) {
    return json(400, { ok: false, code: 'INVALID_INPUT', message: 'Unsupported image type.' });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { url: hostedUrl } = await uploadBlogImage({
      bytes,
      filename: file.name || 'image',
      contentType,
    });
    return json(200, { ok: true, url: hostedUrl });
  } catch (err) {
    console.error('[admin/blog upload] failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path } : { err: String(err) });
    return json(502, { ok: false, code: 'GHL_FAILED', message: 'Could not upload the image.' });
  }
};
