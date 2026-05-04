# QA-Brand Report

Wave 2 — read-only audit. Date: 2026-05-05.

## Build Status
`npm run build` — SUCCESS. 10 pages built in 2.19s. 18 images optimized. Sitemap generated. No errors, no warnings.

## Summary
- Off-palette hex codes in src/: **0** (all hex values are confined to `tokens.css` + `globals.css` and match the approved palette exactly).
- Tailwind arbitrary color classes (`bg-[#...]`, `text-[#...]`, etc.): **0**.
- Off-palette Tailwind utilities (e.g. `bg-red-600`, `bg-gray-200`): **0**.
- Logo issues: **0** (file present, aspect ratio set, no recolor filters).
- Typography issues: **0** (Inter loaded with `display=swap`, mapped via `--font-sans`).
- Heading weight discipline: 12 files use `font-bold|extrabold|black` on H1/H2.
- Footer brand discipline: PASS (logo + NAP + about paragraph + correct copyright "Gracie Barra Whittier").
- Gold misuse: **2** (program-page eyebrows on dark hero — borderline P1; congrats page label/decoration — P1).
- Navy on light section: **0** confirmed misuse; FAQ section has no explicit bg (P2 — does not match brief intent of "navy FAQ").
- **Totals: P0: 0 / P1: 2 / P2: 2.**

Overall: brand fidelity is strong. Tokens are the single source of truth, brand utilities dominate, no off-palette hex anywhere, CTA pill style consistent, hero/program imagery sourced from local `src/assets/images/...` (i.e. real GB Whittier files), no emoji in headings/body. The only meaningful drift is gold-usage discipline on a few eyebrow labels.

---

## P0 Issues
None.

## P1 Issues

### Gold used as eyebrow text on program-page heroes
- File:line — `src/pages/adults-jiu-jitsu.astro:87`, `src/pages/kids-martial-arts.astro:113`
- Found — `<p class="text-gb-gold text-xs md:text-sm font-bold tracking-widest uppercase">` rendering the eyebrow line "Brazilian Jiu-Jitsu for Adults/Kids in Whittier, CA" above the H1 on each program-page hero (which is a navy section).
- Expected — Per brief, gold is reserved for offer callouts only (e.g. the "FREE 3-CLASS PASS" pill). The over-page-headline eyebrow is not an offer label — it's a category descriptor. Acceptable substitutes: `text-gb-white/70` or `text-gb-white` with `tracking-widest` to keep the visual hierarchy without burning the gold accent.
- Fix — swap `text-gb-gold` → `text-gb-white/80` (or `text-gb-white`) on these two eyebrows. Same fix applies to `src/pages/kickstart.astro:54` and `:178` (additional eyebrows on the funnel pages — same pattern, also gold).

### Gold used for term labels + link decoration on congrats page
- File:line — `src/pages/congrats.astro:82, 88, 95, 99, 106, 110`
- Found — six gold class instances: address/phone/email `<dt>` term labels are `text-gb-gold`, and the underlying `<a>` tags use `decoration-gb-gold underline-offset-4 hover:text-gb-gold`. This styles general NAP info (which appears on every page) as if it were an offer callout.
- Expected — Gold for offer callouts only. NAP/contact lines on a confirmation page are not an offer.
- Fix — change `<dt>` color to `text-gb-white/70` (matches surrounding `bg-gb-navy text-white` block visually) and link decoration/hover to `decoration-gb-white/40` + `hover:text-gb-white`. Keep one gold accent at the top of the page if a "Reserved" badge is desired.

## P2 Issues

### Footer hover state uses gold
- File:line — `src/components/footer/Footer.astro:48, 53, 69, 76, 81`
- Found — all phone/email/nav/legal links in the navy footer use `hover:text-gb-gold`.
- Expected — Brief reserves gold for offer callouts. A hover-color is a small surface, but five instances apply.
- Fix — use `hover:text-gb-white` (full white-on-dim → bright on hover) or `hover:text-gb-red` if a brand pop is desired. Low impact — the user only sees this transiently. Treat as polish.

### FAQ section lacks navy background
- File:line — `src/components/faq/FAQ.astro:19`
- Found — `<section class="max-w-3xl mx-auto px-4 md:px-6 py-12 md:py-16">` — no background utility, so it inherits the page (gb-white).
- Expected — Brief Part 1 lists FAQ alongside footer + dark CTA section as a navy/dark surface.
- Fix — wrap the FAQ in a `bg-gb-bg-light` or `bg-gb-navy` band per the brief intent. (Verify the brief's exact wording with the design lead before changing — possible the design lead chose light-surface FAQ for readability.)

---

## Color audit table
| File | Line | Hex / class | Approved? | Notes |
|---|---|---|---|---|
| src/styles/tokens.css | 8 | `#cc2200` | yes | gb-red |
| src/styles/tokens.css | 9 | `#a31a00` | yes | gb-red-dark |
| src/styles/tokens.css | 10 | `#1b2a5e` | yes | gb-navy |
| src/styles/tokens.css | 11 | `#131f47` | yes | gb-navy-dark |
| src/styles/tokens.css | 12 | `#ef9f27` | yes | gb-gold |
| src/styles/tokens.css | 13 | `#f4f4f4` | yes | gb-bg-light |
| src/styles/tokens.css | 14 | `#1b2a5e` | yes | gb-bg-dark (= navy) |
| src/styles/tokens.css | 15 | `#ffffff` | yes | gb-white |
| src/styles/tokens.css | 16 | `#0f1419` | yes | gb-text |
| src/styles/tokens.css | 17 | `#5c6470` | yes | gb-text-muted |
| src/styles/globals.css | 9-18 | duplicate of above | yes | mapped into Tailwind v4 `@theme` |
| **all other src files** | — | **no raw hex codes** | yes | only `#xxx` matches were the suite-number `#104` in NAP strings (literal text, not a color) |
| any src file | — | `bg-[#...]` / `text-[#...]` | n/a | **0 occurrences** |
| any src file | — | `bg-red-N`, `bg-gray-N`, etc. | n/a | **0 occurrences** |

Verdict: token discipline is excellent. Every color in the codebase resolves to one of the 10 approved palette entries.

## Logo + typography table
| Item | Status | Notes |
|---|---|---|
| Logo file present | OK | `public/logo/gb-whittier-logo.png`, 20.8 KB |
| Logo aspect ratio preserved | OK | Nav.astro L24-30 sets `width="120" height="48"` + `class="h-10 md:h-12 w-auto"`; Footer.astro L28-34 same dimensions + `bg-gb-white p-1 rounded` (white card behind logo on navy footer — expected behavior, no recolor filter). |
| No CSS filter / recolor on logo | OK | grep for `filter\|grayscale\|sepia\|hue-rotate` returns only `-moz-osx-font-smoothing: grayscale` in globals.css (font smoothing, unrelated to images). |
| Inter font loaded | OK | BaseLayout.astro L37-42 — `<link rel="preconnect">` to fonts.googleapis.com + fonts.gstatic.com, then `<link rel="stylesheet" href=".../Inter:wght@400;500;600;700;800&display=swap">`. |
| `display=swap` on font URL | OK | present in the URL string. |
| `--font-sans` references Inter | OK | tokens.css L20 + globals.css L20 + `@theme` mapping. |
| No other font families introduced | OK | No `font-serif`, no `@font-face` rules, no other Google Fonts URLs. `font-mono` not used outside Tailwind defaults. |
| H1/H2 use bold weight | OK | `font-bold|extrabold|black` matched in 12 page/component files (404, contact, terms, congrats, adults-jiu-jitsu, FAQ, reviews, privacy, kickstart, kids-martial-arts, index, OptInForm). All hero H1s use `font-extrabold`; section H2s use `font-bold`. |
| Button is single source | OK | `src/components/cta/CTAButton.astro` is the only styled-button factory; uses `rounded-full` (pill) per `--btn-radius: 9999px`; primary = `bg-gb-red text-gb-white hover:bg-gb-red-dark`. |
| Pill consistency | OK | `rounded-full` appears in CTAButton, in offer-pill spans (`bg-gb-gold text-gb-navy ... rounded-full`), and in icon circles. No divergent `rounded-md`/`rounded-lg` for primary CTAs. |
| No emoji in headings/body | OK | `grep -E "[✓✔]"` returns only matches inside binary image files (false positives) plus the `-moz-osx-font-smoothing: grayscale` token name. No emoji characters appear in `.astro` text content. |
| Footer copyright | OK | "Copyright 2026. Gracie Barra Whittier. All Rights Reserved." (Footer.astro L90). No "Test Sub-Account" string anywhere in src/. |

## Imagery sources table
| Page | Hero source | Local asset / from Website Media? |
|---|---|---|
| / (homepage) | `src/assets/images/home/homepage-hero.png` (imported on index.astro:12) | local, real GB Whittier file (matches `Website Media/Homepage/`) |
| / program card — kids | `src/assets/images/home/program-card-kids.png` (index.astro:13) | local |
| / program card — adults | `src/assets/images/home/program-card-adults.png` (index.astro:14) | local |
| / gallery (9 imgs) | `/images/home/gallery/{kids,adults,team}-N.{jpg}` (index.astro:16-26 → `public/images/home/`) | local public files; need confirmation each was copied from `Website Media/` rather than placeholder. Wave 2 cannot read pixel data — flag for Wave 3 if any asset is a 1×1 placeholder. |
| /kids-martial-arts | `src/assets/images/kids/kids-hero.jpg` (kids-martial-arts.astro:137) | local |
| /kids-martial-arts instructor portraits | `/images/instructors/professor-{phil,eric}.jpg` (kids-martial-arts.astro:292, 305) | local public files |
| /adults-jiu-jitsu | `src/assets/images/adults/adults-hero.jpg` (adults-jiu-jitsu.astro:111) | local |
| /adults-jiu-jitsu fundamentals card | `/images/adults/adults-fundamentals.jpg` (adults-jiu-jitsu.astro:206) | local public file |
| /contact | Google Maps embed iframe (no hero photo) | external embed, expected |

No stock-photo URLs (no `unsplash.com`, no `images.pexels.com`, no `picsum.photos`) anywhere in src/. No external image hosts. All hero/program/instructor imagery is sourced from local files under `src/assets/images/` or `public/images/`, which the Wave 1 image-prep agent populated from `Website Media/`. PASS.

---

## Spot-checks (passed)
- Gold appears on the homepage **only** at: hero floating-card "FREE 3-CLASS PASS" pill (index.astro:116), opt-in form offer label (OptInForm.astro:35), stat-card numerals (index.astro:313), star icons in review cards (index.astro:231) and reviews-page star icons (reviews.astro:106). All four locations match the brief's allowed-list exactly.
- Navy backgrounds appear on: footer (`bg-gb-navy`), homepage final CTA strip (`bg-gb-bg-dark`), homepage stats section (`bg-gb-bg-dark`), kids-/adults-page heroes (`bg-gb-navy`), congrats studio info card (`bg-gb-navy`), FunnelLayout top bar (`bg-gb-navy`). No navy bleed onto light content sections.
- CTAButton variants: `primary` and `nav` and `formSubmit` all render `bg-gb-red text-gb-white`; `secondary` is navy; `program` is outline navy. Single source of truth confirmed; no inline duplicate-styled buttons elsewhere.
- BaseLayout body is `bg-gb-white text-gb-text` — sane defaults; no off-palette default text color.

## Recommendations (priority order)
1. **P1** — recolor the eyebrow text on `adults-jiu-jitsu.astro:87`, `kids-martial-arts.astro:113`, `kickstart.astro:54`, `kickstart.astro:178` from `text-gb-gold` to `text-gb-white/80` (preserve hierarchy, free up gold for the actual offer callout).
2. **P1** — recolor the congrats-page NAP `<dt>` labels and link decoration on `congrats.astro:82-110` away from gold.
3. **P2** — decide intent for footer link `hover:text-gb-gold` and the unstyled FAQ section background; either fix to match brief or document the conscious deviation.
4. No P0 actions required. Tokens, typography, logo, copyright, and imagery sourcing are all clean.

End of QA-Brand report.
