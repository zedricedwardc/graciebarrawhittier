# Blog Setup — GHL config

How to wire up the website blog for a new gym. The blog stores posts in **GHL
Blogs** (GHL is the store; the website only replaces the editor with a custom
form at `/admin/blog`, surfaced as a GHL custom-menu link — full formatting
ribbon: bold/italic/underline/strike, font + size + paragraph-style dropdowns,
align/indent/line-height, lists, quote, text/highlight color, link, image,
YouTube/Vimeo embed, divider, clear formatting, HTML source view). Templatable
for any gym — the only per-gym values are the three resolved IDs, the signing
key, and the site URL. Anything the ribbon emits must stay in sync with the
`sanitizeBody` allowlist in `src/lib/ghl-blog.ts` — the API strips any tag or
style the allowlist doesn't cover.

SEO note: posts are created at runtime, so the build-time sitemap can't list
them — `/sitemap-blog.xml` (SSR, auto-refreshing) covers them instead. When
templating for a new gym, the second `Sitemap:` line in `public/robots.txt`
must point at the new gym's domain (same edit as the first line).

**Phase legend**: `[DEV]` = developer (terminal). `[ADMIN]` = studio admin (GHL UI).

---

## 1. PIT token scopes

Add these scopes to the sub-account's Private Integration Token
(GHL → Settings → Private Integrations → edit token → tick scopes → Save; the
token string is unchanged, so no Vercel update is needed — see
[`ghl-api-access-methods.md` §scope-rotation](./ghl-api-access-methods.md)):

- `blogs/post.write` — create posts (`POST /blogs/posts`)
- `blogs/post-update.write` — update / archive posts (`PUT /blogs/posts/{id}`)
- `blogs/posts.readonly` — list posts (`GET /blogs/posts/all`)
- `blogs/author.readonly` — resolve `GHL_BLOG_AUTHOR_ID`
- `blogs/category.readonly` — resolve `GHL_BLOG_DEFAULT_CATEGORY_ID`
- `blogs/list.readonly` — resolve `GHL_BLOG_ID`
- `blogs/check-slug.readonly` — slug-collision check (`GET /blogs/posts/url-slug-exists`)
- `medias.write` — upload featured/inline images (`POST /medias/upload-file`)
- `custom-menu-link.write` — create the "Website Blog" custom menu (`POST /custom-menus/`)

## 2. Create blog assets in GHL (one-time, UI)

- [ ] **[ADMIN]** GHL → Sites → Blogs: create at least one **blog site**, one
      **author**, and one **category**. The onboarding script resolves the
      *first* of each — if you keep one of each, no ambiguity. **Done when:**
      a blog site, an author, and a category all exist in the sub-account.

## 3. Resolve the three env IDs

- [ ] **[DEV]** Run `npm run onboard:blog discover`. It queries GHL and resolves:
  - `GHL_BLOG_ID` ← first item of `GET /blogs/site/all`
  - `GHL_BLOG_AUTHOR_ID` ← first item of `GET /blogs/authors`
  - `GHL_BLOG_DEFAULT_CATEGORY_ID` ← first item of `GET /blogs/categories`

  Resolved IDs are **appended** to `.env.client.local` (alongside the
  pipeline/workflow IDs that `onboard:ghl discover` writes). The script logs
  exactly what it chose and **warns** (resolving nothing for that key) if a blog
  site / author / category is missing — fix in GHL per §2, then re-run.
  **Done when:** all three `GHL_BLOG_*` lines are present and non-empty.

- [ ] **[DEV]** Set `ADMIN_SIGNING_KEY` (>= 32 chars, `openssl rand -hex 32`) and
      paste all three `GHL_BLOG_*` IDs into Vercel → Project → Environment
      Variables (Production + Preview). Redeploy. **Done when:** `/blog` renders
      on the deployed site.

## 3b. Connect a Vercel Blob store (post bodies)

GHL's Blogs API accepts `rawHTML` on create/update but **never returns it on
reads** (the list endpoint omits the field; no single-post GET exists). Post
bodies are therefore persisted to **Vercel Blob** (`blog/{postId}.json`) at
publish time and read back for the public post page and the admin editor.
Without the store, publishing still works but post pages fall back to the
~160-char description.

- [ ] **[DEV]** `vercel blob create-store <gym>-blog --access public` → answer
      **Y** to link it to the project (all environments). This injects
      `BLOB_READ_WRITE_TOKEN`. Locally: `vercel env pull` (or copy the token
      into `.env.local`). **Done when:** publishing a post from `/admin/blog`
      shows its body on `/blog/<slug>`.

- [ ] **[DEV]** After creating the store, run `vercel blob get-store <store-id>`
      (or read the store's URL off the Vercel dashboard) and set
      `BLOB_STORE_BASE_URL` in Vercel → Project → Environment Variables (all
      environments). Recommended for new gyms — without it the store's base URL
      is learned from the first write or a `list()` call (eventually consistent
      for ~1 min on brand-new stores); with it, the very first published post
      renders its body immediately on all instances.

## 4. Create the "Website Blog" custom menu

The admin editor is reached through a GHL custom-menu link whose URL embeds a
long-lived signed admin token (`/admin/blog?t=<token>`, signed with
`ADMIN_SIGNING_KEY` — possession of the link is the credential; the menu's
`userRole: admin` limits who sees it).

- [ ] **[DEV]** Dry-run first: `npm run onboard:blog menu`. Prints the exact
      `POST /custom-menus/` payload **and the signed admin URL** — no write.
- [ ] **[DEV]** Create it: `npm run onboard:blog menu -- --write`. The write is
      guarded behind the explicit `--write` flag (default is dry-run) because it
      mutates the GHL account. Sends `title: "Website Blog"`, `openMode: iframe`,
      `userRole: admin`, `showOnLocation: true`. **Done when:** "Website Blog"
      appears in the sub-account's left sidebar and opens the editor in an iframe.

  Manual fallback (if the API write is skipped or fails): paste the printed
  signed URL into GHL → Settings → Custom Menu Links, Open Mode **iframe**,
  Role **Admin**, show on sub-account.

  > **Set `PUBLIC_SITE_URL`** (no trailing slash) in the environment when running
  > the menu step if the gym's domain differs from the default in
  > `scripts/onboard-blog.ts` (`SITE_URL_DEFAULT`, the astro.config `site`).

  > ⚠️ **Whitelabel domains:** `/admin/blog` sends a `frame-ancestors` CSP that
  > allows GHL's own domains plus `*.localcraze.com` (see
  > `src/pages/admin/blog/index.astro`). `frame-ancestors` checks the domain in
  > the **staff member's address bar** — if they log in through a different
  > agency whitelabel domain, the menu shows "*\<site\> refused to connect*"
  > even though it works fine from `app.gohighlevel.com`. Fix: add the
  > whitelabel origin to `ADMIN_FRAME_ANCESTORS` (space-separated, e.g.
  > `https://*.myagency.com`) in Vercel → Environment Variables and redeploy.
  > Verify from the whitelabel URL, not `app.gohighlevel.com` — the two differ
  > exactly on this header.

## 5. Token rotation note

The custom-menu URL embeds a long-lived signed token (default TTL 365 days).
**Rotating `ADMIN_SIGNING_KEY` invalidates that link** — the embedded token no
longer verifies and the editor returns a 401. After rotating the key, re-run the
menu step (`npm run onboard:blog menu -- --write`, or update the existing menu's
URL manually with the freshly-printed signed URL).
