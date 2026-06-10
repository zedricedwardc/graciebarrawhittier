import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
  del: vi.fn(),
  list: vi.fn(),
}));

import { put, del, list } from '@vercel/blob';
import { saveBody, readBody, deleteBody, __resetBodyStore } from './blog-body-store';

const putMock = vi.mocked(put);
const delMock = vi.mocked(del);
const listMock = vi.mocked(list);

const BASE = 'https://teststore.public.blob.vercel-storage.com';

function mockFetchJson(status: number, body?: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  putMock.mockReset();
  delMock.mockReset();
  listMock.mockReset();
  __resetBodyStore();
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test_token');
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('saveBody', () => {
  it('puts JSON at a deterministic pathname with overwrite enabled, returns true', async () => {
    putMock.mockResolvedValueOnce({ url: `${BASE}/blog/p1.json`, pathname: 'blog/p1.json' } as never);
    expect(await saveBody('p1', '<p>Hello</p>')).toBe(true);
    const [pathname, body, opts] = putMock.mock.calls[0]!;
    expect(pathname).toBe('blog/p1.json');
    expect(JSON.parse(body as string)).toEqual({ rawHTML: '<p>Hello</p>' });
    expect(opts).toMatchObject({ access: 'public', addRandomSuffix: false, allowOverwrite: true });
  });

  it('is a no-op without the blob token — reports false so callers can warn', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    expect(await saveBody('p1', '<p>x</p>')).toBe(false);
    expect(putMock).not.toHaveBeenCalled();
  });

  it('returns false (never throws) when the blob put fails', async () => {
    putMock.mockRejectedValueOnce(new Error('blob unavailable'));
    expect(await saveBody('p1', '<p>x</p>')).toBe(false);
  });
});

describe('readBody', () => {
  it('REGRESSION: reads a just-saved body even while list() is blind (eventual consistency)', async () => {
    // saveBody teaches the store base from put()'s result…
    putMock.mockResolvedValueOnce({ url: `${BASE}/blog/p1.json`, pathname: 'blog/p1.json' } as never);
    await saveBody('p1', '<p>fresh edit</p>');
    // …so the read NEVER calls list() (which would return [] right after a write).
    listMock.mockResolvedValue({ blobs: [] } as never);
    vi.stubGlobal('fetch', mockFetchJson(200, { rawHTML: '<p>fresh edit</p>' }));

    const body = await readBody('p1');
    expect(body).toBe('<p>fresh edit</p>');
    expect(listMock).not.toHaveBeenCalled();
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toMatch(new RegExp(`^${BASE}/blog/p1\\.json\\?v=\\d+$`)); // cache-busted direct URL
  });

  it('cold instance: learns the base from env BLOB_STORE_BASE_URL', async () => {
    vi.stubEnv('BLOB_STORE_BASE_URL', `${BASE}/`);
    vi.stubGlobal('fetch', mockFetchJson(200, { rawHTML: '<p>b</p>' }));
    const body = await readBody('p2');
    expect(body).toBe('<p>b</p>');
    expect(listMock).not.toHaveBeenCalled();
  });

  it('cold instance without env: learns the base from any existing blob via list()', async () => {
    listMock.mockResolvedValueOnce({
      blobs: [{ url: `${BASE}/blog/old.json`, pathname: 'blog/old.json' }],
    } as never);
    vi.stubGlobal('fetch', mockFetchJson(200, { rawHTML: '<p>c</p>' }));
    const body = await readBody('p3');
    expect(body).toBe('<p>c</p>');
  });

  it('returns "" for a 404 (pre-blob post) and for an empty store', async () => {
    vi.stubEnv('BLOB_STORE_BASE_URL', BASE);
    vi.stubGlobal('fetch', mockFetchJson(404));
    expect(await readBody('nope')).toBe('');

    __resetBodyStore();
    vi.unstubAllEnvs();
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_test_token');
    listMock.mockResolvedValueOnce({ blobs: [] } as never);
    expect(await readBody('nope')).toBe('');
  });
});

describe('deleteBody', () => {
  it('deletes via the deterministic URL once the base is known', async () => {
    putMock.mockResolvedValueOnce({ url: `${BASE}/blog/p9.json`, pathname: 'blog/p9.json' } as never);
    await saveBody('p9', '<p>x</p>');
    delMock.mockResolvedValueOnce(undefined as never);
    await deleteBody('p9');
    expect(delMock).toHaveBeenCalledWith(`${BASE}/blog/p9.json`);
  });
});
