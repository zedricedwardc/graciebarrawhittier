# Ad Landing Pages (/go/*) — Google Ads + Meta

Standalone, chromeless landing pages for paid traffic. Same content as the
organic pages, but no nav/footer (no way to leak an ad click off-page) and
per-platform URLs for clean lead-source attribution.

## Architecture (already in the template)

- `src/components/landing/{HomeLanding,KidsLanding,AdultsLanding}.astro` —
  the page bodies, shared by the organic page and its ad variants. Copy lives
  in ONE place; editing a landing component updates organic + both ad pages.
  - `source?: string` — overrides every OptInForm's lead source. Omitted on
    the organic shells, so originals keep their values (`homepage-optin`,
    `kids-optin`, `adults-optin`).
  - `adMode?: boolean` — repoints internal page links (e.g. homepage
    "Learn More" → program pages) to `#trial`. Anchors/`tel:` untouched.
- `src/layouts/AdLandingLayout.astro` — chromeless layout: no Nav/Footer,
  always `noindex,nofollow`, `canonical` → the organic page, full OG meta
  (Meta scrapes it for ad previews), GTM loaded, StickyMobileCTA pinned to
  `#trial`.
- `src/pages/go/*.astro` — six ~20-line shells:

| Route | Body | Lead source |
|---|---|---|
| `/go/kids-meta` | KidsLanding | `ads-kids-meta` |
| `/go/kids-google` | KidsLanding | `ads-kids-google` |
| `/go/adults-meta` | AdultsLanding | `ads-adults-meta` |
| `/go/adults-google` | AdultsLanding | `ads-adults-google` |
| `/go/start-meta` | HomeLanding | `ads-general-meta` |
| `/go/start-google` | HomeLanding | `ads-general-google` |

- `astro.config.mjs` sitemap filter excludes `/go/`.

## Per-gym replication steps

1. Nothing page-specific to rebuild — the `/go/*` routes ship with the
   template and inherit the gym's content automatically once the landing
   components are populated.
2. Verify canonical URLs in `src/pages/go/*.astro` point at the new gym's
   domain (they derive from the page files, not config — update if the
   organic slugs differ).
3. In GHL, the lead-source values (`ads-*-meta`, `ads-*-google`) arrive via
   the existing `/api/lead` flow — add them to any source-based reporting or
   workflow filters the gym uses.
4. Ad platforms: use the `/go/*-google` URLs as Google Ads final URLs and
   `/go/*-meta` as Meta ad destination URLs. Add platform UTM templates on
   top as desired; the path itself already encodes platform + audience.
5. Confirm `noindex` + canonical on the deployed pages and that they are
   absent from `sitemap-0.xml`.

Design spec: `docs/superpowers/specs/2026-06-12-ad-landing-pages-design.md`.
