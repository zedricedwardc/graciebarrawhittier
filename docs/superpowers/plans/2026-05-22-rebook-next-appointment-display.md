# Rebook Next-Appointment Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each `/rebook` trainee card's next booked appointment (date + time) permanently, with a muted fallback when there is no upcoming class.

**Architecture:** Rename the resolver field `pendingClassISO` → `nextClassISO` and populate it for every card status from the opportunity's existing `last_appointment_start_iso`. The two lookup endpoints and the add-person endpoint carry the renamed field. The `/rebook` page decides future-vs-past client-side and renders a navy semibold appointment line or a muted "no upcoming class" note.

**Tech Stack:** Astro 6, TypeScript, Vitest, Tailwind CSS v4.

---

### Task 1: Generalize `nextClassISO` in the card resolver

**Files:**
- Modify: `src/lib/rebook-cards.ts`
- Test: `src/lib/rebook-cards.test.ts`

- [ ] **Step 1: Update the test file**

Replace the entire contents of `src/lib/rebook-cards.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveTraineeCards, CONTACT_SCOPED_TRAINEE_KEY, type OppFacts } from './rebook-cards';

function fact(over: Partial<OppFacts>): OppFacts {
  return {
    pipeline: 'CREDIT_MON',
    status: 'open',
    traineeKey: 'tk-1',
    traineeName: 'Mia',
    program: 'lc2',
    creditsRemaining: 0,
    lastAttendanceISO: null,
    lastAppointmentStartISO: null,
    ...over,
  };
}

describe('resolveTraineeCards', () => {
  it('renders an active card for an open credit opp with credits', () => {
    const [card] = resolveTraineeCards([fact({ creditsRemaining: 3 })]);
    expect(card!.status).toBe('active');
    expect(card!.creditsRemaining).toBe(3);
  });

  it('renders an exhausted card for an open credit opp with zero credits', () => {
    const [card] = resolveTraineeCards([fact({ creditsRemaining: 0 })]);
    expect(card!.status).toBe('exhausted');
  });

  it('renders a pending card for an open trial-conv opp with no credit opp', () => {
    const [card] = resolveTraineeCards([
      fact({ pipeline: 'TRIAL_CONV', status: 'open', lastAppointmentStartISO: '2026-05-24T16:00:00-07:00' }),
    ]);
    expect(card!.status).toBe('pending');
    expect(card!.nextClassISO).toBe('2026-05-24T16:00:00-07:00');
  });

  it('renders an enrolled card for a won trial-conv opp', () => {
    const [card] = resolveTraineeCards([fact({ pipeline: 'TRIAL_CONV', status: 'won' })]);
    expect(card!.status).toBe('enrolled');
  });

  it('populates nextClassISO for an active card from the credit opp', () => {
    const [card] = resolveTraineeCards([
      fact({ creditsRemaining: 2, lastAppointmentStartISO: '2026-06-01T18:00:00-07:00' }),
    ]);
    expect(card!.status).toBe('active');
    expect(card!.nextClassISO).toBe('2026-06-01T18:00:00-07:00');
  });

  it('populates nextClassISO for an enrolled card from the won trial-conv opp', () => {
    const [card] = resolveTraineeCards([
      fact({ pipeline: 'TRIAL_CONV', status: 'won', lastAppointmentStartISO: '2026-06-05T17:00:00-07:00' }),
    ]);
    expect(card!.status).toBe('enrolled');
    expect(card!.nextClassISO).toBe('2026-06-05T17:00:00-07:00');
  });

  it('leaves nextClassISO null when the opp has no last appointment', () => {
    const [card] = resolveTraineeCards([fact({ creditsRemaining: 1 })]);
    expect(card!.nextClassISO).toBeNull();
  });

  it('credit opp beats a pending trial-conv opp for the same trainee_key', () => {
    const cards = resolveTraineeCards([
      fact({ pipeline: 'CREDIT_MON', status: 'open', creditsRemaining: 2 }),
      fact({ pipeline: 'TRIAL_CONV', status: 'open' }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.status).toBe('active');
  });

  it('a won trial-conv opp beats an open credit opp for the same trainee_key', () => {
    const cards = resolveTraineeCards([
      fact({ pipeline: 'CREDIT_MON', status: 'open', creditsRemaining: 2 }),
      fact({ pipeline: 'TRIAL_CONV', status: 'won' }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.status).toBe('enrolled');
  });

  it('produces no card for a trainee with only lost/abandoned opps', () => {
    const cards = resolveTraineeCards([
      fact({ pipeline: 'TRIAL_CONV', status: 'lost' }),
      fact({ pipeline: 'TRIAL_CONV', status: 'abandoned' }),
    ]);
    expect(cards).toHaveLength(0);
  });

  it('produces one card per distinct trainee_key', () => {
    const cards = resolveTraineeCards([
      fact({ traineeKey: 'tk-1', creditsRemaining: 3 }),
      fact({ traineeKey: 'tk-2', pipeline: 'TRIAL_CONV', status: 'open' }),
    ]);
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.status))).toEqual(new Set(['active', 'pending']));
  });

  it('exports the sentinel value for contact-scoped tokens', () => {
    expect(CONTACT_SCOPED_TRAINEE_KEY).toBe('__contact__');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/rebook-cards.test.ts`
Expected: FAIL — TypeScript/assertion errors on `card.nextClassISO` ("Property 'nextClassISO' does not exist on type 'ResolvedTrainee'").

- [ ] **Step 3: Rename the field in the `ResolvedTrainee` interface**

In `src/lib/rebook-cards.ts`, in the `ResolvedTrainee` interface, replace:

```typescript
  pendingClassISO: string | null;
```

with:

```typescript
  /** Next/most-recent appointment ISO datetime, or null if the opp has none. */
  nextClassISO: string | null;
```

- [ ] **Step 4: Populate `nextClassISO` for every status in `resolveTraineeCards`**

In `src/lib/rebook-cards.ts`, in the `resolveTraineeCards` function, change the three `cards.push({ ... })` calls so each sets `nextClassISO` from its source opp instead of `pendingClassISO`.

Replace the `enrolled` branch's pushed object:

```typescript
      cards.push({
        traineeName: enrolled.traineeName,
        traineeKey,
        program: enrolled.program,
        status: 'enrolled',
        creditsRemaining: 0,
        lastAttendanceISO: enrolled.lastAttendanceISO,
        nextClassISO: enrolled.lastAppointmentStartISO,
      });
```

Replace the `credit` branch's pushed object:

```typescript
      cards.push({
        traineeName: credit.traineeName,
        traineeKey,
        program: credit.program,
        status: credit.creditsRemaining > 0 ? 'active' : 'exhausted',
        creditsRemaining: credit.creditsRemaining,
        lastAttendanceISO: credit.lastAttendanceISO,
        nextClassISO: credit.lastAppointmentStartISO,
      });
```

Replace the `pendingTrial` branch's pushed object:

```typescript
      cards.push({
        traineeName: pendingTrial.traineeName,
        traineeKey,
        program: pendingTrial.program,
        status: 'pending',
        creditsRemaining: 0,
        lastAttendanceISO: pendingTrial.lastAttendanceISO,
        nextClassISO: pendingTrial.lastAppointmentStartISO,
      });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/rebook-cards.test.ts`
Expected: PASS — all 12 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rebook-cards.ts src/lib/rebook-cards.test.ts
git commit -m "feat(rebook): expose nextClassISO on all trainee card statuses"
```

---

### Task 2: Carry the renamed field through the API endpoints

**Files:**
- Modify: `src/pages/api/rebook-lookup.ts`
- Modify: `src/pages/api/rebook-context.ts`
- Modify: `src/pages/api/rebook-add-person.ts`

- [ ] **Step 1: Update the `TraineeCard` interface in `rebook-lookup.ts`**

In `src/pages/api/rebook-lookup.ts`, in the `TraineeCard` interface, replace:

```typescript
  /** Booked class start ISO — set only for `pending` cards. */
  pendingClassISO: string | null;
```

with:

```typescript
  /** Next/most-recent appointment start ISO for this trainee, or null. */
  nextClassISO: string | null;
```

- [ ] **Step 2: Update the response mapper in `rebook-lookup.ts`**

In `src/pages/api/rebook-lookup.ts`, in the `trainees` mapper, replace the line:

```typescript
    pendingClassISO: r.pendingClassISO,
```

with:

```typescript
    nextClassISO: r.nextClassISO,
```

Also update the JSDoc block at the top of the file: in the `Returns:` example object, change `pendingClassISO` to `nextClassISO`.

- [ ] **Step 3: Update the response mapper in `rebook-context.ts`**

In `src/pages/api/rebook-context.ts`, in the `trainees` mapper, replace the line:

```typescript
    pendingClassISO: r.pendingClassISO,
```

with:

```typescript
    nextClassISO: r.nextClassISO,
```

- [ ] **Step 4: Update `rebook-add-person.ts`**

In `src/pages/api/rebook-add-person.ts`, replace the line (around line 191):

```typescript
      pendingClassISO: body.slotStartISO,
```

with:

```typescript
      nextClassISO: body.slotStartISO,
```

And replace the fallback return line (around line 197):

```typescript
  return { traineeName: '', traineeKey: 'spam-discarded', program, status: 'pending' as const, pendingClassISO: null };
```

with:

```typescript
  return { traineeName: '', traineeKey: 'spam-discarded', program, status: 'pending' as const, nextClassISO: null };
```

Also update the JSDoc comment at the top of the file: change `status: 'pending', pendingClassISO` to `status: 'pending', nextClassISO`.

- [ ] **Step 5: Run the type checker**

Run: `npm run check`
Expected: PASS — no errors. (A pre-existing unrelated warning, if any, is acceptable; there must be no errors mentioning `pendingClassISO` or `nextClassISO`.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/rebook-lookup.ts src/pages/api/rebook-context.ts src/pages/api/rebook-add-person.ts
git commit -m "feat(rebook): rename pendingClassISO to nextClassISO in endpoints"
```

---

### Task 3: Add the `formatDateTime` helper and rename the `Trainee` field

**Files:**
- Modify: `src/pages/rebook.astro`

- [ ] **Step 1: Rename the field in the `Trainee` interface**

In `src/pages/rebook.astro`, in the `interface Trainee` block, replace:

```typescript
    pendingClassISO: string | null;
```

with:

```typescript
    nextClassISO: string | null;
```

- [ ] **Step 2: Add the `formatDateTime` helper**

In `src/pages/rebook.astro`, immediately after the existing `formatDate` function (which ends with `}` after the `Intl.DateTimeFormat(...).format(d)` return), add:

```typescript
    /** "Thu, May 28 · 4:00 PM" in America/Los_Angeles. */
    function formatDateTime(iso: string): string {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      const tz = 'America/Los_Angeles';
      const datePart = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short', month: 'short', day: 'numeric',
      }).format(d);
      const timePart = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', minute: '2-digit',
      }).format(d);
      return `${datePart} · ${timePart}`;
    }
    function isFuture(iso: string): boolean {
      const d = new Date(iso);
      return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
    }
```

- [ ] **Step 3: Run the type checker**

Run: `npm run check`
Expected: PASS — no errors mentioning `pendingClassISO`, `nextClassISO`, `formatDateTime`, or `isFuture`. The `formatDateTime`/`isFuture` helpers being unused at this point is acceptable (they are used in Task 4).

- [ ] **Step 4: Commit**

```bash
git add src/pages/rebook.astro
git commit -m "feat(rebook): add formatDateTime helper, rename Trainee.nextClassISO"
```

---

### Task 4: Render the persistent appointment line on every card

**Files:**
- Modify: `src/pages/rebook.astro`

- [ ] **Step 1: Add the `appointmentLine` helper**

In `src/pages/rebook.astro`, immediately after the `isFuture` function added in Task 3, add:

```typescript
    /**
     * The persistent under-the-program-name line for a card:
     *   - future appointment → navy semibold "Next class" / "Trial class" line
     *   - no future appointment → muted "No upcoming class booked" note
     */
    function appointmentLine(t: Trainee): string {
      if (t.nextClassISO && isFuture(t.nextClassISO)) {
        const label = t.status === 'pending' ? 'Trial class' : 'Next class';
        return `<p class="mt-1 text-sm font-semibold text-gb-navy">${label}: ${escapeHtml(formatDateTime(t.nextClassISO))}</p>`;
      }
      return `<p class="mt-1 text-xs text-gb-text-muted">No upcoming class booked</p>`;
    }
```

- [ ] **Step 2: Replace the header date block in `buildCard`**

In `src/pages/rebook.astro`, in `buildCard`, find the `header.innerHTML` template. Replace this block:

```typescript
          ${
            t.status === 'pending' && t.pendingClassISO
              ? `<p class="mt-1 text-xs text-gb-text-muted">Trial class: ${formatDate(t.pendingClassISO)}</p>`
              : t.lastAttendanceISO
                ? `<p class="mt-1 text-xs text-gb-text-muted">Last attended: ${formatDate(t.lastAttendanceISO)}</p>`
                : ''
          }
```

with:

```typescript
          ${appointmentLine(t)}
```

- [ ] **Step 3: Verify `formatDate` is still referenced**

Run: `grep -n "formatDate(" src/pages/rebook.astro`
Expected: If `formatDate` now has zero call sites, delete the `formatDate` function definition to avoid a lint/unused warning. If it still has call sites, leave it. (At time of writing the only caller was the block removed in Step 2 — expect to delete it.)

- [ ] **Step 4: Run the type checker**

Run: `npm run check`
Expected: PASS — no errors.

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev`
Then open `http://localhost:4321/rebook`, look up a contact email that has trainees across multiple statuses. Verify:
- Cards with a future booked class show a navy bold `Next class: <Wed, Jun 1, 6:00 PM>` line (or `Trial class:` for pending cards).
- Cards whose last appointment is in the past show the muted `No upcoming class booked` note.
Stop the dev server when done (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add src/pages/rebook.astro
git commit -m "feat(rebook): show persistent next-appointment line on every card"
```

---

### Task 5: Update `nextClassISO` after a successful booking so the line refreshes

**Files:**
- Modify: `src/pages/rebook.astro`

- [ ] **Step 1: Update `nextClassISO` in `submitBooking`**

In `src/pages/rebook.astro`, in the `submitBooking` function, find the success block after the booking succeeds:

```typescript
        // Update in-memory trainee credits + show success on the card.
        t.creditsRemaining = Math.max(0, t.creditsRemaining - 1);
        collapseActive();
        renderCards();
        showCardSuccess(t, slotForSuccess);
```

Replace it with:

```typescript
        // Update in-memory trainee credits + next-class + show success.
        t.creditsRemaining = Math.max(0, t.creditsRemaining - 1);
        t.nextClassISO = slotForSuccess.startISO;
        collapseActive();
        renderCards();
        showCardSuccess(t, slotForSuccess);
```

- [ ] **Step 2: Confirm the add-person path already carries `nextClassISO`**

In `src/pages/rebook.astro`, in `submitAddPerson`, the `newTrainee` object is built from the endpoint response. Find:

```typescript
        const newTrainee: Trainee = {
          traineeName: data.trainee.traineeName,
          traineeKey: data.trainee.traineeKey,
          program: data.trainee.program,
          status: 'pending',
          creditsRemaining: 0,
          lastAttendanceISO: null,
          pendingClassISO: data.trainee.pendingClassISO,
        };
```

Replace it with:

```typescript
        const newTrainee: Trainee = {
          traineeName: data.trainee.traineeName,
          traineeKey: data.trainee.traineeKey,
          program: data.trainee.program,
          status: 'pending',
          creditsRemaining: 0,
          lastAttendanceISO: null,
          nextClassISO: data.trainee.nextClassISO,
        };
```

- [ ] **Step 3: Run the type checker**

Run: `npm run check`
Expected: PASS — no errors. A repo-wide search confirms no `pendingClassISO` remains:

Run: `grep -rn "pendingClassISO" src/`
Expected: no matches.

- [ ] **Step 4: Run the unit tests**

Run: `npm test`
Expected: PASS — full suite green, including the 12 `rebook-cards` tests.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`
Open `/rebook`, look up a contact with an `active` trainee, book a class for them, and confirm the card's `Next class:` line now shows the slot you just booked. Then use "Add a new person", book a trial, and confirm the new card shows `Trial class: <slot>`. Stop the dev server (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add src/pages/rebook.astro
git commit -m "feat(rebook): refresh next-class line after booking and add-person"
```

---

## Notes for the implementer

- The `.claude/worktrees/` directory contains stale copies of these files. **Do not edit anything under `.claude/worktrees/`** — only the top-level `src/` paths listed above.
- `npx vitest run <file>` runs one test file; `npm test` runs the whole suite.
- The dev server runs on `http://localhost:4321` by default (Astro).
- `escapeHtml`, `formatDate`, `todayInTZ`, and the `Trainee` interface already exist in `src/pages/rebook.astro` — reuse them, do not redefine.
