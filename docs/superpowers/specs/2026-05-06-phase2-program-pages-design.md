# Phase 2 â€” Program Pages (Kids + Adults) Design Spec

**Date:** 2026-05-06
**Source brief:** `GB_Whittier_Website_Build_Brief (1).docx` (client-supplied, May 2026), Part 3 (Page-by-Page Copy & Design Guide)
**Phase:** 2 of 4 in the Brief Implementation roadmap (offer alignment âœ… â†’ **program pages** â†’ aux pages â†’ SEO/tracking)
**Predecessor:** [Phase 1 spec](./2026-05-06-phase1-offer-global-polish-design.md) (shipped to production)

## Context

Phase 1 aligned global offer copy + homepage. Phase 2 rebuilds the two highest-conversion-intent interior pages â€” Kids Martial Arts and Adults Jiu-Jitsu â€” to match the client brief Part 3 verbatim. Both pages currently exist with brief-adjacent (not verbatim) copy and use the older edge-to-edge section layout. The user has confirmed the homepage's bento-card design language (cards on light-gray bg, rounded hero card, full-width navy band for FAQ) is canonical and must propagate to these pages.

The brief explicitly requires the opt-in form to be embedded on all program pages (Part 5). Currently neither page embeds the form â€” CTAs link to `#trial-form`, a dead in-page anchor. Phase 2 fixes that by embedding `<OptInForm>` on each page with the same default props as the homepage instance.

The brief also requires `BreadcrumbList` JSON-LD on interior pages (Part 4). Phase 2 adds that to both pages while we're rebuilding them; doing it now avoids a second pass during Phase 4.

Form/calendar embeds called for elsewhere in the brief remain skipped â€” the existing webhook integrations (`PUBLIC_GHL_WEBHOOK_URL`, `GHL_APPOINTMENT_WEBHOOK_URL`, custom booking calendar at `/kickstart`) already satisfy that need.

## Goals

- `src/pages/kids-martial-arts.astro` matches brief Part 3 (Kids page) section-by-section, with brief-verbatim headings, body copy, CTAs, and section ordering
- `src/pages/adults-jiu-jitsu.astro` matches brief Part 3 (Adults page) section-by-section, including the previously-missing FAQ section
- Both pages adopt the homepage's bento-card visual language (light-gray page wrapper, white card sections, rounded hero card, navy FAQ band)
- Both pages have a real visible `<h1>` with the brief's keyword phrase, and the motivational display line tagged `<h2>`
- Both pages embed `<OptInForm>` with the homepage's exact default props (single source of truth â€” no audience-specific copy variants)
- Both pages emit `BreadcrumbList` JSON-LD (Home â†’ Page) and `FAQPage` JSON-LD (4 brief-specified questions per page)
- Page meta `title` and `description` match the brief's per-page SEO targets
- Phase 1's acceptance criteria continue to pass (no regressions to homepage, booking flow, or vitest suite)

## Non-goals

- Reviews page content rewrite (Phase 3)
- Contact page polish (Phase 3)
- Sitemap, `robots.txt`, canonical audit (Phase 4)
- GA4 / GTM event wiring (Phase 4)
- LocalBusiness schema beyond what Phase 1 already ships (Phase 4)
- AI chat widget integration (separate, integration-driven)
- Per-program-page hero image swaps unless existing imagery clearly contradicts brief intent
- Audience-specific OptInForm copy variants (user explicitly directed: "all same opt in")

## Files touched

| File | Change |
|---|---|
| `src/pages/kids-martial-arts.astro` | Full rewrite of all 7 section blocks + visual + H1/H2 + embed OptInForm + BreadcrumbList + meta |
| `src/pages/adults-jiu-jitsu.astro` | Full rewrite of 6 section blocks + add FAQ section + visual + H1/H2 + embed OptInForm + BreadcrumbList + meta |
| `src/content/kids-faqs.ts` | Verify/replace with 4 brief-specified Kids FAQ entries |
| `src/content/adults-faqs.ts` | Verify/replace with 4 brief-specified Adults FAQ entries |
| `src/components/seo/SchemaBreadcrumb.astro` | Existing component â€” verify input shape matches what we'll pass; add minimal use-site documentation if missing |

Approximate diff size: 5 files, ~600 lines of net change (mostly the two page rewrites). No new components, no new dependencies. The existing `SchemaBreadcrumb`, `SchemaFAQ`, `OptInForm`, `CTAButton`, `BaseLayout` components are reused unchanged.

## Visual treatment

Page-level pattern (both Kids and Adults):

- **Outer wrapper inside `<BaseLayout>`:** `<div class="bg-gb-bg-light">` wraps every section EXCEPT the final navy band (Conversion CTA + FAQ), which escapes the wrapper to span full-width.
- **Hero:** Rounded card on the gray bg, exactly like homepage hero. Same gradient overlay over a full-bleed image. Heading stack: SEO label `<p>` + `<h1>` (small visible label-style) + `<h2>` (large display) + subheadline `<p>` + primary CTA.
- **Body sections:** Each section is `class="px-4 md:px-6 py-12 md:py-16"`, with the inner content card `class="max-w-6xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10"` (or grid variant for multi-card sections).
- **Conversion CTA strip:** Full-width navy band (`bg-gb-navy text-gb-white py-14 md:py-20`).
- **FAQ:** Full-width navy band (`bg-gb-navy text-gb-white py-14 md:py-20`), inline `<details>` accordion identical to homepage FAQ block, chevron rotates on `group-open`.

CTAButton labels follow brief Part 3 verbatim (audience-specific variants permitted on these pages â€” overrides Phase 1 spec's strict "no other labels" clause for these two files):

- Kids hero + Kids final CTA: `Claim My Child's Free 3-Class Pass`
- Kids program cards (4 of them): `Claim Free 3-Class Pass`
- Adults hero + Adults final CTA: `Claim My Free 3-Class Pass`
- Mid-page CTAs (none planned for Phase 2 â€” both pages funnel through hero â†’ form/embed â†’ final CTA)

All CTAs `href="#trial"` so they scroll to the embedded `<OptInForm>` instance which carries `id="trial"`.

## Kids page (`src/pages/kids-martial-arts.astro`)

### Meta

```astro
<BaseLayout
  title="Kids Martial Arts in Whittier, CA | Gracie Barra Whittier"
  description="Gracie Barra Whittier offers age-specific kids BJJ programs for ages 3-15. Build confidence, focus, and self-defense skills in a safe, structured environment. Claim your free 3-class pass."
  canonical="https://www.graciebarrawhittier.com/kids-martial-arts"
>
```

### Section structure

1. **Hero (rounded card)**
   - SEO label `<p>`: `Brazilian Jiu-Jitsu for Kids in Whittier, CA`
   - `<h1 class="text-base md:text-lg font-semibold text-gb-white/90 mb-3">`: `Kids Martial Arts Classes in Whittier, CA â€” Ages 3 to 15`
   - `<h2 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold ...">`: `Where Kids Build Confidence, Discipline, and Strength`
   - Subheadline `<p>`: `Age-specific Brazilian Jiu-Jitsu programs designed for every stage of childhood â€” from Tiny Champions (ages 3-4) through Juniors (ages 10-15). Safe, structured, and genuinely fun.`
   - Primary CTA: `Claim My Child's Free 3-Class Pass` â†’ `#trial`
   - Hero image: existing import `kidsHero` from `../assets/images/kids/kids-hero.jpg` (already in the current file)
   - alt text: `Kids Brazilian Jiu-Jitsu class at Gracie Barra Whittier, CA`

2. **Programs Breakdown** â€” `<h2>Age-Specific Programs Built for Your Child`
   - 4 program cards in a `grid sm:grid-cols-2 lg:grid-cols-4` grid
   - Per card: image (existing assets), age-range badge (small red uppercase), program name `<h3>`, 2â€“3 sentence brief-aligned blurb, CTA `Claim Free 3-Class Pass` â†’ `#trial`
   - Card data array (in component frontmatter):
     - **Tiny Champions** â€” Ages 3â€“4 â€” "Movement, coordination, listening skills, following instructions. A fun and safe introduction to the mat."
     - **Little Champions 1** â€” Ages 5â€“6 â€” "Core BJJ fundamentals introduced through age-appropriate drills. Builds discipline, respect, and confidence in a structured team environment."
     - **Little Champions 2** â€” Ages 7â€“9 â€” "Deeper technique focus and partner drills. Continued emphasis on respect, listening, and structured practice."
     - **Juniors Jiu-Jitsu** â€” Ages 10â€“15 â€” "Technique-focused training with real BJJ skills, optional competition preparation, and leadership development."

3. **Benefits for Parents** â€” `<h2>What Parents Tell Us After Their Child Starts Training`
   - 3 testimonial-style cards in `grid md:grid-cols-3` (each white card with red quote-mark icon, blockquote, benefit caption):
     - "My son's teachers started noticing how much more focused he is in class." â†’ caption: `Focus and school performance`
     - "She walks into every room now like she belongs there." â†’ caption: `Confidence`
     - "I feel safe knowing he can protect himself." â†’ caption: `Self-defense and safety`
   - Footnote below grid: `Placeholder quotes pending publication of real parent reviews.`

4. **What to Expect at First Class** â€” `<h2>What Happens at Your Child's First Class`
   - 6-step numbered ordered list in `grid md:grid-cols-2`, each step a card with red number circle:
     1. Arrive 10 minutes early â€” say hi to the front desk and meet your instructor.
     2. Get fitted for your free uniform rental.
     3. Warm up with the group â€” fun, age-appropriate movement.
     4. Learn the first technique with the instructor walking you through every step.
     5. End-of-class reflection â€” what we learned, what's next.
     6. Sit down with Program Director Alex for a brief no-pressure conversation about the trial.
   - Trailing line below the list: `Bring comfortable workout clothes. We provide the uniform for your trial classes.`

5. **Certified Instructors** â€” `<h2>Certified Gracie Barra Instructors â€” Not Just Athletes, But Teachers`
   - Single white-card text block with brief-aligned copy:
   > Every instructor at Gracie Barra Whittier completes the official Gracie Barra certification program before stepping on the mat with your child. The same curriculum is taught at over 1,000 GB academies worldwide. Our lead instructors, Professor Phil and Professor Eric, bring decades of training experience and a teaching-first mindset â€” your child isn't just learning Jiu-Jitsu, they're being mentored.

6. **Embedded OptInForm**
   - Identical to homepage instance:
     ```astro
     <OptInForm
       id="trial"
       header="UNLOCK YOUR FREE 3-CLASS PASS"
       subheader="+ VIEW OUR FULL CLASS SCHEDULE INSTANTLY"
       description="Enter your info below to claim your Free 3-Class Pass and access our full class schedule."
       offerLabel="FREE 3-CLASS PASS"
       riskLine="No Risk. No Pressure. Free Uniform Rental Included."
       submitLabel="CLAIM MY FREE 3-CLASS PASS"
       imageSrc="/images/home/gallery/kids-1.jpg"
       imageAlt="Kids Brazilian Jiu-Jitsu class at Gracie Barra Whittier"
     />
     ```

7. **Conversion CTA strip** â€” full-width navy band â€” `<h2>Ready to Get Your Child Started?`
   - Body: `Try any of our kids programs free for 3 classes â€” no commitment, no contracts, free uniform rental included. Just bring your child and let us take it from there.`
   - CTA: `Claim My Child's Free 3-Class Pass` â†’ `#trial`
   - Trust line below button: `3 free classes â€¢ Free uniform rental â€¢ No contracts â€¢ No pressure`

8. **FAQ** â€” full-width navy band â€” `<h2>Questions About Kids Jiu-Jitsu`
   - Inline `<details>` accordion (identical CSS pattern to homepage FAQ band)
   - Items pulled from `src/content/kids-faqs.ts` (4 items)
   - `<SchemaFAQ items={kidsFaqs} />` emits FAQPage JSON-LD

9. **`<SchemaBreadcrumb>` JSON-LD** â€” emitted in head:
   ```
   [
     { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.graciebarrawhittier.com/" },
     { "@type": "ListItem", "position": 2, "name": "Kids Martial Arts", "item": "https://www.graciebarrawhittier.com/kids-martial-arts" }
   ]
   ```

### Kids FAQ content (`src/content/kids-faqs.ts`)

```ts
export const kidsFaqs: FAQItemData[] = [
  {
    question: 'Is jiu-jitsu safe for young children?',
    answer:
      'Yes. Our Tiny Champions and Little Champions programs are specifically designed for young kids with age-appropriate movement and no unsafe sparring. Every class is supervised, structured, and safety-first.',
  },
  {
    question: 'What if my child is shy or nervous?',
    answer:
      "Very common. Our instructors specialize in working with nervous first-timers, and most shy kids are asking to come back after their first class. Your child sets the pace â€” there is no pressure to do anything they're not ready for.",
  },
  {
    question: 'Will my child get hurt?',
    answer:
      'BJJ at this level is about technique and coordination, not roughness. Our classes are supervised, structured, and safety-first. Injuries are rare in a well-run academy like ours.',
  },
  {
    question: "How do I know which program is right for my child's age?",
    answer:
      "Age determines the program automatically. Just tell us how old your child is and we'll get them into the right class â€” Tiny Champions (3-4), Little Champions 1 (5-6), Little Champions 2 (7-9), or Juniors Jiu-Jitsu (10-15).",
  },
];
```

## Adults page (`src/pages/adults-jiu-jitsu.astro`)

### Meta

```astro
<BaseLayout
  title="Adult BJJ Classes in Whittier, CA | Gracie Barra Whittier"
  description="Train Brazilian Jiu-Jitsu at Gracie Barra Whittier. Beginner-friendly adult BJJ classes in Whittier, CA. Build fitness, self-defense skills, and confidence. Try 3 classes free."
  canonical="https://www.graciebarrawhittier.com/adults-jiu-jitsu"
>
```

### Section structure

1. **Hero (rounded card)**
   - SEO label `<p>`: `Brazilian Jiu-Jitsu for Adults in Whittier, CA`
   - `<h1>`: `Adult Brazilian Jiu-Jitsu Classes in Whittier, CA`
   - `<h2>`: `The Most Effective Martial Art. Beginner-Friendly. Life-Changing.`
   - Subheadline: `Gracie Barra Whittier's adult BJJ program is built for people with zero experience who want real results â€” in fitness, self-defense, and mental toughness. No prior training required.`
   - Primary CTA: `Claim My Free 3-Class Pass` â†’ `#trial`
   - Hero image: existing import `adultsHero` from `../assets/images/adults/adults-hero.jpg` (already in the current file)
   - alt text: `Adult Brazilian Jiu-Jitsu class at Gracie Barra Whittier, CA`

2. **The Case for BJJ** â€” `<h2>Why Adults Choose Brazilian Jiu-Jitsu Over Every Other Martial Art`
   - 4 white benefit cards in `grid sm:grid-cols-2 lg:grid-cols-4`, each with a red icon circle (existing icon SVG style â€” match homepage stat-card icon-circle pattern):
     - **Real self-defense** (shield icon): `BJJ works based on leverage and technique â€” not size or strength. It's why it's the #1 choice for law enforcement and military worldwide.`
     - **Total fitness** (lightning/zap icon): `Cardio, strength, flexibility, coordination â€” all in one hour. You'll be too focused on learning to notice you're working out.`
     - **Mental toughness** (brain icon): `The mat teaches you to stay calm under pressure. That skill shows up everywhere in your life.`
     - **Community** (people icon): `Your training partners become people you trust. The BJJ community at GB Whittier is unlike anything else you'll find.`

3. **Beginner Reassurance** â€” `<h2>You Don't Need Experience. You Need to Show Up.`
   - Single white-card text block:
   > Every black belt at Gracie Barra Whittier was a beginner once â€” and that includes Professor Phil, who leads our adult program. The culture on the mat is welcoming and ego-free. You'll train with people at your level, learn at your pace, and start with the same Fundamentals class every adult does â€” whether they're 18 or 58, fit or starting over. Show up; we take it from there.

4. **What to Expect** â€” `<h2>What Your First Adult BJJ Class Looks Like`
   - 6-step numbered ordered list (same visual pattern as Kids page Section 4):
     1. Arrive 10 minutes early â€” meet your instructor and the front desk team.
     2. Get fitted for your free uniform rental.
     3. Warm up with the class â€” light movement, no surprises.
     4. Fundamentals class â€” the instructor walks you through technique step-by-step.
     5. Practice with a training partner at your level. Slow, controlled, low-pressure.
     6. Debrief with Program Director Alex â€” quick chat about how it went and what's next. No commitment.

5. **Embedded OptInForm**
   - Identical props to homepage / Kids page (single source of truth â€” see Visual Treatment section).

6. **Conversion CTA strip** â€” full-width navy band â€” `<h2>Start Your BJJ Journey This Week`
   - Body: `3 free classes. No experience needed. Free uniform provided. Come see what Brazilian Jiu-Jitsu at Gracie Barra Whittier can do for you.`
   - CTA: `Claim My Free 3-Class Pass` â†’ `#trial`
   - Trust line below button: `3 free classes â€¢ No experience needed â€¢ Free uniform â€¢ No contracts`

7. **FAQ** â€” full-width navy band â€” `<h2>Questions About Adult Jiu-Jitsu`
   - Inline `<details>` accordion (identical to homepage + Kids pattern)
   - Items pulled from `src/content/adults-faqs.ts` (4 items)
   - `<SchemaFAQ items={adultsFaqs} />` emits FAQPage JSON-LD

8. **`<SchemaBreadcrumb>` JSON-LD** â€” head:
   ```
   [
     { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.graciebarrawhittier.com/" },
     { "@type": "ListItem", "position": 2, "name": "Adults Jiu-Jitsu", "item": "https://www.graciebarrawhittier.com/adults-jiu-jitsu" }
   ]
   ```

### Adults FAQ content (`src/content/adults-faqs.ts`)

```ts
export const adultsFaqs: FAQItemData[] = [
  {
    question: 'Am I too old to start BJJ?',
    answer:
      'Many of our best students started training in their 30s, 40s, and 50s. BJJ is a technique-based art â€” age is not a barrier. The Fundamentals program scales to every body type and starting point.',
  },
  {
    question: 'Do I need to be fit to start?',
    answer:
      'No. Training IS how you get fit. Come as you are â€” every adult who has ever started training at GB Whittier began exactly where you are.',
  },
  {
    question: 'Is adult BJJ dangerous?',
    answer:
      'Like any contact sport, there are risks â€” but our classes are supervised, structured, and safety-first. Injuries are rare in a well-run environment like ours, and Fundamentals classes specifically avoid live sparring until you are ready.',
  },
  {
    question: 'How quickly will I progress?',
    answer:
      "Students typically notice real progress within 3-4 weeks of consistent training. The structured Gracie Barra curriculum means you always know what you're working on next, and your instructor tracks your development class to class.",
  },
];
```

## Brief-alignment audit (subagent)

Same protocol as Phase 1, scoped to Phase 2 deliverables.

**Trigger:** at the end of Phase 2 implementation, before the production promote.

**Subagent type:** `general-purpose`.

**Inputs the agent receives:**
- Brief extracted text: `C:\Users\herna\AppData\Local\Temp\gb_brief.txt`
- This spec: `docs/superpowers/specs/2026-05-06-phase2-program-pages-design.md`
- Working directory: project root
- Vercel preview URL (post-build)
- Phase scope: "Phase 2 only â€” Kids Martial Arts page + Adults Jiu-Jitsu page rewrites per brief Part 3"

**Agent task contract:**
1. Parse brief Part 3 sections for Kids page and Adults page. Build a flat checklist (one row per concrete requirement), grouped by area: Hero / Sections / OptInForm embed / Conversion CTA / FAQ / Schema / Meta / CTA labels.
2. Verify each row by grepping `src/pages/{kids-martial-arts,adults-jiu-jitsu}.astro` and `src/content/{kids,adults}-faqs.ts`, plus fetching the Vercel preview URL HTML for each page.
3. Verify FAQPage JSON-LD on both pages (4 questions each).
4. Verify BreadcrumbList JSON-LD on both pages.
5. Output Markdown report: Summary (PASS/FAIL/N/A counts), Failures, Warnings, Passes (collapsed).

**Pass criteria:** zero FAIL items.

**Out-of-scope for the audit:** homepage, Reviews/Contact pages, sitemap/robots/canonical, GA4 events, AI chat widget. Those belong to Phase 1 (already audited), Phase 3, or Phase 4.

## Acceptance criteria

**Manual visual checks (Vercel preview deploy, both `/kids-martial-arts` and `/adults-jiu-jitsu`):**

- View-source shows real visible `<h1>` with the brief's keyword phrase; display heading is `<h2>`
- Page wrapper background is light gray; sections are white cards with rounded corners
- Hero is a rounded card on the gray (not full-bleed)
- `<OptInForm>` renders with the homepage's exact copy/image; `id="trial"` is the anchor for hero/final CTA
- Conversion CTA strip and FAQ are full-width navy bands (NOT inside the gray wrapper)
- Kids: 4 program cards (Tiny / LC1 / LC2 / Juniors), each with `Claim Free 3-Class Pass` button
- Kids: hero CTA + final CTA both read `Claim My Child's Free 3-Class Pass`
- Adults: 4 benefit cards (Real self-defense / Total fitness / Mental toughness / Community) with red icon circles
- Adults: FAQ section exists with 4 expandable items
- Both pages: meta `<title>` and `<meta name="description">` exactly match this spec

**Schema checks (view-source on preview):**
- FAQPage JSON-LD on Kids â€” 4 question/answer pairs
- FAQPage JSON-LD on Adults â€” 4 question/answer pairs
- BreadcrumbList JSON-LD on Kids â€” 2 items (Home, Kids Martial Arts)
- BreadcrumbList JSON-LD on Adults â€” 2 items (Home, Adults Jiu-Jitsu)

**Grep checks (must return zero matches in `src/pages/{kids-martial-arts,adults-jiu-jitsu}.astro`):**
- `Get My Free Class`
- `Free First Class`
- `Click Here`
- `>Submit<`, `label="Submit"`
- `Get Started` (not followed by ` Free`)
- `#trial-form` (the dead anchor must be replaced site-wide on these two files)

**Automated:**
- `npx astro check` â†’ 0 errors, 0 warnings
- `npx vitest run` â†’ all tests pass (including Phase 1's `src/content/faqs.test.ts` ordering check)
- `npm run build` â†’ completes without warnings

**Regression non-goals (must continue to work):**
- Homepage `/` continues to render and pass Phase 1's manual checklist
- `/api/book` POST flow returns `{ ok: true, appointmentId }` for a valid payload
- `/api/availability` returns slots for known programs
- Opt-in form submission still POSTs to `PUBLIC_GHL_WEBHOOK_URL` and redirects to `/kickstart`
- Booking webhook (`GHL_APPOINTMENT_WEBHOOK_URL`) still fires fire-and-forget on successful booking
- Phase 1 vitest assertions on `homepageFaqs` still pass

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Three `<OptInForm>` instances site-wide (home, Kids, Adults) trigger the form-submission script multiple times for one user click | Low | High (duplicate webhook fires) | The script in `OptInForm.astro` queries `[data-optin-form]` per-form and binds an isolated submit handler per `<form>` element â€” already correct. Verify by inspection during implementation. |
| Three `<OptInForm>` instances all use `id="trial"` â†’ invalid HTML (duplicate IDs) | High | Medium (anchor scrolling only goes to the first; accessibility tree pollution) | Use distinct IDs per page (`id="trial"` on home, `id="trial"` on Kids and Adults â€” but each page only has ONE form, so duplicates only matter if the same page renders multiple). Each page renders exactly one `<OptInForm>`, so duplicate IDs across pages are not a per-page validity issue. Confirmed safe. |
| Visual regression â€” bento adaptation breaks the existing program-card image aspect ratios | Low | Low | Reuse existing image dimensions; per-card image sizing matches homepage program cards (`h-44 md:h-52 object-cover`) |
| BreadcrumbList JSON-LD shape mismatch with `SchemaBreadcrumb.astro` props | Low | Medium | Verify component prop interface during implementation; if interface needs adjustment, update component (small surface) |
| Brief inconsistency: 3 vs 4 Kids program cards (Part 3 says 3, Part 5 + Section 7 say 4) | Resolved | â€” | User picked 4 cards (matches booking system + homepage FAQ). Spec locks 4. |
| Phase 1 spec's "no other CTA labels permitted" clause for Kids/Adults conflicts with brief Part 3's audience-specific labels (`Claim My Child's Free 3-Class Pass`, `Claim Free 3-Class Pass`) | Resolved | â€” | Phase 2 spec overrides Phase 1's clause for these two files. Brief Part 3 wins. |

## Out of scope (deferred to later phases)

- Reviews page rewrite (Phase 3)
- Contact page polish (Phase 3)
- Kickstart "What Happens Next" section + trust strip refinements (Phase 3)
- LocalBusiness schema improvements (Phase 4)
- Per-page canonical tag audit (Phase 4)
- `sitemap.xml` and `robots.txt` (Phase 4)
- GA4 event firing (`generate_lead`, `booking_initiated`, `booking_complete`) (Phase 4)
- AI chat widget (separate, integration-driven)

## Roll-out

This phase ships as a single PR / deploy. No feature flag â€” the page rewrites are intentional and immediately visible. Sequence:

1. Implement edits per the file inventory.
2. `npx astro check`, `npx vitest run`, `npm run build` locally â€” all clean.
3. `vercel deploy` (preview).
4. Run the manual checklist on `/kids-martial-arts` and `/adults-jiu-jitsu` preview URLs.
5. **Spawn the brief-alignment audit subagent.** Resolve every FAIL it reports. Repeat until clean.
6. `vercel deploy --prod --yes` â€” promote to production.
7. Final visual smoke-check on production for both pages.
8. Phase 3 brainstorm starts only after Phase 2 is live and the audit reports zero failures.
