# Blog Section — Design Spec

**Date:** 2026-06-10
**Status:** Approved, ready for implementation
**Branch:** `feat/blog-section`

## Goal

Add a blog to the GBW website. Posts are authored through a **dead-simple custom
form** (title, rich-text body, images) surfaced as a **GHL custom menu link**, and
**stored in GHL Blogs** via API. The public blog pages render on the Astro site and
**inherit the existing Gracie Barra design system** (no new visual language).

The admin's complaint is GHL's native Blogs *editor* (too complex), not GHL as
storage. So we keep GHL as the store and replace only the editor with our own
minimal form.

## Non-goals (YAGNI)

- No new database / blob store — GHL Blogs is the store, GHL Medias hosts images.
- No multi-author management UI — a single default author is configured per gym.
- No category management UI — a single default category is configured per gym.
- No comments, no tags UI (tags optional, can default to empty).

## Architecture

```
GHL sidebar (admin) ──iframe──▶ /admin/blog?t=<signed>   (SSR token-gated form)
                                       │ submit (fetch)
                                       ▼
                          /api/admin/blog/*  ──▶ GHL Medias (upload) + GHL Blogs (create/update/archive)

Public visitor ──▶ /blog, /blog/[slug] ◀── lib/ghl-blog.listPublishedPosts() / getPostBySlug()  (cached)
```

Three slices:
1. **Foundation** — `lib/ghl-blog.ts`, `lib/admin-token.ts`, `/api/admin/blog/*` routes (+ unit tests). Establishes all contracts.
2. **Public pages** — `/blog`, `/blog/[slug]`, `BlogCard`, nav link, sitemap.
3. **Admin form** — `/admin/blog`, client rich-text editor, framing header.
4. **Onboarding/config** — env vars, PIT scopes, custom-menu creation, docs.

Slices 2–4 depend only on slice 1's contracts (below) and are independent of each other.

---

## FROZEN CONTRACTS

### `src/lib/ghl-blog.ts` (server-only)

Uses the existing GHL client (`request`/`ghlFetch` in `src/lib/ghl.ts` + `ghl-rate-limit.ts`)
and `readEnv` for config. All gym-specific IDs come from env (no hardcode).

```ts
export interface BlogPostSummary {
  id: string;
  title: string;
  slug: string;            // urlSlug
  description: string;
  imageUrl: string;
  imageAltText: string;
  publishedAt: string;     // ISO
}

export interface BlogPost extends BlogPostSummary {
  rawHTML: string;
  status: 'PUBLISHED' | 'DRAFT' | 'SCHEDULED' | 'ARCHIVED';
}

export interface CreatePostInput {
  title: string;
  rawHTML: string;
  imageUrl: string;          // already-hosted GHL media URL
  description?: string;      // defaults to first ~160 chars of stripped rawHTML
  imageAltText?: string;     // defaults to title
}

/** List PUBLISHED posts for the configured blog, newest first. Cached (~5 min). */
export function listPublishedPosts(opts?: { limit?: number }): Promise<BlogPostSummary[]>;

/** Fetch a single PUBLISHED post by slug. null if not found. */
export function getPostBySlug(slug: string): Promise<BlogPost | null>;

/** Create a PUBLISHED post. Auto-fills blogId, author, categories, urlSlug, publishedAt. */
export function createPost(input: CreatePostInput): Promise<{ id: string; slug: string }>;

/** Update an existing post (same auto-fill rules; only provided fields change). */
export function updatePost(id: string, input: Partial<CreatePostInput>): Promise<void>;

/** Soft-delete: set status ARCHIVED. */
export function archivePost(id: string): Promise<void>;

/** Slugify title + ensure uniqueness via GET /blogs/posts/url-slug-exists (append -2, -3...). */
export function ensureUniqueSlug(title: string, postId?: string): Promise<string>;

/** Upload an image to GHL Medias (POST /medias/upload-file, multipart). Returns hosted URL. */
export function uploadBlogImage(file: { bytes: Buffer; filename: string; contentType: string }): Promise<{ url: string }>;
```

GHL endpoints used (confirmed via MCP):
- `GET /blogs/posts/all?locationId&blogId&limit&offset&status=PUBLISHED` — list
- `POST /blogs/posts` — create (required: title, locationId, blogId, imageUrl, description, rawHTML, status, imageAltText, categories[], author, urlSlug, publishedAt)
- `PUT /blogs/posts/{postId}` — update
- `GET /blogs/posts/url-slug-exists?urlSlug&locationId&postId?` — slug collision check
- `POST /medias/upload-file` — multipart upload (returns hosted file URL)

Env (resolved at onboarding):
- `GHL_BLOG_ID`, `GHL_BLOG_AUTHOR_ID`, `GHL_BLOG_DEFAULT_CATEGORY_ID`

Caching: wrap `listPublishedPosts`/`getPostBySlug` in a short-TTL cache (~5 min). Prefer the
existing pattern if one exists; otherwise a module-scoped TTL map on the warm Fluid Compute
instance is acceptable. On fetch failure, serve last-good cache; if none, return `[]` (list)
or `null` (single) so pages degrade gracefully.

### `src/lib/admin-token.ts` (server-only)

Mirror `src/lib/rebook-token.ts` exactly (HMAC-SHA256, base64url, constant-time compare).

```ts
export interface AdminTokenPayload { scope: 'blog'; exp: number; }
export function signAdminToken(args: { scope?: 'blog'; ttlDays?: number }): string; // default scope 'blog'
export type VerifyResult =
  | { ok: true; payload: AdminTokenPayload }
  | { ok: false; code: 'INVALID_FORMAT' | 'INVALID_SIGNATURE' | 'EXPIRED' };
export function verifyAdminToken(token: string): VerifyResult;
```

Signing key env: `ADMIN_SIGNING_KEY` (>= 32 chars). Default TTL long (e.g. 365 days) since the
token is embedded in a GHL menu link configured once. Payload deliberately carries no user data
— possession of the signed link is the credential (low-stakes blog admin; `userRole: 'admin'`
on the menu limits who sees it). Note in docs: can be hardened later with GHL SSO postMessage.

### API routes (`src/pages/api/admin/blog/`)

All verify the admin token (passed as `t` query OR `x-admin-token` header) before any write.
All return `{ ok: boolean, code?: string, ... }` JSON (match existing `/api/book` style).

- `POST /api/admin/blog/index.ts` — body `{ title, rawHTML, description?, imageUrl, imageAltText? }` → `createPost` → `{ ok, id, slug }`.
- `PUT  /api/admin/blog/[id].ts` — update; `DELETE /api/admin/blog/[id].ts` — archive.
- `POST /api/admin/blog/upload.ts` — multipart image → `uploadBlogImage` → `{ ok, url }`.

Errors: `INVALID_TOKEN` (401), `INVALID_INPUT` (400), `GHL_FAILED` (502 with message). Never
create a partial post — if image upload fails, abort before `createPost`.

---

## Public pages — must inherit GB design

Design system is fixed: `src/styles/tokens.css` (palette `--gb-red #cc2200`, `--gb-navy #1b2a5e`,
`--gb-gold #ef9f27`, `--gb-bg-light #f4f4f4`; Inter; pill buttons). tokens.css states: "Do not
introduce off-palette hex values elsewhere." Reuse `BaseLayout.astro` and existing components.

- `src/pages/blog/index.astro` — wrapped in `BaseLayout`. Card grid of `listPublishedPosts()`.
  Reuse the card/section markup already used on `index.astro`/program pages; "Read more" uses
  `CTAButton.astro`. Empty state: friendly "no posts yet" copy.
- `src/pages/blog/[slug].astro` — `BaseLayout`. `getPostBySlug`; 404 via existing 404 path if
  null. Render `rawHTML` inside a branded prose wrapper (headings navy, links gb-red, Inter,
  constrained reading width, responsive images). SEO: title/description/canonical/OG image from
  the post. Append existing conversion furniture (`TrustStrip` or trial CTA) at the end so blog
  traffic funnels to bookings. Add JSON-LD Article schema via the `schema` prop.
- **Nav:** add "Blog" link to `Nav.astro` (main nav) and `Footer.astro`.
- **Sitemap:** `/blog` + posts must be included (astro.config sitemap filter excludes funnels,
  not blog — verify blog is not filtered).

## Admin form — deliberately plain, inside GHL

- `src/pages/admin/blog/index.astro` — **SSR token gate**: read `t` from query, `verifyAdminToken`;
  if invalid, render a minimal 401 ("This link is invalid or expired.") and stop. Does NOT use
  BaseLayout (no public Nav/Footer/CTA in an embedded admin tool), but imports `tokens.css` so
  inputs/buttons feel like GB.
- Form: Title (text), Featured image (upload → `/api/admin/blog/upload`, preview), Body
  (simple rich-text WYSIWYG: bold, headings, lists, links, inline image; produces HTML), Publish.
  Below: list of existing posts with Edit / Delete (Delete = archive, with confirm).
- Rich-text editor: a lightweight client-side editor. Prefer a tiny dependency or a
  contenteditable-based minimal toolbar — keep the bundle small; document the choice.
- **Framing:** set response header `Content-Security-Policy: frame-ancestors https://*.gohighlevel.com https://*.leadconnectorhq.com https://app.gohighlevel.com` on `/admin/blog` so the GHL iframe can load it. (Vercel/Astro default blocks framing.) Implement via Astro middleware scoped to the route or a header set in the page response.

## Onboarding / config (Academy Launch templatable)

- `.env.example`: add `GHL_BLOG_ID`, `GHL_BLOG_AUTHOR_ID`, `GHL_BLOG_DEFAULT_CATEGORY_ID`, `ADMIN_SIGNING_KEY`.
- PIT token scopes to document/add: `blogs/post.write`, `blogs/post-update.write`, `blogs/posts.readonly`,
  `blogs/author.readonly`, `blogs/category.readonly`, `blogs/list.readonly`, `blogs/check-slug.readonly`,
  `medias.write`, `custom-menu-link.write`.
- `scripts/onboard-client.ts` (or the GHL onboard flow): resolve `GHL_BLOG_ID` (GET /blogs/site/all),
  `GHL_BLOG_AUTHOR_ID` (GET /blogs/authors), `GHL_BLOG_DEFAULT_CATEGORY_ID` (GET /blogs/categories);
  then create the custom menu via `POST /custom-menus/` with `title: "Website Blog"`,
  `url: <site>/admin/blog?t=<signAdminToken>`, `openMode: 'iframe'`, `userRole: 'admin'`,
  `showOnLocation: true`. Print the signed URL for manual fallback.
- Document the GHL-side note: the menu link embeds a long-lived signed token; rotating
  `ADMIN_SIGNING_KEY` invalidates it (re-run the menu step).

## Error handling (summary)

- Admin: invalid/expired token → 401 page / `INVALID_TOKEN`. Upload fail → inline error, no post.
  Create/update fail → surface GHL message. Slug collision → auto-suffix.
- Public: GHL fetch fail → serve last-good cache, else empty state. Missing post → 404.

## Testing

Lib units (Vitest, GHL mocked — match `ghl-adapter.cancel.test.ts` pattern):
- `admin-token`: sign→verify round-trip; bad signature; expired; malformed.
- `ghl-blog`: `ensureUniqueSlug` (slugify + collision suffixing); `createPost` payload builder
  (auto-fills blogId/author/categories/publishedAt/description-truncation/imageAltText default);
  response mapping for `listPublishedPosts`/`getPostBySlug`.
- API route auth: request without valid token → 401; with token → reaches handler (handler mocked).

Astro page rendering verified by manual QA + `npm run check`.

## Verification gate (every slice)

`npm run check` → 0 errors; `npx vitest run` → all pass. No slice is "done" otherwise.
