/**
 * Server-only GoHighLevel Blogs client.
 * NEVER import this from a component or anywhere reachable by the browser bundle.
 *
 * GHL Blogs is the store; GHL Medias hosts images. This module owns the mapping
 * between our minimal post model and GHL's verbose create/update payloads, and
 * auto-fills every GHL-required field so the admin form can stay dead-simple.
 *
 * Endpoints used:
 *   GET  /blogs/posts/all?locationId&blogId&limit&offset&status=PUBLISHED — list
 *   POST /blogs/posts                                                     — create
 *   PUT  /blogs/posts/{postId}                                            — update
 *   GET  /blogs/posts/url-slug-exists?urlSlug&locationId&postId?          — slug check
 *   POST /medias/upload-file (multipart)                                  — image upload
 *
 * Env (resolved at onboarding): GHL_BLOG_ID, GHL_BLOG_AUTHOR_ID,
 * GHL_BLOG_DEFAULT_CATEGORY_ID. Location comes from GHL_LOCATION_ID.
 */

import sanitizeHtml from 'sanitize-html';
import { ghlFetch, GhlError } from './ghl-rate-limit';
import { readEnv } from './ghl';
import { saveBody, readBody, deleteBody } from './blog-body-store';

// ── Public model ───────────────────────────────────────────────────────────

export interface BlogPostSummary {
  id: string;
  title: string;
  slug: string; // urlSlug
  description: string;
  imageUrl: string;
  imageAltText: string;
  publishedAt: string; // ISO
  authorName: string; // resolved display name, '—' if unknown
  blogName: string; // resolved display name, '—' if unknown
}

export interface BlogPost extends BlogPostSummary {
  rawHTML: string;
  status: 'PUBLISHED' | 'DRAFT' | 'SCHEDULED' | 'ARCHIVED';
  /**
   * True when rawHTML came from the description fallback instead of the blob
   * store (pre-blob post, or the blob is missing/unreachable) — the admin
   * editor can warn that it's not showing the full saved body.
   */
  bodyFallback: boolean;
}

export interface CreatePostInput {
  title: string;
  rawHTML: string;
  imageUrl: string; // already-hosted GHL media URL
  description?: string; // defaults to first ~160 chars of stripped rawHTML
  imageAltText?: string; // defaults to title
}

// ── Config helpers ───────────────────────────────────────────────────────────

function locationId(): string {
  const l = readEnv('GHL_LOCATION_ID');
  if (!l) throw new Error('GHL_LOCATION_ID env var not set');
  return l;
}

function blogId(): string {
  const b = readEnv('GHL_BLOG_ID');
  if (!b) throw new Error('GHL_BLOG_ID env var not set');
  return b;
}

function authorId(): string {
  const a = readEnv('GHL_BLOG_AUTHOR_ID');
  if (!a) throw new Error('GHL_BLOG_AUTHOR_ID env var not set');
  return a;
}

function defaultCategoryId(): string {
  const c = readEnv('GHL_BLOG_DEFAULT_CATEGORY_ID');
  if (!c) throw new Error('GHL_BLOG_DEFAULT_CATEGORY_ID env var not set');
  return c;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

const DESCRIPTION_MAX = 160;

/** Strip HTML tags + collapse whitespace. Used to derive a plain-text description. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Derive a ~160-char plain-text description from rawHTML. */
export function deriveDescription(rawHTML: string): string {
  const text = stripHtml(rawHTML);
  if (text.length <= DESCRIPTION_MAX) return text;
  return `${text.slice(0, DESCRIPTION_MAX).trimEnd()}…`;
}

const BLOCK_TAG_RE = /<(p|div|h[1-6]|ul|ol|li|blockquote|figure|img|pre|table|section|article)\b/i;

/**
 * Ensure body content is block-level HTML. GHL's blog `rawHTML` field silently
 * drops content that isn't well-formed HTML — a bare text node like "hello"
 * (which a contenteditable emits for an unformatted line) is stored as an empty
 * body. Wrap plain-text / inline-only content in <p> so the body persists.
 * Already-block HTML passes through untouched.
 */
export function ensureHtml(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  if (BLOCK_TAG_RE.test(s)) return s; // already has block structure
  const paras = s
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`);
  return paras.length ? paras.join('') : `<p>${s}</p>`;
}

/**
 * Server-side body sanitization (defence in depth — the admin editor sanitizes
 * on paste, but the API must not trust the client). Allowlist mirrors what the
 * editor toolbar can produce; everything else (script, iframe, event handlers,
 * javascript:/data: URLs) is stripped. Applied to rawHTML before it is sent to
 * GHL AND before it is persisted to the blob store, so both copies match.
 */
export function sanitizeBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'div', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
      'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'a', 'img', 'blockquote', 'br', 'span',
      'hr', 'iframe', 'figure', 'figcaption',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      iframe: ['src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'frameborder'],
      // The toolbar emits inline styles (alignment, colors, fonts, indent…) —
      // allowedStyles below allowlists each property + value shape; everything
      // else is stripped.
      '*': ['style'],
    },
    allowedStyles: {
      '*': {
        'text-align': [/^(left|right|center|justify)$/],
        'color': [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/],
        'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/],
        'font-family': [/^[\w\s,'"-]+$/],
        'font-size': [/^\d{1,2}(\.\d+)?(px|rem|em)$/],
        'line-height': [/^\d{1,2}(\.\d+)?$/],
        // Indent steps from the editor's indent/outdent buttons.
        'margin-left': [/^\d{1,3}(\.\d+)?(px|rem|em)$/],
      },
    },
    // Video embeds only from the big two players; any other iframe is dropped.
    allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'],
    // A disallowed host leaves an empty <iframe> shell behind — remove it.
    exclusiveFilter: (frame) => frame.tag === 'iframe' && !frame.attribs.src,
    // Images come from the GHL CDN (https); no data: URIs.
    allowedSchemes: ['http', 'https'],
  });
}

/** Slugify a title: lowercase, ascii-ish, hyphen-separated. */
export function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'post';
}

// ── Slug uniqueness ──────────────────────────────────────────────────────────

interface SlugExistsResponse {
  exists?: boolean;
}

async function slugExists(slug: string, postId?: string): Promise<boolean> {
  const params = new URLSearchParams({ urlSlug: slug, locationId: locationId() });
  if (postId) params.set('postId', postId);
  const data = (await ghlFetch(`/blogs/posts/url-slug-exists?${params.toString()}`)) as SlugExistsResponse;
  return Boolean(data?.exists);
}

/**
 * Slugify a title + ensure uniqueness via GET /blogs/posts/url-slug-exists.
 * Appends -2, -3, ... until a free slug is found. `postId` excludes the post
 * itself from the collision check (so updates that keep the same slug pass).
 */
export async function ensureUniqueSlug(title: string, postId?: string): Promise<string> {
  const base = slugify(title);
  if (!(await slugExists(base, postId))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await slugExists(candidate, postId))) return candidate;
  }
  // Extremely unlikely; fall back to a timestamp suffix.
  return `${base}-${Date.now()}`;
}

// ── Response mapping ─────────────────────────────────────────────────────────

interface GhlBlogPost {
  _id?: string;
  id?: string;
  title?: string;
  urlSlug?: string;
  description?: string;
  imageUrl?: string;
  imageAltText?: string;
  rawHTML?: string;
  status?: string;
  publishedAt?: string;
  // Author/blog id field names vary across GHL responses; capture both.
  author?: string;
  authorId?: string;
  blogId?: string;
  blog?: string;
}

/** The author id carried on a raw post, defensive across field names. */
function postAuthorId(p: GhlBlogPost): string {
  return p.author ?? p.authorId ?? '';
}

/** The blog id carried on a raw post, defensive across field names. */
function postBlogId(p: GhlBlogPost): string {
  return p.blogId ?? p.blog ?? '';
}

function mapSummary(p: GhlBlogPost): BlogPostSummary {
  return {
    id: p._id ?? p.id ?? '',
    title: p.title ?? '',
    slug: p.urlSlug ?? '',
    description: p.description ?? '',
    imageUrl: p.imageUrl ?? '',
    imageAltText: p.imageAltText ?? p.title ?? '',
    publishedAt: p.publishedAt ?? '',
    // The join in listPublishedPosts/getPostBySlug overwrites these; default to '—'
    // so the returned object satisfies BlogPostSummary even before the join.
    authorName: '—',
    blogName: '—',
  };
}

function mapPost(p: GhlBlogPost): BlogPost {
  const status = (p.status ?? 'PUBLISHED').toUpperCase();
  const normalized: BlogPost['status'] =
    status === 'DRAFT' || status === 'SCHEDULED' || status === 'ARCHIVED' ? status : 'PUBLISHED';
  return {
    ...mapSummary(p),
    rawHTML: p.rawHTML ?? '',
    status: normalized,
    bodyFallback: true, // no blob merged yet; enrichPost flips this when the stored body loads
  };
}

// ── Cache (~5 min freshness, last-good fallback, realtime invalidation) ──────
//
// Two layers, one set of semantics:
//   1. Vercel Runtime Cache (shared across ALL function instances in the
//      region) — what makes an admin edit show on the website in realtime:
//      writes call expireTag('blog'), which propagates to every instance in
//      ~300ms. Entries are stored with a LONG ttl and a `storedAt` stamp; code
//      treats entries older than 5 min as stale-but-servable (last-good).
//   2. Module-scoped Map fallback for environments without the Runtime Cache
//      (plain `astro dev`, vitest) — same entry shape, same freshness logic.

const CACHE_FRESH_MS = 5 * 60 * 1000;
const CACHE_KEEP_TTL_S = 24 * 60 * 60; // runtime-cache retention (last-good window)
const CACHE_TAG = 'blog';
const CACHE_NS = 'ghl-blog';

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

interface RuntimeCacheLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { ttl?: number; tags?: string[] }): Promise<void>;
  expireTag(tag: string): Promise<void>;
}

// Module-scoped fallback — lives on a warm instance. Cold starts repopulate.
const memCache = new Map<string, CacheEntry<unknown>>();

let runtimeCache: RuntimeCacheLike | null | undefined; // undefined = not probed yet
async function getRuntimeCache(): Promise<RuntimeCacheLike | null> {
  if (runtimeCache !== undefined) return runtimeCache;
  try {
    const { getCache } = await import('@vercel/functions');
    runtimeCache = getCache({ namespace: CACHE_NS }) as unknown as RuntimeCacheLike;
  } catch {
    runtimeCache = null; // SDK unavailable — fall back to the in-memory Map
  }
  return runtimeCache;
}

async function cacheRead<T>(key: string): Promise<CacheEntry<T> | undefined> {
  const rc = await getRuntimeCache();
  if (rc) {
    try {
      const hit = (await rc.get(key)) as CacheEntry<T> | undefined | null;
      if (hit && typeof hit.storedAt === 'number') return hit;
      return undefined;
    } catch {
      /* fall through to memory */
    }
  }
  return memCache.get(key) as CacheEntry<T> | undefined;
}

async function cacheWrite<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  const rc = await getRuntimeCache();
  if (rc) {
    try {
      await rc.set(key, entry, { ttl: CACHE_KEEP_TTL_S, tags: [CACHE_TAG] });
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memCache.set(key, entry);
}

/**
 * Cache wrapper with last-good fallback. Fresh (< 5 min) entries are served
 * without re-fetching. On fetch success, refreshes + returns the value. On
 * fetch error: serves the last-good cached value if present, else `fallback`.
 */
async function cached<T>(key: string, fallback: T, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = await cacheRead<T>(key);
  if (hit && now - hit.storedAt < CACHE_FRESH_MS) return hit.value;
  try {
    const value = await fetcher();
    await cacheWrite(key, { value, storedAt: now });
    return value;
  } catch (err) {
    console.error('[ghl-blog] fetch failed, serving last-good cache',
      err instanceof GhlError ? { status: err.status, path: err.path } : { err: String(err) });
    if (hit) return hit.value;
    return fallback;
  }
}

/** Test-only: clear the in-memory cache between cases. */
export function __clearBlogCache(): void {
  memCache.clear();
}

/**
 * Drop all cached blog reads after a write so the admin list and /blog reflect
 * the change in realtime. expireTag propagates to every function instance in
 * the region within ~300ms; the Map clear covers the no-runtime-cache fallback.
 */
async function invalidateBlogCache(): Promise<void> {
  memCache.clear();
  const rc = await getRuntimeCache();
  if (rc) {
    try {
      await rc.expireTag(CACHE_TAG);
    } catch (err) {
      console.warn('[ghl-blog] expireTag failed (cache will age out via freshness window)', String(err).slice(0, 120));
    }
  }
}

// ── Author / blog name lookups (cached, last-good/{} on error) ───────────────

interface GhlAuthor {
  _id?: string;
  id?: string;
  name?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
}

interface AuthorsResponse {
  authors?: GhlAuthor[];
  data?: GhlAuthor[];
}

interface GhlBlogSite {
  _id?: string;
  id?: string;
  name?: string;
  title?: string;
}

interface BlogsResponse {
  data?: GhlBlogSite[];
  blogs?: GhlBlogSite[];
  sites?: GhlBlogSite[];
}

function authorDisplayName(a: GhlAuthor): string {
  if (a.name) return a.name;
  if (a.fullName) return a.fullName;
  return `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
}

/** Map of author id -> display name for the location. Cached (~5 min), {} on error. */
export async function getAuthorsMap(): Promise<Record<string, string>> {
  return cached<Record<string, string>>('authors', {}, async () => {
    const params = new URLSearchParams({
      locationId: locationId(),
      // GHL rejects limit > ~20 on /blogs/authors with a 422 (unlike /blogs/site/all).
      limit: '20',
      offset: '0',
    });
    const data = (await ghlFetch(`/blogs/authors?${params.toString()}`)) as AuthorsResponse | GhlAuthor[];
    const raw: GhlAuthor[] = Array.isArray(data)
      ? data
      : data.authors ?? data.data ?? [];
    const map: Record<string, string> = {};
    for (const a of raw) {
      const id = a._id ?? a.id;
      if (!id) continue;
      const name = authorDisplayName(a);
      if (name) map[id] = name;
    }
    return map;
  });
}

/** Map of blog id -> display name for the location. Cached (~5 min), {} on error. */
export async function getBlogsMap(): Promise<Record<string, string>> {
  return cached<Record<string, string>>('blogs', {}, async () => {
    const params = new URLSearchParams({
      locationId: locationId(),
      skip: '0',
      limit: '100',
    });
    const data = (await ghlFetch(`/blogs/site/all?${params.toString()}`)) as BlogsResponse | GhlBlogSite[];
    const raw: GhlBlogSite[] = Array.isArray(data)
      ? data
      : data.data ?? data.blogs ?? data.sites ?? [];
    const map: Record<string, string> = {};
    for (const b of raw) {
      const id = b._id ?? b.id;
      if (!id) continue;
      const name = b.name ?? b.title;
      if (name) map[id] = name;
    }
    return map;
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

interface ListResponse {
  blogs?: GhlBlogPost[];
  posts?: GhlBlogPost[];
  data?: GhlBlogPost[];
}

/**
 * Resolve an author display name from the authors map, falling back to the
 * configured default author (so single-author accounts always show a real name)
 * and finally '—'.
 */
function resolveAuthorName(authorsMap: Record<string, string>, postAuthor: string): string {
  const direct = postAuthor ? authorsMap[postAuthor] : undefined;
  if (direct) return direct;
  // Resolve the configured default author's name from the map as a fallback.
  let defaultId: string | undefined;
  try {
    defaultId = authorId();
  } catch {
    defaultId = undefined;
  }
  const fallback = defaultId ? authorsMap[defaultId] : undefined;
  return fallback ?? '—';
}

/**
 * Resolve a blog display name from the blogs map, falling back to the configured
 * default blog (so single-blog accounts always show a real name) and finally '—'.
 */
function resolveBlogName(blogsMap: Record<string, string>, postBlog: string): string {
  const direct = postBlog ? blogsMap[postBlog] : undefined;
  if (direct) return direct;
  // Resolve the configured default blog's name from the map as a fallback.
  let defaultId: string | undefined;
  try {
    defaultId = blogId();
  } catch {
    defaultId = undefined;
  }
  const fallback = defaultId ? blogsMap[defaultId] : undefined;
  return fallback ?? '—';
}

/** List PUBLISHED posts for the configured blog, newest first. Cached (~5 min). */
export async function listPublishedPosts(opts: { limit?: number } = {}): Promise<BlogPostSummary[]> {
  const limit = opts.limit ?? 50;
  const key = `list:${limit}`;
  return cached<BlogPostSummary[]>(key, [], async () => {
    const params = new URLSearchParams({
      locationId: locationId(),
      blogId: blogId(),
      limit: String(limit),
      offset: '0',
      status: 'PUBLISHED',
    });
    const data = (await ghlFetch(`/blogs/posts/all?${params.toString()}`)) as ListResponse;
    const raw = data.blogs ?? data.posts ?? data.data ?? [];
    // Resolve author/blog display names from their own (separately cached) maps.
    const [authorsMap, blogsMap] = await Promise.all([getAuthorsMap(), getBlogsMap()]);
    const mapped = raw.map((p) => {
      const summary = mapSummary(p);
      summary.authorName = resolveAuthorName(authorsMap, postAuthorId(p));
      summary.blogName = resolveBlogName(blogsMap, postBlogId(p));
      return summary;
    });
    mapped.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    return mapped;
  });
}

/**
 * Every PUBLISHED post's slug + publish date, for /sitemap-blog.xml. Pages
 * through GHL (which 422s on limit > 50) so the sitemap isn't capped at one
 * page. Cached with the same tag as the other reads, so publish/edit/delete
 * refreshes the sitemap in realtime.
 */
export async function listAllPublishedForSitemap(): Promise<Array<{ slug: string; publishedAt: string }>> {
  return cached<Array<{ slug: string; publishedAt: string }>>('sitemap', [], async () => {
    const PAGE = 50;
    const MAX_PAGES = 20; // safety cap (1000 posts) so a pathological response can't loop forever
    const out: Array<{ slug: string; publishedAt: string }> = [];
    for (let page = 0, offset = 0; page < MAX_PAGES; page++, offset += PAGE) {
      const params = new URLSearchParams({
        locationId: locationId(),
        blogId: blogId(),
        limit: String(PAGE),
        offset: String(offset),
        status: 'PUBLISHED',
      });
      const data = (await ghlFetch(`/blogs/posts/all?${params.toString()}`)) as ListResponse;
      const raw = data.blogs ?? data.posts ?? data.data ?? [];
      for (const p of raw) {
        if (p.urlSlug) out.push({ slug: p.urlSlug, publishedAt: p.publishedAt ?? '' });
      }
      if (raw.length < PAGE) break; // last page
    }
    return out;
  });
}

/**
 * Enrich a matched raw post: resolve author/blog names and merge in the body.
 * GHL never returns rawHTML on reads (the list omits it; no single-post GET
 * exists), so the body comes from our blob store — falling back to the saved
 * description so pre-blob posts aren't blank.
 */
async function enrichPost(match: GhlBlogPost): Promise<BlogPost> {
  const post = mapPost(match);
  const [authorsMap, blogsMap, body] = await Promise.all([
    getAuthorsMap(),
    getBlogsMap(),
    readBody(post.id),
  ]);
  post.authorName = resolveAuthorName(authorsMap, postAuthorId(match));
  post.blogName = resolveBlogName(blogsMap, postBlogId(match));
  if (body) {
    post.rawHTML = body;
    post.bodyFallback = false;
  } else {
    post.rawHTML = ensureHtml(post.description);
    post.bodyFallback = true;
  }
  return post;
}

/** Page through PUBLISHED posts until `pick` matches. GHL 422s on limit > 50. */
async function findPublishedPost(pick: (p: GhlBlogPost) => boolean): Promise<GhlBlogPost | null> {
  const PAGE = 50;
  const MAX_PAGES = 20; // safety cap (1000 posts) so a pathological response can't loop forever
  for (let page = 0, offset = 0; page < MAX_PAGES; page++, offset += PAGE) {
    const params = new URLSearchParams({
      locationId: locationId(),
      blogId: blogId(),
      limit: String(PAGE),
      offset: String(offset),
      status: 'PUBLISHED',
    });
    const data = (await ghlFetch(`/blogs/posts/all?${params.toString()}`)) as ListResponse;
    const raw = data.blogs ?? data.posts ?? data.data ?? [];
    const match = raw.find(pick);
    if (match) return match;
    if (raw.length < PAGE) return null; // last page, no match
  }
  console.warn(`[ghl-blog] findPublishedPost: page cap (${MAX_PAGES}) hit without a match`);
  return null;
}

/** Fetch a single PUBLISHED post by slug (body merged from the blob store). Cached (~5 min). */
export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  return cached<BlogPost | null>(`slug:${slug}`, null, async () => {
    const match = await findPublishedPost((p) => p.urlSlug === slug);
    return match ? enrichPost(match) : null;
  });
}

/** Fetch a single PUBLISHED post by GHL id (body merged from the blob store). Cached. */
export async function getPostById(id: string): Promise<BlogPost | null> {
  return cached<BlogPost | null>(`id:${id}`, null, async () => {
    const match = await findPublishedPost((p) => (p._id ?? p.id) === id);
    return match ? enrichPost(match) : null;
  });
}

// ── Writes ─────────────────────────────────────────────────────────────────

interface CreateResponse {
  data?: GhlBlogPost;
  blogPost?: GhlBlogPost;
  blog?: GhlBlogPost;
  post?: GhlBlogPost;
  _id?: string;
  id?: string;
  urlSlug?: string;
}

/**
 * Build the full GHL create/update payload from our minimal input, auto-filling
 * every GHL-required field. Exported for unit testing the payload builder.
 */
export function buildCreatePayload(input: CreatePostInput, urlSlug: string, publishedAt: string): Record<string, unknown> {
  const description = input.description?.trim() || deriveDescription(input.rawHTML);
  return {
    title: input.title,
    locationId: locationId(),
    blogId: blogId(),
    imageUrl: input.imageUrl,
    description,
    rawHTML: sanitizeBody(ensureHtml(input.rawHTML)),
    status: 'PUBLISHED',
    imageAltText: input.imageAltText?.trim() || input.title,
    categories: [defaultCategoryId()],
    author: authorId(),
    urlSlug,
    publishedAt,
  };
}

/**
 * Create a PUBLISHED post. Auto-fills blogId, author, categories, urlSlug,
 * publishedAt. `bodyPersisted` reports whether the body made it into the blob
 * store (false when the save failed OR when no id came back to key it on).
 */
export async function createPost(input: CreatePostInput): Promise<{ id: string; slug: string; bodyPersisted: boolean }> {
  const urlSlug = await ensureUniqueSlug(input.title);
  const publishedAt = new Date().toISOString();
  const payload = buildCreatePayload(input, urlSlug, publishedAt);
  // Reaching here means ghlFetch returned a 2xx — the post was created. GHL
  // nests the created record under `blogPost`; fall back through other shapes.
  const data = (await ghlFetch('/blogs/posts', { method: 'POST', json: payload })) as CreateResponse;
  const post = data.data ?? data.blogPost ?? data.blog ?? data.post ?? data;
  const id = post._id ?? post.id ?? '';
  if (!id) {
    // Created successfully but the id wasn't where we expected. Don't fail the
    // request — the admin UI reloads the list (which carries ids) regardless.
    console.warn('[ghl-blog] createPost: post created but no id in response', JSON.stringify(data).slice(0, 200));
  }
  // GHL accepts rawHTML but never returns it — persist the body where we can
  // read it back (public post page + admin edit prefill).
  const bodyPersisted = id ? await saveBody(id, payload.rawHTML as string) : false;
  await invalidateBlogCache();
  return { id, slug: post.urlSlug ?? urlSlug, bodyPersisted };
}

/**
 * Update an existing post. Only provided fields change. If `title` is provided
 * we re-derive a unique slug (excluding this post from the collision check).
 *
 * GHL's PUT REQUIRES `status` (422 "status must be a valid enum value" without
 * it), so we send PUBLISHED — but only after verifying the post still exists
 * among published posts. That guard is what prevents an update from silently
 * resurrecting a post another admin archived moments earlier.
 *
 * `bodyPersisted` is true when there was nothing to persist (no rawHTML in the
 * update) or the blob save succeeded; false when the save failed.
 */
export async function updatePost(id: string, input: Partial<CreatePostInput>): Promise<{ bodyPersisted: boolean }> {
  const existing = await getPostById(id);
  if (!existing) {
    throw new GhlError(404, '', `/blogs/posts/${id}`, 'updatePost: post is not published (deleted?)');
  }
  const payload: Record<string, unknown> = {
    locationId: locationId(),
    blogId: blogId(),
    author: authorId(),
    categories: [defaultCategoryId()],
    status: 'PUBLISHED',
  };
  if (input.title !== undefined) {
    payload.title = input.title;
    payload.urlSlug = await ensureUniqueSlug(input.title, id);
  }
  if (input.rawHTML !== undefined) {
    payload.rawHTML = sanitizeBody(ensureHtml(input.rawHTML));
    // Body changed but no explicit description — re-derive so the list/SEO
    // summary doesn't go stale against the new body.
    if (input.description === undefined) {
      payload.description = deriveDescription(payload.rawHTML as string);
    }
  }
  if (input.imageUrl !== undefined) payload.imageUrl = input.imageUrl;
  if (input.description !== undefined) {
    payload.description = input.description.trim() || deriveDescription(input.rawHTML ?? '');
  }
  if (input.imageAltText !== undefined) {
    payload.imageAltText = input.imageAltText.trim() || input.title || '';
  }
  await ghlFetch(`/blogs/posts/${encodeURIComponent(id)}`, { method: 'PUT', json: payload });
  const bodyPersisted = payload.rawHTML !== undefined ? await saveBody(id, payload.rawHTML as string) : true;
  await invalidateBlogCache();
  return { bodyPersisted };
}

/** Soft-delete: set status ARCHIVED. Drops the stored body + cache. */
export async function archivePost(id: string): Promise<void> {
  await ghlFetch(`/blogs/posts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    json: {
      locationId: locationId(),
      blogId: blogId(),
      status: 'ARCHIVED',
    },
  });
  await deleteBody(id);
  await invalidateBlogCache();
}

// ── Image upload ─────────────────────────────────────────────────────────────

interface UploadResponse {
  url?: string;
  fileUrl?: string;
  data?: { url?: string; fileUrl?: string };
}

/**
 * Upload an image to GHL Medias (POST /medias/upload-file, multipart). Returns
 * the hosted file URL. Uses the shared ghlFetch client's multipart path so auth,
 * version, and rate-limit back-pressure are reused.
 */
export async function uploadBlogImage(file: {
  bytes: Buffer;
  filename: string;
  contentType: string;
}): Promise<{ url: string }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(file.bytes)], { type: file.contentType });
  form.append('file', blob, file.filename);
  const data = (await ghlFetch('/medias/upload-file', { method: 'POST', formData: form })) as UploadResponse;
  const url = data.url ?? data.fileUrl ?? data.data?.url ?? data.data?.fileUrl;
  if (!url) {
    throw new GhlError(500, JSON.stringify(data), '/medias/upload-file', 'uploadBlogImage: no url in response');
  }
  return { url };
}
