# Phase 3 — Aux Pages (Reviews + Contact + Kickstart polish) Design Spec

**Date:** 2026-05-06
**Source brief:** `GB_Whittier_Website_Build_Brief (1).docx` (client-supplied, May 2026), Part 3 (Page-by-Page Copy & Design Guide)
**Phase:** 3 of 4 in the Brief Implementation roadmap (offer alignment ✅ → program pages ✅ → **aux pages** → SEO/tracking)
**Predecessors:** [Phase 1 spec](./2026-05-06-phase1-offer-global-polish-design.md), [Phase 2 spec](./2026-05-06-phase2-program-pages-design.md) (both shipped)

## Context

Phases 1 and 2 aligned global offer copy + homepage and the two highest-conversion-intent program pages. Phase 3 finishes the user-facing public pages by aligning Reviews, Contact, and the Kickstart funnel page to brief Part 3.

The bento-card visual language locked in Phase 1 propagates here. Reviews and Contact get full rewrites. Kickstart gets a minor polish pass — its structure already matches the brief (it's the funnel page with no nav/footer per brief Part 5), so this phase only verifies brief alignment and tightens copy where deviations exist.

The `/congrats` page is explicitly deferred — the brief Part 1 site architecture says "Congratulations Page (Build later)" and we honor that. Phase 4 may revisit it as part of the SEO/tracking infrastructure pass.

## Goals

- `src/pages/reviews.astro` rewritten to brief Part 3 (Reviews page) verbatim: minimal hero, reviews widget section, 3–4 featured quote cards, final CTA. Bento-card visual, semantic H1/H2, BreadcrumbList JSON-LD, brief-aligned meta.
- `src/pages/contact.astro` rewritten to brief Part 3 (Contact) verbatim: NAP block, contact form, Google Map embed, Service Areas. Bento-card visual, BreadcrumbList JSON-LD, brief-aligned meta. Form submit stays `Send Message` (brief explicit).
- `src/pages/kickstart.astro` verified against brief Part 3 (Kickstart) — adjust copy where it deviates from the brief, but do NOT restructure (it's a funnel page; minimal layout is intentional).
- Phase 1 + 2 acceptance criteria continue to pass (no regressions).

## Non-goals

- `/congrats` page rewrite (deferred per brief)
- Sitemap, `robots.txt`, canonical audit (Phase 4)
- GA4 / GTM event wiring (Phase 4)
- AI chat widget integration (separate)
- Form/calendar embed swaps — webhook integration is the contract
- LocalBusiness schema beyond what Phase 1 already ships (Phase 4)

## Files touched

| File | Change |
|---|---|
| `src/pages/reviews.astro` | Full rewrite — bento visual, hero H1/H2 fix, brief-aligned content, CTA labels, BreadcrumbList |
| `src/pages/contact.astro` | Full rewrite — bento visual, hero H1/H2 fix, brief-aligned NAP/form/map/service-areas, BreadcrumbList |
| `src/pages/kickstart.astro` | Targeted edits — verify brief copy alignment, tighten CTA labels if any deviate |

Approximate diff: 3 files. No new components, no new dependencies. Reuses `BaseLayout`, `CTAButton`, `OptInForm` (not embedded on these pages — no homepage form duplication needed since these are not direct conversion pages), `SchemaBreadcrumb`, `SchemaLocalBusiness`. Note: Reviews and Contact pages link to homepage `/#trial` for conversion (these are research-and-trust pages, not conversion-funnel-entry pages).

## Visual treatment

Same bento-card pattern as homepage / Kids / Adults:
- Outer `<div class="bg-gb-bg-light">` wraps content sections.
- Hero is a rounded card on the gray bg with gradient overlay.
- Body sections are white cards with rounded-2xl corners.
- Final CTA strip is a full-width navy band that escapes the wrapper.
- Heading stack on every page: SEO label `<p>` + visible small `<h1>` + display `<h2>` (where applicable — Contact may use H1 only without a display H2 since it's an info page, not a sales page).

## Reviews page (`src/pages/reviews.astro`)

### Meta

```astro
<BaseLayout
  title="Reviews — Gracie Barra Whittier | Brazilian Jiu-Jitsu in Whittier, CA"
  description="Read reviews from students and families training at Gracie Barra Whittier. See why families across Whittier, La Habra, La Mirada, and Pico Rivera trust us for kids and adult BJJ."
  canonical="https://gbwhittier.com/reviews/"
>
```

### Section structure

1. **Hero (rounded card)**
   - SEO label `<p>`: `Reviews — Gracie Barra Whittier`
   - `<h1 class="text-base md:text-lg font-semibold text-gb-white/90 mb-3">`: `What Students Say About Gracie Barra Whittier`
   - `<h2 class="text-3xl ... font-extrabold ...">`: same line as H1 styled larger? **No** — Reviews page in brief uses single H1 with no display H2. Drop the `<h2>` slot and let the H1 be the visible main heading at full display size. Use `<h1 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl ...">`. Brief says only one H1 with the keyword phrase; no separate motivational display line for this page.
   - Subheadline `<p>`: `Real reviews from real families in Whittier, La Habra, La Mirada, and Pico Rivera.`
   - Primary CTA: `Start My Free Trial` → `/#trial` (links back to homepage opt-in form per brief)

2. **Reviews widget section** (white card)
   - `<h2>`: `Live Google Reviews` (sr-only acceptable; visible heading optional — if visible, use it for SEO)
   - Above the widget: small text `Powered by Google Reviews — updated in real time`
   - Widget container `<div id="reviews-widget">` — placeholder div for the GHL/LocalCraze widget. Brief says "Currently shows 0 reviews. Will populate when Firestorm campaign runs." We render the placeholder element; the GHL embed script (mounted in BaseLayout via `PUBLIC_REVIEWS_EMBED_ID`) populates it at runtime.
   - Fallback text inside the widget div: `Reviews loading...` (visible when widget hasn't initialized)

3. **Featured Review Quotes** (white card section with grid)
   - `<h2>`: `Stories From the Mat`
   - 3–4 quote cards in `grid sm:grid-cols-2 lg:grid-cols-4` (or `lg:grid-cols-3` for 3 quotes). Each card: blockquote, name, optional role.
   - Quotes pulled from existing `src/content/reviews.ts` (placeholder testimonials).
   - Footnote: `Placeholder quotes pending publication of real reviews.`

4. **Final CTA strip** (full-width navy band)
   - `<h2>`: `Ready to write your own success story?`
   - Body: `Try 3 classes free at Gracie Barra Whittier. No risk, no contracts, free uniform rental included.`
   - CTA: `Claim My Free 3-Class Pass` → `/#trial`
   - Trust line: `3 free classes • Free uniform rental • No contracts`

5. **`<SchemaBreadcrumb>`** — head emit, items `[{Home, /}, {Reviews, /reviews/}]`

## Contact page (`src/pages/contact.astro`)

### Meta

```astro
<BaseLayout
  title="Contact Us | Gracie Barra Whittier — Whittier, CA"
  description="Visit Gracie Barra Whittier at 13595 Whittier Blvd. #104, Whittier, CA 90605. Call (562) 640-1400 or email info@gbwhittier.com to claim your Free 3-Class Pass."
  canonical="https://gbwhittier.com/contact/"
>
```

### Section structure

1. **Hero (rounded card, smaller than program-page heroes — Contact is a utility page)**
   - SEO label `<p>`: `Contact Gracie Barra Whittier`
   - `<h1>` (full display size — no separate display H2): `Contact Gracie Barra Whittier`
   - Subheadline: `Drop in, call, email, or send a message. We answer every inquiry.`
   - Primary CTA: `Claim My Free 3-Class Pass` → `/#trial`

2. **NAP Block + Hours** (white card section, two-column on desktop)
   - Left column: `<h2>` `Visit, Call, or Email`. Address block (in plain HTML, NOT image — brief Part 3 explicitly notes this for SEO), phone (tel link), email (mailto link). All NAP from `src/content/nap.ts`.
   - Right column: `<h2>` `Class Schedule`. Pulled from existing `src/data/schedule.ts` if present, or a brief-aligned placeholder schedule per program.

3. **Contact Form** (white card section)
   - `<h2>`: `Send Us a Message`
   - Form fields per brief: Name (required), Email (required), Phone (required), Message (optional textarea)
   - Submit button: `Send Message` (brief explicit — this stays despite the global CTA-ban list because the brief mandates it)
   - Form posts to `PUBLIC_GHL_WEBHOOK_URL` (same target as homepage opt-in) so messages land as GHL conversations. If a separate webhook is preferred for contact submissions, gate behind a future env var; for Phase 3, reuse the existing PUBLIC_GHL_WEBHOOK_URL.
   - Honeypot + dwell-time anti-spam pattern matching homepage opt-in form.
   - On success: render an inline confirmation message ("Message received. We'll reply within 1 business day."). NO redirect — Contact page is not a funnel.

4. **Google Map Embed** (white card section)
   - `<h2>`: `Find Us`
   - Embedded Google Map iframe pointing at the studio address. Lazy-load (`loading="lazy"`) per brief SEO Part 4 (don't block initial paint).

5. **Service Areas** (white card section)
   - `<h2>`: `Serving the Greater Whittier Area`
   - Body: brief verbatim — `Gracie Barra Whittier is conveniently located on Whittier Blvd and easily accessible from Whittier, La Habra, La Mirada, and Pico Rivera.`

6. **Final CTA strip** (full-width navy band)
   - `<h2>`: `Ready to step on the mat?`
   - Body: brief-aligned `Try 3 classes free. No risk, no contracts, free uniform rental included.`
   - CTA: `Claim My Free 3-Class Pass` → `/#trial`

7. **`<SchemaBreadcrumb>`** — head emit, items `[{Home, /}, {Contact, /contact/}]`
8. **`<SchemaLocalBusiness>`** — head emit (Contact is the canonical business-info page; reinforces local SEO).

## Kickstart page (`src/pages/kickstart.astro`)

Targeted edits only. Brief Part 5 says: "NO NAV. NO FOOTER. THIS IS A FUNNEL PAGE — NO EXITS. GOAL: GET THEM TO BOOK THEIR FIRST CLASS." Current page already uses `FunnelLayout` (no Nav/Footer). Verify and tighten:

### Brief-required content checks (verify each in current file; edit if missing or off-spec)

1. **Confirmation header** — `<h1>You're In, [First Name]! Your Free 3-Class Pass Is Reserved.` (already aligned in Phase 1 commit `b9474e5`).
2. **Age routing note** — paragraph `Not sure which program to choose?` plus the 5-bullet age-to-program map (Tiny 3-4, LC1 5-6, LC2 7-9, Juniors 10-15, Adults 16+). Already present.
3. **GHL Calendar embed** — replaced by our custom booking calendar (out of scope; webhook integration is the contract).
4. **What Happens Next** — 3-step visual:
   - Book your first class
   - Show up — wear workout clothes, we provide the uniform
   - After class, meet with Alex — no pressure, no commitment
5. **Trust strip** — small horizontal: `Free uniform rental included • No contracts • No pressure • World-class Gracie Barra curriculum`

### Phase 3 work for Kickstart

- Verify all 5 content blocks above match brief Part 3 verbatim.
- Adjust any banned-strings (audit will catch).
- Do NOT add bento wrapper, do NOT add full-width navy bands — funnel page minimal aesthetic stays.
- Do NOT add BreadcrumbList (funnel page — no schema, no nav signal).

If audit finds nothing actionable, this is a no-op task and the existing kickstart.astro stays.

## Acceptance criteria

**Manual visual checks (Vercel preview deploy, both `/reviews/` and `/contact/`):**

- View-source shows real visible `<h1>` with brief keyword phrase; appropriate H2 hierarchy.
- Page wrapper background is light gray; sections are white cards with rounded corners.
- Hero is a rounded card on the gray.
- Final CTA strip is a full-width navy band escaping the gray wrapper.
- Reviews: 3–4 featured quote cards, reviews-widget placeholder div, brief-aligned subheadline.
- Contact: NAP block, schedule block, contact form with `Send Message` button, Google Map iframe, service-areas section, final CTA.

**Schema checks (view-source on preview):**
- BreadcrumbList JSON-LD on `/reviews/` — 2 ListItem entries.
- BreadcrumbList JSON-LD on `/contact/` — 2 ListItem entries.
- LocalBusiness JSON-LD on `/contact/` — 1 entry (in addition to homepage's).

**Grep checks (must return zero matches in `src/pages/{reviews,contact,kickstart}.astro`):**
- `Get My Free Class`
- `Free First Class`
- `Click Here`
- `>Submit<` and `label="Submit"` (brief allows `Send Message` and the canonical CTA labels — `Submit` is banned)
- `Get Started` not followed by ` Free`
- `#trial-form` (legacy dead anchor)

**Automated:**
- `npx astro check` → 0 errors, 0 warnings
- `npx vitest run` → all tests pass (Phases 1 and 2)
- `npm run build` → completes without warnings

**Regression non-goals (must continue to work):**
- Homepage `/` continues to render and pass Phase 1 acceptance.
- Kids and Adults program pages render and pass Phase 2 acceptance.
- `/api/book`, `/api/availability`, OptInForm submission still functional.
- Vitest assertions on `homepageFaqs`, `kidsFaqs`, `adultsFaqs` still pass.

## Brief-alignment audit (subagent)

Same protocol as Phases 1 and 2, scoped to Phase 3 deliverables.

**Trigger:** at the end of Phase 3 implementation, before production promote.
**Subagent type:** `general-purpose`.
**Inputs:** brief extracted text, this spec, codebase root, Vercel preview URL, scope = "Phase 3 only — Reviews/Contact/Kickstart per brief Part 3".
**Output:** Markdown report (Summary / Failures / Warnings / Passes).
**Pass criteria:** zero FAIL items.
**Out-of-scope for the audit:** homepage, Kids/Adults pages (already audited), `/congrats`, sitemap/robots/canonical, GA4, AI chat widget.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Contact form submission re-uses `PUBLIC_GHL_WEBHOOK_URL` and pollutes the opt-in lead pipeline | Medium | Medium | Distinguish via a `source` field in the POST body (e.g., `source: 'contact-form'`). GHL workflow can branch on that. If client requires a separate webhook, gate behind a new env var; defer to Phase 4 if scope-out is preferred. |
| Reviews widget script (`PUBLIC_REVIEWS_EMBED_ID`) doesn't populate at runtime, leaving the placeholder text visible | Low | Low | Acceptable — brief explicitly notes "Currently shows 0 reviews. Will populate when Firestorm campaign runs." Visual fallback text is brief-acceptable. |
| Google Map iframe slows initial render | Low | Low | Use `loading="lazy"`; place below the fold (after form). Brief Part 4 mandates this. |
| Kickstart page changes break the booking flow | Low | High | Phase 3 only edits Kickstart copy/labels — does not touch `<BookingFlow>`, `/api/book`, or `/api/availability`. Manual smoke check after deploy. |
| Phase 1's strict CTA-label clause conflicts with `Send Message` button on Contact form | Resolved | — | Brief Part 3 (Contact §2) explicitly mandates `Send Message`. Phase 3 spec overrides Phase 1's banned-list for this single label. Audit must not flag `Send Message` as a violation. |

## Out of scope (deferred)

- `/congrats` rebuild (brief: "build later")
- Sitemap.xml audit (Phase 4)
- robots.txt blocking `/kickstart`, `/congrats` (Phase 4)
- LocalBusiness schema field expansion (Phase 4)
- GA4 events: `generate_lead`, `booking_initiated`, `booking_complete` (Phase 4)
- AI chat widget integration (separate, integration-driven)

## Roll-out

Single PR / deploy. Sequence:
1. Implement edits per file inventory.
2. `npx astro check`, `npx vitest run`, `npm run build` locally — all clean.
3. `vercel deploy` (preview).
4. Manual checklist on `/reviews/`, `/contact/`, `/kickstart/` preview URLs.
5. Spawn brief-alignment audit subagent. Fix every FAIL. Repeat until clean.
6. `vercel deploy --prod --yes`.
7. Final smoke check on production for all three pages.
8. Phase 4 brainstorm (SEO + tracking) starts after Phase 3 ships clean.
