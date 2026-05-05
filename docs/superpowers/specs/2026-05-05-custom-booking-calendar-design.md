# Custom Booking Calendar — `/kickstart`

**Status:** Approved (design)
**Date:** 2026-05-05
**Owner:** Gracie Barra Whittier site

## 1. Goal

Replace the 5 GoHighLevel (GHL) booking iframes on `/kickstart` with a native in-page calendar flow. After a slot is selected and the form submitted, write the booking directly into GHL via its v2 API so staff continue to manage appointments in the existing GHL calendar UI and the standard GHL confirmation email/SMS fires automatically.

## 2. Non-Goals

- No new persistence layer. GHL remains the single source of truth for bookings.
- No modal/dialog UI. The booking flow is in-page on `/kickstart`.
- No CRM beyond GHL, no Sentry/Axiom, no Vercel KV/Upstash queue. Vercel Function Logs are sufficient for week-one observability.
- No analytics events added in this scope.

## 3. Architecture

### 3.1 Stack changes

- `astro.config.mjs` switches from static to `output: 'server'` and adds `@astrojs/vercel`.
- Every existing marketing page gets `export const prerender = true;` so static pages stay CDN-cached. Only `/kickstart` and `/api/*` run as Vercel Functions.
- New deps: `@astrojs/vercel`, `zod`.

### 3.2 Request flow

```
[Browser]                                    [Astro server / Vercel Function]                  [GHL API v2]
   │  GET /kickstart (page shell + JS)                  │                                       │
   ├──────────────────────────────────────────────────────►│                                    │
   │                                                       │                                    │
   │  GET /api/availability?program=adults&from=…&to=…     │                                    │
   ├──────────────────────────────────────────────────────►│  GET /calendars/{id}/free-slots    │
   │                                                       ├───────────────────────────────────►│
   │                                                       │◄───────────────────────────────────┤
   │  ◄── { slots: [...] }  (template − blackouts − booked, 60s edge cached)                    │
   │                                                       │                                    │
   │  POST /api/book  { program, slot, parent, trainee, marketingConsent, ts, website }         │
   ├──────────────────────────────────────────────────────►│  POST /contacts/  (upsert by email)│
   │                                                       ├───────────────────────────────────►│
   │                                                       │  POST /calendars/events/appointments│
   │                                                       ├───────────────────────────────────►│
   │  ◄── { ok, appointmentId } or structured error                                             │
```

### 3.3 Layered responsibilities

| Layer | File(s) | Responsibility |
|---|---|---|
| Data | `src/data/programs.ts`, `schedule.ts`, `blackouts.ts` | Plain typed config. No I/O. |
| Domain | `src/lib/slot-resolver.ts` | Pure function: template + blackouts − booked → `AvailabilitySlot[]`. |
| GHL client | `src/lib/ghl.ts` | Server-only. Owns token + fetch wrapper. Exposes `getFreeSlots`, `upsertContact`, `createAppointment`. |
| Types | `src/lib/booking-types.ts` | Zod schemas + TS types shared between API and UI. |
| HTTP adapters | `src/pages/api/availability.ts`, `book.ts` | Thin: validate, call lib, shape response. |
| UI | `src/pages/kickstart.astro`, `src/components/booking/*` | Talks only to `/api/*`, never to GHL. |

### 3.4 Token & secrets (Vercel env vars)

| Var | Scope | Purpose |
|---|---|---|
| `GHL_PIT_TOKEN` | server | Private Integration Token (Bearer auth) |
| `GHL_LOCATION_ID` | server | Sub-account ID |
| `GHL_CAL_TINY` | server | Calendar ID — Tiny Champions |
| `GHL_CAL_LC1` | server | Calendar ID — Little Champs 1 |
| `GHL_CAL_LC2` | server | Calendar ID — Little Champs 2 |
| `GHL_CAL_JUNIORS` | server | Calendar ID — Juniors BJJ |
| `GHL_CAL_ADULTS` | server | Calendar ID — Adults |

No `PUBLIC_` prefix → never exposed to the browser. Documented in `.env.example`.

### 3.5 Caching

- `GET /api/availability` response: `Cache-Control: s-maxage=60, stale-while-revalidate=300`.
- `POST /api/book` always uncached.
- After a successful booking, the next availability call appends `?t=<now>` to bust cache before the "book another" loop reads.

## 4. Data Model

### 4.1 `src/data/programs.ts`

```ts
export type ProgramKey = 'tiny' | 'lc1' | 'lc2' | 'juniors' | 'adults';

export interface Program {
  key: ProgramKey;
  name: string;              // "Tiny Champions"
  ageRange: string;          // "Ages 3–4"
  calendarIdEnvVar: string;  // "GHL_CAL_TINY"
}

export const programs: Program[] = [
  { key: 'tiny',    name: 'Tiny Champions',          ageRange: 'Ages 3–4',  calendarIdEnvVar: 'GHL_CAL_TINY' },
  { key: 'lc1',     name: 'Little Champions 1',      ageRange: 'Ages 5–6',  calendarIdEnvVar: 'GHL_CAL_LC1' },
  { key: 'lc2',     name: 'Little Champions 2',      ageRange: 'Ages 7–9',  calendarIdEnvVar: 'GHL_CAL_LC2' },
  { key: 'juniors', name: 'Juniors Jiu-Jitsu',       ageRange: 'Ages 10–15', calendarIdEnvVar: 'GHL_CAL_JUNIORS' },
  { key: 'adults',  name: 'Adults Brazilian Jiu-Jitsu', ageRange: 'Ages 16+', calendarIdEnvVar: 'GHL_CAL_ADULTS' },
];
```

### 4.2 `src/data/schedule.ts`

Recurring weekly template. Local timezone fixed to `America/Los_Angeles`.

```ts
type Weekday = 0|1|2|3|4|5|6; // 0=Sun … 6=Sat

export interface ClassSlot {
  weekday: Weekday;
  hour: number;        // 24h, local
  minute: number;
  durationMin: number;
}

export const TZ = 'America/Los_Angeles';

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
    // Trial-eligible Fundamentals (GB1) only — no Advanced/Top Team for trials.
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

### 4.3 `src/data/blackouts.ts`

```ts
export const blackouts: string[] = [
  // ISO date strings (YYYY-MM-DD) when the gym is closed entirely.
  // Maintained manually. Subtracted in slot-resolver.
];
```

### 4.4 `src/lib/booking-types.ts`

```ts
export const ProgramKeyEnum = z.enum(['tiny','lc1','lc2','juniors','adults']);

export const AvailabilityRequest = z.object({
  program: ProgramKeyEnum,
  from: z.string().date(),    // ISO date inclusive
  to: z.string().date(),      // ISO date inclusive (max 21 days range)
});

export interface AvailabilitySlot {
  startISO: string;   // "2026-05-06T15:00:00-07:00"
  endISO: string;
  label: string;      // "Tue, May 6 · 3:00 PM"
}

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
  // Anti-spam fields:
  website: z.string().optional(),   // honeypot
  ts:      z.number().int(),        // page render timestamp
});
```

### 4.5 Booking constants

- Availability window: **next 14 days** rolling.
- Max range per `/api/availability` request: 21 days.
- Per-IP rate limit: **5 bookings / 10 min** (in-memory token bucket).
- Min dwell time before submit: **3000 ms**.

## 5. UI Flow

Single page (`/kickstart`). State held in module-scoped vanilla-TS controller. No URL hash, no localStorage. Six states swap in-place inside the booking section.

### 5.1 States

| # | State | Trigger to next state |
|---|---|---|
| 1 | Confirmation header (always visible top) | (static) |
| 2 | Survey: "Myself / Someone else" → age tier | Resolves `ProgramKey` |
| 3 | Date picker — horizontal chips, next 14 days | User picks date |
| 4 | Slot picker — pill buttons, loaded from `/api/availability` | User picks slot |
| 5 | Trainee/parent form | User submits |
| 6a | Success card + "book another?" prompt | Yes → reset to state 2; No → `/congrats` |
| 6b | Error card with "Try again" + phone fallback | (terminal until retry) |

Pre-fill from URL: `?name=…` populates parent first name (existing behavior). New: `?email=…&phone=…` populate parent email/phone — requires patching `OptInForm.astro` to forward these.

### 5.2 Date picker rules

- Days with no class for the selected program: greyed, disabled.
- Days fully booked: greyed, labelled "Full".
- Today's date: only show slots whose start time is still ≥ now + 60 minutes (no last-minute bookings via the funnel).

### 5.3 "Book another child" loop

State carried across loops:

| Field | Carried |
|---|---|
| `parent.*`, `marketingConsent` | yes |
| `program`, `selectedDate`, `selectedSlot`, `trainee.*` | reset |
| `ts` (dwell timer), `website` (honeypot) | re-stamped |

The success card maintains a running `bookings: BookingSummary[]` array (client-side only) and renders a "Your bookings so far" list when `length > 1`.

### 5.4 Handoff to `/congrats`

`/congrats?count=N`. `congrats.astro` reads `count`:

- `count === 1` → existing copy ("Your first class is booked")
- `count > 1` → "All N classes are booked. See you on the mat!"

## 6. Failure Handling

### 6.1 Availability load fails

`/api/availability` returns 200 with `{ ok: false, code: 'GHL_UNAVAILABLE' }` on GHL errors. UI shows inline retry card with phone number fallback. Single client-side retry with 1.5s backoff before showing the card.

### 6.2 Slot taken between page load and submit

`POST /api/book` re-validates availability **before** writing. If gone:

```
Sorry — that 4:00 PM slot just filled up.
Here are the next 3 available times: [chips]
```

Form data preserved in component state.

### 6.3 Booking write fails (GHL 5xx, network)

Form preserved. Error card with `[Try again]` + studio phone number `(562) 640-1400`. Server logs the full payload + GHL response body via `console.error` → Vercel Function Logs.

`upsertContact` is naturally idempotent (lookup by email), so retries do not create duplicate contacts.

### 6.4 Out of scope (YAGNI)

- Vercel KV / Upstash fallback queue
- Resend email-to-staff on failure
- Sentry / Axiom
- GHL idempotency keys (not natively supported)

## 7. Anti-Spam Defense

Four layers, zero extra GHL calls:

1. **Client single-flight submit** — `inFlight` lock + disabled button while request in flight. Catches rage-clicks, mobile double-taps.
2. **Honeypot field** — hidden input named `website`. If non-empty server-side: silent 200 (do not GHL-call, do not error to bot).
3. **Min dwell time** — hidden `ts` field stamped at page render. Submit < 3000ms after render → silent 200.
4. **Per-IP token bucket** — module-scoped `Map`, 5 submissions / 10 minutes per IP. Trade-off: in-memory state doesn't survive cold starts; acceptable for single-location franchise. Upgrade path: Vercel BotID or Upstash Redis if abuse materializes.

Legitimate duplicates (same parent booking multiple kids in same slot) are **allowed** by design.

## 8. File Structure

```
src/
├── data/
│   ├── programs.ts             NEW
│   ├── schedule.ts             NEW
│   └── blackouts.ts            NEW
├── lib/
│   ├── ghl.ts                  NEW   server-only GHL client
│   ├── slot-resolver.ts        NEW   pure: template − blackouts − booked
│   └── booking-types.ts        NEW   Zod + TS types
├── pages/
│   ├── api/
│   │   ├── availability.ts     NEW   GET, edge-cached 60s
│   │   └── book.ts             NEW   POST, anti-spam + write
│   ├── kickstart.astro         MODIFY  iframe section → BookingFlow
│   ├── congrats.astro          MODIFY  read ?count= for headline
│   ├── index.astro             MODIFY  + `export const prerender = true;`
│   └── (all other pages)       MODIFY  + `export const prerender = true;`
└── components/
    ├── booking/
    │   ├── BookingFlow.astro       NEW  shell + state machine
    │   ├── ProgramSurvey.astro     NEW  STATE 2 (lifted from kickstart)
    │   ├── DatePicker.astro        NEW  STATE 3
    │   ├── SlotPicker.astro        NEW  STATE 4
    │   ├── TraineeForm.astro       NEW  STATE 5
    │   ├── BookingSuccess.astro    NEW  STATE 6a + book-another prompt
    │   └── BookingError.astro      NEW  STATE 6b
    └── form/
        └── OptInForm.astro     MODIFY  forward email + phone in redirect
```

Boundaries:

| Unit | Knows about | Does NOT know about |
|---|---|---|
| `data/*` | Plain types | I/O, Astro, GHL, env |
| `lib/ghl.ts` | `fetch`, env, GHL endpoints | UI, components, Astro |
| `lib/slot-resolver.ts` | Date math, schedule, blackouts | Network, GHL |
| `lib/booking-types.ts` | Zod | Anything else |
| `pages/api/*` | Zod, lib/*, HTTP | UI rendering |
| `components/booking/*` | siblings, `/api/*` via fetch | GHL, env, tokens |

## 9. Open Implementation Risks

1. **Exact GHL `GET /calendars/{id}/free-slots` response shape** — verify during implementation; adapt `getFreeSlots` parser accordingly.
2. **Exact `POST /calendars/events/appointments` payload** — verify required fields (custom values, calendar config) on the GBW sub-account.
3. **GHL native confirmation email/SMS firing** — confirm the calendar's notification settings trigger on API-created appointments identically to widget-created ones. May require `toNotify: true` flag in the create payload.

These are flagged in code as `// VERIFY:` comments at the call sites and resolved in implementation, not design.

## 10. Out of Scope

- New analytics/tracking events
- A/B testing framework
- Reschedule / cancel flows (GHL native confirmation email handles this)
- Waitlists when slots are full
- Multi-location support
- Admin UI for managing the schedule (still code-edited)
