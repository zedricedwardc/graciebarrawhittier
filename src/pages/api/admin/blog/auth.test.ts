import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the GHL blog client so the handler never makes real calls.
vi.mock('../../../../lib/ghl-blog', () => ({
  createPost: vi.fn(async () => ({ id: 'post_1', slug: 'hello' })),
}));

import { createPost } from '../../../../lib/ghl-blog';
import { signAdminToken } from '../../../../lib/admin-token';
import { POST } from './index';

const createPostMock = vi.mocked(createPost);
const KEY = 'test-admin-signing-key-at-least-32-chars-long';

function makeCtx(opts: { token?: string; header?: string; body?: unknown }) {
  const u = new URL('https://site.test/api/admin/blog');
  if (opts.token) u.searchParams.set('t', opts.token);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.header) headers.set('x-admin-token', opts.header);
  const request = new Request(u, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
  // Astro passes `url` and `request` to the handler.
  return { request, url: u } as Parameters<typeof POST>[0];
}

const validBody = { title: 'Hello', rawHTML: '<p>Hi.</p>', imageUrl: 'https://cdn/x.jpg' };

beforeEach(() => {
  createPostMock.mockClear();
  vi.stubEnv('ADMIN_SIGNING_KEY', KEY);
});

describe('POST /api/admin/blog auth', () => {
  it('returns 401 INVALID_TOKEN with no token', async () => {
    const res = await POST(makeCtx({ body: validBody }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, code: 'INVALID_TOKEN' });
    expect(createPostMock).not.toHaveBeenCalled();
  });

  it('returns 401 INVALID_TOKEN with a bad token', async () => {
    const res = await POST(makeCtx({ token: 'garbage', body: validBody }));
    expect(res.status).toBe(401);
    expect(createPostMock).not.toHaveBeenCalled();
  });

  it('reaches the handler with a valid token (query param)', async () => {
    const token = signAdminToken({});
    const res = await POST(makeCtx({ token, body: validBody }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 'post_1', slug: 'hello' });
    expect(createPostMock).toHaveBeenCalledTimes(1);
  });

  it('reaches the handler with a valid token (x-admin-token header)', async () => {
    const token = signAdminToken({});
    const res = await POST(makeCtx({ header: token, body: validBody }));
    expect(res.status).toBe(200);
    expect(createPostMock).toHaveBeenCalledTimes(1);
  });

  it('returns 400 INVALID_INPUT for a valid token but bad body', async () => {
    const token = signAdminToken({});
    const res = await POST(makeCtx({ token, body: { title: '' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(createPostMock).not.toHaveBeenCalled();
  });
});
