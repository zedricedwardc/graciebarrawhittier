# Phase 3 â€” Aux Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/reviews` and `/contact` to match brief Part 3 verbatim with bento-card visual; verify `/kickstart` against brief; defer `/congrats` per brief.

**Architecture:** Pure page-content + visual refactor. Two full page rewrites (`reviews.astro`, `contact.astro`), one verification-only pass on kickstart (likely zero edits), no new components, no API changes. Verification via grep + Vitest + `astro check` + brief-alignment audit subagent.

**Tech Stack:** Astro 4, TypeScript, Tailwind v4, Vitest, Vercel.

**Source spec:** [docs/superpowers/specs/2026-05-06-phase3-aux-pages-design.md](../specs/2026-05-06-phase3-aux-pages-design.md)

---

## Pre-flight: scope reconciliation

Pre-implementation grep + read shows:
- `src/pages/reviews.astro` (166 lines): has hero, reviews-widget placeholder, featured-quotes section, navy CTA section. Uses old edge-to-edge layout. Phase 3 = bento adaptation + brief copy + BreadcrumbList.
- `src/pages/contact.astro` (365 lines): has hero, NAP block + schedule, contact form (Name/Email/Phone/Message + `Send Message` submit), Google Map iframe, service-areas, navy CTA. Form already POSTs to a webhook with the right shape. Phase 3 = bento adaptation + meta + BreadcrumbList; ensure form POST body includes `source: 'contact-form'`.
- `src/pages/kickstart.astro` (103 lines): brief-aligned. Section 1 (header) âœ“, Section 2 (age routing) âœ“, Section 3 (BookingFlow) âœ“, Section 4 (What Happens Next) âœ“, Section 5 (Trust strip) âœ“. Phase 3 = verify only.

Real diff: 2 page rewrites + 1 verification (likely no commit).

---

### Task 1: Rewrite Reviews page (`src/pages/reviews.astro`)

Bento layout, hero with single visible H1 (no separate display H2), reviews widget placeholder, featured quotes from `src/content/reviews.ts`, final navy CTA, BreadcrumbList JSON-LD, brief-aligned meta.

**Files:**
- Modify: `src/pages/reviews.astro` (full overwrite)

- [ ] **Step 1: Overwrite the entire file**

Use the Write tool to overwrite `src/pages/reviews.astro` with EXACTLY this content:

```astro
---
export const prerender = true;
/**
 * /reviews â€” social-proof hub for Gracie Barra Whittier.
 * Copy aligned to build brief Part 3 Reviews section.
 */
import BaseLayout from '../layouts/BaseLayout.astro';
import CTAButton from '../components/cta/CTAButton.astro';
import SchemaBreadcrumb from '../components/seo/SchemaBreadcrumb.astro';
import { reviews } from '../content/reviews';

const breadcrumb = [
  { name: 'Home', url: 'https://www.graciebarrawhittier.com/' },
  { name: 'Reviews', url: 'https://www.graciebarrawhittier.com/reviews/' },
];
---

<BaseLayout
  title="Reviews â€” Gracie Barra Whittier | Brazilian Jiu-Jitsu in Whittier, CA"
  description="Read reviews from students and families training at Gracie Barra Whittier. See why families across Whittier, La Habra, La Mirada, and Pico Rivera trust us for kids and adult BJJ."
  canonical="https://www.graciebarrawhittier.com/reviews/"
>
  <div class="bg-gb-bg-light">
    {/* HERO â€” rounded card on light-gray background */}
    <section class="px-4 md:px-6 pt-6 md:pt-8">
      <div class="max-w-7xl mx-auto bg-gb-navy rounded-2xl overflow-hidden relative isolate shadow-lg">
        <div class="absolute inset-0 -z-10 bg-gradient-to-br from-gb-navy via-gb-navy/95 to-gb-navy-dark"></div>
        <div class="px-6 md:px-10 lg:px-14 py-12 md:py-16 lg:py-20 max-w-3xl text-gb-white">
          <p class="text-xs md:text-sm font-semibold uppercase text-gb-gold tracking-wide mb-4">
            Reviews â€” Gracie Barra Whittier
          </p>
          <h1 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05] mb-5">
            What Students Say About Gracie Barra Whittier
          </h1>
          <p class="text-base md:text-lg text-gb-white/90 leading-relaxed max-w-2xl mb-7">
            Real reviews from real families in Whittier, La Habra, La Mirada, and Pico Rivera.
          </p>
          <CTAButton variant="primary" label="Start My Free Trial" href="/#trial" />
        </div>
      </div>
    </section>

    {/* LIVE REVIEWS WIDGET */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-5xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10">
        <div class="text-center mb-6">
          <h2 class="text-2xl md:text-4xl font-extrabold text-gb-navy">Live Google Reviews</h2>
          <p class="mt-2 text-sm text-gb-text-muted">Powered by Google Reviews â€” updated in real time</p>
        </div>
        <div id="reviews-widget" class="bg-gb-bg-light rounded-xl p-6 md:p-8 text-center text-gb-text-muted">
          Reviews loading...
        </div>
      </div>
    </section>

    {/* FEATURED REVIEW QUOTES */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-6xl mx-auto">
        <div class="text-center mb-10 md:mb-12">
          <h2 class="text-2xl md:text-4xl font-extrabold text-gb-navy">Stories From the Mat</h2>
          <p class="mt-3 text-sm md:text-base text-gb-text-muted max-w-2xl mx-auto leading-relaxed">
            What students and families across Whittier are saying about training at Gracie Barra Whittier.
          </p>
        </div>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {reviews.map((r) => (
            <article class="bg-gb-white rounded-2xl shadow-sm p-5 md:p-6 flex flex-col">
              <div class="flex gap-0.5 text-gb-gold mb-3" aria-label={`${r.rating} out of 5 stars`}>
                {Array.from({ length: r.rating }).map(() => (
                  <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M9.05 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.367 2.446a1 1 0 00-.364 1.118l1.287 3.957c.3.922-.755 1.688-1.54 1.118l-3.366-2.446a1 1 0 00-1.176 0l-3.366 2.446c-.785.57-1.84-.196-1.54-1.118l1.286-3.957a1 1 0 00-.363-1.118L2.073 9.384c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.951-.69l1.286-3.957z" />
                  </svg>
                ))}
              </div>
              <p class="text-sm text-gb-text leading-relaxed flex-1">"{r.quote}"</p>
              <div class="mt-4 pt-4 border-t border-gb-bg-light">
                <p class="text-sm font-semibold text-gb-navy">{r.name}</p>
                <p class="text-xs text-gb-text-muted">{r.role}</p>
              </div>
            </article>
          ))}
        </div>
        <p class="mt-8 text-xs text-gb-text-muted text-center">Placeholder quotes pending publication of real reviews.</p>
      </div>
    </section>
  </div>

  {/* FINAL CTA â€” full-width navy band */}
  <section class="bg-gb-navy text-gb-white py-14 md:py-20 px-4 md:px-6">
    <div class="max-w-3xl mx-auto text-center">
      <h2 class="text-2xl md:text-4xl font-extrabold">Ready to write your own success story?</h2>
      <p class="mt-4 text-sm md:text-base text-gb-white/85 leading-relaxed">
        Try 3 classes free at Gracie Barra Whittier. No risk, no contracts, free uniform rental included.
      </p>
      <div class="mt-7 flex justify-center">
        <CTAButton variant="primary" label="Claim My Free 3-Class Pass" href="/#trial" />
      </div>
      <p class="mt-4 text-xs text-gb-white/70">3 free classes â€¢ Free uniform rental â€¢ No contracts</p>
    </div>
  </section>

  <SchemaBreadcrumb items={breadcrumb} />
</BaseLayout>
```

- [ ] **Step 2: Type-check**

```
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Grep verification**

In `src/pages/reviews.astro`:

| Pattern | Expected count |
|---|---|
| `Get My Free Class` | 0 |
| `<h1 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl` | 1 |
| `Start My Free Trial` | 1 |
| `Claim My Free 3-Class Pass` | 1 |
| `What Students Say About Gracie Barra Whittier` | 1 |
| `SchemaBreadcrumb` | 2 (1 import, 1 render) |

- [ ] **Step 4: Commit**

```
git add src/pages/reviews.astro
git commit -m "feat(reviews): rebuild Reviews page per Phase 3 spec â€” bento layout, brief copy, BreadcrumbList"
```

---

### Task 2: Rewrite Contact page (`src/pages/contact.astro`)

Bento layout, brief-aligned NAP/schedule/form/map/service-areas, contact form gets `source: 'contact-form'` field on POST so GHL workflow can branch, BreadcrumbList + LocalBusiness JSON-LD, brief-aligned meta.

**Files:**
- Modify: `src/pages/contact.astro` (full overwrite)

- [ ] **Step 1: Overwrite the entire file**

Use the Write tool to overwrite `src/pages/contact.astro` with EXACTLY this content:

```astro
---
export const prerender = true;
/**
 * /contact â€” contact form, NAP block, map, service areas.
 * Copy aligned to build brief Part 3 Contact section.
 */
import BaseLayout from '../layouts/BaseLayout.astro';
import CTAButton from '../components/cta/CTAButton.astro';
import SchemaBreadcrumb from '../components/seo/SchemaBreadcrumb.astro';
import SchemaLocalBusiness from '../components/seo/SchemaLocalBusiness.astro';
import { nap } from '../content/nap';

const breadcrumb = [
  { name: 'Home', url: 'https://www.graciebarrawhittier.com/' },
  { name: 'Contact', url: 'https://www.graciebarrawhittier.com/contact/' },
];

interface ScheduleRow {
  day: string;
  classes: string[];
}

const schedule: ScheduleRow[] = [
  {
    day: 'Monday â€“ Thursday',
    classes: [
      '11:00 AM â€” Adults Fundamentals',
      '12:00 PM â€” Adults Advanced',
      '3:00 PM â€“ 7:00 PM â€” Kids classes (varying age groups by hour)',
      '7:00 PM â€” Adults Fundamentals',
      '8:00 PM â€” Adults Advanced (No Gi / Gi alternating)',
    ],
  },
  {
    day: 'Friday',
    classes: [
      '4:00 PM â€” Top Team (invite only)',
      '7:00 PM â€” Open Mat (all levels)',
    ],
  },
  {
    day: 'Saturday',
    classes: [
      '10:00 AM â€” Little Champs 1 & 2',
      '11:00 AM â€” Juniors BJJ + Adults Fundamentals',
      '12:00 PM â€” Adults Fundamentals',
      '1:00 PM â€” Adults Advanced',
    ],
  },
  {
    day: 'Sunday',
    classes: ['No classes â€” see you Monday'],
  },
];
---

<BaseLayout
  title="Contact Us | Gracie Barra Whittier â€” Whittier, CA"
  description="Visit Gracie Barra Whittier at 13595 Whittier Blvd. #104, Whittier, CA 90605. Call (562) 640-1400 or email info@gbwhittier.com to claim your Free 3-Class Pass."
  canonical="https://www.graciebarrawhittier.com/contact/"
>
  <div class="bg-gb-bg-light">
    {/* HERO â€” rounded card on light-gray bg */}
    <section class="px-4 md:px-6 pt-6 md:pt-8">
      <div class="max-w-7xl mx-auto bg-gb-navy rounded-2xl overflow-hidden relative isolate shadow-lg">
        <div class="absolute inset-0 -z-10 bg-gradient-to-br from-gb-navy via-gb-navy/95 to-gb-navy-dark"></div>
        <div class="px-6 md:px-10 lg:px-14 py-12 md:py-16 lg:py-20 max-w-3xl text-gb-white">
          <p class="text-xs md:text-sm font-semibold uppercase text-gb-gold tracking-wide mb-4">
            Contact Gracie Barra Whittier
          </p>
          <h1 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.05] mb-5">
            Contact Gracie Barra Whittier
          </h1>
          <p class="text-base md:text-lg text-gb-white/90 leading-relaxed max-w-2xl mb-7">
            Drop in, call, email, or send a message. We answer every inquiry.
          </p>
          <CTAButton variant="primary" label="Claim My Free 3-Class Pass" href="/#trial" />
        </div>
      </div>
    </section>

    {/* NAP + SCHEDULE â€” two-column white card */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-6xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10">
        <div class="grid md:grid-cols-2 gap-8 md:gap-12">
          <div>
            <h2 class="text-xl md:text-2xl font-extrabold text-gb-navy">Visit, Call, or Email</h2>
            <address class="not-italic mt-4 text-sm md:text-base text-gb-text space-y-2">
              <div class="font-semibold">{nap.name}</div>
              <div>{nap.streetAddress}</div>
              <div>{nap.addressLocality}, {nap.addressRegion} {nap.postalCode}</div>
              <div>
                <a href={`tel:${nap.phoneTel}`} class="inline-flex items-center min-h-[44px] py-2 text-gb-navy font-semibold hover:text-gb-red transition-colors">
                  {nap.phone}
                </a>
              </div>
              <div>
                <a href={`mailto:${nap.email}`} class="inline-flex items-center min-h-[44px] py-2 text-gb-navy font-semibold hover:text-gb-red transition-colors">
                  {nap.email}
                </a>
              </div>
            </address>
          </div>
          <div>
            <h2 class="text-xl md:text-2xl font-extrabold text-gb-navy">Class Schedule</h2>
            <p class="mt-2 text-sm text-gb-text-muted">Drop-in times for our weekly Brazilian Jiu-Jitsu and kids martial arts classes.</p>
            <dl class="mt-4 space-y-4">
              {schedule.map((row) => (
                <div>
                  <dt class="font-semibold text-gb-navy">{row.day}</dt>
                  <dd class="mt-1">
                    <ul class="list-disc list-inside text-sm md:text-base text-gb-text space-y-1">
                      {row.classes.map((c) => <li>{c}</li>)}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>

    {/* CONTACT FORM */}
    <section class="px-4 md:px-6 py-12 md:py-16" aria-labelledby="contact-form-heading">
      <div class="max-w-xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10">
        <h2 id="contact-form-heading" class="text-2xl md:text-3xl font-extrabold text-gb-navy text-center">
          Send Us a Message
        </h2>
        <p class="mt-2 text-center text-sm text-gb-text-muted">
          Have a question? We'll get back to you within one business day.
        </p>

        <form data-contact-form class="mt-6 space-y-4" novalidate>
          <div>
            <label for="contact-name" class="block text-sm font-medium text-gb-text mb-1">Full Name</label>
            <input
              id="contact-name"
              name="name"
              type="text"
              inputmode="text"
              autocomplete="name"
              required
              class="w-full h-12 px-4 rounded-lg border border-gb-bg-light bg-gb-white text-gb-text placeholder-gb-text-muted focus:outline-none focus:ring-2 focus:ring-gb-red focus:border-gb-red"
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label for="contact-email" class="block text-sm font-medium text-gb-text mb-1">Email</label>
            <input
              id="contact-email"
              name="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              required
              class="w-full h-12 px-4 rounded-lg border border-gb-bg-light bg-gb-white text-gb-text placeholder-gb-text-muted focus:outline-none focus:ring-2 focus:ring-gb-red focus:border-gb-red"
              placeholder="jane@example.com"
            />
          </div>
          <div>
            <label for="contact-phone" class="block text-sm font-medium text-gb-text mb-1">Phone</label>
            <input
              id="contact-phone"
              name="phone"
              type="tel"
              inputmode="tel"
              autocomplete="tel-national"
              required
              class="w-full h-12 px-4 rounded-lg border border-gb-bg-light bg-gb-white text-gb-text placeholder-gb-text-muted focus:outline-none focus:ring-2 focus:ring-gb-red focus:border-gb-red"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label for="contact-message" class="block text-sm font-medium text-gb-text mb-1">
              Message <span class="text-gb-text-muted font-normal">(optional)</span>
            </label>
            <textarea
              id="contact-message"
              name="message"
              rows="5"
              class="w-full min-h-[120px] px-4 py-3 rounded-lg border border-gb-bg-light bg-gb-white text-gb-text placeholder-gb-text-muted focus:outline-none focus:ring-2 focus:ring-gb-red focus:border-gb-red"
              placeholder="Tell us a bit about who you'd like to train (kid's age, your goals, etc.)"
            ></textarea>
          </div>

          <CTAButton variant="formSubmit" type="submit" label="Send Message" fullWidth={true} />

          <p
            data-contact-success
            class="hidden text-center text-gb-navy bg-gb-bg-light rounded-lg p-4"
            role="status"
          >
            Thanks for reaching out! We'll be in touch within one business day.
          </p>
          <p data-contact-error class="hidden text-sm text-gb-red text-center" role="alert">
            Something went wrong sending your message. Please try again or call us directly.
          </p>

          <p class="text-[11px] leading-relaxed text-gb-text-muted text-center">
            By submitting, you agree to be contacted by Gracie Barra Whittier about your inquiry.
          </p>
        </form>
      </div>
    </section>

    {/* GOOGLE MAP â€” lazy-loaded below the fold */}
    <section class="px-4 md:px-6 py-12 md:py-16" aria-labelledby="map-heading">
      <div class="max-w-6xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10">
        <h2 id="map-heading" class="text-2xl md:text-3xl font-extrabold text-gb-navy text-center">Find Us</h2>
        <p class="mt-2 text-center text-sm text-gb-text-muted">
          {nap.streetAddress}, {nap.addressLocality}, {nap.addressRegion} {nap.postalCode}
        </p>
        <div class="mt-6 aspect-video rounded-xl overflow-hidden border border-gb-bg-light">
          <iframe
            title="Map showing Gracie Barra Whittier at 13595 Whittier Blvd #104, Whittier, CA 90605"
            src="https://www.google.com/maps?q=13595+Whittier+Blvd+%23104,+Whittier,+CA+90605&output=embed"
            class="w-full h-full"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
          ></iframe>
        </div>
      </div>
    </section>

    {/* SERVICE AREAS */}
    <section class="px-4 md:px-6 py-12 md:py-16">
      <div class="max-w-3xl mx-auto bg-gb-white rounded-2xl shadow-sm p-6 md:p-10 text-center">
        <h2 class="text-2xl md:text-3xl font-extrabold text-gb-navy">Serving the Greater Whittier Area</h2>
        <p class="mt-4 text-sm md:text-base text-gb-text-muted leading-relaxed">
          Gracie Barra Whittier is conveniently located on Whittier Blvd and easily accessible from Whittier, La Habra, La Mirada, and Pico Rivera.
        </p>
      </div>
    </section>
  </div>

  {/* FINAL CTA â€” full-width navy band */}
  <section class="bg-gb-navy text-gb-white py-14 md:py-20 px-4 md:px-6">
    <div class="max-w-3xl mx-auto text-center">
      <h2 class="text-2xl md:text-4xl font-extrabold">Ready to step on the mat?</h2>
      <p class="mt-4 text-sm md:text-base text-gb-white/85 leading-relaxed">
        Try 3 classes free. No risk, no contracts, free uniform rental included.
      </p>
      <div class="mt-7 flex justify-center">
        <CTAButton variant="primary" label="Claim My Free 3-Class Pass" href="/#trial" />
      </div>
      <p class="mt-4 text-xs text-gb-white/70">3 free classes â€¢ Free uniform rental â€¢ No contracts</p>
    </div>
  </section>

  <SchemaBreadcrumb items={breadcrumb} />
  <SchemaLocalBusiness />
</BaseLayout>

<script>
  const forms = document.querySelectorAll<HTMLFormElement>('[data-contact-form]');
  forms.forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const successEl = form.querySelector<HTMLElement>('[data-contact-success]');
      const errorEl = form.querySelector<HTMLElement>('[data-contact-error]');
      successEl?.classList.add('hidden');
      errorEl?.classList.add('hidden');

      const data = new FormData(form);
      const name = String(data.get('name') ?? '').trim();
      const email = String(data.get('email') ?? '').trim();
      const phone = String(data.get('phone') ?? '').trim();
      const message = String(data.get('message') ?? '').trim();

      if (!name || !email || !phone) {
        errorEl?.classList.remove('hidden');
        return;
      }

      const webhookEnv = (import.meta as ImportMeta).env?.PUBLIC_GHL_WEBHOOK_URL as
        | string
        | undefined;
      const target = webhookEnv && webhookEnv.length > 0 ? webhookEnv : '/api/leads-stub';

      try {
        const res = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            phone,
            message,
            source: 'contact-form',
            page: window.location.pathname,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        form.reset();
        successEl?.classList.remove('hidden');
      } catch {
        errorEl?.classList.remove('hidden');
      }
    });
  });
</script>
```

- [ ] **Step 2: Type-check**

```
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Grep verification**

In `src/pages/contact.astro`:

| Pattern | Expected count |
|---|---|
| `Get My Free Class` | 0 |
| `Free First Class` | 0 |
| `<h1 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl` | 1 |
| `Send Message` | 1 (form submit label) |
| `Claim My Free 3-Class Pass` | 2 (hero + final CTA) |
| `source: 'contact-form'` | 1 |
| `loading="lazy"` (the map iframe) | 1 |
| `SchemaBreadcrumb` | 2 (import + render) |
| `SchemaLocalBusiness` | 2 (import + render) |

- [ ] **Step 4: Commit**

```
git add src/pages/contact.astro
git commit -m "feat(contact): rebuild Contact page per Phase 3 spec â€” bento layout, NAP/schedule/form/map/service-areas, contact-form source tag"
```

---

### Task 3: Verify Kickstart page against brief

Kickstart is structurally aligned to brief Part 3 already. This task verifies and only edits if a deviation is found.

**Files:**
- Maybe modify: `src/pages/kickstart.astro` (only if a brief mismatch is found)

- [ ] **Step 1: Read the current `src/pages/kickstart.astro`**

Use the Read tool to read the full file. Compare against brief Part 3 (Kickstart) requirements:

| Brief requirement | Verification |
|---|---|
| H1: `You're In, [First Name]! Your Free 3-Class Pass Is Reserved.` | Search file for `Your Free 3-Class Pass Is Reserved` â€” must be present in `<h1>` and in the JS interpolation script. |
| Subtitle paragraph beginning `One last step` | Must be present. |
| Section 2 H2: `Not sure which program to choose?` + age-to-program map (5 bullets, 3-4/5-6/7-9/10-15/16+) | Must be present. |
| Section 4 H2: `What Happens Next` + 3-step list | Must be present with 3 list items. |
| Section 5 trust strip: includes `Free uniform rental included`, `No contracts`, `No pressure`, `World-class Gracie Barra curriculum` | Must be present. |
| No `<Nav>` or `<Footer>` (uses `<FunnelLayout>`) | `<FunnelLayout>` is the wrapper â€” no `BaseLayout`. |
| No banned strings | Grep for `Get My Free Class`, `Free First Class`, `Click Here`, `>Submit<`, `label="Submit"`, `Get Started(?! Free)` â€” all 0. |

- [ ] **Step 2: Run grep checks**

For each pattern below in `src/pages/kickstart.astro`, expected match counts:

| Pattern | Expected count |
|---|---|
| `Your Free 3-Class Pass Is Reserved` | â‰¥ 1 (in static `<h1>`; the JS interpolation reuses the same text) |
| `Not sure which program to choose?` | 1 |
| `What Happens Next` | 1 |
| `Free uniform rental included` | 1 |
| `Get My Free Class` | 0 |
| `FunnelLayout` | 1 (the layout wrapper) |

- [ ] **Step 3: If all checks pass, no commit needed**

If all 6 brief requirements are present and grep is clean, this task is a no-op. Skip Step 4.

- [ ] **Step 4: If a deviation is found, fix it inline**

For each deviation: apply a targeted Edit to `src/pages/kickstart.astro`. Re-run the grep check. Then commit:

```
git add src/pages/kickstart.astro
git commit -m "fix(kickstart): align copy with brief Part 3"
```

If no edit was needed, do not commit.

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

Expected: all 22 tests pass (Phase 1 + Phase 2; Phase 3 adds no new tests).

- [ ] **Step 4: Run production build**

```
npm run build
```

Expected: completes without warnings.

- [ ] **Step 5: Verify dist HTML for schema**

Use the Grep tool with pattern `"@type":"BreadcrumbList"` in `dist/client/reviews/index.html`. Expected: 1 match.
Use the Grep tool with pattern `"@type":"BreadcrumbList"` in `dist/client/contact/index.html`. Expected: 1 match.
Use the Grep tool with pattern `"@type":"LocalBusiness"` in `dist/client/contact/index.html`. Expected: 1 match (Contact has its own LocalBusiness schema).

- [ ] **Step 6: If all green, no commit needed (verification only)**

---

### Task 5: Deploy preview + brief-alignment audit + production promote

- [ ] **Step 1: Deploy a Vercel preview**

```
vercel deploy --yes
```

Capture the preview URL.

- [ ] **Step 2: Smoke check preview**

Open `<preview>/reviews/`, `<preview>/contact/`, `<preview>/kickstart/` (if not gated by SSO) and confirm:
- Reviews: hero with single visible H1, reviews-widget placeholder, 4 quote cards, navy final CTA
- Contact: hero, NAP + schedule two-column, contact form (Send Message), Google Map iframe, service-areas, navy final CTA
- Kickstart: confirmation header, age guide, BookingFlow, What Happens Next, trust strip â€” no nav/footer

- [ ] **Step 3: Spawn brief-alignment audit subagent**

Use the Agent tool with `subagent_type: general-purpose`. Prompt:

> Audit Gracie Barra Whittier aux pages against the client brief for Phase 3 only.
>
> Inputs:
> - Brief (extracted text): `C:\Users\herna\AppData\Local\Temp\gb_brief.txt`
> - Phase 3 spec: `docs/superpowers/specs/2026-05-06-phase3-aux-pages-design.md`
> - Codebase: project root (Astro)
> - Live preview URLs: `<preview>/reviews/`, `<preview>/contact/`, `<preview>/kickstart/`
>
> Your task:
> 1. Read brief Part 3 sections "Page: Reviews", "Page: Contact Us", "Page: Kickstart Page". Read Phase 3 spec.
> 2. Build a flat checklist of every Phase-3-relevant requirement, grouped by page (Reviews / Contact / Kickstart) and area (Hero / Sections / CTAs / Schema / Meta). Do NOT include Phase 1, Phase 2, or Phase 4 items.
> 3. Verify each row by greping the codebase or fetching preview HTML. If preview is 401-gated by Vercel SSO, fall back to `dist/client/reviews/index.html`, `dist/client/contact/index.html`, `dist/client/kickstart/index.html`.
> 4. Run banned-string sweep across `src/`.
> 5. Verify BreadcrumbList JSON-LD on Reviews (2 items) and Contact (2 items); LocalBusiness on Contact.
> 6. Output Markdown report: Summary (PASS/FAIL/N/A counts), Failures, Warnings, Passes (collapsed).
>
> Note: `Send Message` is the brief-mandated submit label on the contact form â€” do NOT flag it as a banned-string violation. Allowed CTA labels: `Claim My Free 3-Class Pass`, `Start My Free Trial`, `Learn More`, `Get Started Free`, `Send Message`.
>
> Pass criteria: zero FAIL items.

- [ ] **Step 4: Resolve any FAILs**

Fix each cited deviation. Re-run `npx astro check` + `npm run build`. Redeploy preview. Re-spawn audit. Repeat until clean.

- [ ] **Step 5: Commit any audit-driven fixes**

```
git add src/
git commit -m "fix(phase3): resolve brief-alignment audit findings"
```

If no fixes needed, skip.

- [ ] **Step 6: Promote to production**

```
vercel deploy --prod --yes
```

- [ ] **Step 7: Final smoke check on production**

```
curl -s "https://graciebarrawebsite.vercel.app/reviews/" | grep -i '<h1'
curl -s "https://graciebarrawebsite.vercel.app/contact/" | grep -i '<h1'
curl -s "https://graciebarrawebsite.vercel.app/kickstart/" | grep -i '<h1'
```

Expected: each returns one `<h1>` line. Reviews `<h1>` contains `What Students Say About Gracie Barra Whittier`; Contact `<h1>` contains `Contact Gracie Barra Whittier`; Kickstart `<h1>` contains `Your Free 3-Class Pass Is Reserved`.

---

## Done criteria

Phase 3 is complete when:
1. All 5 tasks are checked off (Tasks 1â€“2 with commits; Tasks 3â€“4 typically no-commits; Task 5 with deploy).
2. The brief-alignment audit subagent returns zero FAILs.
3. Production deploy reflects all spec changes on visual inspection of `/reviews/`, `/contact/`, and `/kickstart/`.
4. `npx vitest run`, `npx astro check`, and `npm run build` all pass cleanly.
5. Phase 1 and Phase 2 acceptance criteria continue to pass (homepage, Kids, Adults regression-free).

After Phase 3 ships, Phase 4 (SEO + tracking infrastructure) becomes the next brainstorm target.
