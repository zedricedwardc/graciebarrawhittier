# QA-Mobile-UX Report

Wave 2 read-only audit. Source paths absolute; line numbers reference current `src/` tree.

## Build Status

`npm run build` PASSED. 10 pages generated in 2.14 s. Asset sizes (HTML only):

| Page | HTML | CSS | Notes |
|---|---|---|---|
| `/` | 54 KB | 33 KB shared | hero LCP image `loading="eager"`, GTM gated by env |
| `/kids-martial-arts/` | 35 KB | shared | hero eager, all other imgs lazy |
| `/adults-jiu-jitsu/` | 31 KB | shared | hero eager, all other imgs lazy |
| `/reviews/` | 27 KB | shared | widget mount only, no images |
| `/contact/` | 20 KB | shared | Maps iframe lazy |
| `/kickstart/` | 15 KB | shared | FunnelLayout (no nav/footer/sticky) |
| `/privacy/` | 15 KB | shared | sticky CTA suppressed |
| `/terms/` | 14 KB | shared | sticky CTA suppressed |
| `/404.html` | 11 KB | shared | sticky CTA renders (BaseLayout default) |
| `/congrats/` |  6 KB | shared | FunnelLayout |

All under the 150 KB budget. Single CSS bundle (`globals.DhnY879L.css`, 33 KB). No JS bundle — only inline `type="module"` scripts (deferred by spec) and `application/ld+json` (non-executing).

## Summary

Total issues: **9** (P0: 0, P1: 4, P2: 5)

No P0 blockers. The site is functional on mobile: forms submit, sticky CTA targets the right pages, layouts don't horizontally overflow, all inputs have labels + autocomplete + inputmode. Issues below are tap-target tightening and minor polish.

---

## P1 Issues

### Issue 1: Nav-variant CTA is 40 px tall — under WCAG 48 px tap target
- File: `src/components/cta/CTAButton.astro:48`
- Pages affected: every public page (desktop nav "Get Started Free" button)
- Found: `const sizeClasses = isNav ? 'h-10 text-sm' : 'h-14 md:h-12 text-base';` produces 40 px height for the `nav` variant. Token `--btn-h-nav: 40px` documents the choice but it is below Apple HIG (44 px) and Material/WCAG (48 px) minima.
- Expected: ≥ 44 px. The button only renders on `md:` and up, where mouse pointing is the dominant input — but tablets in landscape (`md` ≥ 768 px) include touch devices.
- Fix: bump `nav` variant to `h-11` (44 px) or `h-12` (48 px). Also update token `--btn-h-nav` to match. Acceptable trade-off: the nav bar is `h-16 md:h-20` (64/80 px), so a 44–48 px button fits without layout impact.

### Issue 2: Mobile drawer hamburger + close buttons are 40 × 40 px
- File: `src/components/nav/MobileNavDrawer.astro:24` (open) and `:53` (close)
- Pages affected: every public page on viewports < 768 px (the only place the hamburger ever shows)
- Found: `class="inline-flex items-center justify-center w-10 h-10 rounded-md ..."` — explicit 40 × 40 px tap region for the primary mobile-nav trigger.
- Expected: ≥ 48 × 48 px.
- Fix: change `w-10 h-10` → `w-12 h-12` on both buttons; SVG inside (`w-6 h-6`) stays the same.

### Issue 3: Footer phone + email links have no explicit tap height
- File: `src/components/footer/Footer.astro:48` and `:53`
- Pages affected: every public page (footer)
- Found: links wrapped in a `<div>` inside `<address class="... space-y-1">`. No padding, no `min-h-[…]`. With `text-sm` (14 px) line-height ≈ 20 px and only 4 px gap between rows, the phone/email tap regions are ~20 px tall and adjacent — fat-finger collision risk.
- Expected: ≥ 44 px tap height per link, ≥ 8 px gap between adjacent tappable elements.
- Fix: add `inline-block py-2` to each `<a>` (or `min-h-[44px] inline-flex items-center`); change `space-y-1` → `space-y-2` on the `<address>` element. The contact page already uses this pattern at `src/pages/contact.astro:95,103` (`min-h-[48px] py-3`) — apply the same here.

### Issue 4: Mobile drawer link list uses `space-y-1` (4 px gap)
- File: `src/components/nav/MobileNavDrawer.astro:66`
- Pages affected: mobile drawer on every public page
- Found: `<ul class="flex-1 overflow-y-auto px-4 py-6 space-y-1">`. Each `<a>` has `block px-3 py-3` so individual tap heights are ~48 px (good), but adjacent links sit only 4 px apart — below the 8 px minimum gap recommended for adjacent touch targets, especially relevant in a vertical menu where mis-taps drop the user on the wrong page.
- Expected: ≥ 8 px between adjacent tappable rows.
- Fix: change `space-y-1` → `space-y-2`.

---

## P2 Issues

### Issue 5: Homepage hero subhead may be oversized on 375 px viewports
- File: `src/pages/index.astro:78`
- Pages affected: `/`
- Found: `text-4xl md:text-6xl` — 36 px on mobile. The line "Learn Real Self-Defense." is 21 chars at 36 px ≈ 340 px and competes for the 343 px content area inside `px-4` on a 375 px-wide phone (iPhone SE / 13 mini territory).
- Expected: comfortable wrap at 375 px without near-edge overflow risk.
- Fix: `text-3xl md:text-6xl` or `text-3xl sm:text-4xl md:text-6xl` for a smoother ramp. Other pages (`/contact`, `/reviews`, `/kickstart`) already use the safer `text-3xl md:text-5xl` pattern.

### Issue 6: FAQ `<summary>` has no visible focus ring
- File: `src/components/faq/FAQItem.astro:18`
- Pages affected: `/`, `/adults-jiu-jitsu`, `/kids-martial-arts` (every page using `<FAQ />`)
- Found: `<summary class="flex items-center justify-between cursor-pointer list-none text-base md:text-lg font-semibold text-gb-text">` — no `focus-visible:` utility. Browsers vary on the default outline once `list-none` is applied.
- Expected: visible focus ring for keyboard users.
- Fix: add `focus:outline-none focus-visible:ring-2 focus-visible:ring-gb-navy focus-visible:rounded` to the summary.

### Issue 7: `text-base` mobile-nav link rows aren't pressed-state-distinguished
- File: `src/components/nav/MobileNavDrawer.astro:71-72`
- Pages affected: mobile drawer
- Found: links use `hover:bg-gb-bg-light hover:text-gb-red` but no `active:` or `focus-visible:` state. On touch, `:hover` is unreliable.
- Expected: `active:bg-gb-bg-light` for press feedback and a `focus-visible:` ring.
- Fix: add `active:bg-gb-bg-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gb-navy`.

### Issue 8: Inter loaded via stylesheet without `media`/`preload` hint
- File: `src/layouts/BaseLayout.astro:39-42` (and same in `FunnelLayout.astro:31-34`)
- Pages affected: all
- Found: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />`. `display=swap` is set (good — flag passed), but the font CSS is render-blocking. Five weights = larger CSS payload than needed.
- Expected: only ship weights actually used (audit shows 400/600/700/800 are used; 500 may not be); consider `<link rel="preload" as="style" onload="this.rel='stylesheet'">` pattern for non-blocking.
- Fix: drop weight 500 from the URL if unused; optional preload swap. Low impact (Google Fonts CSS is already cached for most return visitors).

### Issue 9: Calendar iframe `min-height: 720px` may force long mobile viewports
- File: `src/pages/kickstart.astro:188`
- Pages affected: `/kickstart`
- Found: inline style `width: 100%; min-height: 720px; border: 0;`. On a 375 × 667 viewport, the iframe is taller than the visible window — fine, but the user has nested scroll context (page scroll vs iframe scroll). The wrapper `rounded-2xl overflow-hidden` does prevent horizontal overflow.
- Expected: workable, but 720 px on the smallest phones means heavy scroll. Acceptable tradeoff for a third-party booking widget.
- Fix: optional — drop to `min-h-[640px] md:min-h-[720px]` to slightly reduce vertical real estate on phones; otherwise leave.

---

## Things checked and passing (no issue)

- All form inputs have `<label for=…>` + `autocomplete` + `inputmode` (`OptInForm.astro:53–98`, `contact.astro:153–211`). Phone uses `tel-national`, email uses `email`.
- Sticky mobile CTA renders on the 6 expected pages (`/`, `/adults-jiu-jitsu`, `/kids-martial-arts`, `/contact`, `/reviews`, `/404`) and is correctly absent from `/kickstart`, `/congrats`, `/privacy`, `/terms` per `BaseLayout.astro:83` (`!hideStickyCTA` + FunnelLayout omits it entirely).
- `md:hidden` on the StickyMobileCTA wrapper (`StickyMobileCTA.astro:10`) — desktop unaffected.
- No render-blocking JS in `<head>`. Every script tag in built HTML is `type="module"` (deferred) or `application/ld+json` (non-executing).
- No `min-w-[…]` fixed-width elements anywhere in `src/`.
- Hero images use Astro `<Image>` with responsive `widths` + `sizes` and `format="webp"` (homepage, kids, adults). Below-fold gallery imgs have `loading="lazy" decoding="async"`.
- Mobile drawer has full-width red CTA at bottom (`MobileNavDrawer.astro:80-87`).
- Color contrast: white on `#CC2200` ≈ 5.83:1 ✓, white on `#1B2A5E` ≈ 13.4:1 ✓. `gb-text-muted` (#5C6470) is only used on white/light backgrounds (`gb-bg-light`, `gb-white`) — passes AA on both.
- Calendar iframe (`kickstart.astro:184-189`) has `loading="lazy"`, `title=…`, `width: 100%`. Container clips overflow.
- Maps iframe (`contact.astro:248-258`) has `title`, `loading="lazy"`, `referrerpolicy`, wrapped in `rounded-2xl overflow-hidden`.
- Skip-to-main-content link present (`BaseLayout.astro:66-71`).
- `<meta name="viewport" content="width=device-width, initial-scale=1">` on every layout.

---

## Page weights table

| Page | HTML size | Top-of-head scripts | Sticky mobile CTA | Issues |
|---|---|---|---|---|
| `/` | 54 KB | 0 blocking (GTM async, JSON-LD, modules) | yes (`md:hidden`) | hero subhead size (P2) |
| `/kids-martial-arts/` | 35 KB | 0 blocking | yes | none page-specific |
| `/adults-jiu-jitsu/` | 31 KB | 0 blocking | yes | none page-specific |
| `/reviews/` | 27 KB | 0 blocking | yes | none page-specific |
| `/contact/` | 20 KB | 0 blocking | yes | none page-specific |
| `/privacy/` | 15 KB | 0 blocking | suppressed ✓ | none |
| `/kickstart/` | 15 KB | 0 blocking | n/a (FunnelLayout) | iframe min-height (P2) |
| `/terms/` | 14 KB | 0 blocking | suppressed ✓ | none |
| `/404.html` | 11 KB | 0 blocking | yes | none |
| `/congrats/` |  6 KB | 0 blocking | n/a (FunnelLayout) | none |

---

## Tap target audit table

| Component | File:line | Class | Computed height | Pass (≥48 px)? |
|---|---|---|---|---|
| CTAButton primary/secondary/program/formSubmit | `cta/CTAButton.astro:48` | `h-14 md:h-12` | 56 px / 48 px | ✓ |
| CTAButton nav | `cta/CTAButton.astro:48` | `h-10 text-sm` | 40 px | ✗ (P1) |
| OptInForm inputs | `form/OptInForm.astro:63,79,95` | `h-12 px-4` | 48 px | ✓ |
| Contact form inputs | `pages/contact.astro:163,179,195` | `h-12 px-4` | 48 px | ✓ |
| Contact form textarea | `pages/contact.astro:208` | `min-h-[120px] py-3` | 120 px | ✓ |
| Mobile-nav hamburger | `nav/MobileNavDrawer.astro:24` | `w-10 h-10` | 40 × 40 px | ✗ (P1) |
| Mobile-nav close | `nav/MobileNavDrawer.astro:53` | `w-10 h-10` | 40 × 40 px | ✗ (P1) |
| Mobile-nav links | `nav/MobileNavDrawer.astro:71-72` | `block px-3 py-3 text-base` | ~48 px | ✓ height (gap fail — see P1 #4) |
| Sticky mobile CTA (primary) | `cta/StickyMobileCTA.astro:13` (CTAButton primary) | `h-14` | 56 px | ✓ |
| Contact page phone link | `pages/contact.astro:95` | `min-h-[48px] py-3` | 48 px | ✓ |
| Contact page email link | `pages/contact.astro:103` | `min-h-[48px] py-3` | 48 px | ✓ |
| Footer phone link | `footer/Footer.astro:48` | (none) | ~20 px | ✗ (P1) |
| Footer email link | `footer/Footer.astro:53` | (none) | ~20 px | ✗ (P1) |
| Footer site links | `footer/Footer.astro:69` | `text-sm`, `space-y-2` parent | ~20 px text + 8 px gap | borderline; not user-critical |
| FAQ `<summary>` | `faq/FAQItem.astro:18` | `py-4 text-base md:text-lg` | ~56 px | ✓ (focus ring missing — P2) |
| Hero phone link | `pages/index.astro:88` | `text-sm` (no min-h) | ~20 px | ✗ (low risk — sits next to a 56 px CTA, not a competing tappable) |

The "Or call (562) 640-1400" link at `src/pages/index.astro:88` deserves the same `inline-block min-h-[48px] py-3` treatment as the contact page for consistency, but it isn't dense neighborhood — flagging at the table level only, not as a separate issue.
