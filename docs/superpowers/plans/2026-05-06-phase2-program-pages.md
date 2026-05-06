# Phase 2 — Program Pages (Kids + Adults) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/kids-martial-arts` and `/adults-jiu-jitsu` to match brief Part 3 verbatim, adopt the homepage's bento-card visual language, normalize OptInForm to homepage-identical props, and fix hero H1/H2 semantics.

**Architecture:** Pure page-content + visual refactor. No new components. Two page rewrites, two FAQ data tweaks, no API changes. Verification via grep + Vitest + `astro check` + brief-alignment audit subagent.

**Tech Stack:** Astro 4, TypeScript, Tailwind v4, Vitest, Vercel.

**Source spec:** [docs/superpowers/specs/2026-05-06-phase2-program-pages-design.md](../specs/2026-05-06-phase2-program-pages-design.md)

---

## Pre-flight: scope reconciliation against current state

Pre-implementation grep shows both pages already have:
- `programs` / `parentQuotes` / `firstClassSteps` data arrays (Kids page)
- `breadcrumb` data array + `<SchemaBreadcrumb items={breadcrumb} />` rendered
- `<OptInForm>` embedded (but with audience-specific `header` prop, no `imageSrc`/`imageAlt`, and `id="trial-form"`)
- `<FAQ items={...} heading="..."/>` for FAQ rendering (white-card style, NOT the navy band style spec wants)

Real diff for Phase 2:
- **OptInForm props** — both pages must use homepage-identical props (`id="trial"`, full set of overrides matching homepage). All `href="#trial-form"` CTA hrefs become `href="#trial"`.
- **Hero H1/H2** — current H1 is too prominent and display heading is `<p>`. Restructure to small visible H1 + large `<h2>` display.
- **Visual** — pages currently use edge-to-edge full-width sections. Adapt to bento-card-on-gray pattern matching homepage (`<div class="bg-gb-bg-light">` wrapper, white card sections, rounded hero card on gray, navy band escapes wrapper).
- **FAQ visual** — replace `<FAQ items={...}>` (white card style) with inline `<details>` accordion matching homepage's navy band style. `<SchemaFAQ>` still emits JSON-LD.
- **FAQ content** — `kids-faqs.ts` and `adults-faqs.ts` get slightly fuller answers per spec (the current versions are condensed).
- **Meta** — update title/description per spec on both pages.

Files touched: 4 (`kids-martial-arts.astro`, `adults-jiu-jitsu.astro`, `kids-faqs.ts`, `adults-faqs.ts`). `SchemaBreadcrumb.astro` is verified unchanged (interface already matches).

---

### Task 1: Refine FAQ data to spec wording + Vitest coverage

**Files:**
- Modify: `src/content/kids-faqs.ts`
- Modify: `src/content/adults-faqs.ts`
- Test: `src/content/kids-faqs.test.ts` (create)
- Test: `src/content/adults-faqs.test.ts` (create)

- [ ] **Step 1: Write failing tests for kids-faqs**

Create `src/content/kids-faqs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { kidsFaqs } from './kids-faqs';

describe('kidsFaqs', () => {
  it('contains exactly 4 items', () => {
    expect(kidsFaqs).toHaveLength(4);
  });

  it('every item has a non-empty question and answer', () => {
    for (const item of kidsFaqs) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
  });

  it('contains the four brief-mandated kids questions in order', () => {
    expect(kidsFaqs.map((f) => f.question)).toEqual([
      'Is jiu-jitsu safe for young children?',
      'What if my child is shy or nervous?',
      'Will my child get hurt?',
      "How do I know which program is right for my child's age?",
    ]);
  });

  it('answers reference the program names where appropriate', () => {
    expect(kidsFaqs[0]!.answer).toMatch(/Tiny Champions|Little Champions/);
    expect(kidsFaqs[3]!.answer).toMatch(/Tiny Champions|Little Champions|Juniors/);
  });
});
```

- [ ] **Step 2: Write failing tests for adults-faqs**

Create `src/content/adults-faqs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { adultsFaqs } from './adults-faqs';

describe('adultsFaqs', () => {
  it('contains exactly 4 items', () => {
    expect(adultsFaqs).toHaveLength(4);
  });

  it('every item has a non-empty question and answer', () => {
    for (const item of adultsFaqs) {
      expect(item.question.trim().length).toBeGreaterThan(0);
      expect(item.answer.trim().length).toBeGreaterThan(0);
    }
  });

  it('contains the four brief-mandated adults questions in order', () => {
    expect(adultsFaqs.map((f) => f.question)).toEqual([
      'Am I too old to start BJJ?',
      'Do I need to be fit to start?',
      'Is adult BJJ dangerous?',
      'How quickly will I progress?',
    ]);
  });
});
```

- [ ] **Step 3: Run tests to confirm failures or partial passes**

```
npx vitest run src/content/kids-faqs.test.ts src/content/adults-faqs.test.ts
```

Expected: `kidsFaqs[0]!.answer` may not match the program-name regex (current answer doesn't list Little Champions); other tests likely pass since data already exists.

- [ ] **Step 4: Replace `src/content/kids-faqs.ts`**

```ts
/**
 * Kids page FAQs — 4 questions per build brief Part 3 Kids Section 7.
 * Copy verbatim from the build brief, expanded for SEO/AI-search indexing.
 */
import type { FAQItemData } from './faqs';

export const kidsFaqs: FAQItemData[] = [
  {
    question: 'Is jiu-jitsu safe for young children?',
    answer:
      'Yes. Our Tiny Champions and Little Champions programs are specifically designed for young kids with age-appropriate movement and no unsafe sparring. Every class is supervised, structured, and safety-first.',
  },
  {
    question: 'What if my child is shy or nervous?',
    answer:
      "Very common. Our instructors specialize in working with nervous first-timers, and most shy kids are asking to come back after their first class. Your child sets the pace — there is no pressure to do anything they're not ready for.",
  },
  {
    question: 'Will my child get hurt?',
    answer:
      'BJJ at this level is about technique and coordination, not roughness. Our classes are supervised, structured, and safety-first. Injuries are rare in a well-run academy like ours.',
  },
  {
    question: "How do I know which program is right for my child's age?",
    answer:
      "Age determines the program automatically. Just tell us how old your child is and we'll get them into the right class — Tiny Champions (3-4), Little Champions 1 (5-6), Little Champions 2 (7-9), or Juniors Jiu-Jitsu (10-15).",
  },
];
```

- [ ] **Step 5: Replace `src/content/adults-faqs.ts`**

```ts
/**
 * Adults page FAQs — 4 questions per build brief Part 3 Adults Section 6.
 * Copy verbatim from the build brief, expanded for SEO/AI-search indexing.
 */
import type { FAQItemData } from './faqs';

export const adultsFaqs: FAQItemData[] = [
  {
    question: 'Am I too old to start BJJ?',
    answer:
      'Many of our best students started training in their 30s, 40s, and 50s. BJJ is a technique-based art — age is not a barrier. The Fundamentals program scales to every body type and starting point.',
  },
  {
    question: 'Do I need to be fit to start?',
    answer:
      'No. Training IS how you get fit. Come as you are — every adult who has ever started training at GB Whittier began exactly where you are.',
  },
  {
    question: 'Is adult BJJ dangerous?',
    answer:
      'Like any contact sport, there are risks — but our classes are supervised, structured, and safety-first. Injuries are rare in a well-run environment like ours, and Fundamentals classes specifically avoid live sparring until you are ready.',
  },
  {
    question: 'How quickly will I progress?',
    answer:
      "Students typically notice real progress within 3-4 weeks of consistent training. The structured Gracie Barra curriculum means you always know what you're working on next, and your instructor tracks your development class to class.",
  },
];
```

- [ ] **Step 6: Run all tests to confirm pass**

```
npx vitest run
```

Expected: all tests pass (Phase 1 + new Phase 2 FAQ tests).

- [ ] **Step 7: Commit**

```
git add src/content/kids-faqs.ts src/content/adults-faqs.ts src/content/kids-faqs.test.ts src/content/adults-faqs.test.ts
git commit -m "feat(content): expand kids/adults FAQ answers per Phase 2 spec + Vitest coverage"
```

---

### Task 2: Rewrite Kids page (`src/pages/kids-martial-arts.astro`)

This task replaces the entire page body with the bento-card layout, fixes hero H1/H2 semantics, normalizes OptInForm props to homepage-identical, swaps the FAQ to the navy-band inline `<details>` style, and updates meta. Data arrays in the frontmatter (`programs`, `parentQuotes`, `firstClassSteps`, `breadcrumb`) stay unchanged.

**Files:**
- Modify: `src/pages/kids-martial-arts.astro`

- [ ] **Step 1: Rewrite the entire file**

Use the Write tool to overwrite `src/pages/kids-martial-arts.astro` with this exact content:

```astro
---
export const prerender = true;
/**
 * /kids-martial-arts — audience: parents of children ages 3–15.
 * Copy verbatim from build brief Part 3 Kids section.
 * Visual: bento-card on gray bg, matching homepage.
 */
import { Image } from 'astro:assets';
import BaseLayout from '../layouts/BaseLayout.astro';
import CTAButton from '../components/cta/CTAButton.astro';
import OptInForm from '../components/form/OptInForm.astro';
import SchemaBreadcrumb from '../components/seo/SchemaBreadcrumb.astro';
import SchemaFAQ from '../components/seo/SchemaFAQ.astro';
import { kidsFaqs } from '../content/kids-faqs';
import kidsHero from '../assets/images/kids/kids-hero.jpg';

const programs = [
  {
    name: 'Tiny Champions',
    ages: 'Ages 3–4',
    blurb:
      'Movement, coordination, listening skills, following instructions. A fun and safe introduction to the mat.',
    image: '/images/kids/kids-tiny-champions.jpg',
    alt: 'Tiny Champions Brazilian Jiu-Jitsu class for ages 3 to 4 at Gracie Barra Whittier',
  },
  {
    name: 'Little Champions 1',
    ages: 'Ages 5–6',
    blurb:
      'Core BJJ fundamentals introduced through age-appropriate drills. Builds discipline, respect, and confidence in a structured team environment.',
    image: '/images/kids/kids-little-champions-1.jpg',
    alt: 'Little Champions 1 Brazilian Jiu-Jitsu class for ages 5 to 6 at Gracie Barra Whittier',
  },
  {
    name: 'Little Champions 2',
    ages: 'Ages 7–9',
    blurb:
      'Deeper technique focus and partner drills. Continued emphasis on respect, listening, and structured practice.',
    image: '/images/kids/kids-little-champions-2.jpg',
    alt: 'Little Champions 2 Brazilian Jiu-Jitsu class for ages 7 to 9 at Gracie Barra Whittier',
  },
  {
    name: 'Juniors Jiu-Jitsu',
    ages: 'Ages 10–15',
    blurb:
      'Technique-focused training with real BJJ skills, optional competition preparation, and leadership development.',
    image: '/images/kids/kids-juniors.jpg',
    alt: 'Juniors Brazilian Jiu-Jitsu class for ages 10 to 15 at Gracie Barra Whittier',
  },
];

const parentQuotes = [
  {
    quote: "My son's teachers started noticing how much more focused he is in class.",
    benefit: 'Focus and school performance',
  },
  {
    quote: 'She walks into every room now like she belongs there.',
    benefit: 'Confidence',
  },
  {
    quote: 'I feel safe knowing he can protect himself.',
    benefit: 'Self-defense and safety',
  },
];

const firstClassSteps = [
  'Arrive 10 minutes early — say hi to the front desk and meet your instructor.',
  'Get fitted for your free uniform rental.',
  'Warm up with the group — fun, age-appropriate movement.',
  'Learn the first technique with the instructor walking you through every step.',
  'End-of-class reflection — what we learned, what comes next.',
  'Sit down with Program Director Alex for a brief no-pressure conversation about the trial.',
];

const breadcrumb = [
  { name: 'Home', url: 'https://gbwhittier.com/' },
  { name: 'Kids Martial Arts', url: 'https://gbwhittier.com/kids-martial-arts/' },
];
---

<BaseLayout
  title="Kids Martial Arts in Whittier, CA | Gracie Barra Whittier"
  description="Gracie Barra Whittier offers age-specific kids BJJ programs for ages 3-15. Build confidence, focus, and self-defense skills in a safe, structured environment. Claim your free 3-class pass."
  canonical="https://gbwhittier.com/kids-martial-arts/"
>
  <div class="bg-gb-bg-light">
    {/* HERO — rounded card on light-gray background */}
    <section class="px-4 md:px-6 pt-6 md:pt-8">
      <div class="max-w-7xl mx-auto bg-gb-navy rounded-2xl overflow-hidden relative isolate shadow-lg">
        <Image
          src={kidsHero}
          alt="Kids Brazilian Jiu-Jitsu class at Gracie Barra Whittier, CA"
          widths={[768, 1280, 1920]}
          sizes="100vw"
          format="webp"
          quality={82}
          loading="eager"
          class="absolute inset-0 -z-10 w-full h-full object-cover object-center"
        />
        <div class="absolute inset-0 -z-10 bg-gradient-to-r from-gb-navy/95 via-gb-navy/40 to-gb-navy/85"></div>
        <div class="absolute inset-0 -z-10 bg-gradient-to-t from-gb-navy/90 via-transparent to-transparent md:hidden"></div>

        <div class="px-6 md:px-10 lg:px-14 py-12 md:py-16 lg:py-20 max-w-3xl text-gb-white">
          <p class="text-xs md:text-sm font-semibold uppercase text-gb-gold tracking-wide mb-4">
            Brazilian Jiu-Jitsu for Kids in Whittier, CA
          </p>
          <h1 class="text-base md:text-lg font-semibold text-gb-white/90 mb-3">
            Kids Martial Arts Classes in Whittier, CA — Ages 3 to 15
          </h1>
          <h2 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05] mb-5">
            Where Kids Build Confidence, Discipline, and Strength
          </h2>
          <p class="text-base md:text-lg text-gb-white/90 leading-relaxed max-w-2xl mb-7">
            Age-specific Brazilian Jiu-Jitsu programs designed for every stage of childhood — from Tiny Champions (ages 3-4) through Juniors (ages 10-15). Safe, structured, and genuinely fun.
          </p>
          <CTAButton variant="primary" label="Claim My Child's Free 3-Class Pass" href="#trial" />
        </div>
      </div>
    </section>

    {/* PROGRAMS BREAKDOWN */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-6xl mx-auto">
        <div class="text-center mb-10 md:mb-12">
          <h2 class="text-2xl md:text-4xl font-extrabold text-gb-navy">Age-Specific Programs Built for Your Child</h2>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
          {programs.map((p) => (
            <article class="bg-gb-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col">
              <img src={p.image} alt={p.alt} loading="lazy" decoding="async" class="w-full h-44 object-cover" />
              <div class="p-5 flex flex-col flex-1">
                <p class="text-xs font-bold tracking-widest text-gb-red uppercase">{p.ages}</p>
                <h3 class="mt-2 text-lg font-extrabold text-gb-navy">{p.name}</h3>
                <p class="mt-2 text-sm text-gb-text-muted leading-relaxed flex-1">{p.blurb}</p>
                <div class="mt-5">
                  <CTAButton variant="program" label="Claim Free 3-Class Pass" href="#trial" fullWidth={true} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>

    {/* BENEFITS FOR PARENTS */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-6xl mx-auto">
        <div class="text-center mb-10 md:mb-12">
          <h2 class="text-2xl md:text-4xl font-extrabold text-gb-navy">What Parents Tell Us After Their Child Starts Training</h2>
        </div>
        <div class="grid md:grid-cols-3 gap-5 md:gap-6">
          {parentQuotes.map((q) => (
            <figure class="bg-gb-white rounded-2xl shadow-sm p-6 flex flex-col">
              <svg class="w-8 h-8 text-gb-red mb-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M9 7H6a3 3 0 00-3 3v7h7v-7H7c0-1.1.9-2 2-2V7zm9 0h-3a3 3 0 00-3 3v7h7v-7h-3c0-1.1.9-2 2-2V7z" />
              </svg>
              <blockquote class="text-base md:text-lg text-gb-text font-medium leading-relaxed">
                &ldquo;{q.quote}&rdquo;
              </blockquote>
              <figcaption class="mt-4 text-sm font-semibold text-gb-navy">{q.benefit}</figcaption>
            </figure>
          ))}
        </div>
        <p class="mt-8 text-xs text-gb-text-muted text-center">Placeholder quotes pending publication of real parent reviews.</p>
      </div>
    </section>

    {/* WHAT TO EXPECT */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-5xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10">
        <div class="text-center mb-8">
          <h2 class="text-2xl md:text-4xl font-extrabold text-gb-navy">What Happens at Your Child's First Class</h2>
        </div>
        <ol class="grid md:grid-cols-2 gap-4 md:gap-5">
          {firstClassSteps.map((step, idx) => (
            <li class="flex gap-4 bg-gb-bg-light rounded-xl p-4 md:p-5">
              <span class="shrink-0 w-9 h-9 rounded-full bg-gb-red text-gb-white font-bold inline-flex items-center justify-center" aria-hidden="true">
                {idx + 1}
              </span>
              <p class="text-sm md:text-base text-gb-text leading-relaxed">{step}</p>
            </li>
          ))}
        </ol>
        <p class="mt-8 text-center text-sm text-gb-text-muted">
          Bring comfortable workout clothes. We provide the uniform for your trial classes.
        </p>
      </div>
    </section>

    {/* CERTIFIED INSTRUCTORS */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-3xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10 text-center">
        <h2 class="text-2xl md:text-4xl font-extrabold text-gb-navy">Certified Gracie Barra Instructors — Not Just Athletes, But Teachers</h2>
        <p class="mt-4 text-sm md:text-base text-gb-text-muted leading-relaxed">
          Every instructor at Gracie Barra Whittier completes the official Gracie Barra certification program before stepping on the mat with your child. The same curriculum is taught at over 1,000 GB academies worldwide. Our lead instructors, Professor Phil and Professor Eric, bring decades of training experience and a teaching-first mindset — your child isn't just learning Jiu-Jitsu, they're being mentored.
        </p>
      </div>
    </section>

    {/* OPT-IN FORM — identical props to homepage */}
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
  </div>

  {/* CONVERSION CTA — full-width navy band */}
  <section class="bg-gb-navy text-gb-white py-14 md:py-20 px-4 md:px-6">
    <div class="max-w-3xl mx-auto text-center">
      <h2 class="text-2xl md:text-4xl font-extrabold">Ready to Get Your Child Started?</h2>
      <p class="mt-4 text-sm md:text-base text-gb-white/85 leading-relaxed">
        Try any of our kids programs free for 3 classes — no commitment, no contracts, free uniform rental included. Just bring your child and let us take it from there.
      </p>
      <div class="mt-7 flex justify-center">
        <CTAButton variant="primary" label="Claim My Child's Free 3-Class Pass" href="#trial" />
      </div>
      <p class="mt-4 text-xs text-gb-white/70">3 free classes • Free uniform rental • No contracts • No pressure</p>
    </div>
  </section>

  {/* FAQ — full-width navy band, inline details accordion */}
  <section class="bg-gb-navy text-gb-white py-14 md:py-20 px-4 md:px-6" aria-labelledby="kids-faq-heading">
    <div class="max-w-3xl mx-auto">
      <div class="text-center mb-8 md:mb-10">
        <h2 id="kids-faq-heading" class="text-2xl md:text-4xl font-extrabold">Questions About Kids Jiu-Jitsu</h2>
      </div>
      <div class="space-y-2">
        {kidsFaqs.map((item) => (
          <details class="group border-b border-gb-white/15 py-4">
            <summary class="flex items-center justify-between gap-4 cursor-pointer list-none text-sm md:text-base font-semibold text-gb-white">
              <span class="flex items-center gap-3">
                <svg class="w-4 h-4 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span>{item.question}</span>
              </span>
            </summary>
            <p class="mt-3 ml-7 text-sm text-gb-white/80 leading-relaxed">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  </section>

  <SchemaFAQ items={kidsFaqs} />
  <SchemaBreadcrumb items={breadcrumb} />
</BaseLayout>
```

- [ ] **Step 2: Type-check**

```
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Grep verification**

Use the Grep tool with pattern `#trial-form` in `src/pages/kids-martial-arts.astro`. Expected: 0 matches.
Use the Grep tool with pattern `Get My Free Class` in `src/pages/kids-martial-arts.astro`. Expected: 0 matches.
Use the Grep tool with pattern `id="trial"` in `src/pages/kids-martial-arts.astro`. Expected: 1 match (OptInForm).
Use the Grep tool with pattern `<h1 class="text-base md:text-lg` in `src/pages/kids-martial-arts.astro`. Expected: 1 match.

- [ ] **Step 4: Commit**

```
git add src/pages/kids-martial-arts.astro
git commit -m "feat(kids): rebuild Kids page per Phase 2 spec — bento layout, H1/H2 semantics, OptInForm normalization, navy-band FAQ"
```

---

### Task 3: Rewrite Adults page (`src/pages/adults-jiu-jitsu.astro`)

Same pattern as Task 2: bento layout, hero H1/H2 fix, OptInForm props match homepage exactly, FAQ in navy band, 4 benefit cards with icons.

**Files:**
- Modify: `src/pages/adults-jiu-jitsu.astro`

- [ ] **Step 1: Rewrite the entire file**

Use the Write tool to overwrite `src/pages/adults-jiu-jitsu.astro` with this exact content:

```astro
---
export const prerender = true;
/**
 * /adults-jiu-jitsu — audience: adults 16+, beginners and returning students.
 * Copy verbatim from build brief Part 3 Adults section.
 * Visual: bento-card on gray bg, matching homepage.
 */
import { Image } from 'astro:assets';
import BaseLayout from '../layouts/BaseLayout.astro';
import CTAButton from '../components/cta/CTAButton.astro';
import OptInForm from '../components/form/OptInForm.astro';
import SchemaBreadcrumb from '../components/seo/SchemaBreadcrumb.astro';
import SchemaFAQ from '../components/seo/SchemaFAQ.astro';
import { adultsFaqs } from '../content/adults-faqs';
import adultsHero from '../assets/images/adults/adults-hero.jpg';

const benefits = [
  {
    title: 'Real self-defense',
    body:
      "BJJ works based on leverage and technique — not size or strength. It's why it's the #1 choice for law enforcement and military worldwide.",
    icon: 'shield',
  },
  {
    title: 'Total fitness',
    body:
      "Cardio, strength, flexibility, coordination — all in one hour. You'll be too focused on learning to notice you're working out.",
    icon: 'zap',
  },
  {
    title: 'Mental toughness',
    body:
      'The mat teaches you to stay calm under pressure. That skill shows up everywhere in your life.',
    icon: 'brain',
  },
  {
    title: 'Community',
    body:
      "Your training partners become people you trust. The BJJ community at GB Whittier is unlike anything else you'll find.",
    icon: 'people',
  },
];

const firstClassSteps = [
  'Arrive 10 minutes early — meet your instructor and the front desk team.',
  'Get fitted for your free uniform rental.',
  'Warm up with the class — light movement, no surprises.',
  'Fundamentals class — the instructor walks you through technique step-by-step.',
  'Practice with a training partner at your level. Slow, controlled, low-pressure.',
  'Debrief with Program Director Alex — quick chat about how it went and what comes next. No commitment.',
];

const breadcrumb = [
  { name: 'Home', url: 'https://gbwhittier.com/' },
  { name: 'Adults Jiu-Jitsu', url: 'https://gbwhittier.com/adults-jiu-jitsu/' },
];
---

<BaseLayout
  title="Adult BJJ Classes in Whittier, CA | Gracie Barra Whittier"
  description="Train Brazilian Jiu-Jitsu at Gracie Barra Whittier. Beginner-friendly adult BJJ classes in Whittier, CA. Build fitness, self-defense skills, and confidence. Try 3 classes free."
  canonical="https://gbwhittier.com/adults-jiu-jitsu/"
>
  <div class="bg-gb-bg-light">
    {/* HERO — rounded card on light-gray background */}
    <section class="px-4 md:px-6 pt-6 md:pt-8">
      <div class="max-w-7xl mx-auto bg-gb-navy rounded-2xl overflow-hidden relative isolate shadow-lg">
        <Image
          src={adultsHero}
          alt="Adult Brazilian Jiu-Jitsu class at Gracie Barra Whittier, CA"
          widths={[768, 1280, 1920]}
          sizes="100vw"
          format="webp"
          quality={82}
          loading="eager"
          class="absolute inset-0 -z-10 w-full h-full object-cover object-center"
        />
        <div class="absolute inset-0 -z-10 bg-gradient-to-r from-gb-navy/95 via-gb-navy/40 to-gb-navy/85"></div>
        <div class="absolute inset-0 -z-10 bg-gradient-to-t from-gb-navy/90 via-transparent to-transparent md:hidden"></div>

        <div class="px-6 md:px-10 lg:px-14 py-12 md:py-16 lg:py-20 max-w-3xl text-gb-white">
          <p class="text-xs md:text-sm font-semibold uppercase text-gb-gold tracking-wide mb-4">
            Brazilian Jiu-Jitsu for Adults in Whittier, CA
          </p>
          <h1 class="text-base md:text-lg font-semibold text-gb-white/90 mb-3">
            Adult Brazilian Jiu-Jitsu Classes in Whittier, CA
          </h1>
          <h2 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05] mb-5">
            The Most Effective Martial Art. Beginner-Friendly. Life-Changing.
          </h2>
          <p class="text-base md:text-lg text-gb-white/90 leading-relaxed max-w-2xl mb-7">
            Gracie Barra Whittier's adult BJJ program is built for people with zero experience who want real results — in fitness, self-defense, and mental toughness. No prior training required.
          </p>
          <CTAButton variant="primary" label="Claim My Free 3-Class Pass" href="#trial" />
        </div>
      </div>
    </section>

    {/* THE CASE FOR BJJ — 4 benefit cards with icons */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-6xl mx-auto">
        <div class="text-center mb-10 md:mb-12">
          <h2 class="text-2xl md:text-4xl font-extrabold text-gb-navy">Why Adults Choose Brazilian Jiu-Jitsu Over Every Other Martial Art</h2>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
          {benefits.map((b) => (
            <div class="bg-gb-white rounded-2xl p-6 shadow-sm flex flex-col items-center text-center">
              <div class="w-12 h-12 rounded-full bg-gb-red/10 text-gb-red flex items-center justify-center mb-4">
                {b.icon === 'shield' && (
                  <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                )}
                {b.icon === 'zap' && (
                  <svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
                  </svg>
                )}
                {b.icon === 'brain' && (
                  <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9.5 2A2.5 2.5 0 0 0 7 4.5v.5a2.5 2.5 0 0 0-2 2.45A2.5 2.5 0 0 0 4 9.45V12a3 3 0 0 0 3 3h0a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0 2-2v-3a2 2 0 0 1 2-2h0a3 3 0 0 0 3-3V9.45A2.5 2.5 0 0 0 19 7.45 2.5 2.5 0 0 0 17 5v-.5A2.5 2.5 0 0 0 14.5 2h0A2.5 2.5 0 0 0 12 4.5V20" />
                  </svg>
                )}
                {b.icon === 'people' && (
                  <svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M9 11a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4zm9-2a3 3 0 100-6 3 3 0 000 6zm0 2c-1 0-1.9.2-2.7.6 1.7 1 2.7 2.5 2.7 4.4v2h6v-2c0-2.5-2.7-5-6-5z" />
                  </svg>
                )}
              </div>
              <h3 class="text-lg font-extrabold text-gb-navy">{b.title}</h3>
              <p class="mt-2 text-sm text-gb-text-muted leading-relaxed">{b.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* BEGINNER REASSURANCE */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-3xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10 text-center">
        <h2 class="text-2xl md:text-4xl font-extrabold text-gb-navy">You Don't Need Experience. You Need to Show Up.</h2>
        <p class="mt-4 text-sm md:text-base text-gb-text-muted leading-relaxed">
          Every black belt at Gracie Barra Whittier was a beginner once — and that includes Professor Phil, who leads our adult program. The culture on the mat is welcoming and ego-free. You'll train with people at your level, learn at your pace, and start with the same Fundamentals class every adult does — whether they're 18 or 58, fit or starting over. Show up; we take it from there.
        </p>
      </div>
    </section>

    {/* WHAT TO EXPECT */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-5xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10">
        <div class="text-center mb-8">
          <h2 class="text-2xl md:text-4xl font-extrabold text-gb-navy">What Your First Adult BJJ Class Looks Like</h2>
        </div>
        <ol class="grid md:grid-cols-2 gap-4 md:gap-5">
          {firstClassSteps.map((step, idx) => (
            <li class="flex gap-4 bg-gb-bg-light rounded-xl p-4 md:p-5">
              <span class="shrink-0 w-9 h-9 rounded-full bg-gb-red text-gb-white font-bold inline-flex items-center justify-center" aria-hidden="true">
                {idx + 1}
              </span>
              <p class="text-sm md:text-base text-gb-text leading-relaxed">{step}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>

    {/* OPT-IN FORM — identical props to homepage */}
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
  </div>

  {/* CONVERSION CTA — full-width navy band */}
  <section class="bg-gb-navy text-gb-white py-14 md:py-20 px-4 md:px-6">
    <div class="max-w-3xl mx-auto text-center">
      <h2 class="text-2xl md:text-4xl font-extrabold">Start Your BJJ Journey This Week</h2>
      <p class="mt-4 text-sm md:text-base text-gb-white/85 leading-relaxed">
        3 free classes. No experience needed. Free uniform provided. Come see what Brazilian Jiu-Jitsu at Gracie Barra Whittier can do for you.
      </p>
      <div class="mt-7 flex justify-center">
        <CTAButton variant="primary" label="Claim My Free 3-Class Pass" href="#trial" />
      </div>
      <p class="mt-4 text-xs text-gb-white/70">3 free classes • No experience needed • Free uniform • No contracts</p>
    </div>
  </section>

  {/* FAQ — full-width navy band, inline details accordion */}
  <section class="bg-gb-navy text-gb-white py-14 md:py-20 px-4 md:px-6" aria-labelledby="adults-faq-heading">
    <div class="max-w-3xl mx-auto">
      <div class="text-center mb-8 md:mb-10">
        <h2 id="adults-faq-heading" class="text-2xl md:text-4xl font-extrabold">Questions About Adult Jiu-Jitsu</h2>
      </div>
      <div class="space-y-2">
        {adultsFaqs.map((item) => (
          <details class="group border-b border-gb-white/15 py-4">
            <summary class="flex items-center justify-between gap-4 cursor-pointer list-none text-sm md:text-base font-semibold text-gb-white">
              <span class="flex items-center gap-3">
                <svg class="w-4 h-4 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span>{item.question}</span>
              </span>
            </summary>
            <p class="mt-3 ml-7 text-sm text-gb-white/80 leading-relaxed">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  </section>

  <SchemaFAQ items={adultsFaqs} />
  <SchemaBreadcrumb items={breadcrumb} />
</BaseLayout>
```

- [ ] **Step 2: Type-check**

```
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Grep verification**

Use the Grep tool with pattern `#trial-form` in `src/pages/adults-jiu-jitsu.astro`. Expected: 0 matches.
Use the Grep tool with pattern `Get My Free Class` in `src/pages/adults-jiu-jitsu.astro`. Expected: 0 matches.
Use the Grep tool with pattern `id="trial"` in `src/pages/adults-jiu-jitsu.astro`. Expected: 1 match.
Use the Grep tool with pattern `<h1 class="text-base md:text-lg` in `src/pages/adults-jiu-jitsu.astro`. Expected: 1 match.

- [ ] **Step 4: Commit**

```
git add src/pages/adults-jiu-jitsu.astro
git commit -m "feat(adults): rebuild Adults page per Phase 2 spec — bento layout, H1/H2 semantics, OptInForm normalization, navy-band FAQ"
```

---

### Task 4: Site-wide verification sweep

- [ ] **Step 1: Banned-string grep across `src/`**

Run the Grep tool for each pattern below in path `src/`:

| Pattern | Expected matches |
|---|---|
| `Get My Free Class` | 0 |
| `Free First Class` | 0 |
| `Click Here` | 0 |
| `Test Sub-Account` | 0 |
| `>Submit<` | 0 |
| `label="Submit"` | 0 |
| `#trial-form` | 0 |
| `Get Started` not followed by ` Free` (regex `Get Started(?! Free)`) | 0 |

- [ ] **Step 2: Run Astro type-check**

```
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Run all Vitest tests**

```
npx vitest run
```

Expected: all tests pass — Phase 1 (`faqs.test.ts` 5 tests) + Phase 2 (`kids-faqs.test.ts` 4 tests + `adults-faqs.test.ts` 3 tests). Pre-existing tests in `src/lib/` also continue passing.

- [ ] **Step 4: Run production build**

```
npm run build
```

Expected: completes without warnings. The 4-item Kids FAQPage JSON-LD and 4-item Adults FAQPage JSON-LD should be visible in the built `/kids-martial-arts/index.html` and `/adults-jiu-jitsu/index.html` source.

- [ ] **Step 5: Verify dist HTML for schema correctness**

Use the Grep tool with pattern `"@type":"BreadcrumbList"` in `dist/client/kids-martial-arts/index.html`. Expected: 1 match.
Use the Grep tool with pattern `"@type":"FAQPage"` in `dist/client/kids-martial-arts/index.html`. Expected: 1 match.
Use the Grep tool with pattern `"@type":"BreadcrumbList"` in `dist/client/adults-jiu-jitsu/index.html`. Expected: 1 match.
Use the Grep tool with pattern `"@type":"FAQPage"` in `dist/client/adults-jiu-jitsu/index.html`. Expected: 1 match.

- [ ] **Step 6: If all green, no commit needed (verification only)**

If any grep returns hits, fix the source file and re-run the verification before proceeding to Task 5.

---

### Task 5: Deploy preview + brief-alignment audit subagent + production promote

- [ ] **Step 1: Deploy a Vercel preview**

```
vercel deploy --yes
```

Capture the preview URL from the output (e.g., `https://graciebarrawebsite-xxxxx-zedricedwardcs-projects.vercel.app`).

- [ ] **Step 2: Manual visual smoke check on the preview URL**

Open `<preview-url>/kids-martial-arts/` and `<preview-url>/adults-jiu-jitsu/` in a browser. Confirm:
- Hero is a rounded card on a light-gray background
- View source shows `<h1 class="text-base md:text-lg ...">` with the brief's keyword phrase, and `<h2 class="text-3xl ...">` for the display heading
- 4 program cards on Kids page; 4 benefit cards with red icon circles on Adults page
- OptInForm renders with the kids photo on the left and the brief-aligned form copy on the right (both pages)
- Conversion CTA strip and FAQ are full-width navy bands BELOW the gray-wrapped sections
- All CTAs scroll to the OptInForm via `#trial` anchor

- [ ] **Step 3: Spawn the brief-alignment audit subagent**

Use the Agent tool with `subagent_type: general-purpose`. Prompt:

> Audit the Gracie Barra Whittier program pages against the client brief for Phase 2 only.
>
> Inputs:
> - Brief (extracted text): `C:\Users\herna\AppData\Local\Temp\gb_brief.txt`
> - Phase 2 spec: `docs/superpowers/specs/2026-05-06-phase2-program-pages-design.md`
> - Codebase: project root (Astro project)
> - Live preview URLs: `<paste preview URL>/kids-martial-arts/` and `<paste preview URL>/adults-jiu-jitsu/`
>
> Your task:
> 1. Read the brief Part 3 (Page-by-Page Copy & Design Guide) for the Kids page and the Adults page; also read the Phase 2 spec.
> 2. Build a flat checklist of every Phase-2-relevant requirement (one row per concrete requirement), grouped by page (Kids / Adults) and by area (Hero / Sections / OptInForm embed / Conversion CTA / FAQ / Schema / Meta / CTA labels). Do NOT include Phase 1, Phase 3, or Phase 4 items.
> 3. Verify each row by either grepping the codebase (with file path + line number citation) or fetching the preview URLs and inspecting rendered HTML.
> 4. Run the banned-string grep from the Phase 2 spec's Acceptance Criteria.
> 5. Verify FAQPage JSON-LD on each preview URL emits 4 question/answer pairs.
> 6. Verify BreadcrumbList JSON-LD on each preview URL emits 2 items (Home → page).
> 7. Output a single Markdown report with sections: **Summary** (PASS/FAIL/N/A counts), **Failures** (must-fix list with file/line refs), **Warnings** (review items), **Passes** (collapsed list).
>
> If preview URLs are gated by Vercel SSO/auth, fall back to inspecting `dist/client/kids-martial-arts/index.html` and `dist/client/adults-jiu-jitsu/index.html` directly.
>
> Pass criteria: zero FAIL items.

- [ ] **Step 4: Resolve any FAIL items the audit reports**

For each FAIL: open the cited file, fix the deviation, re-run `npx astro check` + `npm run build`, redeploy preview, re-spawn the audit. Repeat until clean.

- [ ] **Step 5: Commit any audit-driven fixes (if any)**

```
git add src/
git commit -m "fix(phase2): resolve brief-alignment audit findings"
```

If no fixes were needed, skip this commit.

- [ ] **Step 6: Promote to production**

```
vercel deploy --prod --yes
```

- [ ] **Step 7: Final smoke check on production**

Open `https://graciebarrawebsite.vercel.app/kids-martial-arts/` and `/adults-jiu-jitsu/` and re-confirm the manual checks from Step 2 against production HTML.

---

## Done criteria

Phase 2 is complete when:
1. All 5 tasks are checked off and committed.
2. The brief-alignment audit subagent returns zero FAILs.
3. Production deploy reflects all spec changes on visual inspection of both program pages.
4. `npx vitest run`, `npx astro check`, and `npm run build` all pass cleanly.
5. Phase 1 acceptance criteria continue to pass (homepage and booking flow regression-free).

After Phase 2 ships, the user starts Phase 3 brainstorm (Reviews + Contact + Kickstart polish).
