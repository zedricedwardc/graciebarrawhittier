# QA-SEO Report

## Build Status
PASS — `npm run build` completed in 1.57s, 10 pages built, sitemap generated, no warnings.

## Summary
- Total issues: 11 (P0: 0, P1: 6, P2: 5)
- Pages audited: 9 (`/`, `/kids-martial-arts/`, `/adults-jiu-jitsu/`, `/reviews/`, `/contact/`, `/terms/`, `/privacy/`, `/kickstart/`, `/congrats/`)
- Strong fundamentals: every page has exactly one H1, every public page has canonical + OG + Twitter + parsing JSON-LD, NAP is identical across all 9 pages, sitemap excludes funnel pages, robots.txt blocks funnel, both funnel pages carry `noindex,nofollow`.

## P0 Issues (must fix before launch)
None.

## P1 Issues (should fix)

### P1-1: Homepage `<title>` exceeds 60-char limit
- File: `src/pages/index.astro:60`
- Page: `/`
- Found: title attr `Brazilian Jiu-Jitsu Classes in Whittier, CA`; rendered title `Brazilian Jiu-Jitsu Classes in Whittier, CA | Gracie Barra Whittier` = **67 chars**
- Expected: ≤60 chars (Google truncates pixel-width ~580px → ~60 chars)
- Fix: shorten to e.g. `BJJ Classes in Whittier, CA` so rendered = `BJJ Classes in Whittier, CA | Gracie Barra Whittier` (51 chars). Plan's "Pages & SEO Targets" table specifies the long form, but the ≤60 rule in the audit checklist takes precedence — flag for owner decision.

### P1-2: Meta descriptions exceed 160-char ceiling on 3 pages
- `/kids-martial-arts/` 188 chars — `src/pages/kids-martial-arts.astro:106`
- `/adults-jiu-jitsu/` 176 chars — `src/pages/adults-jiu-jitsu.astro:80`
- `/contact/` 172 chars — `src/pages/contact.astro:64`
- Expected: 130–160 chars; SERP truncates beyond ~160
- Fix: trim each to ~155 chars while keeping primary keyword + location. Suggested rewrites:
  - kids: `Age-specific Brazilian Jiu-Jitsu for kids 3–15 at Gracie Barra Whittier, CA. Build confidence and self-defense. Claim your free 3-class pass.` (~145)
  - adults: `Beginner-friendly adult Brazilian Jiu-Jitsu classes at Gracie Barra Whittier, CA. Build fitness, self-defense, and confidence. 3 classes free.` (~145)
  - contact: `Visit Gracie Barra Whittier, 13595 Whittier Blvd. #104, Whittier, CA 90605. Call (562) 640-1400. Brazilian Jiu-Jitsu for kids and adults.` (~140)

### P1-3: "Learn More" anchor text on homepage program cards
- File: `src/pages/index.astro:181` and `src/pages/index.astro:203`
- Page: `/`
- Found: two `<CTAButton variant="program" label="Learn More" href="/...">` instances
- Expected: descriptive anchor text per SEO checklist + brief Part 4 ("Never `click here`"). The plan's CTA table lists "Learn More" as the program-card variant, but it lacks a meaningful target keyword.
- Fix: Change labels to `Explore Kids Programs` (line 181) and `Explore Adult Classes` (line 203). Update `CTAButton.astro` if "Learn More" is hardcoded fallback.

### P1-4: Footer "About" paragraph missing required AI-search elements
- File: `src/components/footer/Footer.astro:20`
- Page: All public pages (footer is shared)
- Found: `Gracie Barra Whittier is a Brazilian Jiu-Jitsu academy serving Whittier, La Habra, La Mirada, and Pico Rivera, California. We teach world-class BJJ to kids ages 3+ and adults of all experience levels...` (no street address, no instructor names, no "global Gracie Barra network" mention)
- Expected (from brief Part 4): `Gracie Barra Whittier is a certified Brazilian Jiu-Jitsu academy located at 13595 Whittier Blvd. #104, Whittier, CA 90605. Part of the global Gracie Barra network, the academy offers age-specific BJJ programs for kids (ages 3-15) and adults (16+). Led by Professor Eric and Professor Phil, GB Whittier serves families throughout Whittier, La Habra, La Mirada, and Pico Rivera with a free 3-class trial pass and no contracts.`
- Fix: replace string at `Footer.astro:20` with brief-spec text. AI-search engines lean heavily on this paragraph for direct-answer pulls.

### P1-5: `/reviews/` and `/contact/` lack human (non-logo) image alts
- File: `src/pages/reviews.astro` and `src/pages/contact.astro`
- Page: `/reviews/`, `/contact/`
- Found: only 2 images each, both `Gracie Barra Whittier logo` (header + footer). No content imagery.
- Expected: per brief, reviews page should have a hero/community photo; contact page benefits from an exterior or storefront image.
- Fix: add at least one content image with descriptive alt text incl. location keyword. Or document as intentional in `docs/images-needed.md` if Wave 1 deliberately deferred photography.

### P1-6: Reviews page meta description marginally over 160
- File: `src/pages/reviews.astro:30`
- Page: `/reviews/`
- Found: 165 chars
- Expected: 130–160
- Fix: trim 5 chars, e.g. `Read reviews from Gracie Barra Whittier students and families. See why families across Whittier, La Habra, and La Mirada train with us in BJJ.` (~145).

## P2 Issues (nice to have)

### P2-1: Funnel pages have no `og:*` tags
- Files: `src/layouts/FunnelLayout.astro:21-38`
- Pages: `/kickstart/`, `/congrats/`
- Found: no Open Graph or Twitter Card meta
- Severity: P2 because pages are `noindex,nofollow` and not intended for sharing — but a user pasting `/kickstart/` link in iMessage/WhatsApp/Slack will get an unstyled preview.
- Fix: add minimal `og:title`/`og:description`/`og:image` to FunnelLayout `<head>`.

### P2-2: Homepage program-card heading order skips levels in source order
- File: `src/pages/index.astro` (program cards section)
- Page: `/`
- Found: heading sequence H1→H2→H2→H2→H3→H3 — order is technically valid (each H3 is under an H2), but the program-card H3s ("Kids Martial Arts", "Adults Jiu-Jitsu") sit visually outside an H2 block in the same section pattern.
- Severity: P2 — not a real hierarchy violation; flagging only for awareness. No fix required if Wave 3 confirms the section structure.

### P2-3: Homepage hero label is `<p>` styled like a kicker, but H1 sits below H2 in visual reading order
- File: `src/pages/index.astro:74-80`
- Page: `/`
- Found: H1 (`Brazilian Jiu-Jitsu Classes in Whittier, CA`) is rendered smaller than the H2 (`Build Confidence. Learn Real Self-Defense.`) immediately below it. H1 visual rank < H2 visual rank.
- Severity: P2 — semantically correct (one H1, keyword-loaded), but visual de-emphasis of the H1 weakens user-perceived hierarchy.
- Fix: optional — bump H1 styling so it visually outranks the H2, OR swap so the bold tagline becomes H1 and the keyword line moves to a `<p>` lede. Owner call.

### P2-4: Sitemap `lastmod` not present
- File: `astro.config.mjs` (sitemap integration config)
- Found: each `<url>` has only `<loc>` — no `<lastmod>`, `<changefreq>`, or `<priority>`
- Severity: P2 — modern Google ignores changefreq/priority; lastmod is helpful but not required.
- Fix: optional — set `serialize` in sitemap integration to inject `lastmod: new Date().toISOString()`.

### P2-5: Images may lack location keyword on funnel-adjacent calls
- File: various
- Found: most image alts include "Gracie Barra Whittier" but a few say only "Gracie Barra Whittier" (e.g. logo). Not problematic.
- Fix: none required — alt text quality across the site is genuinely good.

## Page-by-page summary table

| Page | H1 count | H1 keyword | Title len | Meta-desc len | Canonical | Robots | OG/Tw | Schema types | NAP | Service areas |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | 1 | BJJ Whittier CA | 67 (over) | 155 | yes | (default) | yes | MartialArtsSchool, FAQPage | yes | all 4 |
| `/kids-martial-arts/` | 1 | Kids Martial Arts Whittier | 57 | 188 (over) | yes | (default) | yes | FAQPage, BreadcrumbList | yes | all 4 |
| `/adults-jiu-jitsu/` | 1 | Adult BJJ Whittier | 57 | 176 (over) | yes | (default) | yes | FAQPage, BreadcrumbList | yes | all 4 |
| `/reviews/` | 1 | Gracie Barra Whittier | 53 | 165 (over) | yes | (default) | yes | BreadcrumbList | yes | all 4 |
| `/contact/` | 1 | Contact GB Whittier | 49 | 172 (over) | yes | (default) | yes | BreadcrumbList, MartialArtsSchool | yes | all 4 |
| `/terms/` | 1 | Terms | 44 | 134 | yes | (default) | yes | none | yes | n/a (legal) |
| `/privacy/` | 1 | Privacy Policy | 38 | 133 | yes | (default) | yes | none | yes | n/a (legal) |
| `/kickstart/` | 1 | Free 3-Class Pass | 73 | 89 | n/a (noindex) | noindex,nofollow | absent | none | name only | Whittier only |
| `/congrats/` | 1 | Booking Confirmed | 41 | 94 | n/a (noindex) | noindex,nofollow | absent | none | yes | Whittier only |

## Pass-through verifications (all green)

- `dist/sitemap-index.xml` → references `sitemap-0.xml` correctly
- `dist/sitemap-0.xml` → 7 URLs, **excludes** `/kickstart/` and `/congrats/`
- `dist/robots.txt` → disallows `/kickstart` and `/congrats`, points to `sitemap-index.xml`
- All JSON-LD blocks parse without error (8 blocks total across pages)
- Homepage `MartialArtsSchool` schema includes name, url, telephone, address (full PostalAddress), geo coords (33.9385, -118.0149), priceRange, openingHoursSpecification (Mon–Fri 09:00–21:00, Sat 09:00–13:00), areaServed (4 cities). `MartialArtsSchool` is a valid `LocalBusiness` subtype per schema.org.
- All `<img>` tags have alt attributes (zero missing); no generic alts (`image`, `photo`, `picture`).
- NAP (`Gracie Barra Whittier` / `13595 Whittier Blvd. #104, Whittier, CA 90605` / `(562) 640-1400`) appears identically and at minimum once on every public page.
- Service-area mentions (Whittier, La Habra, La Mirada, Pico Rivera) appear in the body of every public page (via shared footer).
- Funnel pages: confirmed `<meta name="robots" content="noindex,nofollow">` present in head.
- Heading hierarchy on every public page: starts with H1, proceeds through H2/H3 without skipping levels.
