# Phase 1 — Offer + Global Polish (Design Spec)

**Date:** 2026-05-06
**Source brief:** `GB_Whittier_Website_Build_Brief (1).docx` (client-supplied, May 2026)
**Phase:** 1 of 4 in the Brief Implementation roadmap (offer alignment → program pages → aux pages → SEO/tracking)

## Context

The client brief supersedes the GHL preview the homepage was last aligned to. Two visible mismatches exist on production today:

1. The offer is rendered as "Free First Class" / "Get My Free Class" — both are explicitly on the brief's never-use list.
2. Hero `<h1>` is `sr-only`, with the visible motivational line in a `<p aria-hidden>`. Brief requires a real, visible, keyword-rich H1.

Phase 1 fixes the offer alignment, CTA standardization, hero H1 semantics, FAQ expansion, and footer copy across the entire site without restructuring page content. Subsequent phases handle full content rewrites for program pages (Phase 2), auxiliary pages (Phase 3), and SEO/tracking infrastructure (Phase 4).

The client confirmed the current homepage's bento-card design language (card-on-gray sections, navy FAQ band, red rounded-pill buttons) is the canonical visual style — Phase 1 makes no layout changes, only copy/label/semantic edits.

Form and calendar embeds called for in the brief are intentionally skipped: the existing webhook integrations (`PUBLIC_GHL_WEBHOOK_URL`, `GHL_APPOINTMENT_WEBHOOK_URL`) and the custom booking calendar at `/kickstart` already satisfy that need.

## Goals

- Every visible mention of the offer reads "Free 3-Class Pass" (with "Free uniform rental included" addendum where appropriate)
- Every CTA label on every existing page matches the brief's allowed set
- Homepage `<h1>` is the keyword-rich phrase; the motivational display heading is `<h2>`
- Homepage FAQ has 8 brief-specified items; FAQPage JSON-LD emits all 8
- Footer reflects "Gracie Barra Whittier" branding, lists service areas, and includes the brief's About paragraph for AI-search indexing

## Non-goals

- Full content rewrites for `/kids-martial-arts`, `/adults-jiu-jitsu`, `/reviews`, `/contact` — only CTA relabels (Phase 2/3)
- New schema beyond what FAQ expansion produces (Phase 4)
- GA4/GTM event wiring (Phase 4)
- Sitemap, `robots.txt`, canonical audit (Phase 4)
- AI chat widget integration (out of scope for this roadmap)
- Form/calendar embed swaps — webhook integration is the current contract

## Files touched

| File | Change type |
|---|---|
| `src/pages/index.astro` | Offer copy, CTA labels, hero H1/H2 semantics, hero card addendum |
| `src/pages/kids-martial-arts.astro` | CTA labels only |
| `src/pages/adults-jiu-jitsu.astro` | CTA labels only |
| `src/pages/reviews.astro` | CTA labels only |
| `src/pages/contact.astro` | CTA labels only |
| `src/pages/kickstart.astro` | Title copy ("Free 3-Class Pass Is Reserved") |
| `src/components/form/OptInForm.astro` | Default prop values; render "Free uniform rental included" addendum in split layout |
| `src/components/footer/Footer.astro` | Copyright, service-area line, About paragraph |
| `src/content/faqs.ts` | Restore 4 expansion items appended to existing 4 (total 8) |
| `src/components/booking/BookingSuccess.astro` | Grep for banned strings; relabel any matches. No structural changes. |

Approximate diff size: 10 files, label/string-level edits. No new components, no new dependencies, no API changes.

## Copy contract

The single source of truth for Phase 1 strings. Phase 2/3 inherits these.

### Offer & supporting strings

| Slot | Value |
|---|---|
| Offer (full) | `Free 3-Class Pass` |
| Offer label (badge / pill) | `FREE 3-CLASS PASS` |
| Offer addendum | `Free uniform rental included` |
| Risk line | `No Risk. No Pressure. Free Uniform Rental Included.` |
| Trust line | `Takes 30 seconds • No payment required • No contracts` |

### CTA standards

| Where | Label | Href |
|---|---|---|
| Hero primary | `Claim My Free 3-Class Pass` | `#trial` |
| Hero card primary | `Claim My Free 3-Class Pass` | `#trial` |
| Form submit button | `CLAIM MY FREE 3-CLASS PASS` | (form submit) |
| Mid-page conversion (after Real Stories, Why GB Whittier, Gallery) | `Start My Free Trial` | `#trial` |
| Program cards (Kids / Adults) | `Learn More` | `/kids-martial-arts`, `/adults-jiu-jitsu` |
| Nav top-right (already correct) | `Get Started Free` | `/#trial` |
| All CTAs on Kids/Adults/Reviews/Contact pages | `Claim My Free 3-Class Pass` (primary intent) or `Start My Free Trial` (secondary intent), no other labels permitted | `/#trial` |
| Banned (replace on sight) | `Get My Free Class`, `Get Started` (standalone — `Get Started Free` is the allowed nav label), `Submit` (as a button label), `Click Here`, `Free First Class`, `Free Class` (standalone, when referring to the offer) | — |

### Homepage hero copy

| Slot | Value | HTML tag |
|---|---|---|
| SEO label (gold-styled tag above H1) | `Brazilian Jiu-Jitsu Classes in Whittier, CA for Kids and Adults` | `<p>` |
| H1 (visible) | `Brazilian Jiu-Jitsu Classes in Whittier, CA` | `<h1>` |
| Display heading | `Build Confidence. Learn Real Self-Defense.` | `<h2>` |
| Subheadline | (current value retained) | `<p>` |

The H1 renders as a small, semibold label-style heading immediately above the larger H2 display line. Visually subordinate to the display H2 but textually the dominant SEO signal. This matches the brief: "Most visitors won't notice the difference — the display heading is what they read."

### Homepage hero card

```
Try Our Academy In
Whittier, CA
13595 Whittier Blvd. #104
Whittier, CA 90605
(562) 640-1400
[FREE 3-CLASS PASS — gold/red badge]
Free uniform rental included
[Claim My Free 3-Class Pass — primary button, full-width]
```

### Opt-in form (homepage, split layout)

| Slot | Value |
|---|---|
| Header | `UNLOCK YOUR FREE 3-CLASS PASS` |
| Subheader | `+ VIEW OUR FULL CLASS SCHEDULE INSTANTLY` |
| Offer label (large red display) | `FREE 3-CLASS PASS` |
| Risk line | `No Risk. No Pressure. Free Uniform Rental Included.` |
| Description | `Enter your info below to claim your Free 3-Class Pass and access our full class schedule.` |
| Submit | `CLAIM MY FREE 3-CLASS PASS` |
| Trust line | `Takes 30 seconds • No payment required • No contracts` |
| Disclaimer | (unchanged — legal text retained verbatim) |

### Kickstart page header

| Slot | Value |
|---|---|
| Title | `You're In, [First Name]! Your Free 3-Class Pass Is Reserved.` |
| Subtitle | `One last step — book your first class below. Choose the program that matches your (or your child's) age and pick a time that works for you.` |

`[First Name]` is interpolated from existing query-string handling on the kickstart page; no new state plumbing.

### FAQ — 8 items (homepageFaqs)

The brief says "keep existing 4". When the brief was authored, items 1–4 had longer SEO-rich answers; a recent commit shortened them to terse GHL-preview wording. Phase 1 restores the richer versions because (a) they align with brief Goal 3 (AI/SEO indexing — "answer questions directly… include specific factual details"), (b) the brief's structure assumes the existing answers are already strong.

Items 1–4 (restored richer answers — no per-question structural change):

1. **What Makes Gracie Barra Whittier Different?** — "Gracie Barra Whittier is part of the global Gracie Barra network — the most respected name in Brazilian Jiu-Jitsu. Every instructor is certified through the official GB curriculum, and every program is structured to grow students from total beginner to confident practitioner. Our academy at 13595 Whittier Blvd. #104 serves families across Whittier, La Habra, La Mirada, and Pico Rivera with age-specific classes for kids and adults."
2. **Is jiu-jitsu safe for beginners?** — "Yes. Brazilian Jiu-Jitsu is one of the safest grappling-based martial arts because there is no striking. Our Fundamentals classes introduce every technique slowly and with control, and our beginner-focused environment means you train with people at your level. Injuries are rare in a well-supervised academy like ours."
3. **What should I expect in my first class?** — "Arrive 10 minutes early, meet your instructor, and get fitted for a free uniform rental. Class begins with a warm-up, then technique instruction, then partner practice. After class, you sit down with our Program Director Alex for a brief enrollment meeting — no pressure, no commitment. You set the pace."
4. **Do you offer programs for both kids & adults?** — "Yes. We offer Tiny Champions (ages 3-4), Little Champions (ages 5-9), Juniors Jiu-Jitsu (ages 10-15), and Adults Brazilian Jiu-Jitsu (ages 16+). Every program is age-appropriate, taught by certified Gracie Barra instructors, and built around the same world-class curriculum used at GB academies worldwide."

Items 5–8 appended (verbatim from brief Part 2 Section 10):

5. **How much do classes cost at Gracie Barra Whittier?** — "The best way to get accurate pricing is to speak with our Program Director Alex after your free trial. Monthly memberships typically start at $160/month depending on the program and training frequency. We also offer enrollment specials for families. Your first 3 classes are completely free."
6. **What age groups do you offer classes for?** — "We offer programs for all ages. Tiny Champions (ages 3-4), Little Champions (ages 5-9), Juniors Jiu-Jitsu (ages 10-15), and Adults Brazilian Jiu-Jitsu (ages 16+). Every class is age-appropriate and taught by certified Gracie Barra instructors."
7. **Do I need any experience to start?** — "Zero experience required. Our programs are specifically designed for beginners. Every black belt at Gracie Barra Whittier started exactly where you are. Just show up — we take care of everything else."
8. **Where is Gracie Barra Whittier located?** — "We're located at 13595 Whittier Blvd. #104, Whittier, CA 90605. We're easily accessible from Whittier, La Habra, La Mirada, and Pico Rivera. Call us at (562) 640-1400 or email info@gbwhittier.com."

Both the inline navy-band FAQ on `index.astro` and the existing `<SchemaFAQ items={homepageFaqs}>` JSON-LD render automatically from the array — no template changes required.

### Footer

Three additions, structured top-to-bottom under the existing nav columns:

1. **About paragraph** (small muted text, max-width ~3xl, top border separating from nav):
   > Gracie Barra Whittier is a certified Brazilian Jiu-Jitsu academy located at 13595 Whittier Blvd. #104, Whittier, CA 90605. Part of the global Gracie Barra network, the academy offers age-specific BJJ programs for kids (ages 3–15) and adults (16+). Led by Professor Eric and Professor Phil, GB Whittier serves families throughout Whittier, La Habra, La Mirada, and Pico Rivera with a free 3-class trial pass and no contracts.

2. **Service-area line** (small, muted, immediately above copyright):
   > Proudly serving Whittier, La Habra, La Mirada, and Pico Rivera, CA

3. **Copyright fix:**
   - Before: `Copyright 2026. Test Sub-Account. All Rights Reserved.`
   - After: `Copyright 2026. Gracie Barra Whittier. All Rights Reserved.`

## Brief-alignment audit (subagent)

After implementation completes, an audit subagent runs as the gating step before declaring Phase 1 done. The audit's job: verify the deployed site matches the client brief, item-by-item.

**Trigger:** at the end of Phase 1 implementation, before final user sign-off.

**Subagent type:** `general-purpose` (or `superpowers:code-reviewer` if the task framing fits — this is content/copy alignment, not code quality, so general-purpose is preferred).

**Inputs the agent receives:**
- Path to the brief: `C:\Users\herna\Downloads\GB_Whittier_Website_Build_Brief (1).docx` (or its extracted text at `C:\Users\herna\AppData\Local\Temp\gb_brief.txt`)
- Path to this spec: `docs/superpowers/specs/2026-05-06-phase1-offer-global-polish-design.md`
- Working directory: project root
- Phase scope: "Phase 1 only — offer copy, CTA labels, hero H1 semantics, FAQ expansion, footer additions"

**Agent task contract:**
1. Parse the brief and extract every Phase-1-relevant requirement into a flat checklist (one row per requirement). Group by area (offer copy / CTAs / hero / FAQ / footer).
2. Scan the codebase (`src/pages`, `src/components`, `src/content`) and inspect a Vercel preview URL's rendered HTML.
3. For each checklist row, report **PASS / FAIL / N/A** with: file path + line number for code findings, or rendered string snippet for HTML findings.
4. Run the banned-string grep from this spec's acceptance criteria; report any hits.
5. Verify FAQPage JSON-LD emits all 8 items (parse view-source on `/`).
6. Output a single Markdown report to stdout with sections: **Summary** (counts), **Failures** (must-fix list), **Warnings** (review list), **Passes** (collapsed by default).

**Pass criteria:** zero FAIL items. Warnings are reviewed by the user and either fixed or explicitly waived in writing.

**Out-of-scope for this audit:** Phase 2/3/4 brief items (Kids/Adults/Reviews/Contact rewrites, SEO infra, GA4). The agent must not flag a Kids-page section being missing as a Phase 1 failure — only Phase 1 deliverables are in its scope.

## Acceptance criteria

**Manual visual checks (Vercel preview deploy):**

- Homepage view-source shows literal `<h1>Brazilian Jiu-Jitsu Classes in Whittier, CA</h1>`; display heading is `<h2>`.
- Hero card shows the `FREE 3-CLASS PASS` badge, the "Free uniform rental included" line, and a `Claim My Free 3-Class Pass` button.
- Opt-in form headers/labels/submit text exactly match the Copy Contract.
- Homepage FAQ shows 8 expandable items in the navy band.
- Footer shows the About paragraph, the service-area line, and "Gracie Barra Whittier" copyright (no "Test Sub-Account").
- Kids, Adults, Reviews, Contact, Kickstart pages: every CTA reads `Claim My Free 3-Class Pass`, `Start My Free Trial`, `Learn More`, or `Get Started Free`. No exceptions.
- Kickstart title reads `You're In, [name]! Your Free 3-Class Pass Is Reserved.`

**Grep checks (must return zero matches in `src/pages/**` and `src/components/**`):**

- `Get My Free Class`
- `Free First Class`
- `Click Here`
- `Test Sub-Account`
- `>Submit<` and `label="Submit"` (literal `Submit` button labels — search-tagged)
- `Get Started` standalone — match `Get Started` NOT followed by ` Free`

**Automated:**
- `npx astro check` → 0 errors, 0 warnings
- `npm run build` → completes without warnings about missing assets/components
- View-source on `/` shows FAQPage JSON-LD with all 8 question/answer pairs

**Regression non-goals (these must continue to work):**
- `/api/book` POST flow returns `{ ok: true, appointmentId }` for a valid payload
- `/api/availability` returns slots for a known program/date range
- Opt-in form submission still POSTs to `PUBLIC_GHL_WEBHOOK_URL` and redirects to `/kickstart`
- Booking webhook (`GHL_APPOINTMENT_WEBHOOK_URL`) still fires fire-and-forget on successful booking

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hidden offer-copy reference outside `src/pages` and `src/components` | Low | Low | Grep covers both directories; `src/content` and `src/lib` reviewed during edits |
| Breaking the OptInForm `<script>` selector by restructuring markup | Low | High (form stops submitting) | Touch only header/label nodes — preserve `[data-optin-form]`, `[data-optin-error]`, and `name="name"/"email"/"phone"` attributes verbatim |
| FAQ JSON-LD schema regression after expanding to 8 | Low | Medium | `<SchemaFAQ items={homepageFaqs}>` consumes the array unchanged; verify view-source post-deploy |
| Phase 2 conflicts because Kids/Adults page CTAs were already updated | Low | Low | Phase 2 will rewrite copy/structure but inherit Phase 1's CTA labels — no conflict, just more changes layered on |

## Out of scope (explicit deferral list — Phase 2/3/4)

- Page-content restructure for Kids, Adults, Reviews, Contact (Phase 2 / 3)
- LocalBusiness, BreadcrumbList JSON-LD on interior pages (Phase 4)
- Per-page meta title/description audit (Phase 4)
- `robots.txt` blocking `/kickstart`, `/congrats` (Phase 4)
- `sitemap.xml` audit (Phase 4)
- GA4 events: `generate_lead`, `booking_initiated`, `booking_complete` via GTM (Phase 4)
- `/congrats` page build (separate phase; brief notes "build later")
- AI chat widget GHL integration (separate, integration-driven)

## Roll-out

This phase ships as a single PR / deploy. No feature flag — copy/label changes are intentional and immediately visible. Sequence:

1. Implement edits per the file inventory.
2. `npx astro check` and `npm run build` locally.
3. `vercel deploy` (preview).
4. Run the manual checklist against the preview URL.
5. **Spawn the brief-alignment audit subagent.** Resolve every FAIL it reports. Repeat until clean.
6. `vercel deploy --prod` — promote to production.
7. Final visual smoke-check on production.
8. Phase 2 brainstorm starts only after Phase 1 is live and the audit reports zero failures.
