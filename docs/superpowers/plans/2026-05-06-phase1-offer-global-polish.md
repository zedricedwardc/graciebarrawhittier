# Phase 1 — Offer + Global Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Gracie Barra Whittier site copy with the May 2026 client brief: offer → "Free 3-Class Pass", standardized CTA labels, semantic hero H1, FAQ expanded to 8 items.

**Architecture:** Pure copy / label / data refactor. Two files genuinely change (homepage + FAQ data). All other site copy is already brief-aligned per a current grep. Verification leans on Vitest for the FAQ data, then `astro check` + `npm run build` + a brief-alignment audit subagent.

**Tech Stack:** Astro 4, TypeScript, Tailwind v4, Vitest, Vercel.

**Source spec:** [docs/superpowers/specs/2026-05-06-phase1-offer-global-polish-design.md](../specs/2026-05-06-phase1-offer-global-polish-design.md)

---

## Pre-flight: scope reconciliation against current state

The spec listed 10 files. A grep against `src/` shows that only **2 files** actually need edits — the rest are already brief-aligned (likely from earlier session work). Tasks below cover the real diff:

- `src/content/faqs.ts` — has 4 terse GHL-preview answers; needs 4 rich + 4 new = 8 items
- `src/pages/index.astro` — has 5 banned-label CTAs, "Free First Class" badge, sr-only H1, mismatched OptInForm props

Other files (`src/pages/{kids-martial-arts,adults-jiu-jitsu,reviews,contact,kickstart,terms}.astro`, `src/components/footer/Footer.astro`, `src/components/form/OptInForm.astro`, `src/components/nav/{Nav,MobileNavDrawer}.astro`, `src/components/cta/StickyMobileCTA.astro`) are already brief-aligned per grep. Task 6 verifies this assumption with a comprehensive sweep.

---

### Task 1: Restore + expand homepageFaqs to 8 items

**Files:**
- Modify: `src/content/faqs.ts` (replace whole array)
- Test: `src/content/faqs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/content/faqs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { homepageFaqs } from './faqs';

describe('homepageFaqs', () => {
  it('contains 8 items', () => {
    expect(homepageFaqs).toHaveLength(8);
  });

  it('every item has a non-empty question and answer', () => {
    for (const item of homepageFaqs) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
  });

  it('includes the four brief-mandated expansion questions', () => {
    const questions = homepageFaqs.map((f) => f.question);
    expect(questions).toContain('How much do classes cost at Gracie Barra Whittier?');
    expect(questions).toContain('What age groups do you offer classes for?');
    expect(questions).toContain('Do I need any experience to start?');
    expect(questions).toContain('Where is Gracie Barra Whittier located?');
  });

  it('preserves the four "keep existing" questions', () => {
    const questions = homepageFaqs.map((f) => f.question);
    expect(questions).toContain('What Makes Gracie Barra Whittier Different?');
    expect(questions).toContain('Is jiu-jitsu safe for beginners?');
    expect(questions).toContain('What should I expect in my first class?');
    expect(questions).toContain('Do you offer programs for both kids & adults?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/content/faqs.test.ts
```

Expected: 4 failing assertions (length is 4 not 8; the 4 "expansion" questions are missing).

- [ ] **Step 3: Replace `src/content/faqs.ts` with the 8-item array**

```ts
export interface FAQItemData {
  question: string;
  answer: string;
}

export const homepageFaqs: FAQItemData[] = [
  {
    question: 'What Makes Gracie Barra Whittier Different?',
    answer:
      'Gracie Barra Whittier is part of the global Gracie Barra network — the most respected name in Brazilian Jiu-Jitsu. Every instructor is certified through the official GB curriculum, and every program is structured to grow students from total beginner to confident practitioner. Our academy at 13595 Whittier Blvd. #104 serves families across Whittier, La Habra, La Mirada, and Pico Rivera with age-specific classes for kids and adults.',
  },
  {
    question: 'Is jiu-jitsu safe for beginners?',
    answer:
      'Yes. Brazilian Jiu-Jitsu is one of the safest grappling-based martial arts because there is no striking. Our Fundamentals classes introduce every technique slowly and with control, and our beginner-focused environment means you train with people at your level. Injuries are rare in a well-supervised academy like ours.',
  },
  {
    question: 'What should I expect in my first class?',
    answer:
      'Arrive 10 minutes early, meet your instructor, and get fitted for a free uniform rental. Class begins with a warm-up, then technique instruction, then partner practice. After class, you sit down with our Program Director Alex for a brief enrollment meeting — no pressure, no commitment. You set the pace.',
  },
  {
    question: 'Do you offer programs for both kids & adults?',
    answer:
      'Yes. We offer Tiny Champions (ages 3-4), Little Champions (ages 5-9), Juniors Jiu-Jitsu (ages 10-15), and Adults Brazilian Jiu-Jitsu (ages 16+). Every program is age-appropriate, taught by certified Gracie Barra instructors, and built around the same world-class curriculum used at GB academies worldwide.',
  },
  {
    question: 'How much do classes cost at Gracie Barra Whittier?',
    answer:
      'The best way to get accurate pricing is to speak with our Program Director Alex after your free trial. Monthly memberships typically start at $160/month depending on the program and training frequency. We also offer enrollment specials for families. Your first 3 classes are completely free.',
  },
  {
    question: 'What age groups do you offer classes for?',
    answer:
      'We offer programs for all ages. Tiny Champions (ages 3-4), Little Champions (ages 5-9), Juniors Jiu-Jitsu (ages 10-15), and Adults Brazilian Jiu-Jitsu (ages 16+). Every class is age-appropriate and taught by certified Gracie Barra instructors.',
  },
  {
    question: 'Do I need any experience to start?',
    answer:
      'Zero experience required. Our programs are specifically designed for beginners. Every black belt at Gracie Barra Whittier started exactly where you are. Just show up — we take care of everything else.',
  },
  {
    question: 'Where is Gracie Barra Whittier located?',
    answer:
      "We're located at 13595 Whittier Blvd. #104, Whittier, CA 90605. We're easily accessible from Whittier, La Habra, La Mirada, and Pico Rivera. Call us at (562) 640-1400 or email info@gbwhittier.com.",
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/content/faqs.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/faqs.ts src/content/faqs.test.ts
git commit -m "feat(content): expand homepageFaqs to 8 items per brief Section 10"
```

---

### Task 2: Fix homepage hero H1 semantics + display heading

**Files:**
- Modify: `src/pages/index.astro:100-107`

The brief requires the keyword phrase to be a real, visible `<h1>` and the motivational line to be `<h2>`. Currently the H1 is `sr-only` and the display line is a `<p aria-hidden>`.

- [ ] **Step 1: Replace lines 100–107 of `src/pages/index.astro`**

Find this block:
```astro
            <p class="text-xs md:text-sm font-semibold uppercase text-gb-gold tracking-wide mb-4">
              Brazilian Jiu-Jitsu Classes in Whittier, CA for Kids and Adults
            </p>

            <h1 class="sr-only">Brazilian Jiu-Jitsu Classes in Whittier, CA</h1>
            <p aria-hidden="true" class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-gb-white leading-[1.05] mb-5">
              Build Confidence.<br />Learn Real Self-Defense.
            </p>
```

Replace with:
```astro
            <p class="text-xs md:text-sm font-semibold uppercase text-gb-gold tracking-wide mb-4">
              Brazilian Jiu-Jitsu Classes in Whittier, CA for Kids and Adults
            </p>

            <h1 class="text-base md:text-lg font-semibold text-gb-white/90 mb-3">
              Brazilian Jiu-Jitsu Classes in Whittier, CA
            </h1>
            <h2 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-gb-white leading-[1.05] mb-5">
              Build Confidence.<br />Learn Real Self-Defense.
            </h2>
```

- [ ] **Step 2: Verify with grep**

```bash
```

Use the Grep tool with pattern `class="sr-only">Brazilian Jiu-Jitsu` in `src/pages/index.astro`.
Expected: 0 matches (the `sr-only` H1 is gone).

Use the Grep tool with pattern `<h1 class="text-base` in `src/pages/index.astro`.
Expected: 1 match.

- [ ] **Step 3: Type-check**

```bash
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(home): promote hero H1 to visible keyword heading; demote display line to H2"
```

---

### Task 3: Update homepage hero card — offer label + addendum + CTA

**Files:**
- Modify: `src/pages/index.astro:126-133`

- [ ] **Step 1: Replace the hero card offer block (lines 126–133)**

Find this block:
```astro
              <div class="mt-4 pt-4 border-t border-gb-bg-light">
                <span class="inline-block bg-gb-red/10 text-gb-red text-[11px] font-bold tracking-wider px-3 py-1 rounded-md uppercase">
                  Free First Class
                </span>
                <div class="mt-3">
                  <CTAButton variant="primary" label="Get My Free Class" href="#trial" fullWidth={true} />
                </div>
              </div>
```

Replace with:
```astro
              <div class="mt-4 pt-4 border-t border-gb-bg-light">
                <span class="inline-block bg-gb-red/10 text-gb-red text-[11px] font-bold tracking-wider px-3 py-1 rounded-md uppercase">
                  Free 3-Class Pass
                </span>
                <p class="mt-2 text-sm text-gb-text">Free uniform rental included</p>
                <div class="mt-3">
                  <CTAButton variant="primary" label="Claim My Free 3-Class Pass" href="#trial" fullWidth={true} />
                </div>
              </div>
```

- [ ] **Step 2: Verify with grep**

Use the Grep tool with pattern `Free First Class` in `src/pages/index.astro`.
Expected: 0 matches.

Use the Grep tool with pattern `Free uniform rental included` in `src/pages/index.astro`.
Expected: ≥ 1 match.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(home): hero card now shows Free 3-Class Pass + uniform rental line"
```

---

### Task 4: Update OptInForm props on homepage to brief copy

**Files:**
- Modify: `src/pages/index.astro:155-165`

- [ ] **Step 1: Replace the OptInForm element**

Find this block:
```astro
    <OptInForm
      id="trial"
      header="UNLOCK YOUR FREE CLASS"
      subheader="+ VIEW OUR FULL CLASS SCHEDULE INSTANTLY"
      description="Enter your info below to access our schedule and reserve your free class now."
      offerLabel="FREE FIRST CLASS"
      riskLine="No Risk. No Pressure."
      submitLabel="CLAIM MY FREE CLASS"
      imageSrc="/images/home/gallery/kids-1.jpg"
      imageAlt="Kids Brazilian Jiu-Jitsu class at Gracie Barra Whittier"
    />
```

Replace with:
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

- [ ] **Step 2: Verify with grep**

Use the Grep tool with pattern `UNLOCK YOUR FREE CLASS|FREE FIRST CLASS|CLAIM MY FREE CLASS"` in `src/pages/index.astro`.
Expected: 0 matches.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(home): align homepage opt-in form props with brief copy contract"
```

---

### Task 5: Replace banned mid-page CTA labels on homepage

Three CTAs on the homepage (Real Stories, Why GB Whittier, See Life Inside) currently say `"Get My Free Class"`. Per the brief CTA standard, mid-page conversion CTAs use `"Start My Free Trial"`.

**Files:**
- Modify: `src/pages/index.astro` (lines ~236, ~301, ~388 — anchor by surrounding context)

- [ ] **Step 1: Update the Real Stories CTA**

Find:
```astro
            <CTAButton variant="primary" label="Get My Free Class" href="#trial" />
```
in the "Real Stories. Real Growth." section (search for surrounding text "Behind every review").

Replace with:
```astro
            <CTAButton variant="primary" label="Start My Free Trial" href="#trial" />
```

- [ ] **Step 2: Update the Why Gracie Barra Whittier CTA**

Find the same line inside the Why Gracie Barra Whittier card (surrounding text "Proudly serving the Whittier community"). The exact line:
```astro
            <CTAButton variant="primary" label="Get My Free Class" href="#trial" fullWidth={true} />
```

Replace with:
```astro
            <CTAButton variant="primary" label="Start My Free Trial" href="#trial" fullWidth={true} />
```

- [ ] **Step 3: Update the See Life Inside (Gallery) CTA**

Find the same `Get My Free Class` line in the section with heading "See Life Inside Gracie Barra Whittier".

Replace with:
```astro
          <CTAButton variant="primary" label="Start My Free Trial" href="#trial" />
```

- [ ] **Step 4: Verify zero `Get My Free Class` remain on the homepage**

Use the Grep tool with pattern `Get My Free Class` in `src/pages/index.astro`.
Expected: 0 matches.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(home): swap banned 'Get My Free Class' CTAs to 'Start My Free Trial' (mid-page)"
```

---

### Task 6: Site-wide banned-string sweep + verification

This task confirms the spec's assumption that no other files contain banned strings. If any are found, fix them before proceeding.

- [ ] **Step 1: Grep for every banned string across `src/`**

Run the Grep tool for each pattern below (path: `src/`, output_mode: `content`, `-n: true`):

| Pattern | Expected matches |
|---|---|
| `Get My Free Class` | 0 |
| `Free First Class` | 0 |
| `Click Here` | 0 |
| `Test Sub-Account` | 0 |
| `>Submit<` | 0 |
| `label="Submit"` | 0 |

- [ ] **Step 2: Grep for `Get Started` standalone (not `Get Started Free`)**

Run the Grep tool with pattern `Get Started(?! Free)` in `src/`.
Expected: 0 matches.

- [ ] **Step 3: If any of the above grep checks return matches**

For each match, decide based on context whether to relabel. The replacement rule:
- Banned label on a primary-conversion button → `Claim My Free 3-Class Pass`
- Banned label on a mid-page secondary button → `Start My Free Trial`
- `Test Sub-Account` in copy → `Gracie Barra Whittier`
- `Click Here` link text → use a descriptive verb phrase that names the destination

Edit, then re-run the relevant grep to confirm 0.

- [ ] **Step 4: Run full astro type-check**

```bash
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Run Vitest**

```bash
npx vitest run
```

Expected: all tests pass (slot-resolver, ghl, faqs).

- [ ] **Step 6: Run production build**

```bash
npm run build
```

Expected: completes without errors. The 8-item FAQPage JSON-LD should be visible in the built `/index.html` source.

- [ ] **Step 7: Commit any sweep fixes (if any)**

```bash
git add src/
git commit -m "chore: site-wide banned-string sweep — Phase 1 verification"
```

If no fixes were needed, skip this commit.

---

### Task 7: Deploy preview + spawn brief-alignment audit subagent

The audit subagent is the gating verification per the spec.

- [ ] **Step 1: Deploy a Vercel preview**

```bash
vercel deploy --yes
```

Capture the preview URL from the output (e.g., `https://graciebarrawebsite-xxxxxx-zedricedwardcs-projects.vercel.app`).

- [ ] **Step 2: Spot-check the preview manually**

Open the preview URL in a browser and confirm:
- View source shows `<h1 class="text-base ...">Brazilian Jiu-Jitsu Classes in Whittier, CA</h1>` and `<h2 class="text-3xl ...">Build Confidence...</h2>`
- Hero card shows "Free 3-Class Pass" badge, "Free uniform rental included" line, "Claim My Free 3-Class Pass" button
- Opt-in form headers/labels/submit text match the spec's Copy Contract
- FAQ section shows 8 expandable items
- Footer shows About paragraph, "Proudly serving Whittier…" line, "Gracie Barra Whittier" copyright

- [ ] **Step 3: Spawn the brief-alignment audit subagent**

Use the Agent tool with `subagent_type: general-purpose`. Prompt:

> Audit the Gracie Barra Whittier site against the client brief for Phase 1 only.
>
> Inputs:
> - Brief (extracted text): `C:\Users\herna\AppData\Local\Temp\gb_brief.txt`
> - Phase 1 spec: `docs/superpowers/specs/2026-05-06-phase1-offer-global-polish-design.md`
> - Codebase: project root (Astro project)
> - Live preview URL: <paste preview URL from Step 1>
>
> Your task:
> 1. Read the brief and the Phase 1 spec.
> 2. Build a flat checklist of every Phase-1-relevant requirement from the brief, grouped by area: offer copy / CTAs / hero / FAQ / footer. (Do NOT include Phase 2/3/4 items — Kids/Adults/Reviews/Contact full rewrites and SEO/tracking are out of scope for this audit.)
> 3. Verify each checklist row by either grepping the codebase (with file path + line number citation) or fetching the preview URL and inspecting rendered HTML.
> 4. Run the banned-string grep from the spec's Acceptance Criteria.
> 5. Verify FAQPage JSON-LD on the preview URL emits all 8 question/answer pairs.
> 6. Output a single Markdown report with sections: **Summary** (PASS/FAIL/N/A counts), **Failures** (must-fix list with file/line refs), **Warnings** (review items), **Passes** (collapsed list).
>
> Pass criteria for Phase 1: zero FAIL items in the report. Warnings get human review.

- [ ] **Step 4: If audit reports any FAIL items**

For each FAIL: open the cited file, fix the deviation, re-run the relevant grep, redeploy preview, re-spawn the audit. Repeat until clean.

- [ ] **Step 5: Commit any audit-driven fixes**

```bash
git add src/
git commit -m "fix: resolve Phase 1 brief-alignment audit findings"
```

- [ ] **Step 6: Promote to production**

After audit returns zero failures:

```bash
vercel deploy --prod --yes
```

- [ ] **Step 7: Final smoke check on production**

Open `https://graciebarrawebsite.vercel.app` and re-confirm the manual checks from Step 2 against production HTML.

---

## Done criteria

Phase 1 is complete when:
1. All 7 tasks are checked off and committed.
2. The brief-alignment audit subagent returns zero FAILs.
3. Production deploy `https://graciebarrawebsite.vercel.app` reflects all spec changes on visual inspection.
4. `npx vitest run`, `npx astro check`, and `npm run build` all pass cleanly.

After Phase 1 ships, the user starts Phase 2 brainstorm (Kids + Adults program-page rewrites).
