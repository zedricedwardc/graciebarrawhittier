# Rebook — "Add a New Person" Feature Design

**Date:** 2026-05-20
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

`/rebook` is the dashboard for customers with an active trial pass. It shows
one card per trainee (sourced from open **Trial Credit Monitoring** opps) with
a "Book a class" action. Today a parent cannot register an *additional* family
member — a sibling who has never trained — from this page; they would have to
go through the public `/kickstart` funnel from scratch.

This feature lets an existing active-trial customer add and book a brand-new
person's **first trial class** directly from `/rebook`, reusing their account.

## Goals

- A parent on `/rebook` can add a new family member and book their first trial
  class without re-entering parent/contact details.
- The new person appears on the dashboard **immediately** as a card, and that
  card **persists across page refreshes** and later magic-link visits.
- The dashboard also surfaces already-**enrolled** household members as
  informational cards, giving the family a complete picture.

## Non-goals

- Editing or cancelling the new person's booking from `/rebook` (cancellation
  already exists via `/api/cancel`; out of scope here).
- Booking a *second* class for the new person before they have attended their
  first (they have no credit pass yet — pending cards have no booking action).
- Changing the public `/kickstart` funnel.

## Card model

The dashboard renders one card per trainee. Each trainee resolves to exactly
one of four states, by priority (highest wins):

| Priority | Status | Source | Card UI |
|---|---|---|---|
| 1 | `enrolled` | Trial Conversion opp, **won** (`STUDENT ENROLLED (WON)`) | "Enrolled" badge — informational, no button |
| 2 | `active` | Trial Credit Monitoring opp, open, `credits > 0` | credit count + **Book a class** *(existing)* |
| 2 | `exhausted` | Trial Credit Monitoring opp, open, `credits = 0` | "Trial complete" + **Schedule enrollment class** *(existing)* |
| 3 | `pending` | Trial Conversion opp, open, not yet attended, no Credit opp | "Trial class booked: <date>" badge — no button |

A single `trainee_key` never produces two cards: opps are merged by
`trainee_key` and the highest-priority status wins. `enrolled` and `pending`
cards carry **no `sessionToken`** — there is no per-trainee booking action on
them.

### `TraineeCard` interface changes

`src/pages/api/rebook-lookup.ts` exports the `TraineeCard` interface. New
fields:

- `status: 'enrolled' | 'active' | 'exhausted' | 'pending'`
- `pendingClassISO?: string | null` — the booked class start ISO, for
  `pending` cards (from the Trial Conversion opp's `last_appointment_start_iso`).
- `sessionToken` becomes optional — present only on `active` / `exhausted`
  cards.

The page's client-side `Trainee` interface mirrors these changes. Rendering
logic in `buildCard()` branches on `status`.

## Architecture

### Approach chosen

A new dedicated endpoint, `/api/rebook-add-person`, modeled on the existing
`/api/rebook-change-program`. Rejected alternatives:

- **Reuse `/api/book`'s public path** — would require `/api/rebook-lookup` to
  return the parent's email/phone to the browser, leaking PII and undermining
  the endpoint's anti-enumeration design.
- **Add an `addPerson` branch inside `/api/book`** — `book.ts` already carries
  the initial-booking and rebook flows; a third branch reduces clarity.

### Server: `/api/rebook-lookup` and `/api/rebook-context` changes

Both endpoints currently fetch only open `CREDIT_MON` opps. They will also
fetch `TRIAL_CONV` opps (open **and** won) for the same contact, then run a
shared **merge resolver** that:

1. Groups all opps (`CREDIT_MON` + `TRIAL_CONV`) by `trainee_key`.
2. For each `trainee_key`, picks the status by the priority table above.
3. Emits one `TraineeCard` per `trainee_key`.

The merge resolver is extracted into a shared helper (e.g.
`src/lib/rebook-cards.ts`) so both endpoints — and its unit tests — use one
implementation. Trial Conversion opps in `LOST / COLD` are ignored.

Both endpoints additionally return a **contact-scoped token**:

```
contactToken: signRebookToken({ contactId, traineeKey: '' })  // 15-min TTL
```

This authorizes the add-person action without binding to any single trainee.

### Server: new endpoint `/api/rebook-add-person.ts`

Modeled on `rebook-change-program.ts`.

**Request body:**

```ts
{
  contactId: string;
  sessionToken: string;          // the contactToken from lookup/context
  program: 'tiny'|'lc1'|'lc2'|'juniors'|'adults';
  trainee: { firstName: string; age: number };
  slotStartISO: string;
  ts: number;                    // page render timestamp (min-dwell check)
  website: string;               // honeypot
}
```

**Processing:**

1. Per-IP rate limit (window + max parity with `/api/book`).
2. Honeypot (`website` non-empty → silent OK) + min-dwell (`Date.now() - ts`).
3. Verify `sessionToken` with `verifyRebookToken`; require it resolves to
   `contactId` **with an empty `traineeKey`** (distinguishes it from
   per-trainee tokens).
4. Resolve the program's calendar env var; `getFreeSlots` re-validation of
   `slotStartISO` — on miss return `{ ok:false, code:'SLOT_TAKEN', alternates }`.
5. `getContact(contactId)` for the parent's name / email / phone.
6. `createAppointment` → `createAppointmentNote`.
7. `handleBooking({ flow: 'trial', contactId, appointmentId, parent, trainee:
   { firstName, age, isSelf: false }, program, programName, slotStartISO,
   slotEndISO })`. `handleBooking` derives the `trainee_key`, creates the
   Trial Conversion opp at `INTRO BOOKED`, updates household CFs, and moves
   the Lead Acquisition opp. Appointment-created-but-opp-failed is logged and
   non-fatal (parity with `/api/book`).

**Response:**

```ts
{ ok: true, trainee: { traineeName, traineeKey, program,
                       status: 'pending', pendingClassISO } }
| { ok: false, code: 'INVALID_INPUT' | 'INVALID_TOKEN' | 'NOT_FOUND'
              | 'SLOT_TAKEN' | 'RATE_LIMITED' | 'GHL_FAILED', alternates? }
```

`isSelf` is always `false` — an added person is always a named student.

## UI design (`src/pages/rebook.astro`)

### Entry point

A dashed-border **"+ Add a new person"** tile, rendered as the final item in
the `[data-trainee-list]` grid (same cell size as a card). Clicking it expands
an inline panel in place, using the existing card expand/collapse mechanics
(full-width active row, `order-first`).

### The add-person panel

A new `renderAddPersonForm` function, styled like the existing
`renderChangeProgramPicker`:

1. **Details step** — two fields:
   - *Student first name* (text input).
   - *Student age* — the dropdown from `TraineeForm` (Ages 3–4 → `tiny`,
     5–6 → `lc1`, 7–9 → `lc2`, 10–15 → `juniors`, 16+ → `adults`). Age
     selection resolves the `program`.
   - A "Continue" button advances to the date step. Inline validation marks
     missing fields, matching `TraineeForm` patterns.
2. **Date → Slot → Confirm** — reuses the shared `#booking-flow` DOM
   (DatePicker + SlotPicker + confirm), exactly as an existing card's booking
   flow does. Confirm summary: *"Booking Little Champions 2 for Mia on
   Sat, May 24 at 9:00 AM."*
3. **Submit** — POST `/api/rebook-add-person` with the `contactToken`. On
   success: collapse the panel, **prepend a new `pending` card** for the
   person to `state.trainees`, re-render, and show the green success line on
   that card. On `SLOT_TAKEN`: surface alternates. On other errors: friendly
   message with the studio phone number `(562) 640-1400`, mirroring the
   existing confirm-step error UI.

The parent's contact details are never shown or requested — resolved
server-side from `contactId`.

### Card rendering for new states

`buildCard()` gains branches for `pending` and `enrolled`:

- **`pending`** — "Trial class booked" badge in place of the credit counter;
  shows the formatted `pendingClassISO` date; no action button; no
  "Change class" link.
- **`enrolled`** — "Enrolled" badge; informational; no buttons.

### Tailwind safelist

The dashed-tile classes and the pending/enrolled badge classes are added to
the existing hidden safelist marker `<span hidden>` so Tailwind compiles them
(the dashboard builds cards via JS string templates, which Tailwind's source
scan does not see).

## Edge cases

- **Duplicate person** — if the added person's derived `trainee_key` already
  has an open Trial Conversion opp, `handleBooking`'s trial path detects it by
  `trainee_key` and moves the existing opp's stage instead of creating a
  duplicate. The booking still succeeds; on next lookup the trainee shows as a
  single card.
- **Pending vs. credit collision** — if a just-added person somehow already
  had an open Credit opp, the merge priority makes the Credit (`active`/
  `exhausted`) card win on reload; no double cards.
- **Token expiry** — the 15-minute `contactToken` expiring yields
  `INVALID_TOKEN`; the panel shows an error asking the customer to reload the
  page.
- **`SLOT_TAKEN`** — handled with `alternates`, same recovery UX as `/api/book`.

## Error handling

Every endpoint failure maps to a typed `code`. The panel surfaces a friendly
message with the studio phone number, mirroring the existing confirm-step
error UI. Appointment-created-but-opp-orchestration-failed remains non-fatal
(logged), consistent with `/api/book`.

## Testing

**Unit:**
- The merge resolver (`rebook-cards.ts`) — four-state priority resolution,
  `trainee_key` grouping, `LOST / COLD` exclusion, dedup.
- `/api/rebook-add-person` — auth rejection (bad token, non-empty
  `traineeKey`), honeypot, min-dwell, slot re-validation / `SLOT_TAKEN`,
  happy path.

**Manual:**
- Add-person happy path end to end.
- Refresh after adding — the `pending` card persists.
- An `enrolled` household member renders as an informational card.

## Files touched

- `src/pages/api/rebook-add-person.ts` — **new** endpoint.
- `src/lib/rebook-cards.ts` — **new** shared merge resolver.
- `src/pages/api/rebook-lookup.ts` — fetch `TRIAL_CONV`, use resolver, return
  `contactToken`; `TraineeCard` interface changes.
- `src/pages/api/rebook-context.ts` — same merge + `contactToken` changes.
- `src/pages/rebook.astro` — add-person tile, panel, `pending`/`enrolled`
  card rendering, safelist additions.
- `src/lib/booking-types.ts` — request/response types for the new endpoint
  (if booking types are centralized there).
- Test files for the resolver and the new endpoint.
