# Phase 4 â€” SEO + Tracking Infrastructure Design Spec

**Date:** 2026-05-06
**Source brief:** `GB_Whittier_Website_Build_Brief (1).docx`, Part 4 (SEO Strategy) + Part 5 (GHL Integration / Tracking)
**Phase:** 4 of 4 in the Brief Implementation roadmap (offer alignment âœ… â†’ program pages âœ… â†’ aux pages âœ… â†’ **SEO/tracking**)
**Predecessors:** [Phase 1](./2026-05-06-phase1-offer-global-polish-design.md), [Phase 2](./2026-05-06-phase2-program-pages-design.md), [Phase 3](./2026-05-06-phase3-aux-pages-design.md) (all shipped)

## Context

Phases 1â€“3 aligned all visible page content with the brief. Phase 4 finishes brief-required infrastructure that's behind the scenes:

- **Tracking:** brief Part 5 mandates GA4 events on `generate_lead` (form submit), `booking_initiated` (kickstart calendar loaded), and `booking_complete` (booking submission). Currently `GTM.astro` is scaffolded but no events fire. Gap closes here.
- **SEO:** brief Part 4 mandates schema markup, canonical tags, sitemap, and robots.txt blocking funnel pages. All four are already in place from prior phases â€” Phase 4 verifies and documents.
- **Webhook source taxonomy:** Phase 3 reviewer flagged that OptInForm sends `source: window.location.pathname` while Contact form sends `source: 'contact-form'` â€” same field, two semantics. Phase 4 normalizes OptInForm to match Contact's pattern.

## Goals

- All three brief-mandated GA4 events fire reliably through GTM `dataLayer`:
  - `generate_lead` on successful homepage/program-page opt-in form submission, payload includes `source` and `page`
  - `booking_initiated` when the booking calendar first renders to the user (after program survey + trainee form, when slots load)
  - `booking_complete` on a `200 { ok: true, appointmentId }` response from `/api/book`, payload includes `appointmentId` and `program`
- OptInForm webhook payload uses consistent taxonomy: `{ source: 'opt-in', page: window.location.pathname, ...formFields }`. Contact form already uses `{ source: 'contact-form', page: window.location.pathname, ... }` â€” both shapes now match.
- Schema/canonical/sitemap/robots audit confirms zero gaps against brief Part 4. No code changes expected; verification only.
- Phase 1â€“3 acceptance criteria continue to pass.

## Non-goals

- AI chat widget GHL integration (separate, integration-driven)
- `/congrats` page rebuild (deferred per brief)
- Move Contact schedule to a content module (cosmetic; not blocking)
- LocalBusiness schema field expansion (current `MartialArtsSchool` covers brief Part 4)
- Any new pages or content rewrites

## Files touched

| File | Change |
|---|---|
| `src/lib/analytics.ts` | Create â€” tiny helper `trackEvent(name, payload)` that no-ops when `dataLayer` is absent (e.g., `PUBLIC_GTM_ID` unset, ad-blocker in dev) |
| `src/lib/analytics.test.ts` | Create â€” Vitest unit tests for `trackEvent` |
| `src/components/form/OptInForm.astro` | Modify the submit `<script>` block â€” call `trackEvent('generate_lead', ...)` on success, change webhook body to `{ source: 'opt-in', page, ...fields }` |
| `src/components/booking/BookingFlow.astro` | Modify the booking flow â€” fire `trackEvent('booking_initiated')` when `step` first becomes `'date'` (calendar step), fire `trackEvent('booking_complete', { appointmentId, program })` on `/api/book` 200 response |

Approximate diff: 4 files (2 new, 2 modified). Vitest covers the helper; the integration points are wired in plain JS where the existing form/flow logic already runs. No new dependencies.

## Tracking helper (`src/lib/analytics.ts`)

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

The `Window` interface declaration lives inside `analytics.ts` so it's globally available wherever the helper imports. Returns `void`. Module-level guard means the function is safe to call from any client `<script>`.

## OptInForm changes (`src/components/form/OptInForm.astro`)

Inside the existing `<script>` block at the bottom of the file, two edits:

**Change 1 â€” webhook body taxonomy:**

From:
```ts
body: JSON.stringify({ name, email, phone, source: window.location.pathname }),
```

To:
```ts
body: JSON.stringify({ name, email, phone, source: 'opt-in', page: window.location.pathname }),
```

**Change 2 â€” fire `generate_lead` on success:**

After the existing line `if (!res.ok) throw new Error(...)`, before the redirect, add:
```ts
trackEvent('generate_lead', { source: 'opt-in', page: window.location.pathname });
```

Import the helper at the top of the script:
```ts
import { trackEvent } from '../../lib/analytics';
```

Astro `<script>` blocks already support TS imports â€” no build config changes.

## BookingFlow changes (`src/components/booking/BookingFlow.astro`)

The booking flow has multiple states. Brief defines two trigger points:

- **`booking_initiated`** â€” fires once per page session when the calendar UI first becomes visible to the user. The natural trigger is the transition into the `'date'` step (after `'survey'` and `'form'`/'`form_returning`'). Use a module-level `let initiatedFired = false` flag so it fires exactly once.
- **`booking_complete`** â€” fires on a successful `/api/book` POST returning `{ ok: true, appointmentId }`. Payload: `{ appointmentId, program }`.

**Implementation in the existing controller `<script>` block:**

Import the helper:
```ts
import { trackEvent } from '../../lib/analytics';
```

Add a top-level flag near the other module state:
```ts
let bookingInitiatedFired = false;
```

In the `render()` function (or wherever step transitions are handled), at the top of the branch that renders the `'date'` step, add:
```ts
if (!bookingInitiatedFired) {
  trackEvent('booking_initiated', { program: state.program });
  bookingInitiatedFired = true;
}
```

In the booking submit handler, after the existing `if (data.ok)` branch where `state.bookings.push(...)` runs, add:
```ts
trackEvent('booking_complete', {
  appointmentId: data.appointmentId,
  program: state.program,
});
```

Both calls are inside an existing client-only script â€” no SSR concerns.

## Vitest coverage (`src/lib/analytics.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

## SEO audit (verification only â€” no code changes expected)

Phase 4 includes a verification pass to confirm brief Part 4 requirements are satisfied:

- One `<h1>` per page; H2/H3 hierarchy without skipped levels
- Canonical tag with `https://www.graciebarrawhittier.com/<path>/` on every public page
- LocalBusiness/MartialArtsSchool schema on Home + Contact
- FAQPage schema on Home, Kids, Adults
- BreadcrumbList schema on Kids, Adults, Reviews, Contact
- `sitemap-index.xml` lists every public page (excludes `/kickstart`, `/congrats` per `prerender = false`/funnel marking)
- `robots.txt` disallows `/kickstart` and `/congrats`
- All images in `src/pages/**/*.astro` have descriptive `alt` text including location keyword where natural

If audit finds gaps, address inline. Otherwise, no commits.

## Acceptance criteria

**Manual checks (Vercel preview deploy):**

- Opening DevTools â†’ Network â†’ submit homepage opt-in form â†’ see POST to `PUBLIC_GHL_WEBHOOK_URL` with body `{ name, email, phone, source: 'opt-in', page: '/' }`. After response, see a `dataLayer.push({ event: 'generate_lead', source: 'opt-in', page: '/' })` call (visible via `window.dataLayer` console inspection if GTM is unset).
- Open `/kickstart`, complete the survey + trainee form, see calendar render. Inspect `window.dataLayer` â€” exactly one entry with `event: 'booking_initiated'` regardless of how many times you switch dates.
- Complete a booking. Inspect `window.dataLayer` â€” one entry with `event: 'booking_complete'`, `appointmentId`, and `program`.

**Automated:**
- `npx astro check` â†’ 0 errors, 0 warnings
- `npx vitest run` â†’ all tests pass (Phase 1+2+3 + new `analytics.test.ts` cases)
- `npm run build` â†’ completes without warnings

**Grep checks:**
- `dataLayer.push` references in code: 0 (only `trackEvent` is called; the helper handles the push)
- `import { trackEvent }` present in `OptInForm.astro` and `BookingFlow.astro`
- `'opt-in'` source string in OptInForm
- `'contact-form'` source string in `contact.astro` (unchanged from Phase 3)

**Regression non-goals:**
- All Phase 1â€“3 acceptance still passes
- `/api/book` and `/api/availability` continue to function
- Form submission still POSTs to webhook and redirects to `/kickstart`
- Booking flow continues to write contact + appointment to GHL via the API routes

## Brief-alignment audit

Same protocol as prior phases, scoped to Phase 4:
- Inputs: brief, this spec, codebase root, preview URL
- Scope: Phase 4 only (tracking events + SEO verification)
- Output: PASS/FAIL/N/A report
- Pass criteria: zero FAIL items
- Out-of-scope: anything covered by Phase 1/2/3 audits

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `dataLayer` not loaded in dev (no `PUBLIC_GTM_ID`) causes form to error | Low | High | `trackEvent` checks `Array.isArray(window.dataLayer)` before pushing; no-ops cleanly. Vitest covers this case explicitly. |
| `booking_initiated` fires multiple times if user navigates back through the flow | Low | Low | Module-level `bookingInitiatedFired` flag ensures exactly one fire per page-session. |
| Source-field semantic change breaks an existing GHL workflow expecting URL paths | Medium | Medium | Update GHL workflow to branch on `source === 'opt-in'` (string match) AND/OR fall back to the `page` field. Communicate the schema change to the client before promoting to production. |
| GTM not yet configured in production (no `PUBLIC_GTM_ID` env var) | High | Low | Helper no-ops safely. The instrumentation lands in code regardless; events start firing once GTM is provisioned. Brief Part 5 mandates GTM setup as a separate task. |

## Out of scope (further deferred / separate work)

- AI chat widget integration
- `/congrats` page rebuild
- Sitemap manual curation (Astro auto-generates)
- Server-side analytics / first-party data piping
- Cookie consent banner (region-dependent compliance â€” separate)

## Roll-out

Single PR / deploy:
1. Implement `analytics.ts` + tests
2. Wire OptInForm + BookingFlow
3. `npx astro check`, `npx vitest run`, `npm run build` clean
4. SEO verification pass (likely no-op; confirm)
5. `vercel deploy` (preview)
6. Manual DevTools check of dataLayer events on preview
7. Brief-alignment audit subagent â€” fix any FAILs
8. `vercel deploy --prod --yes`
9. Final smoke check on production
10. Communicate the OptInForm `source` schema change to the GHL workflow owner so the lead-acquisition workflow continues to branch correctly.

After Phase 4 ships, all four brief-aligned phases are complete. Remaining out-of-scope items (`/congrats`, AI chat widget, future pages) become independent specs.
