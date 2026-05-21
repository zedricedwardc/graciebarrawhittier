# Rebook — persistent "next appointment" display

**Date:** 2026-05-22
**Status:** Approved design

## Problem

The `/rebook` dashboard shows one card per trainee. Today the appointment date
is only visible on **pending** cards (as a plain muted `Trial class: May 28, 2026`
line) and transiently in the post-booking success banner — which disappears on
reload. Customers and the studio admin want every card to **permanently** show
when that trainee's next class is, including the time of day.

## Goal

Every trainee card permanently displays its next booked appointment (date **and**
time). Cards whose most recent appointment is already in the past show a muted
"no upcoming class" note instead.

## Scope decisions

- **Which cards:** all statuses — pending, active, exhausted, and enrolled — that
  have a future appointment show the appointment line.
- **Past appointment:** when the most recent appointment is in the past (attended,
  nothing upcoming booked), the card shows a muted `No upcoming class booked` note
  instead of the old `Last attended:` line.
- **Emphasis:** a navy semibold text line under the program name (no tinted box).

## Data source

Every opportunity already carries `last_appointment_start_iso` — a full ISO
datetime, written by the website on every booking/rebook. No new GHL fields and
no booking-endpoint write-path changes are needed.

Today `resolveTraineeCards` surfaces that value as `pendingClassISO`, but only
for `pending` cards. The other statuses drop it.

## Approach

Generalize the existing field rather than adding a parallel one.

- Rename `ResolvedTrainee.pendingClassISO` → `nextClassISO`.
- Populate `nextClassISO` for **all four** statuses from the chosen opp's
  `lastAppointmentStartISO` (enrolled ← won trial-conv opp; active/exhausted ←
  open credit opp; pending ← open trial-conv opp).
- Future-vs-past is decided **client-side** (`new Date(iso) > new Date()`). The
  page already owns timezone helpers; keeping the comparison out of the API
  leaves `resolveTraineeCards` pure and presentation-free.

Rejected alternatives:

- *Separate new field alongside `pendingClassISO`* — duplicates the same ISO
  value under two names.
- *Backend computes future/past and sends a formatted label* — couples the API
  to presentation and weakens the pure, unit-tested resolver boundary.

## Changes

### Backend

| File | Change |
|------|--------|
| `src/lib/rebook-cards.ts` | `ResolvedTrainee.pendingClassISO` → `nextClassISO`; set it from the chosen opp's `lastAppointmentStartISO` for every status. |
| `src/pages/api/rebook-lookup.ts` | Rename `pendingClassISO` in `TraineeCard` interface + response mapper. |
| `src/pages/api/rebook-context.ts` | Rename `pendingClassISO` in the response mapper. |
| `src/pages/api/rebook-add-person.ts` | Rename `pendingClassISO` → `nextClassISO` in the returned trainee object and its JSDoc. |
| `src/lib/rebook-cards.test.ts` | Update the existing `pendingClassISO` assertion; add cases asserting `nextClassISO` is populated for active and enrolled cards. |

`extractOppFacts` already reads `last_appointment_start_iso` into
`OppFacts.lastAppointmentStartISO` — no change there.

### Frontend (`src/pages/rebook.astro`)

- `Trainee` interface: `pendingClassISO` → `nextClassISO`.
- Add `formatDateTime(iso)` → `"Thu, May 28 · 4:00 PM"` in `America/Los_Angeles`,
  matching the existing slot-label format.
- In `buildCard`, replace the current `Trial class:` / `Last attended:` header
  line with a status-aware appointment line:
  - **Future** `nextClassISO` → navy semibold line:
    - `Trial class: Thu, May 28 · 4:00 PM` for `pending`
    - `Next class: Thu, May 28 · 4:00 PM` for `active` / `exhausted` / `enrolled`
  - **No future appointment** → muted `No upcoming class booked`.
- After a successful booking / rebook / add-person, set the in-memory
  `t.nextClassISO` to the booked slot's `startISO` so the persistent line updates
  on the next `renderCards()`. The transient `data-card-success` banner
  ("✓ Booked … we'll send a reminder before class") stays as-is — it confirms
  the action just taken; the persistent line states the standing fact.

## Testing

- `rebook-cards.test.ts`: `nextClassISO` populated for active, exhausted,
  enrolled, and pending cards; `null` when the opp has no
  `last_appointment_start_iso`.
- Manual: load `/rebook` for a contact with a mix of statuses — verify each card
  shows either a future `Next class` / `Trial class` line or the muted
  `No upcoming class booked` note; verify a fresh booking flips the line.

## Out of scope

- No new GHL custom fields.
- No changes to the `last_appointment_start_iso` write path in booking endpoints.
- No change to the transient post-booking success banner.
