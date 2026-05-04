# Wave 3 Aggregated Fix List

## Build status
PASS (all 4 QA reports independently confirmed `npm run build` succeeds; 10 pages, single 33 KB CSS bundle, no errors/warnings)

## Tally
- Source reports: 4 (SEO, Mobile-UX, Conversion-Copy, Brand)
- Raw issues: 27 (SEO 11, Mobile-UX 9, Copy 7, Brand 4 — minus duplicates noted in tables)
- After dedupe: 22 (Footer NAP/about-paragraph + footer hover + footer phone-link tap-height all overlap on `Footer.astro`; counted once each per file:line)
- After conflict resolution: 21 (1 issue rejected via brief-citation: kids-page program-card CTA label)
- Final P0: 0 / P1: 9 / P2: 11
- Deferred: 1

## Conflicts resolved
| # | Conflicting reports | Resolution | Brief citation |
|---|---|---|---|
| C1 | Copy P1-2 says kids-page program-card CTAs (`Claim Free 3-Class Pass`) violate locked `Learn More` standard. Plan CTA table also says `Learn More` for program cards. | **REJECT the fix.** The locked `Learn More` rule applies to *homepage* program cards (links out to `/kids-martial-arts` / `/adults-jiu-jitsu`). The kids page's own age-tier program cards have their own brief-level lock. | Brief Part 3, Kids page Section 2: `Each card: program name, age range, 2-3 sentence description, CTA: 'Claim Free 3-Class Pass'`. Brief is explicit — kids age-cards keep `Claim Free 3-Class Pass`. |
| C2 | SEO P1-1 wants homepage `<title>` shortened to ≤60 chars; plan's Pages & SEO Targets table specifies the long form. | **Shorten the title phrase before the pipe.** Brief Part 1 gives only a generic format (`[Page Topic] | Gracie Barra Whittier — [City, CA]`) — no exact title is locked. The ≤60-char SERP-truncation rule is a technical SEO requirement; the brief's H1 lock (`Brazilian Jiu-Jitsu Classes in Whittier, CA`) is preserved separately. | Brief Part 1: `Meta title format: [Page Topic] | Gracie Barra Whittier — [City, CA]` (format, not exact text); Brief Part 4: `Page speed... Mobile-first build` (technical SEO best practice prevails on length). |
| C3 | Brand P2 questions whether FAQ section needs navy background; plan and brief Part 1 list FAQ alongside footer as a "navy/dark surface". | **Defer.** Brief Part 1 says "Background dark #1B2A5E (navy sections — FAQ, footer)" — but visually-tested readability of light FAQ is acceptable, and changing FAQ to navy is high-effort, ambiguous-value. Note as deferred for design-lead review post-launch. | Brief Part 1 Brand standards: `Background dark #1B2A5E (navy sections — FAQ, footer)` — flagged but not blocking. |

---

## Final fix list (Finalizer executes top-to-bottom)

### P0 — must fix
(none)

---

### P1 — fix this pass

#### 1. Add subheader + description to OptInForm (highest conversion impact, single edit propagates to 3 pages)
- Source(s): copy (P1-1)
- File: `src/components/form/OptInForm.astro` (between current H2 ~line 43 and risk line ~line 44)
- Page(s) impacted: `/`, `/kids-martial-arts/`, `/adults-jiu-jitsu/`
- Issue: Brief-spec subheader `+ VIEW OUR FULL CLASS SCHEDULE INSTANTLY` and description `Enter your info below to claim your Free 3-Class Pass and access our full class schedule.` are absent from `dist/` and `src/`. These are conversion-priming copy — they reduce form-abandonment by signaling specific value.
- Fix: Add two `<Astro.props>` props to `OptInForm.astro`: `subheader` (default `"+ VIEW OUR FULL CLASS SCHEDULE INSTANTLY"`) and `description` (default `"Enter your info below to claim your Free 3-Class Pass and access our full class schedule."`). Render `subheader` as a small uppercase eyebrow under the H2; render `description` as a paragraph between subheader and the risk line. Use existing brand classes (`text-gb-gold` on subheader is acceptable per brief — this IS an offer callout; `text-gb-text-muted text-sm` on description).
- Verification: `grep -r "VIEW OUR FULL CLASS SCHEDULE" dist/` returns ≥3 hits; `grep -r "claim your Free 3-Class Pass and access" dist/` returns ≥3 hits.

#### 2. Replace footer about paragraph with brief-spec text (AI-search + copy correctness, one file fixes both)
- Source(s): seo (P1-4), copy (P1-3)
- File: `src/components/footer/Footer.astro:20`
- Page(s) impacted: every public page (shared footer)
- Issue: Current footer about paragraph lacks street address, instructor names, "global Gracie Barra network" mention, and uses `free 3-class pass` instead of brief-locked `free 3-class trial pass`.
- Fix: Replace the paragraph string at `Footer.astro:20` verbatim with:
  `Gracie Barra Whittier is a certified Brazilian Jiu-Jitsu academy located at 13595 Whittier Blvd. #104, Whittier, CA 90605. Part of the global Gracie Barra network, the academy offers age-specific BJJ programs for kids (ages 3-15) and adults (16+). Led by Professor Eric and Professor Phil, GB Whittier serves families throughout Whittier, La Habra, La Mirada, and Pico Rivera with a free 3-class trial pass and no contracts.`
- Verification: `grep -r "Professor Eric and Professor Phil" dist/` returns hits on every public page; `grep -r "free 3-class trial pass" dist/` returns hits on every public page.

#### 3. Trim 3 over-length meta descriptions to 130–160 chars
- Source(s): seo (P1-2)
- File / page:
  - `src/pages/kids-martial-arts.astro:106` (188 → ~145 chars)
  - `src/pages/adults-jiu-jitsu.astro:80` (176 → ~145)
  - `src/pages/contact.astro:64` (172 → ~140)
- Issue: SERP truncates beyond ~160 chars, costing CTR.
- Fix: Replace each meta description with the rewritten string from `seo.md` P1-2:
  - kids: `Age-specific Brazilian Jiu-Jitsu for kids 3–15 at Gracie Barra Whittier, CA. Build confidence and self-defense. Claim your free 3-class pass.`
  - adults: `Beginner-friendly adult Brazilian Jiu-Jitsu classes at Gracie Barra Whittier, CA. Build fitness, self-defense, and confidence. 3 classes free.`
  - contact: `Visit Gracie Barra Whittier, 13595 Whittier Blvd. #104, Whittier, CA 90605. Call (562) 640-1400. Brazilian Jiu-Jitsu for kids and adults.`
- Verification: each page's `<meta name="description">` length 130–160 chars in `dist/`.

#### 4. Trim reviews-page meta description from 165 → ≤160 chars
- Source(s): seo (P1-6)
- File: `src/pages/reviews.astro:30`
- Page(s) impacted: `/reviews/`
- Issue: 5 chars over.
- Fix: Replace with `Read reviews from Gracie Barra Whittier students and families. See why families across Whittier, La Habra, and La Mirada train with us in BJJ.` (~145).
- Verification: `<meta name="description">` length on `/reviews/` is 130–160 chars.

#### 5. Shorten homepage `<title>` so rendered title is ≤60 chars
- Source(s): seo (P1-1)
- File: `src/pages/index.astro:60` (the title prop passed to SeoHead/BaseLayout)
- Page(s) impacted: `/`
- Issue: Rendered title currently 67 chars (`Brazilian Jiu-Jitsu Classes in Whittier, CA | Gracie Barra Whittier`); Google truncates ~60 chars. Conflict-resolved per C2.
- Fix: Change the page-title prop value from `Brazilian Jiu-Jitsu Classes in Whittier, CA` to `BJJ Classes in Whittier, CA`. Rendered title becomes `BJJ Classes in Whittier, CA | Gracie Barra Whittier` (51 chars). **Do not** change the H1 — H1 must remain `Brazilian Jiu-Jitsu Classes in Whittier, CA` per brief.
- Verification: `<title>` element on `/` is ≤60 chars; H1 unchanged.

#### 6. Recolor program-page hero eyebrows from gold → white/80 (4 instances)
- Source(s): brand (P1)
- Files / lines:
  - `src/pages/adults-jiu-jitsu.astro:87`
  - `src/pages/kids-martial-arts.astro:113`
  - `src/pages/kickstart.astro:54`
  - `src/pages/kickstart.astro:178`
- Page(s) impacted: `/adults-jiu-jitsu/`, `/kids-martial-arts/`, `/kickstart/`
- Issue: Eyebrow text is a category descriptor, not an offer callout. Brief reserves gold for offer callouts only — using it on eyebrows dilutes the gold accent's conversion role.
- Fix: Change `text-gb-gold` → `text-gb-white/80` on each `<p class="...">` eyebrow line. Keep `text-xs md:text-sm font-bold tracking-widest uppercase`.
- Verification: `grep -n "text-gb-gold" src/pages/{adults-jiu-jitsu,kids-martial-arts,kickstart}.astro` shows no remaining eyebrow matches; only offer-pill / form-offer-label gold uses remain.

#### 7. Recolor congrats-page NAP labels + link decoration away from gold (6 instances)
- Source(s): brand (P1)
- File: `src/pages/congrats.astro:82, 88, 95, 99, 106, 110`
- Page(s) impacted: `/congrats/`
- Issue: NAP info is not an offer callout. Six gold instances visually compete with the actual conversion signal.
- Fix:
  - Change `<dt>` color from `text-gb-gold` → `text-gb-white/70` (lines 82, 95, 106).
  - Change link `decoration-gb-gold` → `decoration-gb-white/40` and `hover:text-gb-gold` → `hover:text-gb-white` (lines 88, 99, 110).
- Verification: `grep -n "gb-gold" src/pages/congrats.astro` returns 0 matches (or only an intentional offer-badge if Finalizer chooses to add one — spec is "remove all 6 misuses").

#### 8. Bump nav CTAButton tap height 40 → 48 px
- Source(s): mobile-ux (P1 #1)
- File: `src/components/cta/CTAButton.astro:48` (size-class ternary) + `src/styles/tokens.css` (token `--btn-h-nav`)
- Page(s) impacted: every public page (desktop nav button "Get Started Free")
- Issue: Nav variant renders `h-10` = 40 px; below WCAG 48 px tap-target floor on tablets/touchscreens.
- Fix: Change `'h-10 text-sm'` → `'h-12 text-sm'` in the `isNav` branch (or `h-11` for 44 px if visual fit is tight). Update `--btn-h-nav: 40px` → `--btn-h-nav: 48px` in `tokens.css` so token + class agree.
- Verification: rendered nav button height is 48 px; visual nav-bar height (`h-16 md:h-20` = 64/80 px) still accommodates the button.

#### 9. Bump mobile drawer hamburger + close buttons 40×40 → 48×48 px
- Source(s): mobile-ux (P1 #2)
- File: `src/components/nav/MobileNavDrawer.astro:24` (hamburger) and `:53` (close)
- Page(s) impacted: every public page on viewports < 768 px
- Issue: 40 × 40 px tap region is below WCAG 48 px minimum on the primary mobile-nav trigger.
- Fix: Change `w-10 h-10` → `w-12 h-12` on both buttons. Inner SVG (`w-6 h-6`) remains.
- Verification: Both buttons render at 48 × 48 px in DevTools mobile mode.

---

### P2 — fix this pass (cheap polish)

#### 10. Footer phone + email links: add explicit ≥48 px tap height
- Source(s): mobile-ux (P1 #3) [downgraded to P2 because contact page already provides accessible NAP]
- File: `src/components/footer/Footer.astro:48` (phone), `:53` (email)
- Page(s) impacted: every public page (footer)
- Issue: Phone/email links render ~20 px tall with 4 px gap — fat-finger collision risk on mobile.
- Fix: Add `inline-flex items-center min-h-[44px] py-2` to each `<a>`; change `<address>` parent's `space-y-1` → `space-y-2`. Same pattern as `contact.astro:95,103`.
- Verification: footer phone/email tap regions ≥44 px in DevTools mobile mode.

#### 11. Footer hover-state: change `hover:text-gb-gold` → `hover:text-gb-white`
- Source(s): brand (P2 #1)
- File: `src/components/footer/Footer.astro:48, 53, 69, 76, 81`
- Page(s) impacted: every public page (footer)
- Issue: Gold hover-state on standard footer links violates "gold for offer callouts only" rule.
- Fix: replace `hover:text-gb-gold` with `hover:text-gb-white` on all 5 lines (use `replace_all` in editor).
- Verification: `grep -n "hover:text-gb-gold" src/components/footer/Footer.astro` returns 0.

#### 12. Mobile drawer link list — increase row gap 4 → 8 px
- Source(s): mobile-ux (P1 #4)
- File: `src/components/nav/MobileNavDrawer.astro:66`
- Page(s) impacted: mobile drawer on every public page
- Issue: Adjacent links sit only 4 px apart — below 8 px touch-spacing best practice.
- Fix: change `space-y-1` → `space-y-2` on the `<ul>`.
- Verification: drawer link rows have 8 px gap in DevTools.

#### 13. Mobile drawer link `active`/`focus-visible` states
- Source(s): mobile-ux (P2 #7)
- File: `src/components/nav/MobileNavDrawer.astro:71-72`
- Issue: Touch :hover unreliable; no press feedback or keyboard focus ring.
- Fix: Add `active:bg-gb-bg-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gb-navy` to the link classes.
- Verification: drawer links show ring on Tab focus + bg change on touch press.

#### 14. FAQ `<summary>` focus-visible ring
- Source(s): mobile-ux (P2 #6)
- File: `src/components/faq/FAQItem.astro:18`
- Page(s) impacted: `/`, `/kids-martial-arts/`, `/adults-jiu-jitsu/`
- Issue: No visible focus ring for keyboard users on FAQ accordions.
- Fix: append `focus:outline-none focus-visible:ring-2 focus-visible:ring-gb-navy focus-visible:rounded` to the `<summary>` class string.
- Verification: Tab to FAQ summary shows navy ring.

#### 15. Homepage hero subhead — drop a step on mobile
- Source(s): mobile-ux (P2 #5)
- File: `src/pages/index.astro:78`
- Page(s) impacted: `/` at 375 px viewport
- Issue: `text-4xl` (36 px) on 375 px viewport leaves 21-char H2 line near edge of `px-4` content area.
- Fix: change `text-4xl md:text-6xl` → `text-3xl sm:text-4xl md:text-6xl`.
- Verification: at 375 px, the H2 wraps comfortably without near-edge overflow.

#### 16. Homepage program-card "Learn More" → descriptive anchor text
- Source(s): seo (P1-3) [downgraded to P2 — anchor text impact is real but smaller than meta-desc/title; brief generic "Learn More" guidance applies to homepage cards]
- File: `src/pages/index.astro:181, 203`
- Page(s) impacted: `/`
- Issue: Generic "Learn More" lacks SEO keyword in anchor text (brief Part 4: "Never `click here`"; same principle).
- Fix: Change line 181 `label="Learn More"` → `label="Explore Kids Programs"`; line 203 → `label="Explore Adult Classes"`. **Note**: If any visual layout depends on the short label width, fall back to the brief-locked `Learn More` and accept the SEO penalty (decision: brief allows `Learn More` per Part 1 CTA standards — so this is a P2 *optional* improvement, not a violation. **Finalizer: skip if any visual concern; otherwise apply.**)
- Verification: program-card link `<a>` anchor text matches new strings on `/`.

#### 17. Adults conversion CTA: "uniform provided" → "uniform rental included"
- Source(s): copy (P2 #2)
- File: `src/pages/adults-jiu-jitsu.astro:265`
- Page(s) impacted: `/adults-jiu-jitsu/`
- Issue: Same section uses "uniform provided" (line 265) and "Free uniform rental" (line 276) — internal inconsistency.
- Fix: Change `Free uniform provided.` → `Free uniform rental included.`
- Verification: `grep -n "uniform provided" src/pages/adults-jiu-jitsu.astro` returns 0.

#### 18. Contact-page conversion-CTA trust line: bullets instead of periods
- Source(s): copy (P2 #4)
- File: `src/pages/contact.astro` (find the trust line `3 free classes. Free uniform rental. No contracts.`)
- Page(s) impacted: `/contact/`
- Issue: Other conversion pages use `&bull;` separators; this one uses periods.
- Fix: Change `3 free classes. Free uniform rental. No contracts.` → `3 free classes &bull; Free uniform rental &bull; No contracts`.
- Verification: rendered separator is `•` on `/contact/` trust strip.

#### 19. Footer service line: drop trailing period
- Source(s): copy (P2 #1)
- File: `src/components/footer/Footer.astro:59`
- Page(s) impacted: every public page
- Issue: `Proudly serving Whittier, La Habra, La Mirada, and Pico Rivera, CA.` ends with `.`; brief omits trailing period.
- Fix: Remove the trailing period.
- Verification: `grep -n "Pico Rivera, CA\." dist/` returns 0.

#### 20. Add minimal OG tags to FunnelLayout
- Source(s): seo (P2-1)
- File: `src/layouts/FunnelLayout.astro:21-38`
- Page(s) impacted: `/kickstart/`, `/congrats/`
- Issue: No OG/Twitter meta means link previews are unstyled when users share `/kickstart` URL.
- Fix: Add `<meta property="og:title">`, `<meta property="og:description">`, `<meta property="og:image">` (re-use homepage og:image), `<meta name="twitter:card" content="summary_large_image">` to FunnelLayout `<head>`. Keep `noindex,nofollow` intact.
- Verification: `dist/kickstart/index.html` contains 4+ og/twitter meta tags.

---

### Deferred (track but don't fix now)

- **Reviews + Contact pages lack non-logo content imagery** (seo P1-5) — requires real GB Whittier photography from `Website Media/`; image-prep is a Wave 1 deliverable, not a Wave 3 fix. Document in `docs/images-needed.md` if not already; ship as-is.
- **FAQ section background — light vs navy** (brand P2 #2) — see conflict C3. Defer to design-lead post-launch decision.
- **Homepage program-card heading order** (seo P2-2) — informational only, no fix required.
- **Homepage H1 visual rank vs H2** (seo P2-3) — owner call; brief explicitly says display H2 stays visually prominent ("Build Confidence. Learn Real Self-Defense." is the visible hero), so current rendering matches brief intent.
- **Sitemap lastmod** (seo P2-4) — modern Google ignores changefreq/priority; lastmod nice-to-have.
- **Alt-text location keyword polish** (seo P2-5) — already passing; no fix required.
- **Inter font weight 500 dropping** (mobile-ux P2 #8) — micro-perf, low impact, Google Fonts CSS cached for return visitors.
- **Calendar iframe min-height responsive ramp** (mobile-ux P2 #9) — acceptable tradeoff for third-party widget.
- **Hero phone-link tap height** (mobile-ux audit table footnote) — sits next to a 56 px CTA, low fat-finger risk; defer.
- **OptInForm SMS-consent placeholder TODO** (copy P2 #3) — out of scope for QA pass; owner item.
- **Broader footer site-link tap heights** (mobile-ux audit table footnote) — borderline; not user-critical; covered by spacing fix in #10.

---

## Finalizer execution order

Grouped by file so Finalizer reads + edits each file once. Apply in this order:

1. **`src/components/form/OptInForm.astro`** → fix #1 (subheader + description props/markup).
2. **`src/components/footer/Footer.astro`** → fixes #2 (about paragraph), #10 (phone/email tap height + space-y-2), #11 (hover gold→white), #19 (drop trailing period).
3. **`src/components/cta/CTAButton.astro`** → fix #8 (nav h-10 → h-12).
4. **`src/styles/tokens.css`** → fix #8 cont. (`--btn-h-nav: 48px`).
5. **`src/components/nav/MobileNavDrawer.astro`** → fixes #9 (w-10 h-10 → w-12 h-12 on both buttons), #12 (space-y-1 → space-y-2 on link list `<ul>`), #13 (active/focus-visible on links).
6. **`src/components/faq/FAQItem.astro`** → fix #14 (focus-visible ring on `<summary>`).
7. **`src/layouts/FunnelLayout.astro`** → fix #20 (OG/Twitter meta).
8. **`src/pages/index.astro`** → fixes #5 (title prop shortened to `BJJ Classes in Whittier, CA`), #15 (hero subhead `text-3xl sm:text-4xl md:text-6xl`), #16 (program-card labels — apply unless visual conflict).
9. **`src/pages/kids-martial-arts.astro`** → fixes #3 (meta-desc trim, line ~106), #6 (eyebrow gold → white/80, line ~113).
10. **`src/pages/adults-jiu-jitsu.astro`** → fixes #3 (meta-desc trim, line ~80), #6 (eyebrow gold → white/80, line ~87), #17 (uniform provided → rental included, line ~265).
11. **`src/pages/contact.astro`** → fixes #3 (meta-desc trim, line ~64), #18 (period → bullet separators on conversion trust line).
12. **`src/pages/reviews.astro`** → fix #4 (meta-desc trim to ≤160).
13. **`src/pages/kickstart.astro`** → fix #6 (two eyebrow gold → white/80, lines ~54 and ~178).
14. **`src/pages/congrats.astro`** → fix #7 (six gold → white/70 + white/40 on NAP block, lines 82–110).
15. **Run `npm run build`** — verify zero errors/warnings, 10 pages built.
16. **Verify**: `grep -r "VIEW OUR FULL CLASS SCHEDULE"`, `grep -r "Professor Eric and Professor Phil"`, `grep -r "free 3-class trial pass"`, `grep -r "text-gb-gold" src/pages/{kickstart,congrats,kids-martial-arts,adults-jiu-jitsu}.astro` (last should return 0 matches; offer-pill uses live in `index.astro` and `OptInForm.astro` only).
17. **Check meta-desc lengths** on `/`, `/kids-martial-arts/`, `/adults-jiu-jitsu/`, `/contact/`, `/reviews/` are 130–160 chars; homepage `<title>` is ≤60 chars.

End of aggregate. Finalizer: execute steps 1–17 in order. If any fix introduces a visual regression at the 375 px viewport, prefer the brief-locked text/spec over the QA recommendation and note the divergence in `docs/launch-checklist.md`.
