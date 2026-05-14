# Gracie Barra Whittier â€” Launch Checklist

This checklist captures every action the site owner must take before and after pushing the Astro build to a host. The codebase is launch-ready as of this commit; no further developer changes are required to ship.

---

## Pre-deploy: env vars to set in your hosting platform

All env vars are read at build time via `import.meta.env`. They must be set in the build environment of the host (Netlify / Vercel / Cloudflare Pages / etc.) before kicking off the production build.

| Var | Where to get it | Notes |
|---|---|---|
| `PUBLIC_GHL_WEBHOOK_URL` | GHL â†’ Pipeline 1 â†’ Workflow trigger â†’ webhook URL | Homepage opt-in form posts here. If unset, form falls back to `/api/leads-stub` (will not reach GHL). |
| `PUBLIC_GTM_ID` | GTM container settings, format `GTM-XXXXX` | Loads tracking script in `<head>` via `BaseLayout`. |
| `PUBLIC_GA4_ID` | GA4 property â†’ data stream â†’ measurement ID `G-XXXXX` | Pageview events. |
| `PUBLIC_GHL_CHAT_KEY` | GHL Conversations â†’ widget embed code â†’ embed key | AI chat widget on every public page. |
| `PUBLIC_REVIEWS_EMBED_ID` | LocalCraze reviews widget config | Reviews widget on `/` and `/reviews/`. |

---

## Pre-deploy: assets and copy to confirm

- [ ] Confirm logo at `public/logo/gb-whittier-logo.png` is the latest brand asset (also used as default OG image).
- [ ] Confirm `public/favicon.svg` is final (current is the placeholder Astro favicon).
- [ ] Studio class schedule on `/contact/` â€” currently sourced from `Website Media/Schedule-2.pdf`. Verify the schedule on the page matches what the studio is currently running.
- [ ] Confirm GHL calendar IDs in `src/pages/kickstart.astro` (top of file, `calendars` array) match the current GHL calendar setup for each program (Tiny Champions, LC1, LC2, Juniors, Adults).
- [ ] SMS-consent disclaimer in `src/components/form/OptInForm.astro` (lines ~119-124) is currently placeholder text. Swap in verbatim disclaimer per business / legal requirements before launch.
- [ ] Reviews / Contact pages currently lack on-page photography (only logo + map). Add real GB Whittier photos to `public/images/` and reference in JSX when available â€” see `docs/images-needed.md`.

---

## Build & deploy

```bash
npm install
npm run build
# Output: dist/  â†’  upload to Netlify, Vercel, Cloudflare Pages, or any static host
```

Build produces 10 pages plus sitemap-index.xml and sitemap-0.xml. `/kickstart/` and `/congrats/` ship `noindex,nofollow` and are excluded from the sitemap.

---

## Post-deploy verification

1. Submit the homepage opt-in form with a real test email; confirm a lead appears in GHL Pipeline 1 and the browser redirects to `/kickstart?name=...`.
2. On `/kickstart/`, complete the survey for each age range; confirm the correct GHL calendar iframe loads. Walk through a test booking through to `/congrats/`.
3. Run a Lighthouse mobile audit on `/`; targets â€” Performance â‰¥90, Accessibility â‰¥95, Best Practices â‰¥95, SEO â‰¥100.
4. Submit `https://www.graciebarrawhittier.com/sitemap-index.xml` to Google Search Console; confirm ingestion (it should list 8 public pages and exclude `/kickstart/` and `/congrats/`).
5. Visit any public page; confirm AI chat bubble loads in bottom-right (requires `PUBLIC_GHL_CHAT_KEY`).
6. Visit `/` and `/reviews/`; confirm the LocalCraze reviews widget renders in place of the "Reviews loading..." placeholder (requires `PUBLIC_REVIEWS_EMBED_ID`).
7. Spot-check NAP on every public page footer: phone is `(562) 640-1400` and address is `13595 Whittier Blvd. #104`.
8. View-source on any public page; confirm a single `<script type="application/ld+json">` block with valid `LocalBusiness` schema. (`/contact/` also includes `BreadcrumbList`.)

---

## Wave-3 Finalizer divergences from the QA aggregate

Only one minor divergence:

- **Fix #6 on `/kickstart/` eyebrows.** Aggregate prescribed `text-gb-gold` â†’ `text-gb-white/80`. The `/kickstart/` page uses `FunnelLayout`, which has a white body background, so `text-gb-white/80` would be invisible on white. Applied the spirit of the fix (remove gold misuse on a category descriptor) by recoloring those two eyebrows to `text-gb-text-muted` instead. Kids-martial-arts and adults-jiu-jitsu hero eyebrows do sit on `bg-gb-navy` and were correctly switched to `text-gb-white/80`.

No other deviations. All 9 P1 and 11 P2 fixes from the aggregate are applied.

---

## Known deferred items (track for v2)

These were flagged in the QA wave and intentionally deferred per the aggregate. They are non-blocking for launch.

- **Reviews + Contact pages lack non-logo on-page imagery** â€” needs real studio photography, an asset / Wave-1 deliverable.
- **FAQ section background â€” light vs navy** â€” brief lists FAQ as a "navy / dark surface", but visual readability of the current light section is acceptable. Design-lead call post-launch.
- **Homepage program-card heading order** â€” informational only, no fix required.
- **Homepage H1 visual rank vs H2** â€” H2 ("Build Confidence. Learn Real Self-Defense.") is the visible hero copy per brief intent; H1 sits as a smaller statement above. Owner-call.
- **`sitemap.xml` `<lastmod>`** â€” modern Google ignores changefreq/priority; nice-to-have.
- **Alt-text location-keyword polish** â€” already passing; no fix required.
- **Inter font weight 500 dropping** â€” micro-perf; Google Fonts CSS is cached for return visitors.
- **Calendar iframe min-height responsive ramp** â€” acceptable third-party widget tradeoff.
- **Hero phone-link tap height** â€” sits next to a 56 px CTA; low fat-finger risk.
- **OptInForm SMS-consent placeholder text** â€” owner item to fill in before launch (see Pre-deploy checklist above).
- **Broader footer site-link tap heights** â€” borderline; #10 already addresses footer phone/email tap heights.
- **`/kickstart/` `<title>` is 73 chars** â€” page is `noindex,nofollow`, so SERP truncation does not apply. Optional future polish.
