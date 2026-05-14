# Phase 4 â€” SEO + Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire GA4 events via GTM `dataLayer`, normalize OptInForm webhook `source` taxonomy, and verify brief Part 4 SEO infrastructure.

**Architecture:** Tiny `trackEvent` helper that pushes to `window.dataLayer`. Two integration sites: OptInForm `<script>` (generate_lead) and BookingFlow `<script>` (booking_initiated + booking_complete). Helper is SSR-safe and no-ops when `dataLayer` is absent.

**Tech Stack:** Astro 4, TypeScript, Tailwind v4, Vitest, GTM (env-gated).

**Source spec:** [docs/superpowers/specs/2026-05-06-phase4-seo-tracking-design.md](../specs/2026-05-06-phase4-seo-tracking-design.md)

---

## Pre-flight: state already in place

- `public/robots.txt` already disallows `/kickstart` + `/congrats` and references the sitemap
- `@astrojs/sitemap` integration already generates `sitemap-index.xml` at build
- `src/components/analytics/GTM.astro` already scaffolded, gated on `PUBLIC_GTM_ID`
- Schemas + canonicals already in place per Phase 1â€“3 audits
- Phase 4's actual work: 1 helper module, 2 wiring tasks, 1 verification pass

---

### Task 1: Create `src/lib/analytics.ts` + Vitest coverage

**Files:**
- Create: `src/lib/analytics.ts`
- Test: `src/lib/analytics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/analytics.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { trackEvent } from './analytics';

describe('trackEvent', () => {
  let originalWindow: typeof globalThis.window | undefined;

  beforeEach(() => {
    originalWindow = globalThis.window;
    // @ts-expect-error â€” test-only window stub
    globalThis.window = { dataLayer: [] };
  });

  afterEach(() => {
    // @ts-expect-error â€” restore
    globalThis.window = originalWindow;
  });

  it('pushes an event with the given name and payload', () => {
    trackEvent('generate_lead', { source: 'opt-in' });
    expect(globalThis.window!.dataLayer).toEqual([
      { event: 'generate_lead', source: 'opt-in' },
    ]);
  });

  it('pushes only the event name when no payload is provided', () => {
    trackEvent('booking_initiated');
    expect(globalThis.window!.dataLayer).toEqual([{ event: 'booking_initiated' }]);
  });

  it('no-ops when window is undefined (SSR)', () => {
    // @ts-expect-error â€” simulate SSR
    globalThis.window = undefined;
    expect(() => trackEvent('any', {})).not.toThrow();
  });

  it('no-ops when dataLayer is not an array (GTM not loaded)', () => {
    // @ts-expect-error â€” simulate GTM-disabled environment
    globalThis.window = {};
    expect(() => trackEvent('any', {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/lib/analytics.test.ts
```

Expected: FAIL â€” `Cannot find module './analytics'`.

- [ ] **Step 3: Create `src/lib/analytics.ts`**

```ts
/**
 * Pushes an event into the GTM dataLayer.
 * No-ops when dataLayer is absent (GTM not loaded, ad-blocker, dev without PUBLIC_GTM_ID).
 */
declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function trackEvent(name: string, payload: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(window.dataLayer)) return;
  window.dataLayer.push({ event: name, ...payload });
}
```

- [ ] **Step 4: Run tests to verify pass**

```
npx vitest run
```

Expected: all tests pass â€” Phase 1+2+3 (22 tests) + 4 new analytics tests = 26 total.

- [ ] **Step 5: Type-check**

```
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```
git add src/lib/analytics.ts src/lib/analytics.test.ts
git commit -m "feat(analytics): trackEvent helper for GTM dataLayer with SSR/no-GTM no-op"
```

---

### Task 2: Wire `generate_lead` in OptInForm + normalize `source` taxonomy

**Files:**
- Modify: `src/components/form/OptInForm.astro` (only the `<script>` block at the bottom)

- [ ] **Step 1: Read the current OptInForm script block**

Use the Read tool on `src/components/form/OptInForm.astro` to see the current `<script>` block (around lines 187â€“225). This task only edits the script block â€” leave the markup above it unchanged.

- [ ] **Step 2: Replace the script block**

Find the existing `<script>` block (starts with `<script>` and ends with `</script>` near the bottom of the file). Replace it with this exact content:

```astro
<script>
  import { trackEvent } from '../../lib/analytics';

  const forms = document.querySelectorAll<HTMLFormElement>('[data-optin-form]');
  forms.forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = form.querySelector<HTMLElement>('[data-optin-error]');
      errorEl?.classList.add('hidden');

      const data = new FormData(form);
      const name = String(data.get('name') ?? '').trim();
      const email = String(data.get('email') ?? '').trim();
      const phone = String(data.get('phone') ?? '').trim();

      if (!name || !email || !phone) {
        errorEl?.classList.remove('hidden');
        return;
      }

      const webhookEnv = (import.meta as ImportMeta).env?.PUBLIC_GHL_WEBHOOK_URL as
        | string
        | undefined;
      const target = webhookEnv && webhookEnv.length > 0 ? webhookEnv : '/api/leads-stub';
      const page = window.location.pathname;

      try {
        const res = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, phone, source: 'opt-in', page }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        trackEvent('generate_lead', { source: 'opt-in', page });
        const qs = new URLSearchParams({ name, email, phone });
        window.location.href = `/kickstart?${qs.toString()}`;
      } catch {
        errorEl?.classList.remove('hidden');
      }
    });
  });
</script>
```

- [ ] **Step 3: Type-check**

```
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Grep verification**

In `src/components/form/OptInForm.astro`:

| Pattern | Expected count |
|---|---|
| `import { trackEvent } from '../../lib/analytics'` | 1 |
| `source: 'opt-in'` | 2 (webhook body + trackEvent payload) |
| `trackEvent('generate_lead'` | 1 |
| `source: window.location.pathname` (the OLD shape) | 0 |

- [ ] **Step 5: Commit**

```
git add src/components/form/OptInForm.astro
git commit -m "feat(opt-in): fire generate_lead dataLayer event + normalize webhook source to 'opt-in'"
```

---

### Task 3: Wire `booking_initiated` + `booking_complete` in BookingFlow

**Files:**
- Modify: `src/components/booking/BookingFlow.astro`

- [ ] **Step 1: Read the current BookingFlow script**

Use the Read tool to inspect the controller `<script>` block in `src/components/booking/BookingFlow.astro`. Look for:
- The `state` object (where `step`, `program`, `bookings`, etc. are tracked)
- The `render()` function or step-rendering branches (for the `'date'` step trigger)
- The submit handler that POSTs to `/api/book` (for the success branch)

- [ ] **Step 2: Add the `trackEvent` import**

At the top of the controller `<script>` block (with the other imports), add:
```ts
import { trackEvent } from '../../lib/analytics';
```

- [ ] **Step 3: Add the `bookingInitiatedFired` module-state flag**

In the `<script>` block's module-level state section (where other `let` flags live), add:
```ts
let bookingInitiatedFired = false;
```

- [ ] **Step 4: Wire `booking_initiated`**

In the `render()` function (or wherever step transitions are handled), find the branch that handles `state.step === 'date'` (the calendar/date-picker rendering). At the top of that branch, add:

```ts
if (!bookingInitiatedFired) {
  trackEvent('booking_initiated', { program: state.program });
  bookingInitiatedFired = true;
}
```

If the step renderer dispatches a `booking:render` CustomEvent and the date step listens for it, place the trackEvent call inside the date-step listener, gated by the `bookingInitiatedFired` flag.

- [ ] **Step 5: Wire `booking_complete`**

In the booking submit handler â€” the block that POSTs to `/api/book` â€” find the success branch where `data.ok` is true and `state.bookings.push(...)` runs. After that line, add:

```ts
trackEvent('booking_complete', {
  appointmentId: data.appointmentId,
  program: state.program,
});
```

- [ ] **Step 6: Type-check**

```
npx astro check
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Grep verification**

In `src/components/booking/BookingFlow.astro`:

| Pattern | Expected count |
|---|---|
| `import { trackEvent } from '../../lib/analytics'` | 1 |
| `trackEvent('booking_initiated'` | 1 |
| `trackEvent('booking_complete'` | 1 |
| `bookingInitiatedFired` | â‰¥ 2 (declaration + check) |

- [ ] **Step 8: Commit**

```
git add src/components/booking/BookingFlow.astro
git commit -m "feat(booking): fire booking_initiated and booking_complete dataLayer events"
```

---

### Task 4: SEO audit pass + verification sweep

This task verifies brief Part 4 requirements are satisfied. Most should pass already from prior phases.

- [ ] **Step 1: Banned-string sweep**

Use the Grep tool for each pattern in `src/`:

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
| `dataLayer.push` (raw, not via helper) | 0 (only inside `analytics.ts` and `GTM.astro`'s gtm.js init script) |
| `source: window.location.pathname` (old OptInForm shape) | 0 |

- [ ] **Step 2: Type-check, tests, build**

```
npx astro check && npx vitest run && npm run build
```

Expected: all clean. Vitest count: 26 tests (Phase 1 + 2 + 3 + 4 helper).

- [ ] **Step 3: Verify built dist HTML â€” schema coverage**

Use the Grep tool with these patterns:

| Path | Pattern | Expected count |
|---|---|---|
| `dist/client/index.html` | `"@type":"FAQPage"` | 1 |
| `dist/client/index.html` | `"@type":"MartialArtsSchool"` | 1 |
| `dist/client/kids-martial-arts/index.html` | `"@type":"BreadcrumbList"` | 1 |
| `dist/client/kids-martial-arts/index.html` | `"@type":"FAQPage"` | 1 |
| `dist/client/adults-jiu-jitsu/index.html` | `"@type":"BreadcrumbList"` | 1 |
| `dist/client/adults-jiu-jitsu/index.html` | `"@type":"FAQPage"` | 1 |
| `dist/client/reviews/index.html` | `"@type":"BreadcrumbList"` | 1 |
| `dist/client/contact/index.html` | `"@type":"BreadcrumbList"` | 1 |
| `dist/client/contact/index.html` | `"@type":"MartialArtsSchool"` | 1 |

- [ ] **Step 4: Verify sitemap + robots**

Use the Grep tool:
- Pattern `Disallow: /kickstart` in `public/robots.txt` â€” 1 match
- Pattern `Disallow: /congrats` in `public/robots.txt` â€” 1 match
- File exists: `dist/client/sitemap-index.xml`
- File exists: `dist/client/sitemap-0.xml`

Read `dist/client/sitemap-0.xml` and confirm it lists at minimum: `/`, `/kids-martial-arts/`, `/adults-jiu-jitsu/`, `/reviews/`, `/contact/`. Does NOT list `/kickstart/` or `/congrats/` (or if it does, they have `<changefreq>` indicators â€” Astro auto-includes prerendered pages; funnel pages with `prerender = false` are excluded).

- [ ] **Step 5: If any check fails, fix inline**

For each gap: identify the page/file, apply the targeted fix, re-run the relevant grep. Then commit:

```
git add src/
git commit -m "fix(seo): resolve Phase 4 audit findings"
```

If no fixes needed, no commit.

- [ ] **Step 6: Verify canonical tags on all public pages**

Use the Grep tool with pattern `<link rel="canonical"` in `dist/client/*/index.html` and `dist/client/index.html`. Each public page should have exactly one match. Read each match to confirm the URL is `https://www.graciebarrawhittier.com/<path>/`.

---

### Task 5: Deploy preview + brief-alignment audit + production promote

- [ ] **Step 1: Deploy preview**

```
vercel deploy --yes
```

Capture the preview URL.

- [ ] **Step 2: Manual DevTools check for events**

On the preview:
1. Open homepage. Open DevTools console. Type `window.dataLayer` â€” should be defined (or a stub array). Submit the opt-in form. Watch the Network tab â€” POST body should have `source: "opt-in", page: "/"`. Then check `window.dataLayer` â€” last entry should be `{ event: 'generate_lead', source: 'opt-in', page: '/' }`.
2. Navigate to `/kickstart?name=Test` (or follow opt-in redirect). Complete the survey + trainee form. Once the calendar renders, check `window.dataLayer` â€” should contain `{ event: 'booking_initiated', program: '<program>' }` exactly once.
3. Complete a booking (if PUBLIC_GTM_ID is unset, this still fires â€” the no-op-on-missing-dataLayer happens elsewhere). Check `window.dataLayer` â€” should contain `{ event: 'booking_complete', appointmentId: '<id>', program: '<program>' }`.

If `PUBLIC_GTM_ID` is unset on the preview, `window.dataLayer` may not exist. In that case, the events still no-op cleanly. Verify by ensuring the form/booking flow doesn't error.

- [ ] **Step 3: Spawn brief-alignment audit subagent**

Use the Agent tool with `subagent_type: general-purpose`. Prompt:

> Audit Gracie Barra Whittier site against the client brief for Phase 4 only.
>
> Inputs:
> - Brief (extracted text): `C:\Users\herna\AppData\Local\Temp\gb_brief.txt`
> - Phase 4 spec: `docs/superpowers/specs/2026-05-06-phase4-seo-tracking-design.md`
> - Codebase: project root (Astro)
> - Live preview URL: `<paste preview>`
>
> Your task:
> 1. Read brief Part 4 (SEO Strategy) and Part 5 (GHL Integration / Tracking).
> 2. Build a flat checklist of every Phase-4-relevant requirement, grouped by area: Tracking events / Schema markup / Sitemap+robots / Canonicals / Source taxonomy.
> 3. Verify each row by grepping the codebase or reading dist HTML / preview HTML.
> 4. Confirm `trackEvent` is invoked for each of the three brief-mandated events.
> 5. Confirm OptInForm webhook now sends `source: 'opt-in', page: <path>` and Contact form sends `source: 'contact-form', page: <path>`.
> 6. Output Markdown report: Summary, Failures, Warnings, Passes (collapsed).
>
> Phase 4 out-of-scope: AI chat widget, /congrats rebuild, anything covered by Phase 1/2/3 audits.
>
> Pass criteria: zero FAIL items.

- [ ] **Step 4: Resolve any FAILs**

For each FAIL: open the cited file, fix, redeploy preview, re-spawn audit. Repeat until clean.

- [ ] **Step 5: Commit any audit-driven fixes**

```
git add src/
git commit -m "fix(phase4): resolve brief-alignment audit findings"
```

If no fixes, skip.

- [ ] **Step 6: Promote to production**

```
vercel deploy --prod --yes
```

- [ ] **Step 7: Smoke check on production**

Open `https://graciebarrawebsite.vercel.app/` in DevTools, submit the opt-in form, confirm `window.dataLayer` receives `generate_lead`. Same for booking flow on `/kickstart`.

---

## Done criteria

Phase 4 is complete when:
1. All 5 tasks are checked off (Tasks 1â€“3 with commits; Task 4 typically no-commit; Task 5 with deploy).
2. The brief-alignment audit subagent returns zero FAILs.
3. Production deploy fires all 3 dataLayer events for the relevant user actions.
4. `npx vitest run` (26 tests), `npx astro check` (0 errors), and `npm run build` (clean) all pass.
5. Phase 1, 2, and 3 acceptance criteria continue to pass.

After Phase 4 ships, all four brief-aligned phases are complete. The brief is fully implemented except for explicit deferrals (`/congrats`, AI chat widget) and external-system items (GHL workflow configuration, GA4 property setup).
