import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the underlying HTTP client so no real GHL calls happen.
vi.mock('./ghl-rate-limit', async () => {
  const actual = await vi.importActual<typeof import('./ghl-rate-limit')>('./ghl-rate-limit');
  return {
    ...actual,
    ghlFetch: vi.fn(),
  };
});
// Mock the blob body store — GHL never returns rawHTML, so reads merge from here.
vi.mock('./blog-body-store', () => ({
  saveBody: vi.fn(async () => true),
  readBody: vi.fn(async () => ''),
  deleteBody: vi.fn(async () => {}),
}));
// Force the in-memory cache fallback (deterministic; __clearBlogCache resets it).
vi.mock('@vercel/functions', () => ({
  getCache: () => { throw new Error('runtime cache unavailable in tests'); },
}));

import { ghlFetch } from './ghl-rate-limit';
import { saveBody, readBody, deleteBody } from './blog-body-store';
import {
  slugify,
  deriveDescription,
  ensureHtml,
  stripHtml,
  sanitizeBody,
  buildCreatePayload,
  ensureUniqueSlug,
  createPost,
  updatePost,
  listPublishedPosts,
  listAllPublishedForSitemap,
  getPostBySlug,
  getAuthorsMap,
  getBlogsMap,
  uploadBlogImage,
  __clearBlogCache,
} from './ghl-blog';

const ghlFetchMock = vi.mocked(ghlFetch);
const saveBodyMock = vi.mocked(saveBody);
const readBodyMock = vi.mocked(readBody);
const deleteBodyMock = vi.mocked(deleteBody);

beforeEach(() => {
  ghlFetchMock.mockReset();
  saveBodyMock.mockReset().mockResolvedValue(true);
  readBodyMock.mockReset().mockResolvedValue('');
  deleteBodyMock.mockReset().mockResolvedValue(undefined);
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

  it('ensureHtml wraps bare text so GHL persists the body', () => {
    // GHL drops non-HTML rawHTML — bare text must be wrapped.
    expect(ensureHtml('testtt')).toBe('<p>testtt</p>');
    expect(ensureHtml('line one\nline two')).toBe('<p>line one</p><p>line two</p>');
    expect(ensureHtml('  ')).toBe('');
    // Inline-only content still needs a block wrapper.
    expect(ensureHtml('<b>bold</b> text')).toBe('<p><b>bold</b> text</p>');
    // Already-block HTML passes through untouched.
    expect(ensureHtml('<p>already</p>')).toBe('<p>already</p>');
    expect(ensureHtml('<h2>Title</h2><p>body</p>')).toBe('<h2>Title</h2><p>body</p>');
  });

  it('sanitizeBody strips script/iframe/event handlers but keeps the editor allowlist', () => {
    // Active content is removed entirely (including script text).
    expect(sanitizeBody('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
    expect(sanitizeBody('<iframe src="https://evil"></iframe><p>ok</p>')).toBe('<p>ok</p>');
    // Event handlers + javascript:/data: URLs are stripped, the element survives.
    const img = sanitizeBody('<img src="https://cdn/x.jpg" onerror="alert(1)" alt="a" width="10" height="20">');
    expect(img).not.toContain('onerror');
    expect(img).toContain('src="https://cdn/x.jpg"');
    expect(img).toContain('alt="a"');
    expect(sanitizeBody('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
    expect(sanitizeBody('<img src="data:image/png;base64,AAAA">')).not.toContain('data:');
    // Editor allowlist passes through untouched.
    const kept = '<h2>Title</h2><ul><li><strong>bold</strong> <em>em</em> <u>u</u></li></ul>'
      + '<blockquote><span>quote</span></blockquote>'
      + '<p><a href="https://x.com" target="_blank" rel="noopener">link</a><br /></p>';
    expect(sanitizeBody(kept)).toBe(kept);
  });

  it('sanitizeBody keeps the toolbar style allowlist but strips every other CSS property', () => {
    const aligned = sanitizeBody('<p style="text-align: center; position: fixed">c</p>');
    expect(aligned).toContain('text-align:center');
    expect(aligned).not.toContain('position');
    // Non-allowlisted values don't survive either.
    expect(sanitizeBody('<p style="text-align: -moz-evil">x</p>')).not.toContain('text-align');
    // Colors (hex/rgb), fonts, sizes, line-height, indent margins all pass.
    const styled = sanitizeBody(
      '<p style="line-height: 1.5; margin-left: 4rem"><span style="color: #d72c0d; background-color: rgb(255, 241, 118); font-family: Georgia, serif; font-size: 24px">x</span></p>',
    );
    expect(styled).toContain('line-height:1.5');
    expect(styled).toContain('margin-left:4rem');
    expect(styled).toContain('color:#d72c0d');
    expect(styled).toContain('background-color:rgb(255, 241, 118)');
    expect(styled).toContain('font-family:Georgia, serif');
    expect(styled).toContain('font-size:24px');
    // url()/expression()-style payloads in allowed properties are rejected.
    expect(sanitizeBody('<p style="background-color: url(https://evil)">x</p>')).not.toContain('url');
  });

  it('sanitizeBody allows strikethrough, hr, and YouTube/Vimeo iframes only', () => {
    expect(sanitizeBody('<p><s>old</s> new</p><hr />')).toBe('<p><s>old</s> new</p><hr />');
    const yt = '<iframe src="https://www.youtube-nocookie.com/embed/abc123" allowfullscreen></iframe>';
    expect(sanitizeBody(yt)).toContain('youtube-nocookie.com/embed/abc123');
    const vimeo = '<iframe src="https://player.vimeo.com/video/123456"></iframe>';
    expect(sanitizeBody(vimeo)).toContain('player.vimeo.com/video/123456');
    // Any other iframe host is dropped entirely.
    expect(sanitizeBody('<iframe src="https://evil.example/x"></iframe><p>ok</p>')).toBe('<p>ok</p>');
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
    expect(res).toEqual({ id: 'post_99', slug: 'my-post', bodyPersisted: true });

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
    expect(res).toEqual({ id: 'bp_1', slug: 'my-post', bodyPersisted: true });
  });

  it('does not throw when a 2xx create response has no parseable id', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({ exists: false })  // slug check
      .mockResolvedValueOnce({ success: true }); // odd shape, but request succeeded

    const res = await createPost({ title: 'My Post', rawHTML: '<p>Hi.</p>', imageUrl: 'https://cdn/x.jpg' });
    expect(res.slug).toBe('my-post');
    expect(res.id).toBe('');
    expect(res.bodyPersisted).toBe(false); // save skipped — nothing to key the body on
    expect(saveBodyMock).not.toHaveBeenCalled(); // no id to key the body on
  });

  it('persists the (HTML-wrapped, sanitized) body to the blob store keyed by the new id', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({ exists: false })                                  // slug check
      .mockResolvedValueOnce({ blogPost: { _id: 'bp_2', urlSlug: 'my-post' } }); // create

    await createPost({ title: 'My Post', rawHTML: 'bare body text', imageUrl: 'u' });
    expect(saveBodyMock).toHaveBeenCalledWith('bp_2', '<p>bare body text</p>');
  });

  it('sends the SAME sanitized body to GHL and the blob store', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({ exists: false })                                  // slug check
      .mockResolvedValueOnce({ blogPost: { _id: 'bp_3', urlSlug: 'my-post' } }); // create

    await createPost({ title: 'My Post', rawHTML: '<p>hi</p><script>alert(1)</script>', imageUrl: 'u' });
    const [, opts] = ghlFetchMock.mock.calls[1]!;
    const body = (opts as { json?: Record<string, unknown> }).json!;
    expect(body.rawHTML).toBe('<p>hi</p>');
    expect(saveBodyMock).toHaveBeenCalledWith('bp_3', '<p>hi</p>');
  });

  it('reports bodyPersisted: false when the blob save fails', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({ exists: false })                                  // slug check
      .mockResolvedValueOnce({ blogPost: { _id: 'bp_4', urlSlug: 'my-post' } }); // create
    saveBodyMock.mockResolvedValueOnce(false); // blob put failed / no token

    const res = await createPost({ title: 'My Post', rawHTML: '<p>Hi.</p>', imageUrl: 'u' });
    expect(res).toEqual({ id: 'bp_4', slug: 'my-post', bodyPersisted: false });
  });
});

describe('updatePost', () => {
  /** updatePost verifies the post is still PUBLISHED before writing (GHL's PUT
   *  requires `status`, and sending PUBLISHED must never resurrect an archived
   *  post). Enqueue the getPostById fetches: list page + authors + blogs. */
  function mockExisting(id = 'post_1') {
    ghlFetchMock
      .mockResolvedValueOnce({ blogs: [{ _id: id, urlSlug: 'existing', title: 'Existing' }] }) // list (getPostById)
      .mockResolvedValueOnce({ authors: [] }) // authors map
      .mockResolvedValueOnce({ data: [] }); // blogs map
  }
  /** The PUT call's JSON body, located by method (mock order varies per case). */
  function putBody(): Record<string, unknown> {
    const call = ghlFetchMock.mock.calls.find(
      ([, opts]) => (opts as { method?: string } | undefined)?.method === 'PUT',
    );
    expect(call).toBeDefined();
    return (call![1] as { json?: Record<string, unknown> }).json!;
  }

  it('sends status PUBLISHED only after verifying the post is still published', async () => {
    mockExisting();
    ghlFetchMock.mockResolvedValueOnce({}); // PUT
    await updatePost('post_1', { imageUrl: 'https://cdn/new.jpg' });
    const body = putBody();
    expect(body.status).toBe('PUBLISHED'); // GHL 422s without status
    expect(body.imageUrl).toBe('https://cdn/new.jpg');
  });

  it('throws a 404 GhlError when the post is no longer published (no resurrect)', async () => {
    // getPostById finds nothing — short page ends the search.
    ghlFetchMock
      .mockResolvedValueOnce({ blogs: [] }); // list (getPostById) — empty
    await expect(updatePost('gone_1', { title: 'X' })).rejects.toMatchObject({ status: 404 });
    // No PUT was sent.
    expect(ghlFetchMock.mock.calls.find(([, o]) => (o as { method?: string } | undefined)?.method === 'PUT')).toBeUndefined();
  });

  it('re-derives the description from the new body when none is provided', async () => {
    mockExisting();
    ghlFetchMock.mockResolvedValueOnce({}); // PUT
    const res = await updatePost('post_1', { rawHTML: '<p>Fresh body text.</p>' });
    const body = putBody();
    expect(body.description).toBe('Fresh body text.');
    expect(body.rawHTML).toBe('<p>Fresh body text.</p>');
    // Sanitized body persisted to the blob store; success reported.
    expect(saveBodyMock).toHaveBeenCalledWith('post_1', '<p>Fresh body text.</p>');
    expect(res).toEqual({ bodyPersisted: true });
  });

  it('honours an explicit description over the re-derived one', async () => {
    mockExisting();
    ghlFetchMock.mockResolvedValueOnce({}); // PUT
    await updatePost('post_1', { rawHTML: '<p>Body.</p>', description: 'Custom summary.' });
    expect(putBody().description).toBe('Custom summary.');
  });

  it('sanitizes the body before sending to GHL and the blob store', async () => {
    mockExisting();
    ghlFetchMock.mockResolvedValueOnce({}); // PUT
    await updatePost('post_1', { rawHTML: '<p>ok</p><img src="https://cdn/x.jpg" onerror="alert(1)">' });
    const body = putBody();
    expect(body.rawHTML).not.toContain('onerror');
    expect(saveBodyMock).toHaveBeenCalledWith('post_1', body.rawHTML);
  });

  it('reports bodyPersisted: true when the update carries no body (nothing to persist)', async () => {
    mockExisting();
    ghlFetchMock
      .mockResolvedValueOnce({ exists: false }) // slug check (title changed)
      .mockResolvedValueOnce({});               // PUT
    const res = await updatePost('post_1', { title: 'New Title' });
    expect(saveBodyMock).not.toHaveBeenCalled();
    expect(res).toEqual({ bodyPersisted: true });
  });

  it('reports bodyPersisted: false when the blob save fails', async () => {
    mockExisting();
    ghlFetchMock.mockResolvedValueOnce({}); // PUT
    saveBodyMock.mockResolvedValueOnce(false);
    const res = await updatePost('post_1', { rawHTML: '<p>Body.</p>' });
    expect(res).toEqual({ bodyPersisted: false });
  });
});

describe('listPublishedPosts', () => {
  it('maps GHL posts to summaries, newest first', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({
        blogs: [
          { _id: 'a', title: 'Old', urlSlug: 'old', publishedAt: '2026-01-01T00:00:00Z', imageUrl: 'i1', description: 'd1', author: 'author_1', blogId: 'blog_1' },
          { _id: 'b', title: 'New', urlSlug: 'new', publishedAt: '2026-06-01T00:00:00Z', imageUrl: 'i2', description: 'd2', imageAltText: 'alt2', author: 'author_1', blogId: 'blog_1' },
        ],
      }) // list
      .mockResolvedValueOnce({ authors: [{ _id: 'author_1', name: 'Jane Coach' }] }) // authors map
      .mockResolvedValueOnce({ data: [{ _id: 'blog_1', name: 'GBW Blog' }] }); // blogs map
    const posts = await listPublishedPosts();
    expect(posts.map((p) => p.id)).toEqual(['b', 'a']);
    expect(posts[0]).toEqual({
      id: 'b', title: 'New', slug: 'new', description: 'd2', imageUrl: 'i2', imageAltText: 'alt2', publishedAt: '2026-06-01T00:00:00Z',
      authorName: 'Jane Coach', blogName: 'GBW Blog',
    });
    const [path] = ghlFetchMock.mock.calls[0]!;
    expect(path).toContain('status=PUBLISHED');
    expect(path).toContain('blogId=blog_1');
  });

  it('falls back to the default author/blog name for unknown ids', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({
        blogs: [
          // post carries no author/blog id at all
          { _id: 'a', title: 'A', urlSlug: 'a', publishedAt: '2026-01-01T00:00:00Z' },
          // post carries an author id the map doesn't know
          { _id: 'b', title: 'B', urlSlug: 'b', publishedAt: '2026-02-01T00:00:00Z', author: 'unknown_author', blogId: 'unknown_blog' },
        ],
      }) // list
      .mockResolvedValueOnce({ authors: [{ _id: 'author_1', name: 'Default Author' }] }) // authors map (only the configured default)
      .mockResolvedValueOnce({ data: [{ _id: 'blog_1', name: 'Default Blog' }] }); // blogs map
    const posts = await listPublishedPosts();
    // Both posts fall back to the configured default (GHL_BLOG_AUTHOR_ID/GHL_BLOG_ID) names.
    for (const p of posts) {
      expect(p.authorName).toBe('Default Author');
      expect(p.blogName).toBe('Default Blog');
    }
  });

  it('uses the — placeholder when no name resolves at all', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({
        blogs: [{ _id: 'a', title: 'A', urlSlug: 'a', publishedAt: '2026-01-01T00:00:00Z', author: 'x', blogId: 'y' }],
      }) // list
      .mockResolvedValueOnce({ authors: [] }) // empty authors map
      .mockResolvedValueOnce({ data: [] }); // empty blogs map
    const posts = await listPublishedPosts();
    expect(posts[0]!.authorName).toBe('—');
    expect(posts[0]!.blogName).toBe('—');
  });

  it('serves [] on fetch error when no cache exists', async () => {
    ghlFetchMock.mockRejectedValueOnce(new Error('network'));
    const posts = await listPublishedPosts();
    expect(posts).toEqual([]);
  });

  it('listAllPublishedForSitemap pages through GHL until a short page', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      _id: `p${i}`, urlSlug: `post-${i}`, publishedAt: '2026-06-01T00:00:00Z',
    }));
    ghlFetchMock
      .mockResolvedValueOnce({ blogs: fullPage }) // page 1 (full → keep going)
      .mockResolvedValueOnce({ blogs: [{ _id: 'last', urlSlug: 'last-post', publishedAt: '2026-06-02T00:00:00Z' }] }); // page 2 (short → stop)
    const all = await listAllPublishedForSitemap();
    expect(all).toHaveLength(51);
    expect(all[50]).toEqual({ slug: 'last-post', publishedAt: '2026-06-02T00:00:00Z' });
    expect(ghlFetchMock).toHaveBeenCalledTimes(2);
    expect(String(ghlFetchMock.mock.calls[1]![0])).toContain('offset=50');
    // Slug-less entries can't produce a URL — dropped, not emitted as /blog//.
    __clearBlogCache();
    ghlFetchMock.mockReset().mockResolvedValueOnce({ blogs: [{ _id: 'x', publishedAt: '2026-06-01T00:00:00Z' }] });
    expect(await listAllPublishedForSitemap()).toEqual([]);
  });

  it('serves last-good cache on a later fetch error', async () => {
    vi.useFakeTimers();
    try {
      ghlFetchMock
        .mockResolvedValueOnce({ blogs: [{ _id: 'a', title: 'A', urlSlug: 'a', publishedAt: '2026-01-01T00:00:00Z' }] }) // list
        .mockResolvedValueOnce({ authors: [] }) // authors map
        .mockResolvedValueOnce({ data: [] }); // blogs map
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
  it('merges the body from the blob store (GHL never returns rawHTML)', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({
        blogs: [
          { _id: 'a', urlSlug: 'other', title: 'Other' },
          { _id: 'b', urlSlug: 'wanted', title: 'Wanted', status: 'PUBLISHED', publishedAt: '2026-06-01T00:00:00Z', author: 'author_1', blogId: 'blog_1' },
        ],
      }) // list page
      .mockResolvedValueOnce({ authors: [{ _id: 'author_1', fullName: 'Coach Carlos' }] }) // authors map
      .mockResolvedValueOnce({ data: [{ _id: 'blog_1', name: 'GBW Blog' }] }); // blogs map
    readBodyMock.mockResolvedValueOnce('<p>Stored body</p>');
    const post = await getPostBySlug('wanted');
    expect(readBodyMock).toHaveBeenCalledWith('b');
    expect(post).toMatchObject({
      id: 'b', slug: 'wanted', rawHTML: '<p>Stored body</p>', status: 'PUBLISHED',
      authorName: 'Coach Carlos', blogName: 'GBW Blog',
      bodyFallback: false, // the real stored body loaded — not the description fallback
    });
  });

  it('falls back to the GHL description when no stored body exists (pre-blob posts)', async () => {
    ghlFetchMock
      .mockResolvedValueOnce({
        blogs: [{ _id: 'b', urlSlug: 'wanted', title: 'Wanted', description: 'Saved summary text.', publishedAt: '2026-06-01T00:00:00Z' }],
      })
      .mockResolvedValueOnce({ authors: [] })
      .mockResolvedValueOnce({ data: [] });
    readBodyMock.mockResolvedValueOnce(''); // nothing in the blob store
    const post = await getPostBySlug('wanted');
    expect(post?.rawHTML).toBe('<p>Saved summary text.</p>');
    expect(post?.bodyFallback).toBe(true); // body is the description stand-in, flagged for the editor
  });

  it('returns null when no post matches the slug', async () => {
    ghlFetchMock.mockResolvedValueOnce({ blogs: [{ _id: 'a', urlSlug: 'x' }] });
    expect(await getPostBySlug('missing')).toBeNull();
  });
});

describe('getAuthorsMap', () => {
  it('parses the {authors:[{_id,name}]} shape into id -> name', async () => {
    ghlFetchMock.mockResolvedValueOnce({
      authors: [
        { _id: 'au1', name: 'Jane Coach' },
        { _id: 'au2', name: 'John Coach' },
      ],
    });
    const map = await getAuthorsMap();
    expect(map).toEqual({ au1: 'Jane Coach', au2: 'John Coach' });
    const [path] = ghlFetchMock.mock.calls[0]!;
    expect(path).toContain('/blogs/authors');
    expect(path).toContain('locationId=loc_123');
    expect(path).toContain('limit=20'); // GHL 422s on limit>~20 for /blogs/authors
  });

  it('parses the {data:[{id,fullName}]} shape into id -> name', async () => {
    ghlFetchMock.mockResolvedValueOnce({
      data: [{ id: 'au3', fullName: 'Carlos Gracie' }],
    });
    const map = await getAuthorsMap();
    expect(map).toEqual({ au3: 'Carlos Gracie' });
  });

  it('derives a name from firstName + lastName when no name/fullName', async () => {
    ghlFetchMock.mockResolvedValueOnce({
      authors: [{ _id: 'au4', firstName: 'Helio', lastName: 'Gracie' }],
    });
    const map = await getAuthorsMap();
    expect(map).toEqual({ au4: 'Helio Gracie' });
  });

  it('returns {} on fetch error when no cache exists', async () => {
    ghlFetchMock.mockRejectedValueOnce(new Error('network'));
    expect(await getAuthorsMap()).toEqual({});
  });
});

describe('getBlogsMap', () => {
  it('parses the {data:[{_id,name}]} shape into id -> name', async () => {
    ghlFetchMock.mockResolvedValueOnce({
      data: [
        { _id: 'b1', name: 'GBW Blog' },
        { _id: 'b2', title: 'Second Blog' },
      ],
    });
    const map = await getBlogsMap();
    expect(map).toEqual({ b1: 'GBW Blog', b2: 'Second Blog' });
    const [path] = ghlFetchMock.mock.calls[0]!;
    expect(path).toContain('/blogs/site/all');
    expect(path).toContain('locationId=loc_123');
  });

  it('returns {} on fetch error when no cache exists', async () => {
    ghlFetchMock.mockRejectedValueOnce(new Error('network'));
    expect(await getBlogsMap()).toEqual({});
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
