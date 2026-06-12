# Ad Landing Pages (/go/*) — Design

**Date:** 2026-06-12
**Status:** Approved by Zedric (this session)

## Goal

Six standalone landing pages for paid traffic (Google Ads + Meta), reusing the
existing kids / adults / homepage content with no nav, no footer, and no way to
leak ad clicks off-page. Meta and Google versions are identical in content —
separate URLs exist purely for per-platform lead-source attribution.

## Routes

| URL | Content | Lead source |
|---|---|---|
| `/go/kids-meta` | Kids page body | `ads-kids-meta` |
| `/go/kids-google` | Kids page body | `ads-kids-google` |
| `/go/adults-meta` | Adults page body | `ads-adults-meta` |
| `/go/adults-google` | Adults page body | `ads-adults-google` |
| `/go/start-meta` | Homepage body | `ads-general-meta` |
| `/go/start-google` | Homepage body | `ads-general-google` |

All prerendered (`export const prerender = true`).

## Architecture

### 1. Extract page bodies into shared landing components

- `src/components/landing/HomeLanding.astro` ← body of `src/pages/index.astro`
- `src/components/landing/KidsLanding.astro` ← body of `src/pages/kids-martial-arts.astro`
- `src/components/landing/AdultsLanding.astro` ← body of `src/pages/adults-jiu-jitsu.astro`

Props on each component:

- `source: string` — threaded into every `OptInForm` on the page (originals
  keep their current source values).
- `adMode?: boolean` (default `false`) — when true, internal links that would
  navigate off-page (homepage "learn more" → `/kids-martial-arts/`,
  `/adults-jiu-jitsu/`, and any other internal `<a href="/...">` CTAs) are
  repointed to `#trial`. Content is otherwise identical.

The existing pages (`index.astro`, `kids-martial-arts.astro`,
`adults-jiu-jitsu.astro`) become thin shells: BaseLayout + SEO schema + their
landing component. **Zero rendered-output change for the originals.**

### 2. New `src/layouts/AdLandingLayout.astro`

Modeled on `FunnelLayout.astro`:

- NO Nav, NO Footer, NO thin navy header strip.
- `noindex,nofollow` always.
- New `canonical: string` prop → `<link rel="canonical">` pointing at the
  original page (protects originals' SEO from duplicate content).
- GTM loaded (head + body) — conversion tracking depends on it.
- Renders `StickyMobileCTA` at the top with `trialHref="#trial"` so the mobile
  conversion bar survives without the Nav.
- Inter font + globals.css, same as other layouts.

### 3. `StickyMobileCTA` change

Add `trialHref?: string` prop (default `'/#trial'` — current behavior). Ad
layout passes `'#trial'`.

### 4. Six page shells `src/pages/go/*.astro`

Each ~10 lines: `AdLandingLayout` wrapping the landing component with
`adMode={true}` and the route's source tag.

**Metadata (required on every /go page):** copy the original page's full meta —
`<title>`, meta description, `og:title`, `og:description`, `og:image` +
`og:image:alt` (the original's OG image, not the logo fallback), and
`twitter:card`. `AdLandingLayout` accepts `title`, `description`, `canonical`,
`ogImage`, `ogImageAlt` props to carry these. OG tags matter here: Meta scrapes
them for ad link previews.

### 5. Sitemap exclusion

`astro.config.mjs` sitemap filter gains `!page.includes('/go/')`.

## Kept on ad pages

- AI chat widget (lives in page content).
- Sticky mobile CTA (via layout).
- All schema components stay inside the landing components (harmless under
  noindex; keeps originals' rendered output unchanged). EXCEPTION: if schema is
  currently emitted at page level (not in body), it stays in the original page
  shell only.

## Verification

- `npm run build` green.
- Originals' HTML unchanged (spot-check hero, forms, nav present).
- Each `/go/*` page: no nav/footer, form posts with correct `source`, no
  internal `<a>` leaks (all CTAs → `#trial` / `tel:` / external), noindex +
  canonical present, absent from sitemap.

## Replication note

This is the Academy Launch reference build — the `/go/` pattern (per-platform
ad routes over shared landing components) is templatable per gym. Update
replication docs after build.
