import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the underlying HTTP client so no real GHL calls happen.
vi.mock('./ghl-rate-limit', async () => {
  const actual = await vi.importActual<typeof import('./ghl-rate-limit')>('./ghl-rate-limit');
  return {
    ...actual,
    ghlFetch: vi.fn(),
  };
});

import { ghlFetch } from './ghl-rate-limit';
import {
  slugify,
  deriveDescription,
  stripHtml,
  buildCreatePayload,
  ensureUniqueSlug,
  createPost,
  listPublishedPosts,
  getPostBySlug,
  uploadBlogImage,
  __clearBlogCache,
} from './ghl-blog';

const ghlFetchMock = vi.mocked(ghlFetch);

beforeEach(() => {
  ghlFetchMock.mockReset();
  __clearBlogCache();
  vi.stubEnv('GHL_LOCATION_ID', 'loc_123');
  vi.stubEnv('GHL_BLOG_ID', 'blog_1');
  vi.stubEnv('GHL_BLOG_AUTHOR_ID', 'author_1');
  vi.stubEnv('GHL_BLOG_DEFAULT_CATEGORY_ID', 'cat_1');
});

describe('pure helpers', () => {
  it('slugify lowercases, strips punctuation, hyphenates', () => {
    expect(slugify('Hello, World! BJJ 101')).toBe('hello-world-bjj-101');
    expect(slugify('  Spaces   everywhere  ')).toBe('spaces-everywhere');
    expect(slugify('Café Olé')).toBe('cafe-ole');
    expect(slugify('!!!')).toBe('post'); // never empty
  });

  it('stripHtml removes tags + decodes common entities', () => {
    expect(stripHtml('<p>Hello&nbsp;<b>world</b> &amp; more</p>')).toBe('Hello world & more');
  });

  it('deriveDescription truncates to ~160 chars with an ellipsis', () => {
    const long = `<p>${'a'.repeat(300)}</p>`;
    const desc = deriveDescription(long);
    expect(desc.length).toBeLessThanOrEqual(161); // 160 + ellipsis
    expect(desc.endsWith('…')).toBe(true);
    const short = '<p>Short body.</p>';
    expect(deriveDescription(short)).toBe('Short body.');
  });
});

describe('ensureUniqueSlug', () => {
  it('returns the base slug when it does not exist', async () => {
    ghlFetchMock.mockResolvedValueOnce({ exists: false });
    const slug = await ensureUniqueSlug('My First Post');
    expect(slug).toBe('my-first-post');
    expect(ghlFetchMock).toHaveBeenCalledTimes(1);
    const [path] = ghlFetchMock.mock.calls[0]!;
    expect(path).toContain('/blogs/posts/url-slug-exists');
    expect(path).toContain('urlSlug=my-first-post');
    expect(path).toContain('locationId=loc_123');
  });

  it('appends a numeric suffix on collision', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({ exists: true })  // my-post
      .mockResolvedValueOnce({ exists: true })  // my-post-2
      .mockResolvedValueOnce({ exists: false }); // my-post-3
    const slug = await ensureUniqueSlug('My Post');
    expect(slug).toBe('my-post-3');
    expect(ghlFetchMock).toHaveBeenCalledTimes(3);
  });

  it('passes postId to exclude the post itself when updating', async () => {
    ghlFetchMock.mockResolvedValueOnce({ exists: false });
    await ensureUniqueSlug('Title', 'post_abc');
    const [path] = ghlFetchMock.mock.calls[0]!;
    expect(path).toContain('postId=post_abc');
  });
});

describe('buildCreatePayload', () => {
  it('auto-fills all GHL-required fields', () => {
    const payload = buildCreatePayload(
      { title: 'My Post', rawHTML: '<p>Body text here.</p>', imageUrl: 'https://cdn/x.jpg' },
      'my-post',
      '2026-06-10T00:00:00.000Z',
    );
    expect(payload).toMatchObject({
      title: 'My Post',
      locationId: 'loc_123',
      blogId: 'blog_1',
      imageUrl: 'https://cdn/x.jpg',
      rawHTML: '<p>Body text here.</p>',
      status: 'PUBLISHED',
      author: 'author_1',
      categories: ['cat_1'],
      urlSlug: 'my-post',
      publishedAt: '2026-06-10T00:00:00.000Z',
    });
  });

  it('defaults description to stripped rawHTML and imageAltText to title', () => {
    const payload = buildCreatePayload(
      { title: 'My Post', rawHTML: '<p>The body.</p>', imageUrl: 'u' },
      's',
      't',
    );
    expect(payload.description).toBe('The body.');
    expect(payload.imageAltText).toBe('My Post');
  });

  it('honours explicit description + imageAltText when provided', () => {
    const payload = buildCreatePayload(
      { title: 'My Post', rawHTML: '<p>x</p>', imageUrl: 'u', description: 'Custom.', imageAltText: 'Alt.' },
      's',
      't',
    );
    expect(payload.description).toBe('Custom.');
    expect(payload.imageAltText).toBe('Alt.');
  });
});

describe('createPost', () => {
  it('ensures a unique slug then POSTs the full payload', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({ exists: false })                          // slug check
      .mockResolvedValueOnce({ data: { _id: 'post_99', urlSlug: 'my-post' } }); // create

    const res = await createPost({ title: 'My Post', rawHTML: '<p>Hi.</p>', imageUrl: 'https://cdn/x.jpg' });
    expect(res).toEqual({ id: 'post_99', slug: 'my-post' });

    const [createPath, opts] = ghlFetchMock.mock.calls[1]!;
    expect(createPath).toBe('/blogs/posts');
    expect((opts as { method?: string }).method).toBe('POST');
    const body = (opts as { json?: Record<string, unknown> }).json!;
    expect(body.status).toBe('PUBLISHED');
    expect(body.urlSlug).toBe('my-post');
    expect(typeof body.publishedAt).toBe('string');
    expect(body.categories).toEqual(['cat_1']);
  });

  it('parses GHL’s blogPost-keyed create response (regression)', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({ exists: false })                                   // slug check
      .mockResolvedValueOnce({ blogPost: { _id: 'bp_1', urlSlug: 'my-post' } });   // create — GHL nests under blogPost

    const res = await createPost({ title: 'My Post', rawHTML: '<p>Hi.</p>', imageUrl: 'https://cdn/x.jpg' });
    expect(res).toEqual({ id: 'bp_1', slug: 'my-post' });
  });

  it('does not throw when a 2xx create response has no parseable id', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({ exists: false })  // slug check
      .mockResolvedValueOnce({ success: true }); // odd shape, but request succeeded

    const res = await createPost({ title: 'My Post', rawHTML: '<p>Hi.</p>', imageUrl: 'https://cdn/x.jpg' });
    expect(res.slug).toBe('my-post');
    expect(res.id).toBe('');
  });
});

describe('listPublishedPosts', () => {
  it('maps GHL posts to summaries, newest first', async () => {
    ghlFetchMock.mockResolvedValueOnce({
      blogs: [
        { _id: 'a', title: 'Old', urlSlug: 'old', publishedAt: '2026-01-01T00:00:00Z', imageUrl: 'i1', description: 'd1' },
        { _id: 'b', title: 'New', urlSlug: 'new', publishedAt: '2026-06-01T00:00:00Z', imageUrl: 'i2', description: 'd2', imageAltText: 'alt2' },
      ],
    });
    const posts = await listPublishedPosts();
    expect(posts.map((p) => p.id)).toEqual(['b', 'a']);
    expect(posts[0]).toEqual({
      id: 'b', title: 'New', slug: 'new', description: 'd2', imageUrl: 'i2', imageAltText: 'alt2', publishedAt: '2026-06-01T00:00:00Z',
    });
    const [path] = ghlFetchMock.mock.calls[0]!;
    expect(path).toContain('status=PUBLISHED');
    expect(path).toContain('blogId=blog_1');
  });

  it('serves [] on fetch error when no cache exists', async () => {
    ghlFetchMock.mockRejectedValueOnce(new Error('network'));
    const posts = await listPublishedPosts();
    expect(posts).toEqual([]);
  });

  it('serves last-good cache on a later fetch error', async () => {
    vi.useFakeTimers();
    try {
      ghlFetchMock.mockResolvedValueOnce({ blogs: [{ _id: 'a', title: 'A', urlSlug: 'a', publishedAt: '2026-01-01T00:00:00Z' }] });
      const first = await listPublishedPosts();
      expect(first).toHaveLength(1);

      // Advance past the 5-min TTL so the next call re-fetches (and fails).
      vi.advanceTimersByTime(6 * 60 * 1000);
      ghlFetchMock.mockRejectedValueOnce(new Error('network'));
      const second = await listPublishedPosts();
      expect(second).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getPostBySlug', () => {
  it('returns the matching post mapped with rawHTML + status', async () => {
    ghlFetchMock.mockResolvedValueOnce({
      blogs: [
        { _id: 'a', urlSlug: 'other', title: 'Other' },
        { _id: 'b', urlSlug: 'wanted', title: 'Wanted', rawHTML: '<p>Body</p>', status: 'PUBLISHED', publishedAt: '2026-06-01T00:00:00Z' },
      ],
    });
    const post = await getPostBySlug('wanted');
    expect(post).toMatchObject({ id: 'b', slug: 'wanted', rawHTML: '<p>Body</p>', status: 'PUBLISHED' });
  });

  it('returns null when no post matches the slug', async () => {
    ghlFetchMock.mockResolvedValueOnce({ blogs: [{ _id: 'a', urlSlug: 'x' }] });
    expect(await getPostBySlug('missing')).toBeNull();
  });
});

describe('uploadBlogImage', () => {
  it('POSTs multipart form data and returns the hosted url', async () => {
    ghlFetchMock.mockResolvedValueOnce({ url: 'https://cdn/hosted.jpg' });
    const res = await uploadBlogImage({ bytes: Buffer.from('abc'), filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res).toEqual({ url: 'https://cdn/hosted.jpg' });
    const [path, opts] = ghlFetchMock.mock.calls[0]!;
    expect(path).toBe('/medias/upload-file');
    expect((opts as { method?: string }).method).toBe('POST');
    expect((opts as { formData?: FormData }).formData).toBeInstanceOf(FormData);
  });

  it('reads fileUrl when GHL returns that key instead', async () => {
    ghlFetchMock.mockResolvedValueOnce({ fileUrl: 'https://cdn/f.png' });
    const res = await uploadBlogImage({ bytes: Buffer.from('a'), filename: 'f.png', contentType: 'image/png' });
    expect(res.url).toBe('https://cdn/f.png');
  });
});
