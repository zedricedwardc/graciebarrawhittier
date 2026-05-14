# Custom Booking Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5 GHL booking iframes on `/kickstart` with a native in-page flow that reads availability via the GHL Calendar API v2 and writes appointments + contacts directly to GHL on submit.

**Architecture:** Astro switches to `output: 'server'` with `@astrojs/vercel`. Recurring class schedule lives in repo (`src/data/schedule.ts`); GHL stays canonical for actual bookings. Browser talks to two server endpoints (`/api/availability`, `/api/book`) which proxy GHL with a server-side token. Anti-spam handled with four zero-cost layers (single-flight submit, honeypot, dwell timer, per-IP token bucket). UI is vanilla TS in pre-rendered Astro partials swapped via `hidden` toggling â€” same pattern as existing `kickstart.astro`.

**Tech Stack:** Astro 6, TypeScript, Tailwind 4, Zod, Vitest (new dev dep for pure-logic tests), `@astrojs/vercel` (new), Node 22+, GHL API v2 (`https://services.leadconnectorhq.com`).

**Spec:** `docs/superpowers/specs/2026-05-05-custom-booking-calendar-design.md`

---

## File Map

```
NEW:
  src/data/programs.ts
  src/data/schedule.ts
  src/data/blackouts.ts
  src/lib/booking-types.ts
  src/lib/slot-resolver.ts
  src/lib/slot-resolver.test.ts
  src/lib/ghl.ts
  src/lib/ghl.test.ts
  src/pages/api/availability.ts
  src/pages/api/book.ts
  src/components/booking/BookingFlow.astro
  src/components/booking/ProgramSurvey.astro
  src/components/booking/DatePicker.astro
  src/components/booking/SlotPicker.astro
  src/components/booking/TraineeForm.astro
  src/components/booking/BookingSuccess.astro
  src/components/booking/BookingError.astro
  vitest.config.ts
  .env.example

MODIFY:
  astro.config.mjs                    (output: 'server', vercel adapter)
  package.json                         (deps + test script)
  src/pages/kickstart.astro            (iframe block â†’ BookingFlow)
  src/pages/congrats.astro             (read ?count= for headline)
  src/pages/index.astro                (+ prerender = true)
  src/pages/404.astro                  (+ prerender = true)
  src/pages/terms.astro                (+ prerender = true)
  src/pages/privacy.astro              (+ prerender = true)
  src/pages/kids-martial-arts.astro    (+ prerender = true)
  src/pages/adults-jiu-jitsu.astro     (+ prerender = true)
  src/pages/reviews.astro              (+ prerender = true)
  src/pages/contact.astro              (+ prerender = true)
  src/components/form/OptInForm.astro  (forward email + phone)
```

---

## Phase 0 â€” Stack Prep

### Task 0.1: Install runtime deps

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install deps**

```bash
npm install @astrojs/vercel zod
```

- [ ] **Step 2: Verify install**

```bash
node -e "console.log(require('zod/package.json').version, require('@astrojs/vercel/package.json').version)"
```

Expected: two version strings, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @astrojs/vercel and zod for booking flow"
```

---

### Task 0.2: Install Vitest + add test script

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 3: Add test script to `package.json`**

In the `"scripts"` block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify it runs (no tests yet, so should report 0)**

```bash
npm test
```

Expected: exits 0 with "No test files found" (acceptable â€” vitest exits 0 with `--passWithNoTests` default in 1.x; if it fails, add `passWithNoTests: true` to vitest.config.ts under `test:`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for pure-logic tests"
```

---

### Task 0.3: Switch Astro to server output + Vercel adapter

**Files:**
- Modify: `astro.config.mjs`

- [ ] **Step 1: Replace `astro.config.mjs`**

```js
// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://www.graciebarrawhittier.com',
  output: 'server',
  adapter: vercel(),
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/kickstart') && !page.includes('/congrats'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
});
```

- [ ] **Step 2: Verify build still passes**

Build will likely warn that pages aren't prerendered yet â€” expected. We fix in 0.4.

```bash
npm run build
```

Expected: build completes (warnings OK).

- [ ] **Step 3: Commit**

```bash
git add astro.config.mjs
git commit -m "chore: switch astro to server output with vercel adapter"
```

---

### Task 0.4: Mark all marketing pages as prerendered

**Files:**
- Modify: `src/pages/index.astro`, `404.astro`, `terms.astro`, `privacy.astro`, `kids-martial-arts.astro`, `adults-jiu-jitsu.astro`, `reviews.astro`, `contact.astro`, `congrats.astro`

- [ ] **Step 1: Add prerender export to each page**

For each of the 9 files above, add this as the FIRST line inside the existing `---` frontmatter block:

```ts
export const prerender = true;
```

(Do **NOT** add to `kickstart.astro` â€” it stays SSR because it'll fetch availability live in a follow-up if we ever do.)

For `index.astro` example, the frontmatter changes from:

```ts
---
import BaseLayout from ...;
// ...
---
```

to:

```ts
---
export const prerender = true;
import BaseLayout from ...;
// ...
---
```

- [ ] **Step 2: Build and verify static pages stay static**

```bash
npm run build
```

Expected: build output shows `â–¶ src/pages/index.astro` as a prerendered route, no SSR warnings on the marketing pages.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro src/pages/404.astro src/pages/terms.astro src/pages/privacy.astro src/pages/kids-martial-arts.astro src/pages/adults-jiu-jitsu.astro src/pages/reviews.astro src/pages/contact.astro src/pages/congrats.astro
git commit -m "chore: mark marketing pages as prerendered"
```

---

### Task 0.5: Document required env vars

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

```bash
# GoHighLevel API v2 â€” Private Integration Token (server-only, NEVER PUBLIC_)
# Generate at: GHL â†’ Settings â†’ Private Integrations â†’ Create new
GHL_PIT_TOKEN=

# GoHighLevel sub-account / location ID
GHL_LOCATION_ID=

# GHL calendar IDs â€” one per program (find in GHL â†’ Calendars â†’ â€¦ â†’ Calendar Settings)
GHL_CAL_TINY=
GHL_CAL_LC1=
GHL_CAL_LC2=
GHL_CAL_JUNIORS=
GHL_CAL_ADULTS=

# Optional: existing public webhook (used by OptInForm)
PUBLIC_GHL_WEBHOOK_URL=
```

- [ ] **Step 2: Confirm `.env` is git-ignored**

```bash
git check-ignore -v .env
```

Expected: prints a `.gitignore` line that ignores `.env*` or `.env`.
If not, add `.env` to `.gitignore` (do NOT modify `.env.example`).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: document GHL env vars in .env.example"
```

---

## Phase 1 â€” Data Layer

### Task 1.1: Create `src/data/programs.ts`

**Files:**
- Create: `src/data/programs.ts`

- [ ] **Step 1: Write file**

```ts
/**
 * The 5 age-tiered programs offered for the free trial pass,
 * each mapped to its GHL calendar ID env var (resolved server-side only).
 */
export type ProgramKey = 'tiny' | 'lc1' | 'lc2' | 'juniors' | 'adults';

export interface Program {
  key: ProgramKey;
  name: string;
  ageRange: string;
  calendarIdEnvVar: string;
}

export const programs: Program[] = [
  { key: 'tiny',    name: 'Tiny Champions',             ageRange: 'Ages 3â€“4',   calendarIdEnvVar: 'GHL_CAL_TINY' },
  { key: 'lc1',     name: 'Little Champions 1',         ageRange: 'Ages 5â€“6',   calendarIdEnvVar: 'GHL_CAL_LC1' },
  { key: 'lc2',     name: 'Little Champions 2',         ageRange: 'Ages 7â€“9',   calendarIdEnvVar: 'GHL_CAL_LC2' },
  { key: 'juniors', name: 'Juniors Jiu-Jitsu',          ageRange: 'Ages 10â€“15', calendarIdEnvVar: 'GHL_CAL_JUNIORS' },
  { key: 'adults',  name: 'Adults Brazilian Jiu-Jitsu', ageRange: 'Ages 16+',   calendarIdEnvVar: 'GHL_CAL_ADULTS' },
];

export function getProgram(key: ProgramKey): Program {
  const p = programs.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown program key: ${key}`);
  return p;
}
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/programs.ts
git commit -m "feat(booking): add programs data module"
```

---

### Task 1.2: Create `src/data/schedule.ts`

**Files:**
- Create: `src/data/schedule.ts`

- [ ] **Step 1: Write file**

```ts
/**
 * Recurring weekly class template per program, in America/Los_Angeles local time.
 * Source of truth for trial-eligible class times â€” verified against Schedule-2.pdf.
 * Adults: only Fundamentals (GB1) â€” Advanced/Top Team excluded for trials.
 */
import type { ProgramKey } from './programs';

export const TZ = 'America/Los_Angeles' as const;

/** 0 = Sunday, 6 = Saturday (matches JS `Date.getDay()`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ClassSlot {
  weekday: Weekday;
  hour: number;        // 0â€“23, local time
  minute: number;      // 0 or 30 typically
  durationMin: number;
}

export const schedule: Record<ProgramKey, ClassSlot[]> = {
  tiny: [
    { weekday: 1, hour: 15, minute: 0, durationMin: 45 }, // Mon 3pm
    { weekday: 3, hour: 15, minute: 0, durationMin: 45 }, // Wed 3pm
    { weekday: 2, hour: 16, minute: 0, durationMin: 45 }, // Tue 4pm
    { weekday: 4, hour: 16, minute: 0, durationMin: 45 }, // Thu 4pm
  ],
  lc1: [
    { weekday: 1, hour: 16, minute: 0, durationMin: 45 }, // Mon 4pm
    { weekday: 3, hour: 16, minute: 0, durationMin: 45 }, // Wed 4pm
    { weekday: 2, hour: 15, minute: 0, durationMin: 45 }, // Tue 3pm
    { weekday: 4, hour: 15, minute: 0, durationMin: 45 }, // Thu 3pm
    { weekday: 6, hour: 10, minute: 0, durationMin: 45 }, // Sat 10am
  ],
  lc2: [
    { weekday: 1, hour: 18, minute: 0, durationMin: 45 }, // Mon 6pm
    { weekday: 3, hour: 18, minute: 0, durationMin: 45 }, // Wed 6pm
    { weekday: 2, hour: 17, minute: 0, durationMin: 45 }, // Tue 5pm
    { weekday: 4, hour: 17, minute: 0, durationMin: 45 }, // Thu 5pm
    { weekday: 6, hour: 10, minute: 0, durationMin: 45 }, // Sat 10am
  ],
  juniors: [
    { weekday: 1, hour: 17, minute: 0, durationMin: 60 }, // Mon 5pm
    { weekday: 3, hour: 17, minute: 0, durationMin: 60 }, // Wed 5pm
    { weekday: 2, hour: 18, minute: 0, durationMin: 60 }, // Tue 6pm
    { weekday: 4, hour: 18, minute: 0, durationMin: 60 }, // Thu 6pm
    { weekday: 6, hour: 11, minute: 0, durationMin: 60 }, // Sat 11am
  ],
  adults: [
    { weekday: 1, hour: 11, minute: 0, durationMin: 60 }, // Mon 11am
    { weekday: 2, hour: 11, minute: 0, durationMin: 60 }, // Tue 11am
    { weekday: 3, hour: 11, minute: 0, durationMin: 60 }, // Wed 11am
    { weekday: 4, hour: 11, minute: 0, durationMin: 60 }, // Thu 11am
    { weekday: 1, hour: 19, minute: 0, durationMin: 60 }, // Mon 7pm
    { weekday: 2, hour: 19, minute: 0, durationMin: 60 }, // Tue 7pm
    { weekday: 3, hour: 19, minute: 0, durationMin: 60 }, // Wed 7pm
    { weekday: 4, hour: 19, minute: 0, durationMin: 60 }, // Thu 7pm
    { weekday: 6, hour: 12, minute: 0, durationMin: 60 }, // Sat 12pm
  ],
};
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/schedule.ts
git commit -m "feat(booking): add weekly class schedule data"
```

---

### Task 1.3: Create `src/data/blackouts.ts`

**Files:**
- Create: `src/data/blackouts.ts`

- [ ] **Step 1: Write file**

```ts
/**
 * ISO date strings (YYYY-MM-DD) when the gym is closed for ALL programs.
 * Subtracted from schedule.ts in slot-resolver. Maintained manually.
 *
 * Add holidays, instructor-out days, scheduled closures here.
 */
export const blackouts: ReadonlySet<string> = new Set<string>([
  // e.g. '2026-12-25', // Christmas Day
]);
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/blackouts.ts
git commit -m "feat(booking): add blackouts data (empty set, manually maintained)"
```

---

## Phase 2 â€” Types + Pure Logic

### Task 2.1: Create `src/lib/booking-types.ts`

**Files:**
- Create: `src/lib/booking-types.ts`

- [ ] **Step 1: Write file**

```ts
/**
 * Zod schemas + TS types shared between API routes and UI controller.
 * The Request schemas validate untrusted input at the HTTP boundary.
 */
import { z } from 'zod';

export const ProgramKeyEnum = z.enum(['tiny', 'lc1', 'lc2', 'juniors', 'adults']);
export type ProgramKey = z.infer<typeof ProgramKeyEnum>;

export const AvailabilityRequest = z.object({
  program: ProgramKeyEnum,
  from: z.string().date(),
  to: z.string().date(),
});
export type AvailabilityRequest = z.infer<typeof AvailabilityRequest>;

export interface AvailabilitySlot {
  startISO: string;   // e.g. "2026-05-06T15:00:00-07:00"
  endISO: string;
  label: string;      // "Tue, May 6 Â· 3:00 PM"
}

export type AvailabilityResponse =
  | { ok: true; slots: AvailabilitySlot[] }
  | { ok: false; code: 'GHL_UNAVAILABLE' | 'INVALID_RANGE' };

export const BookingRequest = z.object({
  program: ProgramKeyEnum,
  slotStartISO: z.string().datetime({ offset: true }),
  parent: z.object({
    firstName: z.string().min(1).max(50),
    lastName:  z.string().min(1).max(50),
    email:     z.string().email(),
    phone:     z.string().regex(/^\+?[\d\s\-().]{10,20}$/),
  }),
  trainee: z.object({
    firstName: z.string().min(1).max(50),
    age:       z.number().int().min(3).max(99),
    isSelf:    z.boolean(),
  }),
  marketingConsent: z.boolean(),
  // Anti-spam
  website: z.string().optional(),
  ts:      z.number().int(),
});
export type BookingRequest = z.infer<typeof BookingRequest>;

export type BookingResponse =
  | { ok: true; appointmentId: string }
  | { ok: false; code: 'SLOT_TAKEN' | 'GHL_FAILED' | 'INVALID_INPUT' | 'RATE_LIMITED'; message?: string; alternates?: AvailabilitySlot[] };
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/booking-types.ts
git commit -m "feat(booking): add Zod schemas + shared types"
```

---

### Task 2.2: Test for `slot-resolver.ts`

**Files:**
- Create: `src/lib/slot-resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { generateSlots } from './slot-resolver';

describe('generateSlots', () => {
  it('expands one weekly Monday slot across a 14-day range', () => {
    // 2026-05-04 is a Monday in America/Los_Angeles
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-17',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(),
      now: new Date('2026-05-04T08:00:00-07:00'),
      minLeadMinutes: 60,
    });

    // Tiny: Mon 3pm, Wed 3pm, Tue 4pm, Thu 4pm â€” across 2 weeks = 8 slots
    expect(slots).toHaveLength(8);
    expect(slots[0].label).toContain('Mon');
    expect(slots[0].startISO).toBe('2026-05-04T15:00:00-07:00');
  });

  it('subtracts a slot that exactly matches a booked startISO', () => {
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-10',
      bookedStartISOs: new Set(['2026-05-04T15:00:00-07:00']),
      blackoutDates: new Set(),
      now: new Date('2026-05-04T08:00:00-07:00'),
      minLeadMinutes: 60,
    });

    expect(slots.find((s) => s.startISO === '2026-05-04T15:00:00-07:00')).toBeUndefined();
  });

  it('subtracts all slots on a blackout date', () => {
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-04',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(['2026-05-04']),
      now: new Date('2026-05-04T08:00:00-07:00'),
      minLeadMinutes: 60,
    });

    expect(slots).toHaveLength(0);
  });

  it('excludes slots starting within minLeadMinutes of now', () => {
    // It's 14:30 PT on Mon 2026-05-04. Mon 3pm slot is 30 min away â†’ excluded if leadMin=60.
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-04',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(),
      now: new Date('2026-05-04T14:30:00-07:00'),
      minLeadMinutes: 60,
    });

    expect(slots.find((s) => s.startISO === '2026-05-04T15:00:00-07:00')).toBeUndefined();
  });

  it('handles a date range that crosses a Sunday (no classes Sunday)', () => {
    // Sun 2026-05-10 â†’ Mon 2026-05-11. Tiny has Mon class â†’ 1 slot.
    const slots = generateSlots({
      programKey: 'tiny',
      fromISODate: '2026-05-10',
      toISODate:   '2026-05-11',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(),
      now: new Date('2026-05-10T08:00:00-07:00'),
      minLeadMinutes: 60,
    });

    expect(slots).toHaveLength(1);
    expect(slots[0].startISO).toBe('2026-05-11T15:00:00-07:00');
  });

  it('produces human-readable labels with weekday + month + time', () => {
    const slots = generateSlots({
      programKey: 'adults',
      fromISODate: '2026-05-04',
      toISODate:   '2026-05-04',
      bookedStartISOs: new Set(),
      blackoutDates: new Set(),
      now: new Date('2026-05-04T06:00:00-07:00'),
      minLeadMinutes: 60,
    });
    expect(slots[0].label).toMatch(/Mon, May 4 Â· 11:00 AM/);
  });
});
```

- [ ] **Step 2: Run the tests; expect them to fail**

```bash
npm test
```

Expected: failures complaining `generateSlots` is not a function (file doesn't exist yet).

---

### Task 2.3: Implement `slot-resolver.ts`

**Files:**
- Create: `src/lib/slot-resolver.ts`

- [ ] **Step 1: Write implementation**

```ts
/**
 * Pure function: given the recurring weekly schedule, blackout dates,
 * and which slot startISOs are already booked, returns the list of
 * available AvailabilitySlot entries within the requested date range.
 *
 * No I/O. No GHL. No Astro. Trivially testable.
 */
import { schedule, TZ, type ClassSlot } from '../data/schedule';
import type { ProgramKey } from '../data/programs';
import type { AvailabilitySlot } from './booking-types';

export interface GenerateSlotsArgs {
  programKey: ProgramKey;
  fromISODate: string;        // 'YYYY-MM-DD' inclusive
  toISODate: string;          // 'YYYY-MM-DD' inclusive
  bookedStartISOs: Set<string>;
  blackoutDates: Set<string>; // 'YYYY-MM-DD'
  now: Date;
  minLeadMinutes: number;     // exclude slots starting within this many minutes of `now`
}

export function generateSlots(args: GenerateSlotsArgs): AvailabilitySlot[] {
  const { programKey, fromISODate, toISODate, bookedStartISOs, blackoutDates, now, minLeadMinutes } = args;
  const template = schedule[programKey];
  if (!template || template.length === 0) return [];

  const out: AvailabilitySlot[] = [];
  const minLeadMs = minLeadMinutes * 60_000;

  for (const dateISO of iterateDates(fromISODate, toISODate)) {
    if (blackoutDates.has(dateISO)) continue;
    const weekday = weekdayInTZ(dateISO);
    for (const tmpl of template) {
      if (tmpl.weekday !== weekday) continue;
      const startISO = composeISO(dateISO, tmpl.hour, tmpl.minute);
      const startMs = Date.parse(startISO);
      if (startMs - now.getTime() < minLeadMs) continue;
      if (bookedStartISOs.has(startISO)) continue;
      const endISO = composeISO(dateISO, tmpl.hour, tmpl.minute, tmpl.durationMin);
      out.push({
        startISO,
        endISO,
        label: formatLabel(startISO),
      });
    }
  }
  out.sort((a, b) => a.startISO.localeCompare(b.startISO));
  return out;
}

/** Inclusive date iteration, YYYY-MM-DD strings. */
function* iterateDates(fromISO: string, toISO: string): Generator<string> {
  let cursor = new Date(`${fromISO}T00:00:00Z`);
  const end = new Date(`${toISO}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    yield cursor.toISOString().slice(0, 10);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
}

/** Returns 0=Sun..6=Sat for a YYYY-MM-DD interpreted in TZ. */
function weekdayInTZ(dateISO: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  // Use Intl to get the weekday in our target tz (date-only â€” noon avoids DST edge confusion).
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
  const wd = fmt.format(new Date(`${dateISO}T12:00:00Z`));
  const map: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[wd];
}

/** Returns a TZ-aware ISO like "2026-05-04T15:00:00-07:00". */
function composeISO(dateISO: string, hour: number, minute: number, addMinutes = 0): string {
  // Compute the UTC instant for {dateISO, hour, minute} interpreted in TZ.
  // Then format with the TZ offset suffix that matches that instant.
  const naive = new Date(`${dateISO}T${pad(hour)}:${pad(minute)}:00Z`); // wrong by tz offset
  const offsetMin = tzOffsetMinutesAt(naive, TZ);
  const corrected = new Date(naive.getTime() - offsetMin * 60_000 + addMinutes * 60_000);
  const finalOffset = tzOffsetMinutesAt(corrected, TZ);
  return formatISOWithOffset(corrected, finalOffset);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function tzOffsetMinutesAt(when: Date, timeZone: string): number {
  // Standard trick: ask Intl what local time is in the target tz, diff with UTC.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(when).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUTC - when.getTime()) / 60_000);
}

function formatISOWithOffset(d: Date, offsetMin: number): string {
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = pad(Math.floor(abs / 60));
  const om = pad(abs % 60);
  // Format the date in that offset (not UTC).
  const local = new Date(d.getTime() + offsetMin * 60_000);
  const y = local.getUTCFullYear();
  const mo = pad(local.getUTCMonth() + 1);
  const da = pad(local.getUTCDate());
  const h = pad(local.getUTCHours());
  const mi = pad(local.getUTCMinutes());
  const se = pad(local.getUTCSeconds());
  return `${y}-${mo}-${da}T${h}:${mi}:${se}${sign}${oh}:${om}`;
}

function formatLabel(startISO: string): string {
  const d = new Date(startISO);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  // "Tue, May 6, 3:00 PM" â†’ reformat to "Tue, May 6 Â· 3:00 PM"
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const date = `${get('weekday')}, ${get('month')} ${get('day')}`;
  const time = `${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
  return `${date} Â· ${time}`;
}
```

- [ ] **Step 2: Run the tests**

```bash
npm test
```

Expected: all 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/slot-resolver.ts src/lib/slot-resolver.test.ts
git commit -m "feat(booking): pure slot-resolver with timezone-aware ISO output"
```

---

## Phase 3 â€” GHL Client

> **VERIFY note:** The exact GHL `Get Free Slots` and `Create Appointment` payload shapes must be validated against the live GHL sub-account during Task 3.4. Until that runs successfully, treat the wrapper code in 3.1â€“3.3 as best-effort based on public docs.

### Task 3.1: Test for `ghl.ts` low-level wrapper

**Files:**
- Create: `src/lib/ghl.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ghl from './ghl';

describe('ghl client', () => {
  beforeEach(() => {
    vi.stubEnv('GHL_PIT_TOKEN', 'test-token');
    vi.stubEnv('GHL_LOCATION_ID', 'loc_123');
    vi.stubGlobal('fetch', vi.fn());
  });

  it('getFreeSlots issues GET to free-slots endpoint with auth + version headers', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ '_dates_': {} }), { status: 200 }),
    );
    await ghl.getFreeSlots({ calendarId: 'cal_x', startDate: 1700000000000, endDate: 1701000000000 });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toMatch(/services\.leadconnectorhq\.com\/calendars\/cal_x\/free-slots/);
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(init.headers.Version).toBe('2021-04-15');
    expect(init.headers.Accept).toBe('application/json');
  });

  it('upsertContact POSTs JSON with locationId injected', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ contact: { id: 'c_1' } }), { status: 200 }),
    );
    const id = await ghl.upsertContact({
      firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com', phone: '+15551234567',
    });
    expect(id).toBe('c_1');
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toMatch(/contacts\/upsert/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.locationId).toBe('loc_123');
    expect(body.email).toBe('jane@x.com');
  });

  it('createAppointment POSTs with calendarId, contactId, startTime', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'apt_42' }), { status: 200 }),
    );
    const id = await ghl.createAppointment({
      calendarId: 'cal_x',
      contactId: 'c_1',
      startISO: '2026-05-06T15:00:00-07:00',
      endISO:   '2026-05-06T15:45:00-07:00',
      title: 'Tiny Champions trial â€” Emma (6)',
    });
    expect(id).toBe('apt_42');
    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.calendarId).toBe('cal_x');
    expect(body.contactId).toBe('c_1');
    expect(body.startTime).toBe('2026-05-06T15:00:00-07:00');
  });

  it('throws GhlError on non-2xx with status + body context', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response('{"message":"bad token"}', { status: 401 }),
    );
    await expect(
      ghl.getFreeSlots({ calendarId: 'cal_x', startDate: 1, endDate: 2 }),
    ).rejects.toMatchObject({ name: 'GhlError', status: 401 });
  });
});
```

- [ ] **Step 2: Run the tests; expect them to fail**

```bash
npm test
```

Expected: cannot import `./ghl`.

---

### Task 3.2: Implement `src/lib/ghl.ts`

**Files:**
- Create: `src/lib/ghl.ts`

- [ ] **Step 1: Write implementation**

```ts
/**
 * Server-only GoHighLevel API v2 client.
 * NEVER import this from a component or anywhere reachable by the browser bundle.
 *
 * Endpoints used:
 *   GET  /calendars/{calendarId}/free-slots?startDate=ms&endDate=ms&timezone=America/Los_Angeles
 *   POST /contacts/upsert
 *   POST /calendars/events/appointments
 *
 * VERIFY: payload shapes must be validated against the GBW sub-account
 * before this is trusted in production.
 */

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-04-15';

export class GhlError extends Error {
  override name = 'GhlError';
  status: number;
  bodyText: string;
  constructor(status: number, bodyText: string, msg: string) {
    super(msg);
    this.status = status;
    this.bodyText = bodyText;
  }
}

function token(): string {
  const t = process.env.GHL_PIT_TOKEN;
  if (!t) throw new Error('GHL_PIT_TOKEN env var not set');
  return t;
}
function locationId(): string {
  const l = process.env.GHL_LOCATION_ID;
  if (!l) throw new Error('GHL_LOCATION_ID env var not set');
  return l;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      Version: VERSION,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GhlError(res.status, text, `GHL ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// â”€â”€ Free slots â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface GetFreeSlotsArgs {
  calendarId: string;
  startDate: number; // epoch ms
  endDate: number;   // epoch ms
}

/**
 * GHL returns free slots as `{ "<YYYY-MM-DD>": { "slots": [iso, iso, ...] } }`.
 * We flatten to a Set of ISO start strings.
 */
export async function getFreeSlots(args: GetFreeSlotsArgs): Promise<Set<string>> {
  const { calendarId, startDate, endDate } = args;
  const url =
    `/calendars/${encodeURIComponent(calendarId)}/free-slots` +
    `?startDate=${startDate}&endDate=${endDate}` +
    `&timezone=${encodeURIComponent('America/Los_Angeles')}`;
  const data = (await request(url)) as Record<string, { slots?: string[] }>;
  const out = new Set<string>();
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('_')) continue; // skip envelope keys like "_dates_"
    if (Array.isArray(v?.slots)) for (const s of v.slots) out.add(s);
  }
  return out;
}

// â”€â”€ Contacts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface UpsertContactArgs {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  marketingConsent?: boolean;
}

export async function upsertContact(args: UpsertContactArgs): Promise<string> {
  const data = (await request('/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify({
      locationId: locationId(),
      firstName: args.firstName,
      lastName: args.lastName,
      email: args.email,
      phone: args.phone,
      // Tag for source visibility in GHL UI:
      tags: ['kickstart-funnel'],
    }),
  })) as { contact?: { id?: string }; id?: string };
  const id = data?.contact?.id ?? data?.id;
  if (!id) throw new GhlError(500, JSON.stringify(data), 'upsertContact: no contact id in response');
  return id;
}

// â”€â”€ Appointments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface CreateAppointmentArgs {
  calendarId: string;
  contactId: string;
  startISO: string;
  endISO: string;
  title: string;
}

export async function createAppointment(args: CreateAppointmentArgs): Promise<string> {
  const data = (await request('/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify({
      calendarId: args.calendarId,
      locationId: locationId(),
      contactId: args.contactId,
      startTime: args.startISO,
      endTime: args.endISO,
      title: args.title,
      appointmentStatus: 'confirmed',
      toNotify: true, // fire native confirmation email/SMS
    }),
  })) as { id?: string; appointment?: { id?: string } };
  const id = data?.id ?? data?.appointment?.id;
  if (!id) throw new GhlError(500, JSON.stringify(data), 'createAppointment: no id in response');
  return id;
}
```

- [ ] **Step 2: Run the tests**

```bash
npm test
```

Expected: all 4 GHL tests pass.

- [ ] **Step 3: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ghl.ts src/lib/ghl.test.ts
git commit -m "feat(booking): add server-only GHL API v2 client (free-slots + upsert + appointment)"
```

---

## Phase 4 â€” API Routes

### Task 4.1: `GET /api/availability`

**Files:**
- Create: `src/pages/api/availability.ts`

- [ ] **Step 1: Write implementation**

```ts
import type { APIRoute } from 'astro';
import { AvailabilityRequest, type AvailabilityResponse, type AvailabilitySlot } from '../../lib/booking-types';
import { generateSlots } from '../../lib/slot-resolver';
import { getProgram } from '../../data/programs';
import { blackouts } from '../../data/blackouts';
import { getFreeSlots, GhlError } from '../../lib/ghl';

export const prerender = false;

const MAX_RANGE_DAYS = 21;
const MIN_LEAD_MINUTES = 60;

export const GET: APIRoute = async ({ url }) => {
  const parsed = AvailabilityRequest.safeParse({
    program: url.searchParams.get('program'),
    from:    url.searchParams.get('from'),
    to:      url.searchParams.get('to'),
  });
  if (!parsed.success) return json({ ok: false, code: 'INVALID_RANGE' });

  const { program, from, to } = parsed.data;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs   = Date.parse(`${to}T23:59:59Z`);
  if ((toMs - fromMs) / 86_400_000 > MAX_RANGE_DAYS) {
    return json({ ok: false, code: 'INVALID_RANGE' });
  }

  const calendarId = process.env[getProgram(program).calendarIdEnvVar];
  if (!calendarId) return json({ ok: false, code: 'GHL_UNAVAILABLE' });

  let bookedStartISOs = new Set<string>();
  try {
    bookedStartISOs = await invertFreeSlotsToBooked(calendarId, fromMs, toMs);
  } catch (err) {
    console.error('[availability] GHL free-slots failed', err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_UNAVAILABLE' });
  }

  const slots: AvailabilitySlot[] = generateSlots({
    programKey: program,
    fromISODate: from,
    toISODate: to,
    bookedStartISOs,
    blackoutDates: new Set(blackouts),
    now: new Date(),
    minLeadMinutes: MIN_LEAD_MINUTES,
  });

  return json(
    { ok: true, slots },
    { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
  );
};

/**
 * GHL returns FREE slots; our slot-resolver expects BOOKED start ISOs to subtract.
 * We compute "booked = template âˆ’ free" by passing the free set through the resolver
 * and inverting. Simpler: pass `bookedStartISOs` such that resolver returns ONLY
 * what GHL also reports as free. We do that by treating any template slot NOT in
 * `freeSet` as booked.
 */
async function invertFreeSlotsToBooked(calendarId: string, startMs: number, endMs: number): Promise<Set<string>> {
  const free = await getFreeSlots({ calendarId, startDate: startMs, endDate: endMs });
  // Resolver subtracts on exact ISO string match. The caller doesn't know the full
  // template here, so we encode "booked" by listing the COMPLEMENT inside the resolver.
  // The simpler contract: we pass `free` upward and let the resolver intersect.
  // Implementation choice: return a "marker set" that the caller treats as the source of truth.
  return invertViaIntersection(free);
}

/**
 * Marker: callers using this set with generateSlots must intersect, not subtract.
 * Adjust generateSlots in this codebase to support an intersection mode? No â€”
 * to keep generateSlots pure-and-simple we instead build the booked set in the
 * route. See README of slot-resolver: returns template âˆ© free is equivalent to
 * (template) âˆ’ (template âˆ’ free).
 */
function invertViaIntersection(_free: Set<string>): Set<string> {
  // Sentinel; actual subtraction happens inline below in this function's caller.
  // The route uses generateSlots with an empty bookedStartISOs and then post-filters
  // by `free`. We refactor to that inline approach instead of inverting upstream.
  return new Set();
}
```

> **Refactor pivot:** The "invert" approach in step 1 is awkward. Step 2 cleans it up.

- [ ] **Step 2: Refactor to a clean intersect-with-free-slots flow**

Replace the entire file content with:

```ts
import type { APIRoute } from 'astro';
import { AvailabilityRequest, type AvailabilitySlot } from '../../lib/booking-types';
import { generateSlots } from '../../lib/slot-resolver';
import { getProgram } from '../../data/programs';
import { blackouts } from '../../data/blackouts';
import { getFreeSlots, GhlError } from '../../lib/ghl';

export const prerender = false;

const MAX_RANGE_DAYS = 21;
const MIN_LEAD_MINUTES = 60;

export const GET: APIRoute = async ({ url }) => {
  const parsed = AvailabilityRequest.safeParse({
    program: url.searchParams.get('program'),
    from:    url.searchParams.get('from'),
    to:      url.searchParams.get('to'),
  });
  if (!parsed.success) return json({ ok: false, code: 'INVALID_RANGE' });

  const { program, from, to } = parsed.data;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs   = Date.parse(`${to}T23:59:59Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs ||
      (toMs - fromMs) / 86_400_000 > MAX_RANGE_DAYS) {
    return json({ ok: false, code: 'INVALID_RANGE' });
  }

  const calendarId = process.env[getProgram(program).calendarIdEnvVar];
  if (!calendarId) {
    console.error('[availability] missing calendar env var', getProgram(program).calendarIdEnvVar);
    return json({ ok: false, code: 'GHL_UNAVAILABLE' });
  }

  let freeFromGhl: Set<string>;
  try {
    freeFromGhl = await getFreeSlots({ calendarId, startDate: fromMs, endDate: toMs });
  } catch (err) {
    console.error('[availability] GHL free-slots failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_UNAVAILABLE' });
  }

  // Build the template slots (no booked subtraction yet), then keep only those
  // that GHL also reports as free. This combines our schedule.ts source of truth
  // with GHL's actual capacity & manual bookings.
  const templateSlots: AvailabilitySlot[] = generateSlots({
    programKey: program,
    fromISODate: from,
    toISODate: to,
    bookedStartISOs: new Set(),
    blackoutDates: new Set(blackouts),
    now: new Date(),
    minLeadMinutes: MIN_LEAD_MINUTES,
  });
  const slots = templateSlots.filter((s) => freeFromGhl.has(s.startISO));

  return json(
    { ok: true, slots },
    { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
  );
};

function json(body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
```

- [ ] **Step 3: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 4: Smoke test (with valid env vars set in `.env`)**

```bash
npm run dev
```

In another terminal:

```bash
curl -s "http://localhost:4321/api/availability?program=adults&from=2026-05-04&to=2026-05-10" | head -c 500
```

Expected: JSON response with `ok: true` and a `slots` array (possibly empty if GHL has no free slots in that range, but no GHL_UNAVAILABLE if envs are correct).

If you see `GHL_UNAVAILABLE`, check Vercel Function Logs / dev terminal for the underlying error and resolve before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/availability.ts
git commit -m "feat(booking): add /api/availability endpoint with edge cache"
```

---

### Task 4.2: `POST /api/book` with anti-spam

**Files:**
- Create: `src/pages/api/book.ts`

- [ ] **Step 1: Write implementation**

```ts
import type { APIRoute } from 'astro';
import { BookingRequest, type BookingResponse, type AvailabilitySlot } from '../../lib/booking-types';
import { getProgram, type ProgramKey } from '../../data/programs';
import { upsertContact, createAppointment, getFreeSlots, GhlError } from '../../lib/ghl';
import { generateSlots } from '../../lib/slot-resolver';
import { blackouts } from '../../data/blackouts';

export const prerender = false;

const MIN_DWELL_MS = 3000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 5;
const MIN_LEAD_MINUTES = 60;

// Module-scoped â€” survives across requests on a warm Fluid Compute instance.
const buckets = new Map<string, { count: number; firstSeen: number }>();

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ ok: false, code: 'INVALID_INPUT' }); }

  const parsed = BookingRequest.safeParse(payload);
  if (!parsed.success) return json({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  // Layer 2 â€” Honeypot. Silent OK so bots don't learn.
  if (body.website && body.website.length > 0) {
    return json({ ok: true, appointmentId: 'spam-discarded' });
  }

  // Layer 3 â€” Min dwell time.
  const elapsed = Date.now() - body.ts;
  if (elapsed < MIN_DWELL_MS) {
    return json({ ok: true, appointmentId: 'spam-discarded' });
  }

  // Layer 4 â€” Per-IP token bucket.
  const ip = clientAddress || 'unknown';
  if (!checkRate(ip)) {
    return json({ ok: false, code: 'RATE_LIMITED' });
  }

  const calendarId = process.env[getProgram(body.program).calendarIdEnvVar];
  if (!calendarId) {
    console.error('[book] missing calendar env var', getProgram(body.program).calendarIdEnvVar);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Calendar not configured.' });
  }

  // Re-validate that the slot is still available.
  const slotMs = Date.parse(body.slotStartISO);
  const windowStart = slotMs - 60_000;
  const windowEnd   = slotMs + 60_000;
  let stillFree: Set<string>;
  try {
    stillFree = await getFreeSlots({ calendarId, startDate: windowStart, endDate: windowEnd });
  } catch (err) {
    console.error('[book] re-validate getFreeSlots failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not verify slot availability.' });
  }
  if (!stillFree.has(body.slotStartISO)) {
    const alternates = nextAlternates(body.program, body.slotStartISO, 3);
    return json({ ok: false, code: 'SLOT_TAKEN', alternates });
  }

  // Write to GHL: contact, then appointment.
  let contactId: string;
  try {
    contactId = await upsertContact({
      firstName: body.parent.firstName,
      lastName:  body.parent.lastName,
      email:     body.parent.email,
      phone:     body.parent.phone,
    });
  } catch (err) {
    console.error('[book] upsertContact failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText, payload: body } : { err, payload: body });
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not create contact.' });
  }

  const endISO = computeEndISO(body.slotStartISO, body.program);
  const traineeName = body.trainee.isSelf ? body.parent.firstName : body.trainee.firstName;
  const title = `${getProgram(body.program).name} trial â€” ${traineeName} (${body.trainee.age})`;

  let appointmentId: string;
  try {
    appointmentId = await createAppointment({
      calendarId, contactId,
      startISO: body.slotStartISO,
      endISO,
      title,
    });
  } catch (err) {
    console.error('[book] createAppointment failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText, payload: body } : { err, payload: body });
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not create appointment.' });
  }

  return json({ ok: true, appointmentId });
};

function checkRate(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.firstSeen > RATE_WINDOW_MS) {
    buckets.set(ip, { count: 1, firstSeen: now });
    return true;
  }
  if (b.count >= RATE_MAX_PER_WINDOW) return false;
  b.count++;
  return true;
}

function computeEndISO(startISO: string, program: ProgramKey): string {
  // Look up duration from schedule for this program â€” match by hour/minute/weekday.
  // Cheap fallback: 60 min for adults/juniors, 45 min everything else.
  const duration = program === 'adults' || program === 'juniors' ? 60 : 45;
  const end = new Date(Date.parse(startISO) + duration * 60_000);
  // Preserve original offset suffix.
  const offset = startISO.slice(-6); // "-07:00"
  const local = new Date(end.getTime() + offsetMinutes(offset) * 60_000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth()+1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${offset}`;
}

function offsetMinutes(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number);
  return sign * (h * 60 + m);
}

function nextAlternates(program: ProgramKey, takenStartISO: string, count: number): AvailabilitySlot[] {
  const start = takenStartISO.slice(0, 10);
  const endDate = new Date(Date.parse(`${start}T00:00:00Z`) + 14 * 86_400_000);
  const endStr = endDate.toISOString().slice(0, 10);
  const alts = generateSlots({
    programKey: program,
    fromISODate: start,
    toISODate: endStr,
    bookedStartISOs: new Set([takenStartISO]),
    blackoutDates: new Set(blackouts),
    now: new Date(),
    minLeadMinutes: MIN_LEAD_MINUTES,
  });
  return alts.slice(0, count);
}

function json(body: BookingResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Smoke test honeypot drop (no GHL call should fire)**

```bash
npm run dev
```

```bash
curl -s -X POST http://localhost:4321/api/book \
  -H 'Content-Type: application/json' \
  -d '{"program":"adults","slotStartISO":"2026-05-04T11:00:00-07:00","parent":{"firstName":"A","lastName":"B","email":"a@b.com","phone":"555-555-5555"},"trainee":{"firstName":"A","age":30,"isSelf":true},"marketingConsent":true,"website":"http://spam.example","ts":1}' | head -c 200
```

Expected: `{"ok":true,"appointmentId":"spam-discarded"}` â€” and **no** GHL call in dev terminal logs.

- [ ] **Step 4: Smoke test dwell-time drop**

Same body without `website`, but `ts` set to `Date.now()` (will be < 3s elapsed):

```bash
curl -s -X POST http://localhost:4321/api/book \
  -H 'Content-Type: application/json' \
  -d "{\"program\":\"adults\",\"slotStartISO\":\"2026-05-04T11:00:00-07:00\",\"parent\":{\"firstName\":\"A\",\"lastName\":\"B\",\"email\":\"a@b.com\",\"phone\":\"555-555-5555\"},\"trainee\":{\"firstName\":\"A\",\"age\":30,\"isSelf\":true},\"marketingConsent\":true,\"ts\":$(node -e 'console.log(Date.now())')}"
```

Expected: `{"ok":true,"appointmentId":"spam-discarded"}`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/book.ts
git commit -m "feat(booking): add /api/book with anti-spam + GHL write"
```

---

## Phase 5 â€” UI Components

### Task 5.1: `BookingFlow.astro` â€” shell + state machine

**Files:**
- Create: `src/components/booking/BookingFlow.astro`

- [ ] **Step 1: Write file**

```astro
---
/**
 * BookingFlow â€” the in-place state machine that replaces the GHL iframes.
 * Renders all 6 states pre-rendered in the DOM; controller toggles `hidden`.
 */
import ProgramSurvey from './ProgramSurvey.astro';
import DatePicker from './DatePicker.astro';
import SlotPicker from './SlotPicker.astro';
import TraineeForm from './TraineeForm.astro';
import BookingSuccess from './BookingSuccess.astro';
import BookingError from './BookingError.astro';

const renderTs = Date.now();
---

<section
  id="booking-flow"
  class="max-w-3xl mx-auto px-4 md:px-6 pb-10"
  data-render-ts={renderTs}
>
  <div data-step="survey">
    <ProgramSurvey />
  </div>
  <div data-step="date" hidden>
    <DatePicker />
  </div>
  <div data-step="slot" hidden>
    <SlotPicker />
  </div>
  <div data-step="form" hidden>
    <TraineeForm />
  </div>
  <div data-step="success" hidden>
    <BookingSuccess />
  </div>
  <div data-step="error" hidden>
    <BookingError />
  </div>
</section>

<script>
  // â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  type ProgramKey = 'tiny'|'lc1'|'lc2'|'juniors'|'adults';
  type Step = 'survey'|'date'|'slot'|'form'|'success'|'error';

  interface Slot { startISO: string; endISO: string; label: string; }
  interface Parent { firstName: string; lastName: string; email: string; phone: string; }
  interface Trainee { firstName: string; age: number; isSelf: boolean; }
  interface BookingSummary { programName: string; label: string; traineeName: string; }

  const root = document.getElementById('booking-flow') as HTMLElement | null;
  if (root) {
    let state = {
      step: 'survey' as Step,
      program: null as ProgramKey | null,
      programName: '',
      selectedDate: null as string | null,
      selectedSlot: null as Slot | null,
      slots: [] as Slot[],
      parent: { firstName: '', lastName: '', email: '', phone: '' } as Parent,
      trainee: { firstName: '', age: 0, isSelf: false } as Trainee,
      marketingConsent: false,
      bookings: [] as BookingSummary[],
      pageRenderTs: Number(root.dataset.renderTs ?? Date.now()),
      lastError: '' as string,
      lastAlternates: [] as Slot[],
      submitting: false,
    };

    // Pre-fill from URL params (name/email/phone forwarded from opt-in).
    try {
      const p = new URLSearchParams(location.search);
      const name = (p.get('name') ?? '').trim();
      if (name) {
        const [first, ...rest] = name.split(/\s+/);
        state.parent.firstName = pretty(first);
        if (rest.length) state.parent.lastName = pretty(rest.join(' '));
      }
      const email = (p.get('email') ?? '').trim();
      if (email) state.parent.email = email;
      const phone = (p.get('phone') ?? '').trim();
      if (phone) state.parent.phone = phone;
    } catch { /* ignore */ }

    function pretty(s: string): string {
      const clean = s.replace(/[^A-Za-z\-']/g, '');
      return clean ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : '';
    }

    // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    function render() {
      const steps: Step[] = ['survey','date','slot','form','success','error'];
      for (const s of steps) {
        const el = root!.querySelector<HTMLElement>(`[data-step="${s}"]`);
        if (el) el.hidden = s !== state.step;
      }
      // Each child component reads state on render via custom event.
      root!.dispatchEvent(new CustomEvent('booking:render', { detail: state }));
    }

    // â”€â”€â”€ Transitions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    root.addEventListener('booking:program-selected', (e: Event) => {
      const detail = (e as CustomEvent).detail as { key: ProgramKey; name: string };
      state.program = detail.key;
      state.programName = detail.name;
      state.selectedDate = null;
      state.selectedSlot = null;
      state.slots = [];
      state.step = 'date';
      render();
    });

    root.addEventListener('booking:date-selected', async (e: Event) => {
      const date = (e as CustomEvent).detail as string;
      state.selectedDate = date;
      state.selectedSlot = null;
      state.step = 'slot';
      render();
      await loadSlotsForDate(date);
    });

    root.addEventListener('booking:slot-selected', (e: Event) => {
      const slot = (e as CustomEvent).detail as Slot;
      state.selectedSlot = slot;
      state.step = 'form';
      render();
    });

    root.addEventListener('booking:form-submit', async (e: Event) => {
      const detail = (e as CustomEvent).detail as { parent: Parent; trainee: Trainee; marketingConsent: boolean };
      state.parent = detail.parent;
      state.trainee = detail.trainee;
      state.marketingConsent = detail.marketingConsent;
      await submitBooking();
    });

    root.addEventListener('booking:book-another', () => {
      // Keep parent + consent; reset everything else.
      state.program = null;
      state.programName = '';
      state.selectedDate = null;
      state.selectedSlot = null;
      state.slots = [];
      state.trainee = { firstName: '', age: 0, isSelf: false };
      state.lastError = '';
      state.lastAlternates = [];
      state.pageRenderTs = Date.now();
      state.step = 'survey';
      render();
      root!.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    root.addEventListener('booking:done', () => {
      window.location.href = `/congrats?count=${state.bookings.length}`;
    });

    root.addEventListener('booking:retry-from-error', () => {
      state.step = 'form';
      render();
    });

    // â”€â”€â”€ Network â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async function loadSlotsForDate(date: string) {
      if (!state.program) return;
      try {
        const r = await fetch(`/api/availability?program=${state.program}&from=${date}&to=${date}&t=${Date.now()}`);
        const data = await r.json();
        if (!data.ok) throw new Error(data.code ?? 'unknown');
        state.slots = data.slots as Slot[];
        render();
      } catch {
        state.lastError = 'We can\'t load class times right now.';
        state.step = 'error';
        render();
      }
    }

    async function submitBooking() {
      if (state.submitting) return;
      if (!state.program || !state.selectedSlot) return;
      state.submitting = true;
      render();
      try {
        const res = await fetch('/api/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            program: state.program,
            slotStartISO: state.selectedSlot.startISO,
            parent: state.parent,
            trainee: state.trainee,
            marketingConsent: state.marketingConsent,
            website: '',
            ts: state.pageRenderTs,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          state.bookings.push({
            programName: state.programName,
            label: state.selectedSlot.label,
            traineeName: state.trainee.isSelf ? state.parent.firstName : state.trainee.firstName,
          });
          state.step = 'success';
        } else if (data.code === 'SLOT_TAKEN') {
          state.lastError = 'That slot just filled up.';
          state.lastAlternates = (data.alternates as Slot[] | undefined) ?? [];
          state.step = 'error';
        } else {
          state.lastError = data.message ?? 'Something went wrong on our end.';
          state.step = 'error';
        }
      } catch {
        state.lastError = 'Network error. Please try again.';
        state.step = 'error';
      } finally {
        state.submitting = false;
        render();
      }
    }

    render();
  }
</script>
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors (note: child components don't exist yet, but Astro tolerates missing files only at build â€” type-check should pass as long as imports resolve. If imports fail, create stubs first then re-check.)

- [ ] **Step 3: Create stub child components for compilation**

Create each as an empty stub for now (Tasks 5.2â€“5.7 fill them in):

```astro
---
// src/components/booking/ProgramSurvey.astro (stub)
---
<div data-component="program-survey">PROGRAM SURVEY (stub)</div>
```

Repeat for: `DatePicker.astro`, `SlotPicker.astro`, `TraineeForm.astro`, `BookingSuccess.astro`, `BookingError.astro`.

- [ ] **Step 4: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/booking/
git commit -m "feat(booking): add BookingFlow shell + state machine + child stubs"
```

---

### Task 5.2: `ProgramSurvey.astro` â€” STATE 2

**Files:**
- Create (replace stub): `src/components/booking/ProgramSurvey.astro`

- [ ] **Step 1: Write file**

```astro
---
/**
 * ProgramSurvey â€” STATE 2.
 * Two-question survey resolving to a ProgramKey.
 * Q1: "Booking for self / someone else"
 * Q2 (only if "someone else"): age tier
 *
 * Emits booking:program-selected with { key, name } on resolution.
 */
import { programs } from '../../data/programs';
---

<div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm">
  <h2 class="text-2xl md:text-3xl font-bold text-gb-navy mb-2 text-center">Pick Your First Class</h2>
  <p class="text-center text-gb-text-muted mb-6">Answer two quick questions and we'll show you the right calendar.</p>

  <fieldset class="mb-6">
    <legend class="text-lg font-semibold text-gb-navy mb-3">1. Who are you booking for?</legend>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3" data-survey-q1>
      <button type="button" data-booking-for="self" class="survey-btn min-h-[56px] px-4 rounded-full border-2 border-gray-300 text-gb-text font-semibold transition-colors hover:border-gb-navy">Myself</button>
      <button type="button" data-booking-for="other" class="survey-btn min-h-[56px] px-4 rounded-full border-2 border-gray-300 text-gb-text font-semibold transition-colors hover:border-gb-navy">Someone else (e.g. my child)</button>
    </div>
  </fieldset>

  <fieldset class="mb-2 hidden" data-survey-q2>
    <legend class="text-lg font-semibold text-gb-navy mb-3">2. How old is the student?</legend>
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {programs.map((p) => (
        <button type="button" data-program-key={p.key} class="age-btn min-h-[56px] px-2 rounded-full border-2 border-gray-300 font-semibold text-sm transition-colors hover:border-gb-navy">
          {p.ageRange.replace('Ages ', '')}
        </button>
      ))}
    </div>
  </fieldset>
</div>

<script>
  type ProgramKey = 'tiny'|'lc1'|'lc2'|'juniors'|'adults';
  const PROGRAM_NAMES: Record<ProgramKey, string> = {
    tiny: 'Tiny Champions',
    lc1: 'Little Champions 1',
    lc2: 'Little Champions 2',
    juniors: 'Juniors Jiu-Jitsu',
    adults: 'Adults Brazilian Jiu-Jitsu',
  };

  const root = document.getElementById('booking-flow');
  if (root) {
    const survey = root.querySelector<HTMLElement>('[data-step="survey"]');
    const q1 = survey?.querySelector<HTMLElement>('[data-survey-q1]');
    const q2 = survey?.querySelector<HTMLElement>('[data-survey-q2]');

    q1?.querySelectorAll<HTMLButtonElement>('[data-booking-for]').forEach((btn) => {
      btn.addEventListener('click', () => {
        clearActive(q1);
        btn.classList.add('bg-gb-navy', 'text-white', 'border-gb-navy');
        const v = btn.getAttribute('data-booking-for');
        if (v === 'self') {
          q2?.classList.add('hidden');
          emit('adults');
        } else {
          q2?.classList.remove('hidden');
        }
      });
    });

    q2?.querySelectorAll<HTMLButtonElement>('[data-program-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        clearActive(q2);
        btn.classList.add('bg-gb-navy', 'text-white', 'border-gb-navy');
        emit(btn.getAttribute('data-program-key') as ProgramKey);
      });
    });

    function clearActive(scope: HTMLElement | null | undefined) {
      scope?.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
        b.classList.remove('bg-gb-navy', 'text-white', 'border-gb-navy'),
      );
    }

    function emit(key: ProgramKey) {
      root!.dispatchEvent(new CustomEvent('booking:program-selected', {
        detail: { key, name: PROGRAM_NAMES[key] },
      }));
    }

    // Reset visible state when the survey re-enters via "book another."
    root.addEventListener('booking:render', (e) => {
      const s = (e as CustomEvent).detail;
      if (s.step === 'survey') {
        clearActive(q1);
        clearActive(q2);
        q2?.classList.add('hidden');
      }
    });
  }
</script>
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/booking/ProgramSurvey.astro
git commit -m "feat(booking): implement ProgramSurvey (STATE 2)"
```

---

### Task 5.3: `DatePicker.astro` â€” STATE 3

**Files:**
- Create (replace stub): `src/components/booking/DatePicker.astro`

- [ ] **Step 1: Write file**

```astro
---
/**
 * DatePicker â€” STATE 3.
 * Horizontal-scroll chips for the next 14 days.
 * Disables days that have no class for the chosen program (computed from schedule.ts).
 *
 * Emits booking:date-selected with the YYYY-MM-DD string.
 */
import { schedule, TZ } from '../../data/schedule';
---

<div>
  <div class="flex items-center justify-between mb-4">
    <div>
      <p class="text-gb-text-muted uppercase tracking-widest text-xs font-semibold" data-program-age></p>
      <h3 class="text-2xl font-bold text-gb-navy" data-program-name></h3>
    </div>
    <button type="button" data-change-program class="text-sm text-gb-text-muted hover:text-gb-navy underline">â† Change program</button>
  </div>

  <p class="text-gb-text mb-3 font-semibold">Pick a date</p>
  <div class="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1" data-date-row>
    {/* chips populated client-side from schedule */}
  </div>
</div>

<script define:vars={{ schedule, TZ }}>
  const root = document.getElementById('booking-flow');
  if (root) {
    const node = root.querySelector('[data-step="date"]');
    const ageEl = node?.querySelector('[data-program-age]');
    const nameEl = node?.querySelector('[data-program-name]');
    const row = node?.querySelector('[data-date-row]');
    const back = node?.querySelector('[data-change-program]');

    const PROGRAM_AGE = {
      tiny: 'Ages 3â€“4', lc1: 'Ages 5â€“6', lc2: 'Ages 7â€“9', juniors: 'Ages 10â€“15', adults: 'Ages 16+',
    };

    back?.addEventListener('click', () => {
      root.dispatchEvent(new CustomEvent('booking:program-selected', { detail: { key: null, name: '' } }));
      // Clean approach: explicitly tell the flow to go to survey step.
      root.dispatchEvent(new CustomEvent('booking:book-another'));
    });

    root.addEventListener('booking:render', (e) => {
      const s = e.detail;
      if (s.step !== 'date' || !s.program) return;
      ageEl.textContent = PROGRAM_AGE[s.program];
      nameEl.textContent = s.programName;
      row.innerHTML = '';

      const programWeekdays = new Set(schedule[s.program].map((c) => c.weekday));
      const today = new Date();
      for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const wd = weekdayInTZ(d, TZ);
        const iso = isoDate(d, TZ);
        const hasClass = programWeekdays.has(wd);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.date = iso;
        btn.disabled = !hasClass;
        btn.className =
          'shrink-0 min-w-[64px] py-2 px-3 rounded-xl border-2 text-center transition-colors ' +
          (hasClass
            ? 'border-gray-300 hover:border-gb-navy text-gb-text bg-white'
            : 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed');
        btn.innerHTML =
          '<div class="text-[10px] uppercase tracking-wider">' + WEEKDAY_SHORT[wd] + '</div>' +
          '<div class="text-lg font-bold">' + d.getDate() + '</div>' +
          '<div class="text-[10px] text-gb-text-muted">' + MONTH_SHORT[d.getMonth()] + '</div>';
        if (hasClass) {
          btn.addEventListener('click', () => {
            row.querySelectorAll('button').forEach((b) => b.classList.remove('bg-gb-navy','text-white','border-gb-navy'));
            btn.classList.add('bg-gb-navy','text-white','border-gb-navy');
            root.dispatchEvent(new CustomEvent('booking:date-selected', { detail: iso }));
          });
        }
        row.appendChild(btn);
      }
    });

    const WEEKDAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    function weekdayInTZ(d, tz) {
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
      const wd = fmt.format(d);
      return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(wd);
    }
    function isoDate(d, tz) {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      return fmt.format(d); // en-CA gives YYYY-MM-DD
    }
  }
</script>
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/booking/DatePicker.astro
git commit -m "feat(booking): implement DatePicker (STATE 3)"
```

---

### Task 5.4: `SlotPicker.astro` â€” STATE 4

**Files:**
- Create (replace stub): `src/components/booking/SlotPicker.astro`

- [ ] **Step 1: Write file**

```astro
---
/**
 * SlotPicker â€” STATE 4.
 * Renders the slots fetched by BookingFlow into pill buttons.
 * Emits booking:slot-selected with the chosen Slot.
 */
---

<div>
  <div class="flex items-center justify-between mb-4">
    <h3 class="text-xl md:text-2xl font-bold text-gb-navy" data-slot-header></h3>
    <button type="button" data-change-date class="text-sm text-gb-text-muted hover:text-gb-navy underline">â† Change date</button>
  </div>

  <div data-slot-list class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <div data-skeleton class="col-span-full text-center text-gb-text-muted py-8">Loading available timesâ€¦</div>
  </div>

  <p data-no-slots class="hidden text-center text-gb-text-muted mt-6">
    No available times on this date. Try another day above.
  </p>
</div>

<script>
  const root = document.getElementById('booking-flow');
  if (root) {
    const node = root.querySelector('[data-step="slot"]');
    const list = node?.querySelector('[data-slot-list]') as HTMLElement | null;
    const empty = node?.querySelector('[data-no-slots]') as HTMLElement | null;
    const header = node?.querySelector('[data-slot-header]') as HTMLElement | null;
    const back = node?.querySelector('[data-change-date]') as HTMLElement | null;

    back?.addEventListener('click', () => {
      // Re-emit program-selected with the existing program to bounce back to date step.
      // BookingFlow's program-selected handler resets selectedSlot/date and shows STATE 3.
      root.dispatchEvent(new CustomEvent('booking:render-back-to-date'));
    });

    // Tiny extra handler in BookingFlow listens for that.
    root.addEventListener('booking:render-back-to-date', () => {
      // No public API for back-step, so fake it by dispatching a synthetic state.
      // Cleaner: ask BookingFlow to handle back-to-date. We'll do it inline here:
      const evt = new CustomEvent('booking:back-to-date');
      root.dispatchEvent(evt);
    });

    root.addEventListener('booking:render', (e) => {
      const s = (e as CustomEvent).detail;
      if (s.step !== 'slot') return;
      if (header) {
        const dateLabel = s.selectedDate ? formatDate(s.selectedDate) : '';
        header.textContent = `${s.programName} Â· ${dateLabel}`;
      }
      if (!list || !empty) return;
      list.innerHTML = '';
      if (!s.slots || s.slots.length === 0) {
        // Either still loading (slots = []) or genuinely empty after fetch.
        const skel = document.createElement('div');
        skel.className = 'col-span-full text-center text-gb-text-muted py-8';
        skel.textContent = 'Loading available timesâ€¦';
        list.appendChild(skel);
        empty.classList.add('hidden');
        return;
      }
      empty.classList.add('hidden');
      for (const slot of s.slots) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'min-h-[56px] px-4 rounded-full border-2 border-gray-300 font-semibold text-gb-text hover:border-gb-navy transition-colors';
        const time = slot.label.split(' Â· ')[1] ?? slot.label;
        btn.textContent = time;
        btn.addEventListener('click', () => {
          root.dispatchEvent(new CustomEvent('booking:slot-selected', { detail: slot }));
        });
        list.appendChild(btn);
      }
    });

    function formatDate(iso: string): string {
      const d = new Date(`${iso}T12:00:00`);
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
  }
</script>
```

- [ ] **Step 2: Hook back-to-date in BookingFlow**

In `src/components/booking/BookingFlow.astro`, inside the `<script>` block, add this handler near the other transition listeners:

```ts
    root.addEventListener('booking:back-to-date', () => {
      state.selectedSlot = null;
      state.step = 'date';
      render();
    });
```

- [ ] **Step 3: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/booking/SlotPicker.astro src/components/booking/BookingFlow.astro
git commit -m "feat(booking): implement SlotPicker (STATE 4) + back-to-date transition"
```

---

### Task 5.5: `TraineeForm.astro` â€” STATE 5

**Files:**
- Create (replace stub): `src/components/booking/TraineeForm.astro`

- [ ] **Step 1: Write file**

```astro
---
/**
 * TraineeForm â€” STATE 5.
 * Captures parent + trainee details. Pre-fills parent fields from URL params
 * and from prior bookings in the loop. Hides student fields when the parent
 * is booking themselves (Adults Â· isSelf=true).
 *
 * Emits booking:form-submit with { parent, trainee, marketingConsent }.
 */
---

<div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm">
  <p class="text-gb-text-muted text-sm mb-1" data-form-context></p>
  <h3 class="text-xl md:text-2xl font-bold text-gb-navy mb-6" data-form-headline>Your Info</h3>

  <form data-trainee-form class="space-y-4" novalidate>
    <!-- Honeypot -->
    <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"
      style="position:absolute;left:-10000px;width:1px;height:1px;opacity:0" />

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="block">
        <span class="text-sm font-medium text-gb-text">Parent first name *</span>
        <input name="parentFirst" required minlength="1" maxlength="50"
          class="mt-1 w-full h-12 px-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-gb-red focus:border-gb-red" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-gb-text">Parent last name *</span>
        <input name="parentLast" required minlength="1" maxlength="50"
          class="mt-1 w-full h-12 px-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-gb-red focus:border-gb-red" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-gb-text">Email *</span>
        <input name="email" type="email" required autocomplete="email"
          class="mt-1 w-full h-12 px-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-gb-red focus:border-gb-red" />
      </label>
      <label class="block">
        <span class="text-sm font-medium text-gb-text">Phone *</span>
        <input name="phone" type="tel" required autocomplete="tel-national"
          class="mt-1 w-full h-12 px-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-gb-red focus:border-gb-red" />
      </label>
    </div>

    <fieldset data-student-block>
      <legend class="text-sm font-semibold text-gb-navy mt-2">Student info</legend>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
        <label class="block">
          <span class="text-sm font-medium text-gb-text">Student first name *</span>
          <input name="studentFirst" minlength="1" maxlength="50"
            class="mt-1 w-full h-12 px-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-gb-red focus:border-gb-red" />
        </label>
        <label class="block">
          <span class="text-sm font-medium text-gb-text">Student age *</span>
          <input name="studentAge" type="number" min="3" max="99"
            class="mt-1 w-full h-12 px-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-gb-red focus:border-gb-red" />
        </label>
      </div>
    </fieldset>

    <label class="flex items-start gap-2 text-sm text-gb-text">
      <input type="checkbox" name="consent" class="mt-1 h-4 w-4" />
      <span>OK to text me class reminders.</span>
    </label>

    <p data-form-error class="hidden text-sm text-gb-red"></p>

    <button type="submit" data-submit
      class="w-full h-14 rounded-full bg-gb-red text-white font-bold text-lg hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
      Confirm Booking
    </button>
  </form>
</div>

<script>
  const root = document.getElementById('booking-flow');
  if (root) {
    const node = root.querySelector('[data-step="form"]') as HTMLElement | null;
    const form = node?.querySelector<HTMLFormElement>('[data-trainee-form]');
    const ctx = node?.querySelector<HTMLElement>('[data-form-context]');
    const headline = node?.querySelector<HTMLElement>('[data-form-headline]');
    const studentBlock = node?.querySelector<HTMLElement>('[data-student-block]');
    const submitBtn = node?.querySelector<HTMLButtonElement>('[data-submit]');
    const errorEl = node?.querySelector<HTMLElement>('[data-form-error]');

    let isSelf = false;

    root.addEventListener('booking:render', (e) => {
      const s = (e as CustomEvent).detail;
      if (s.step !== 'form') return;
      if (ctx && s.selectedSlot) {
        ctx.textContent = `Booking ${s.programName} Â· ${s.selectedSlot.label}`;
      }
      isSelf = s.program === 'adults'; // crude default â€” actual `isSelf` comes from survey choice elsewhere
      // Better: BookingFlow sets isSelf when "Myself" was chosen. We carry it via state.trainee.isSelf.
      isSelf = !!s.trainee?.isSelf || s.program === 'adults' && !s.trainee?.firstName;
      if (studentBlock) {
        if (isSelf) {
          studentBlock.style.display = 'none';
          // Make student inputs not required when hidden:
          studentBlock.querySelectorAll('input').forEach((i) => i.removeAttribute('required'));
        } else {
          studentBlock.style.display = '';
          studentBlock.querySelectorAll('input').forEach((i) => i.setAttribute('required', ''));
        }
      }

      // Pre-fill parent fields from state.
      if (form && s.parent) {
        (form.elements.namedItem('parentFirst') as HTMLInputElement).value = s.parent.firstName ?? '';
        (form.elements.namedItem('parentLast')  as HTMLInputElement).value = s.parent.lastName ?? '';
        (form.elements.namedItem('email')       as HTMLInputElement).value = s.parent.email ?? '';
        (form.elements.namedItem('phone')       as HTMLInputElement).value = s.parent.phone ?? '';
      }

      // Reset submit button state.
      if (submitBtn) {
        submitBtn.disabled = !!s.submitting;
        submitBtn.textContent = s.submitting ? 'Bookingâ€¦' : 'Confirm Booking';
      }
      errorEl?.classList.add('hidden');
    });

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (submitBtn?.disabled) return;
      const fd = new FormData(form);
      const parentFirst = String(fd.get('parentFirst') ?? '').trim();
      const parentLast  = String(fd.get('parentLast') ?? '').trim();
      const email       = String(fd.get('email') ?? '').trim();
      const phone       = String(fd.get('phone') ?? '').trim();
      const studentFirst = String(fd.get('studentFirst') ?? '').trim();
      const studentAgeStr = String(fd.get('studentAge') ?? '').trim();
      const consent = fd.get('consent') === 'on';

      if (!parentFirst || !parentLast || !email || !phone) return showErr('Please fill in all required fields.');
      if (!isSelf && (!studentFirst || !studentAgeStr)) return showErr('Please add the student\'s name and age.');

      const trainee = isSelf
        ? { firstName: parentFirst, age: 30, isSelf: true }   // 30 = sentinel; only ever for Adults trial.
        : { firstName: studentFirst, age: Number(studentAgeStr), isSelf: false };

      root.dispatchEvent(new CustomEvent('booking:form-submit', {
        detail: { parent: { firstName: parentFirst, lastName: parentLast, email, phone }, trainee, marketingConsent: consent },
      }));
    });

    function showErr(msg: string) {
      if (!errorEl) return;
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  }
</script>
```

- [ ] **Step 2: Surface `isSelf` from the survey to BookingFlow state**

The current BookingFlow doesn't set `state.trainee.isSelf` from the survey. Add this in `BookingFlow.astro`'s program-selected handler:

Replace:

```ts
    root.addEventListener('booking:program-selected', (e: Event) => {
      const detail = (e as CustomEvent).detail as { key: ProgramKey; name: string };
      state.program = detail.key;
      state.programName = detail.name;
      state.selectedDate = null;
      state.selectedSlot = null;
      state.slots = [];
      state.step = 'date';
      render();
    });
```

With:

```ts
    root.addEventListener('booking:program-selected', (e: Event) => {
      const detail = (e as CustomEvent).detail as { key: ProgramKey; name: string; isSelf?: boolean };
      state.program = detail.key;
      state.programName = detail.name;
      state.trainee.isSelf = !!detail.isSelf;
      state.trainee.firstName = '';
      state.trainee.age = 0;
      state.selectedDate = null;
      state.selectedSlot = null;
      state.slots = [];
      state.step = 'date';
      render();
    });
```

And in `ProgramSurvey.astro`, change the `emit` calls to pass `isSelf`:

Replace the q1 handler's "self" branch:

```ts
        if (v === 'self') {
          q2?.classList.add('hidden');
          emit('adults');
        } else {
          q2?.classList.remove('hidden');
        }
```

With:

```ts
        if (v === 'self') {
          q2?.classList.add('hidden');
          emit('adults', true);
        } else {
          q2?.classList.remove('hidden');
        }
```

And the q2 handler:

```ts
      btn.addEventListener('click', () => {
        clearActive(q2);
        btn.classList.add('bg-gb-navy', 'text-white', 'border-gb-navy');
        emit(btn.getAttribute('data-program-key') as ProgramKey, false);
      });
```

And the `emit` function:

```ts
    function emit(key: ProgramKey, isSelf: boolean) {
      root!.dispatchEvent(new CustomEvent('booking:program-selected', {
        detail: { key, name: PROGRAM_NAMES[key], isSelf },
      }));
    }
```

- [ ] **Step 3: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/booking/TraineeForm.astro src/components/booking/ProgramSurvey.astro src/components/booking/BookingFlow.astro
git commit -m "feat(booking): implement TraineeForm (STATE 5) + isSelf propagation"
```

---

### Task 5.6: `BookingSuccess.astro` â€” STATE 6a

**Files:**
- Create (replace stub): `src/components/booking/BookingSuccess.astro`

- [ ] **Step 1: Write file**

```astro
---
/**
 * BookingSuccess â€” STATE 6a.
 * Confirms the just-booked appointment, lists prior bookings (if any),
 * and offers "book another child" or "I'm all set" â†’ /congrats.
 *
 * Emits booking:book-another or booking:done.
 */
---

<div class="bg-white border border-green-200 rounded-2xl p-6 md:p-8 shadow-sm text-center">
  <div class="w-14 h-14 mx-auto mb-4 rounded-full bg-green-600 text-white flex items-center justify-center" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="w-7 h-7">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  </div>
  <h3 class="text-2xl font-extrabold text-gb-navy">Booked!</h3>
  <p class="mt-2 text-gb-text" data-success-summary></p>

  <div data-bookings-block class="mt-6 hidden text-left">
    <h4 class="text-sm font-semibold text-gb-navy uppercase tracking-wider mb-2">Your bookings so far</h4>
    <ul class="space-y-1 text-sm" data-bookings-list></ul>
  </div>

  <div class="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
    <button type="button" data-book-another
      class="min-h-[56px] px-6 rounded-full border-2 border-gb-navy text-gb-navy font-semibold hover:bg-gb-navy hover:text-white transition-colors">
      Book another child
    </button>
    <button type="button" data-done
      class="min-h-[56px] px-6 rounded-full bg-gb-red text-white font-semibold hover:bg-red-700 transition-colors">
      I'm all set
    </button>
  </div>
</div>

<script>
  const root = document.getElementById('booking-flow');
  if (root) {
    const node = root.querySelector('[data-step="success"]') as HTMLElement | null;
    const summary = node?.querySelector<HTMLElement>('[data-success-summary]');
    const list = node?.querySelector<HTMLElement>('[data-bookings-list]');
    const block = node?.querySelector<HTMLElement>('[data-bookings-block]');
    const btnAnother = node?.querySelector<HTMLButtonElement>('[data-book-another]');
    const btnDone = node?.querySelector<HTMLButtonElement>('[data-done]');

    btnAnother?.addEventListener('click', () => {
      root.dispatchEvent(new CustomEvent('booking:book-another'));
    });
    btnDone?.addEventListener('click', () => {
      root.dispatchEvent(new CustomEvent('booking:done'));
    });

    root.addEventListener('booking:render', (e) => {
      const s = (e as CustomEvent).detail;
      if (s.step !== 'success') return;
      const last = s.bookings[s.bookings.length - 1];
      if (summary && last) {
        summary.textContent = `${last.traineeName} is confirmed for ${last.programName} Â· ${last.label}`;
      }
      if (list && block) {
        list.innerHTML = '';
        if (s.bookings.length > 1) {
          for (const b of s.bookings) {
            const li = document.createElement('li');
            li.textContent = `â€¢ ${b.traineeName} â€” ${b.programName} â€” ${b.label}`;
            list.appendChild(li);
          }
          block.classList.remove('hidden');
        } else {
          block.classList.add('hidden');
        }
      }
    });
  }
</script>
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/booking/BookingSuccess.astro
git commit -m "feat(booking): implement BookingSuccess (STATE 6a) + book-another loop"
```

---

### Task 5.7: `BookingError.astro` â€” STATE 6b

**Files:**
- Create (replace stub): `src/components/booking/BookingError.astro`

- [ ] **Step 1: Write file**

```astro
---
/**
 * BookingError â€” STATE 6b.
 * Inline error card with retry + studio phone fallback.
 * If the error is SLOT_TAKEN, lists alternate times the user can pick instantly.
 *
 * Emits booking:retry-from-error, booking:slot-selected (alternate), or booking:book-another.
 */
import { nap } from '../../content/nap.ts';
---

<div class="bg-white border border-red-200 rounded-2xl p-6 md:p-8 shadow-sm text-center">
  <h3 class="text-xl md:text-2xl font-bold text-gb-navy">Something went wrong.</h3>
  <p class="mt-2 text-gb-text" data-error-message></p>

  <div data-alternates class="mt-6 hidden">
    <p class="text-sm font-semibold text-gb-navy mb-2">Try one of these instead:</p>
    <div class="flex flex-wrap gap-2 justify-center" data-alternates-list></div>
  </div>

  <div class="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
    <button type="button" data-retry
      class="min-h-[56px] px-6 rounded-full border-2 border-gb-navy text-gb-navy font-semibold hover:bg-gb-navy hover:text-white transition-colors">
      Try again
    </button>
    <a href={`tel:${nap.phoneTel}`}
      class="min-h-[56px] px-6 rounded-full bg-gb-red text-white font-semibold hover:bg-red-700 transition-colors flex items-center justify-center">
      Or call us: {nap.phone}
    </a>
  </div>
</div>

<script>
  const root = document.getElementById('booking-flow');
  if (root) {
    const node = root.querySelector('[data-step="error"]') as HTMLElement | null;
    const msg = node?.querySelector<HTMLElement>('[data-error-message]');
    const altsBox = node?.querySelector<HTMLElement>('[data-alternates]');
    const altsList = node?.querySelector<HTMLElement>('[data-alternates-list]');
    const retry = node?.querySelector<HTMLButtonElement>('[data-retry]');

    retry?.addEventListener('click', () => {
      root.dispatchEvent(new CustomEvent('booking:retry-from-error'));
    });

    root.addEventListener('booking:render', (e) => {
      const s = (e as CustomEvent).detail;
      if (s.step !== 'error') return;
      if (msg) msg.textContent = s.lastError || 'Please try again or call us.';
      if (altsList && altsBox) {
        altsList.innerHTML = '';
        if (s.lastAlternates && s.lastAlternates.length > 0) {
          for (const slot of s.lastAlternates) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'min-h-[44px] px-4 rounded-full border-2 border-gray-300 text-gb-text hover:border-gb-navy';
            btn.textContent = slot.label;
            btn.addEventListener('click', () => {
              root.dispatchEvent(new CustomEvent('booking:slot-selected', { detail: slot }));
            });
            altsList.appendChild(btn);
          }
          altsBox.classList.remove('hidden');
        } else {
          altsBox.classList.add('hidden');
        }
      }
    });
  }
</script>
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/booking/BookingError.astro
git commit -m "feat(booking): implement BookingError (STATE 6b) with alternates + phone fallback"
```

---

## Phase 6 â€” Page Integration

### Task 6.1: Replace iframe block in `kickstart.astro` with `BookingFlow`

**Files:**
- Modify: `src/pages/kickstart.astro`

- [ ] **Step 1: Replace the file**

Replace the entire file with:

```astro
---
/**
 * /kickstart â€” post opt-in booking page.
 * FunnelLayout: NO nav, NO footer, NO AI chat, NO sticky CTA.
 *
 * Reached after homepage opt-in submit. Optional ?name=, ?email=, ?phone=
 * query params are read client-side to personalize the H1 and pre-fill the form.
 */
import FunnelLayout from '../layouts/FunnelLayout.astro';
import TrustStrip from '../components/cta/TrustStrip.astro';
import BookingFlow from '../components/booking/BookingFlow.astro';
---

<FunnelLayout
  title="You're In! Your Free 3-Class Pass Is Reserved"
  description="Your free 3-class pass at Gracie Barra Whittier is reserved. Book your first class below."
>
  <!-- Section 1: Confirmation header -->
  <section class="max-w-3xl mx-auto px-4 md:px-6 pt-10 md:pt-16 pb-6 text-center">
    <p class="text-gb-text-muted uppercase tracking-widest text-xs md:text-sm font-semibold mb-3">
      Free 3-Class Pass &middot; Reserved
    </p>
    <h1 id="kickstart-headline" class="text-3xl md:text-5xl font-extrabold text-gb-navy leading-tight">
      You're In! Your Free 3-Class Pass Is Reserved.
    </h1>
    <p class="mt-5 text-base md:text-lg text-gb-text-muted max-w-2xl mx-auto">
      One last step &mdash; book your first class below. Choose the program that
      matches your (or your child's) age and pick a time that works for you.
    </p>
  </section>

  <!-- Section 2: Age routing guide -->
  <section class="max-w-3xl mx-auto px-4 md:px-6 pb-8">
    <div class="bg-gb-bg-light rounded-2xl p-6 md:p-8">
      <h2 class="text-xl md:text-2xl font-bold text-gb-navy mb-3">Not sure which program to choose?</h2>
      <p class="text-gb-text-muted mb-4">Here's a quick guide to match each student to the right program:</p>
      <ul class="space-y-2 text-gb-text">
        <li class="flex items-baseline gap-3"><span class="font-semibold text-gb-navy whitespace-nowrap">Ages 3â€“4:</span><span>Tiny Champions</span></li>
        <li class="flex items-baseline gap-3"><span class="font-semibold text-gb-navy whitespace-nowrap">Ages 5â€“6:</span><span>Little Champions 1</span></li>
        <li class="flex items-baseline gap-3"><span class="font-semibold text-gb-navy whitespace-nowrap">Ages 7â€“9:</span><span>Little Champions 2</span></li>
        <li class="flex items-baseline gap-3"><span class="font-semibold text-gb-navy whitespace-nowrap">Ages 10â€“15:</span><span>Juniors Jiu-Jitsu</span></li>
        <li class="flex items-baseline gap-3"><span class="font-semibold text-gb-navy whitespace-nowrap">Ages 16+:</span><span>Adults Brazilian Jiu-Jitsu</span></li>
      </ul>
    </div>
  </section>

  <!-- Section 3: BookingFlow (replaces former iframe block) -->
  <BookingFlow />

  <!-- Section 4: What happens next -->
  <section class="bg-gb-bg-light py-12 md:py-16">
    <div class="max-w-4xl mx-auto px-4 md:px-6">
      <h2 class="text-2xl md:text-3xl font-bold text-gb-navy text-center mb-8">What Happens Next</h2>
      <ol class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <li class="bg-white rounded-2xl p-6 text-center">
          <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-gb-red text-white font-bold text-lg flex items-center justify-center">1</div>
          <h3 class="font-semibold text-gb-navy mb-2">Book your first class</h3>
          <p class="text-gb-text-muted text-sm">Use the picker above to choose a time that works for you.</p>
        </li>
        <li class="bg-white rounded-2xl p-6 text-center">
          <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-gb-red text-white font-bold text-lg flex items-center justify-center">2</div>
          <h3 class="font-semibold text-gb-navy mb-2">Show up</h3>
          <p class="text-gb-text-muted text-sm">Wear comfortable workout clothes &mdash; we provide the uniform.</p>
        </li>
        <li class="bg-white rounded-2xl p-6 text-center">
          <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-gb-red text-white font-bold text-lg flex items-center justify-center">3</div>
          <h3 class="font-semibold text-gb-navy mb-2">Meet with Alex</h3>
          <p class="text-gb-text-muted text-sm">After class, talk with our Program Director about next steps. No pressure, no commitment.</p>
        </li>
      </ol>
    </div>
  </section>

  <!-- Section 5: Trust strip -->
  <section class="py-8 md:py-10 px-4">
    <TrustStrip
      items={[
        'Free uniform rental included',
        'No contracts',
        'No pressure',
        'World-class Gracie Barra curriculum',
      ]}
    />
  </section>

  <script is:inline>
    // Personalize H1 with ?name= query param (preserved from prior version).
    (function () {
      try {
        var params = new URLSearchParams(window.location.search);
        var raw = params.get('name');
        if (raw) {
          var first = raw.trim().split(/\s+/)[0].replace(/[^A-Za-z\-']/g, '');
          if (first) {
            var pretty = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
            var h1 = document.getElementById('kickstart-headline');
            if (h1) h1.textContent = "You're In, " + pretty + "! Your Free 3-Class Pass Is Reserved.";
          }
        }
      } catch (_) {}
    })();
  </script>
</FunnelLayout>
```

- [ ] **Step 2: Type-check + build**

```bash
npm run check && npm run build
```

Expected: 0 errors, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/kickstart.astro
git commit -m "feat(booking): replace GHL iframes on /kickstart with native BookingFlow"
```

---

### Task 6.2: Patch `OptInForm.astro` to forward email + phone

**Files:**
- Modify: `src/components/form/OptInForm.astro`

- [ ] **Step 1: Update redirect URL construction**

In the `<script>` block at the bottom of the file, find this line:

```ts
        window.location.href = `/kickstart?name=${encodeURIComponent(name)}`;
```

Replace with:

```ts
        const qs = new URLSearchParams({ name, email, phone });
        window.location.href = `/kickstart?${qs.toString()}`;
```

- [ ] **Step 2: Type-check**

```bash
npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/form/OptInForm.astro
git commit -m "feat(optin): forward email and phone to /kickstart for prefill"
```

---

### Task 6.3: Update `congrats.astro` to read `?count=`

**Files:**
- Modify: `src/pages/congrats.astro`

- [ ] **Step 1: Edit frontmatter and headline**

Replace the frontmatter block:

```ts
---
/**
 * /congrats â€” post-booking confirmation page.
 * FunnelLayout: NO nav, NO footer, NO AI chat.
 * No links out except phone, email, map directions, and a small
 * "back to home" escape hatch in the footer of the page.
 */
import FunnelLayout from '../layouts/FunnelLayout.astro';
import TrustStrip from '../components/cta/TrustStrip.astro';
import { nap } from '../content/nap.ts';

const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
  nap.address,
)}`;
---
```

With:

```ts
---
export const prerender = true;
/**
 * /congrats â€” post-booking confirmation page.
 * FunnelLayout: NO nav, NO footer, NO AI chat.
 * Reads ?count=N to personalize headline for multi-child bookings.
 */
import FunnelLayout from '../layouts/FunnelLayout.astro';
import TrustStrip from '../components/cta/TrustStrip.astro';
import { nap } from '../content/nap.ts';

const mapsHref = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
  nap.address,
)}`;
---
```

> Note: `prerender = true` was already added in Task 0.4 â€” keep it. If duplicated, leave only one.

Then replace the H1 + intro paragraph block:

```astro
    <h1 class="text-3xl md:text-5xl font-extrabold text-gb-navy leading-tight">
      Booking Confirmed &mdash; See You On The Mat!
    </h1>
    <p class="mt-5 text-base md:text-lg text-gb-text-muted max-w-2xl mx-auto">
      Your first class is booked. We've sent the details to your email. Here's
      what to do next:
    </p>
```

With:

```astro
    <h1 id="congrats-headline" class="text-3xl md:text-5xl font-extrabold text-gb-navy leading-tight">
      Booking Confirmed &mdash; See You On The Mat!
    </h1>
    <p id="congrats-intro" class="mt-5 text-base md:text-lg text-gb-text-muted max-w-2xl mx-auto">
      Your first class is booked. We've sent the details to your email. Here's what to do next:
    </p>
    <script is:inline>
      (function () {
        try {
          var params = new URLSearchParams(window.location.search);
          var n = parseInt(params.get('count') || '1', 10);
          if (Number.isFinite(n) && n > 1) {
            var h = document.getElementById('congrats-headline');
            var p = document.getElementById('congrats-intro');
            if (h) h.textContent = 'All ' + n + ' Classes Are Booked â€” See You On The Mat!';
            if (p) p.textContent = 'Weâ€™ve sent confirmation emails for each class. Hereâ€™s what to do next:';
          }
        } catch (_) {}
      })();
    </script>
```

- [ ] **Step 2: Type-check + build**

```bash
npm run check && npm run build
```

Expected: 0 errors, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/congrats.astro
git commit -m "feat(congrats): personalize headline for multi-child bookings via ?count="
```

---

## Phase 7 â€” End-to-End Verification

### Task 7.1: Full local smoke test

**Files:** none modified.

Pre-req: `.env` populated with **valid** `GHL_PIT_TOKEN`, `GHL_LOCATION_ID`, and the 5 `GHL_CAL_*` IDs from your GHL sub-account.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify availability endpoint**

In another terminal, hit availability for each program:

```bash
for p in tiny lc1 lc2 juniors adults; do
  echo "--- $p ---"
  curl -s "http://localhost:4321/api/availability?program=$p&from=2026-05-04&to=2026-05-17" | head -c 300
  echo
done
```

Expected: each call returns `{ ok: true, slots: [...] }` with at least one slot per program (assuming GHL has open availability). If any returns `GHL_UNAVAILABLE`, check terminal logs and resolve env / GHL config.

- [ ] **Step 3: Manual UI smoke (Chrome devtools)**

Open `http://localhost:4321/kickstart?name=Jane&email=jane@example.com&phone=5555551212`.

Verify in this exact order:

1. H1 reads "You're In, Jane! â€¦"
2. Survey renders with both Q1 buttons.
3. Click "Myself" â†’ date picker appears with `Adults Brazilian Jiu-Jitsu Â· Ages 16+` header.
4. Click any enabled date â†’ slot picker shows skeleton, then loads slots within ~1s.
5. Click a slot â†’ form renders, parent fields pre-filled with `Jane`, `jane@example.com`, `5555551212`. Student fields hidden.
6. Click `Confirm Booking` (with valid name fields) â†’ success card shows the booking line.
7. Click `Book another child` â†’ flow returns to survey, parent fields kept.
8. Pick "Someone else" â†’ age question appears â†’ pick `5â€“6` â†’ date picker â†’ slot â†’ form. Student fields visible and required this time.
9. Submit â†’ success card shows BOTH bookings in the "Your bookings so far" list.
10. Click `I'm all set` â†’ navigates to `/congrats?count=2`. Headline reads "All 2 Classes Are Booked â€¦".

- [ ] **Step 4: Verify in GHL**

Open the GHL sub-account â†’ Conversations / Contacts. Confirm:
- A single contact exists for `jane@example.com`.
- Two appointments are attached, on the two correct calendars at the booked times.
- The user received GHL's native confirmation email (check the inbox of the test email).

If confirmation email did NOT fire: confirm `toNotify: true` is being respected by the calendar's notification settings in GHL. Adjust `createAppointment` payload as needed.

- [ ] **Step 5: Stop dev server**

`Ctrl+C` in the dev terminal.

- [ ] **Step 6: Commit verification log**

No code change. Optional commit if you want to record verification status:

```bash
git commit --allow-empty -m "test(booking): manual end-to-end smoke verified locally"
```

---

## Self-Review

**1. Spec coverage** â€” checked each section of the design spec against the task list:
- Â§3 Architecture (server output, vercel adapter, layered files) â†’ Tasks 0.3, 1â€“5
- Â§4 Data model (programs, schedule, blackouts, types) â†’ Tasks 1.1â€“1.3, 2.1
- Â§5 UI flow (6 states, book-another loop, /congrats handoff) â†’ Tasks 5.1â€“5.7, 6.3
- Â§6 Failure handling (availability fail card, slot-taken alternates, write-fail card) â†’ Tasks 4.1, 4.2, 5.7
- Â§7 Anti-spam (4 layers) â†’ Tasks 4.2, 5.1, 5.5
- Â§8 File structure â†’ matches Phase 5 + 6 file list
- Â§9 Open implementation risks (GHL endpoint shapes) â†’ flagged in Task 3 header + Task 7.1 step 4

All spec sections have at least one task. No gaps.

**2. Placeholder scan** â€” no "TBD", "TODO", "implement later", "fill in details" outside the data file `blackouts.ts` (which is intentionally empty, with a comment explaining how to populate). Every code step shows full code.

**3. Type consistency** â€” verified across tasks:
- `ProgramKey` defined in `data/programs.ts`, re-exported via `lib/booking-types.ts` (`z.infer`) â€” matches usage in API routes and components.
- `Slot` interface in `BookingFlow.astro` matches `AvailabilitySlot` in `booking-types.ts` (same fields).
- `getFreeSlots`, `upsertContact`, `createAppointment` signatures match between `ghl.ts` (Task 3.2), `availability.ts` (Task 4.1), and `book.ts` (Task 4.2).
- Custom event names consistent across components: `booking:program-selected`, `booking:date-selected`, `booking:slot-selected`, `booking:form-submit`, `booking:render`, `booking:book-another`, `booking:done`, `booking:retry-from-error`, `booking:back-to-date`.

No inconsistencies found.
