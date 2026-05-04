# QA-Conversion-Copy Report

## Build Status
`npm run build` — **PASS** (10 pages built in 2.31s, no errors).

## Summary
- Banned-label hits: 0
- Missing required CTAs: 0 locked CTAs missing; 1 program-card variant deviates from "Learn More"
- Missing trust copy: 2 (form subheader, form description on homepage + adults; minor footer wording)
- Total: **P0: 0 / P1: 3 / P2: 4**

---

## P0 Issues
None. All banned labels (`Get My Free Class`, standalone `Submit`, `Click Here`, bare `Get Started`, `Free First Class`, `Free Class`, `Test Sub-Account`) returned zero hits in `dist/**/*.html` and `src/**/*.{astro,ts}`. All locked primary/secondary/nav/sticky/form-submit CTAs render correctly with exact strings.

---

## P1 Issues

### 1. Homepage opt-in form missing brief-specified subheader and description
- File: `C:\Users\herna\Downloads\Graciebarra whittier website\src\components\form\OptInForm.astro` (lines 38–45)
- Rendered (`dist/index.html` lines 17–18): only header `UNLOCK YOUR FREE 3-CLASS PASS` and risk line.
- Brief specifies (homepage form section): subheader `+ VIEW OUR FULL CLASS SCHEDULE INSTANTLY` and description `Enter your info below to claim your Free 3-Class Pass and access our full class schedule.`
- Neither phrase exists anywhere in `dist/` or `src/`.
- Fix: add a `subheader` prop (default `+ VIEW OUR FULL CLASS SCHEDULE INSTANTLY`) and `description` prop (default to brief string) to `OptInForm.astro` between the H2 (line 43) and risk line (line 44). Same component renders on `/`, `/kids-martial-arts`, `/adults-jiu-jitsu`, so all three pages get coverage.

### 2. Kids program cards use a non-locked CTA label
- File: `C:\Users\herna\Downloads\Graciebarra whittier website\src\pages\kids-martial-arts.astro` line 181
- Current: `label="Claim Free 3-Class Pass"` on each of the 4 age-program cards (Tiny Champions, Little Champions 1, Little Champions 2, Juniors).
- Plan locked CTA standard: program cards = `Learn More`. Homepage program cards (`src/pages/index.astro` lines 181, 203) correctly use `Learn More`. Kids page is inconsistent.
- This isn't on the BANNED list so it's not P0, but it deviates from the locked CTA spec. Either:
  - Change to `Learn More` (and link to a kids-program detail anchor), **or**
  - Keep as anchor-jumps to `#trial-form` but use `Learn More` per spec.
- Fix: change line 181 to `label="Learn More"`.

### 3. Footer about paragraph wording differs from brief
- File: `C:\Users\herna\Downloads\Graciebarra whittier website\src\components\footer\Footer.astro` line 20
- Current: `…receives a free 3-class pass — no risk, no contracts, free uniform rental included.`
- Brief specifies the about paragraph mentions `free 3-class trial pass and no contracts`. Word `trial` is missing.
- Material? Borderline P1/P2. Calling it P1 because brief is explicit. Fix: replace `free 3-class pass` with `free 3-class trial pass` on line 20.

---

## P2 Issues

### 1. Footer service line has trailing period not in brief
- File: `src\components\footer\Footer.astro` line 59 — `Proudly serving Whittier, La Habra, La Mirada, and Pico Rivera, CA.`
- Brief ends without trailing period. Renders identically on all 8 pages. Cosmetic.

### 2. Adults conversion-CTA trust strip wording: "uniform provided" vs "uniform rental"
- File: `src\pages\adults-jiu-jitsu.astro` line 265
- Current paragraph: `3 free classes. No experience needed. Free uniform provided.` Trust bullets below (line 276) correctly say `Free uniform rental`. Mixed terminology in same section. Recommend `Free uniform rental included` for consistency with brief vocabulary.

### 3. Homepage form risk line uses Title Case period style; rendered as expected but not in brief verbatim casing
- `OptInForm.astro` line 24 default: `No Risk. No Pressure. Free Uniform Rental Included.` Matches brief; flagged only because Wave 1 SMS-consent placeholder (lines 119–124) is still TODO per the file's own comment — out of scope for this audit but noted.

### 4. Contact page conversion CTA trust line uses periods instead of bullet-separators
- `dist/contact/index.html` line 34: `3 free classes. Free uniform rental. No contracts.`
- All other conversion pages use `&bull;` separators. Cosmetic consistency.

---

## CTA inventory table

| Page / location | CTA Label | Locked match? |
|---|---|---|
| `/` hero primary | `Claim My Free 3-Class Pass` | yes |
| `/` hero floating-card primary | `Claim My Free 3-Class Pass` | yes |
| `/` opt-in form submit | `Claim My Free 3-Class Pass` | yes |
| `/` mid-page secondary | `Start My Free Trial` | yes |
| `/` program card kids | `Learn More` | yes |
| `/` program card adults | `Learn More` | yes |
| `/kids-martial-arts/` hero | `Claim My Child's Free 3-Class Pass` | yes (kids variant) |
| `/kids-martial-arts/` program cards (×4) | `Claim Free 3-Class Pass` | **no — should be `Learn More`** |
| `/kids-martial-arts/` form submit | `Claim My Free 3-Class Pass` | yes |
| `/kids-martial-arts/` conversion CTA | `Claim My Child's Free 3-Class Pass` | yes |
| `/adults-jiu-jitsu/` hero | `Claim My Free 3-Class Pass` | yes |
| `/adults-jiu-jitsu/` mid-page secondary | `Start My Free Trial` | yes |
| `/adults-jiu-jitsu/` form submit | `Claim My Free 3-Class Pass` | yes |
| `/adults-jiu-jitsu/` conversion CTA | `Claim My Free 3-Class Pass` | yes |
| `/reviews/` mid-page secondary | `Start My Free Trial` | yes |
| `/reviews/` conversion CTA | `Claim My Free 3-Class Pass` | yes |
| `/contact/` form submit | `Send Message` | yes (legit exception) |
| `/contact/` conversion CTA | `Claim My Free 3-Class Pass` | yes |
| Nav (top right, all pages) | `Get Started Free` | yes |
| Sticky mobile bottom (all pages) | `Claim My Free 3-Class Pass` | yes |

Counts in dist:
- `Claim My Free 3-Class Pass` — 15 hits across 6 pages
- `Get Started Free` — 8 hits (every page)
- `Start My Free Trial` — 3 hits (`/`, `/adults-jiu-jitsu`, `/reviews`)
- `Claim My Child's Free 3-Class Pass` — 2 hits (`/kids-martial-arts`)

---

## Required-copy presence table

| Phrase | Pages required (brief) | Pages found | Missing |
|---|---|---|---|
| `FREE 3-CLASS PASS` (gold pill, hero floating card / form offerLabel) | `/`, `/kids`, `/adults` | `/` (×2), `/kids` (×1), `/adults` (×1) | none |
| `Free uniform rental included` (hero floating card) | `/` | `/` line 119 | none |
| `No Risk. No Pressure. Free Uniform Rental Included.` (above form submit) | `/`, `/kids`, `/adults` | `/` line 17, `/kids` line 45, `/adults` line 30 | none |
| `Takes 30 seconds • No payment required • No contracts` (below form submit) | `/`, `/kids`, `/adults` | all three | none |
| `UNLOCK YOUR FREE 3-CLASS PASS` (form header, homepage) | `/` | `/`, `/adults` | none |
| `+ VIEW OUR FULL CLASS SCHEDULE INSTANTLY` (form subheader) | `/` | none | **all** — see P1 #1 |
| `Enter your info below to claim your Free 3-Class Pass and access our full class schedule.` (form description) | `/` | none | **all** — see P1 #1 |
| `Copyright 2026. Gracie Barra Whittier. All Rights Reserved.` | every page | every page (8/8) | none |
| `Proudly serving Whittier, La Habra, La Mirada, and Pico Rivera, CA` | every page | every page (with stray `.`) | trailing period — P2 |
| `Ready to Get Your Child Started?` (kids conversion H2) | `/kids` | `/kids` line 60 | none |
| `3 free classes • Free uniform rental • No contracts • No pressure` (kids trust strip) | `/kids` | `/kids` line 65 | none |
| `Start Your BJJ Journey This Week` (adults conversion H2) | `/adults` | `/adults` line 45 | none |
| `Free uniform rental included • No contracts • No pressure • World-class Gracie Barra curriculum` (kickstart) | `/kickstart` | `/kickstart` line 51 (also `/congrats`) | none |
| `No risk · No contracts · Free uniform rental` (trust strip after CTAs) | every conversion page | meta-description on `/`, every page meta description, plus `/kickstart` and `/congrats` visible strip | none |
| `free 3-class trial pass` (footer about) | every page (footer) | none — uses `free 3-class pass` | **see P1 #3** |
| `Test Sub-Account` (must be zero) | — | 0 | clean |
| `Free First Class` (must be zero) | — | 0 | clean (only appears in brief source file) |
| `Get My Free Class` (banned) | — | 0 | clean |
| `Click Here` (banned) | — | 0 | clean |
| Standalone `Submit` button | — | 0 | clean |
| Bare `Get Started` (without ` Free`) | — | 0 | clean |

---

## Notes
- All BANNED labels are absent from `dist/` and `src/`. The substring matches in `docs/_internal/brief-extract.txt` and `.claude/settings.local.json` are documentation/configuration references and are out of scope.
- All locked primary CTA strings are exact (no quote-mark or capitalization drift).
- The opt-in form component is single-source-of-truth — fixing P1 #1 in `OptInForm.astro` propagates to all three conversion pages with no per-page edits required.
- Read-only audit; no source files modified.
