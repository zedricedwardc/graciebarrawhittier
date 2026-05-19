# Rebook "Add a New Person" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an active-trial customer on `/rebook` register and book a brand-new family member's first trial class, and surface pending-trial and enrolled household members as dashboard cards.

**Architecture:** A pure card-resolver (`src/lib/rebook-cards.ts`) merges Trial Credit Monitoring + Trial Conversion opportunities by `trainee_key` into a four-state card model. `/api/rebook-lookup` and `/api/rebook-context` adopt the resolver and return a contact-scoped token. A new `/api/rebook-add-person` endpoint books the new person through the existing `handleBooking` trial path. `rebook.astro` gains an "Add a new person" tile + inline panel and renders the two new card states.

**Tech Stack:** Astro 6, TypeScript, Zod 4, Vitest, GoHighLevel API (via `src/lib/ghl*`).

---

## Background for the implementing engineer

- **Pipelines.** GHL "opportunities" live in named pipelines. `CREDIT_MON` (Trial Credit Monitoring) tracks an active trial pass with `credits_remaining`. `TRIAL_CONV` (Trial Conversion) tracks each booked trial from booking → attendance → enrollment. Pipeline/stage names resolve to IDs via `config/ghl-schema.ts` + `src/lib/ghl-pipelines.ts` — never hardcode IDs.
- **`trainee_key`.** A per-person identifier (derived in `src/lib/trainee-key.ts`). One person can have opps in multiple pipelines, all sharing one `trainee_key`.
- **Opportunity custom fields** are read with `getOppCfValueByKey(opp, 'key')` from `src/lib/ghl-opportunities.ts` (async — resolves field key→id via schema).
- **Opportunity `status`** is a top-level field on the opp record: `'open' | 'won' | 'lost' | 'abandoned'`.
- **Tests** live next to source as `*.test.ts` and run with `npm test` (`vitest run`). The codebase unit-tests pure library functions; it has **no API-route tests** — endpoint coverage in this plan is manual, consistent with that convention.
- **Token note:** `signRebookToken` (`src/lib/rebook-token.ts`) *throws* if `traineeKey` is empty. The contact-scoped token therefore uses a reserved sentinel `traineeKey` value, exported as `CONTACT_SCOPED_TRAINEE_KEY`.

---

## File structure

- **Create** `src/lib/rebook-cards.ts` — `OppFacts` type, async `extractOppFacts`, pure `resolveTraineeCards`, `CONTACT_SCOPED_TRAINEE_KEY` constant.
- **Create** `src/lib/rebook-cards.test.ts` — unit tests for `resolveTraineeCards`.
- **Create** `src/pages/api/rebook-add-person.ts` — new booking endpoint.
- **Modify** `src/pages/api/rebook-lookup.ts` — `TraineeCard` interface, TRIAL_CONV fetch, resolver, `contactToken`.
- **Modify** `src/pages/api/rebook-context.ts` — same merge + `contactToken`.
- **Modify** `src/pages/rebook.astro` — add-person tile, panel, `pending`/`enrolled` card rendering, Tailwind safelist.

---

## Task 1: Card-resolver library

Pure merge logic that turns raw opportunities into a four-state card list. No GHL calls in the pure function — fully unit-testable.

**Files:**
- Create: `src/lib/rebook-cards.ts`
- Test: `src/lib/rebook-cards.test.ts`

- [ ] **Step 1: Write the resolver module skeleton with types**

Create `src/lib/rebook-cards.ts`:

```ts
/**
 * Rebook dashboard card resolver.
 *
 * Merges a contact's Trial Credit Monitoring + Trial Conversion opportunities
 * into one card per trainee_key, picking a single status by priority:
 *
 *   enrolled  (won Trial Conversion opp)
 *     > active / exhausted  (open Credit Monitoring opp)
 *       > pending  (open Trial Conversion opp, no Credit opp)
 *
 * `resolveTraineeCards` is pure (no GHL calls) so it is unit-testable.
 * `extractOppFacts` does the async custom-field reads at the endpoint.
 */
import type { OpportunityRecord } from './ghl';
import { getOppCfValueByKey } from './ghl-opportunities';

/**
 * Reserved `traineeKey` for the contact-scoped rebook token. `signRebookToken`
 * rejects an empty traineeKey, so the add-person token uses this sentinel and
 * `/api/rebook-add-person` verifies the token carries exactly this value.
 */
export const CONTACT_SCOPED_TRAINEE_KEY = '__contact__';

export type TraineeStatus = 'enrolled' | 'active' | 'exhausted' | 'pending';

/** Normalized, pipeline-tagged view of one opportunity. */
export interface OppFacts {
  pipeline: 'CREDIT_MON' | 'TRIAL_CONV';
  status: 'open' | 'won' | 'lost' | 'abandoned';
  traineeKey: string;
  traineeName: string;
  program: string;
  creditsRemaining: number;
  lastAttendanceISO: string | null;
  lastAppointmentStartISO: string | null;
}

/** One resolved dashboard card, before the endpoint attaches any token. */
export interface ResolvedTrainee {
  traineeName: string;
  traineeKey: string;
  program: string;
  status: TraineeStatus;
  creditsRemaining: number;
  lastAttendanceISO: string | null;
  pendingClassISO: string | null;
}

/** Read one opportunity into normalized OppFacts (async — reads custom fields). */
export async function extractOppFacts(
  opp: OpportunityRecord,
  pipeline: 'CREDIT_MON' | 'TRIAL_CONV',
): Promise<OppFacts | null> {
  const traineeKey = (await getOppCfValueByKey<string>(opp, 'trainee_key')) ?? '';
  const traineeName = (await getOppCfValueByKey<string>(opp, 'trainee_first_name')) ?? '';
  if (!traineeKey || !traineeName) return null;
  const program = (await getOppCfValueByKey<string>(opp, 'program')) ?? 'adults';
  const creditsRaw = await getOppCfValueByKey<string | number>(opp, 'credits_remaining');
  const creditsRemaining = Number(creditsRaw ?? 0);
  const lastAttendanceISO = (await getOppCfValueByKey<string>(opp, 'last_attendance_iso')) ?? null;
  const lastAppointmentStartISO =
    (await getOppCfValueByKey<string>(opp, 'last_appointment_start_iso')) ?? null;
  const status = (opp.status as OppFacts['status']) ?? 'open';
  return {
    pipeline,
    status,
    traineeKey,
    traineeName: traineeName.trim(),
    program,
    creditsRemaining: Number.isFinite(creditsRemaining) ? creditsRemaining : 0,
    lastAttendanceISO,
    lastAppointmentStartISO,
  };
}

/**
 * Merge OppFacts into one ResolvedTrainee per trainee_key. Pure.
 *
 *   - enrolled : a won TRIAL_CONV opp exists
 *   - active   : an open CREDIT_MON opp exists, credits > 0
 *   - exhausted: an open CREDIT_MON opp exists, credits <= 0
 *   - pending  : an open TRIAL_CONV opp exists, and no CREDIT_MON opp
 *
 * trainee_keys with only lost/abandoned opps produce no card.
 */
export function resolveTraineeCards(facts: OppFacts[]): ResolvedTrainee[] {
  const byKey = new Map<string, OppFacts[]>();
  for (const f of facts) {
    const list = byKey.get(f.traineeKey) ?? [];
    list.push(f);
    byKey.set(f.traineeKey, list);
  }

  const cards: ResolvedTrainee[] = [];
  for (const [traineeKey, list] of byKey) {
    const enrolled = list.find((f) => f.pipeline === 'TRIAL_CONV' && f.status === 'won');
    const credit = list.find((f) => f.pipeline === 'CREDIT_MON' && f.status === 'open');
    const pendingTrial = list.find((f) => f.pipeline === 'TRIAL_CONV' && f.status === 'open');

    if (enrolled) {
      cards.push({
        traineeName: enrolled.traineeName,
        traineeKey,
        program: enrolled.program,
        status: 'enrolled',
        creditsRemaining: 0,
        lastAttendanceISO: enrolled.lastAttendanceISO,
        pendingClassISO: null,
      });
    } else if (credit) {
      cards.push({
        traineeName: credit.traineeName,
        traineeKey,
        program: credit.program,
        status: credit.creditsRemaining > 0 ? 'active' : 'exhausted',
        creditsRemaining: credit.creditsRemaining,
        lastAttendanceISO: credit.lastAttendanceISO,
        pendingClassISO: null,
      });
    } else if (pendingTrial) {
      cards.push({
        traineeName: pendingTrial.traineeName,
        traineeKey,
        program: pendingTrial.program,
        status: 'pending',
        creditsRemaining: 0,
        lastAttendanceISO: pendingTrial.lastAttendanceISO,
        pendingClassISO: pendingTrial.lastAppointmentStartISO,
      });
    }
  }
  return cards;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/rebook-cards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveTraineeCards, type OppFacts } from './rebook-cards';

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
    expect(card.status).toBe('active');
    expect(card.creditsRemaining).toBe(3);
  });

  it('renders an exhausted card for an open credit opp with zero credits', () => {
    const [card] = resolveTraineeCards([fact({ creditsRemaining: 0 })]);
    expect(card.status).toBe('exhausted');
  });

  it('renders a pending card for an open trial-conv opp with no credit opp', () => {
    const [card] = resolveTraineeCards([
      fact({ pipeline: 'TRIAL_CONV', status: 'open', lastAppointmentStartISO: '2026-05-24T16:00:00-07:00' }),
    ]);
    expect(card.status).toBe('pending');
    expect(card.pendingClassISO).toBe('2026-05-24T16:00:00-07:00');
  });

  it('renders an enrolled card for a won trial-conv opp', () => {
    const [card] = resolveTraineeCards([fact({ pipeline: 'TRIAL_CONV', status: 'won' })]);
    expect(card.status).toBe('enrolled');
  });

  it('credit opp beats a pending trial-conv opp for the same trainee_key', () => {
    const cards = resolveTraineeCards([
      fact({ pipeline: 'CREDIT_MON', status: 'open', creditsRemaining: 2 }),
      fact({ pipeline: 'TRIAL_CONV', status: 'open' }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBe('active');
  });

  it('a won trial-conv opp beats an open credit opp for the same trainee_key', () => {
    const cards = resolveTraineeCards([
      fact({ pipeline: 'CREDIT_MON', status: 'open', creditsRemaining: 2 }),
      fact({ pipeline: 'TRIAL_CONV', status: 'won' }),
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].status).toBe('enrolled');
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
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test -- src/lib/rebook-cards.test.ts`
Expected: PASS (8 tests). The implementation in Step 1 already satisfies them.

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no new errors in `src/lib/rebook-cards.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rebook-cards.ts src/lib/rebook-cards.test.ts
git commit -m "feat(rebook): card resolver for trial-conv + credit opps"
```

---

## Task 2: Adopt the resolver in `/api/rebook-lookup`

Extend the email-lookup endpoint to fetch Trial Conversion opps, merge via the resolver, and return a contact-scoped token.

**Files:**
- Modify: `src/pages/api/rebook-lookup.ts`

- [ ] **Step 1: Update the `TraineeCard` interface**

In `src/pages/api/rebook-lookup.ts`, replace the existing `TraineeCard` interface (currently lines ~50-58) with:

```ts
export interface TraineeCard {
  traineeName: string;
  traineeKey: string;
  program: string;
  status: 'enrolled' | 'active' | 'exhausted' | 'pending';
  creditsRemaining: number;
  lastAttendanceISO: string | null;
  /** Booked class start ISO — set only for `pending` cards. */
  pendingClassISO: string | null;
  /**
   * 15-min token authorizing /api/book against this trainee. Present only on
   * `active` / `exhausted` cards — `enrolled` / `pending` have no booking action.
   */
  sessionToken?: string;
}
```

- [ ] **Step 2: Update imports**

In `src/pages/api/rebook-lookup.ts`, add to the existing imports:

```ts
import { getPipelineId } from '../../lib/ghl-pipelines';
import { signRebookToken } from '../../lib/rebook-token';
import { extractOppFacts, resolveTraineeCards, CONTACT_SCOPED_TRAINEE_KEY, type OppFacts } from '../../lib/rebook-cards';
```

(`getPipelineId` and `signRebookToken` are already imported — keep one copy; add only the `rebook-cards` line.)

- [ ] **Step 3: Replace the opp-fetch + trainee-build block**

In the `POST` handler, after `creditPipelineId` is resolved, replace the existing `searchOpportunities` call and the `opps.reduce(...)` trainee-build block (currently ~lines 100-141) with:

```ts
  let trialPipelineId: string;
  try {
    trialPipelineId = await getPipelineId('TRIAL_CONV');
  } catch (err) {
    console.error('[rebook-lookup] could not resolve Trial Conversion pipeline', err);
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  let creditOpps: OpportunityRecord[] = [];
  let trialOpps: OpportunityRecord[] = [];
  try {
    [creditOpps, trialOpps] = await Promise.all([
      searchOpportunities({ contactId: contact.id, pipelineId: creditPipelineId, status: 'open' }),
      searchOpportunities({ contactId: contact.id, pipelineId: trialPipelineId, status: 'all' }),
    ]);
  } catch (err) {
    console.error(
      '[rebook-lookup] searchOpportunities failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err,
    );
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  const facts: OppFacts[] = [];
  for (const o of creditOpps) {
    const f = await extractOppFacts(o, 'CREDIT_MON');
    if (f) facts.push(f);
  }
  for (const o of trialOpps) {
    const f = await extractOppFacts(o, 'TRIAL_CONV');
    if (f) facts.push(f);
  }

  const resolved = resolveTraineeCards(facts);
  const trainees: TraineeCard[] = resolved.map((r) => ({
    traineeName: r.traineeName,
    traineeKey: r.traineeKey,
    program: r.program,
    status: r.status,
    creditsRemaining: r.creditsRemaining,
    lastAttendanceISO: r.lastAttendanceISO,
    pendingClassISO: r.pendingClassISO,
    sessionToken:
      r.status === 'active' || r.status === 'exhausted'
        ? signRebookToken({ contactId: contact.id, traineeKey: r.traineeKey, ttlDays: 1 / 96 })
        : undefined,
  }));
```

- [ ] **Step 4: Add `contactToken` to the success response**

Replace the final `return json({ ok: true, contactId: contact.id, trainees });` with:

```ts
  const contactToken = signRebookToken({
    contactId: contact.id,
    traineeKey: CONTACT_SCOPED_TRAINEE_KEY,
    ttlDays: 1 / 96,
  });

  return json({
    ok: true,
    contactId: contact.id,
    contactToken,
    trainees,
  });
```

- [ ] **Step 5: Type-check**

Run: `npm run check`
Expected: no errors in `src/pages/api/rebook-lookup.ts`. (`rebook-context.ts` imports `TraineeCard` and will error until Task 3 — that is expected; proceed.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/rebook-lookup.ts
git commit -m "feat(rebook): merge trial-conv opps into rebook-lookup, add contact token"
```

---

## Task 3: Adopt the resolver in `/api/rebook-context`

Same merge + contact-token change for the magic-link entry path.

**Files:**
- Modify: `src/pages/api/rebook-context.ts`

- [ ] **Step 1: Update imports**

In `src/pages/api/rebook-context.ts`, add:

```ts
import { signRebookToken } from '../../lib/rebook-token';
import { extractOppFacts, resolveTraineeCards, CONTACT_SCOPED_TRAINEE_KEY, type OppFacts } from '../../lib/rebook-cards';
```

(`signRebookToken` may already be imported alongside `verifyRebookToken` — keep one copy.)

- [ ] **Step 2: Replace the opp-fetch + trainee-build block**

After `creditPipelineId` is resolved, replace the existing `searchOpportunities` call and the `opps.reduce(...)` block (currently ~lines 65-104) with:

```ts
  let trialPipelineId: string;
  try {
    trialPipelineId = await getPipelineId('TRIAL_CONV');
  } catch (err) {
    console.error('[rebook-context] could not resolve Trial Conversion pipeline', err);
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  let creditOpps: OpportunityRecord[] = [];
  let trialOpps: OpportunityRecord[] = [];
  try {
    [creditOpps, trialOpps] = await Promise.all([
      searchOpportunities({ contactId, pipelineId: creditPipelineId, status: 'open' }),
      searchOpportunities({ contactId, pipelineId: trialPipelineId, status: 'all' }),
    ]);
  } catch (err) {
    console.error(
      '[rebook-context] searchOpportunities failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err,
    );
    return json({ ok: false, code: 'GHL_FAILED' }, 502);
  }

  const facts: OppFacts[] = [];
  for (const o of creditOpps) {
    const f = await extractOppFacts(o, 'CREDIT_MON');
    if (f) facts.push(f);
  }
  for (const o of trialOpps) {
    const f = await extractOppFacts(o, 'TRIAL_CONV');
    if (f) facts.push(f);
  }

  const trainees: TraineeCard[] = resolveTraineeCards(facts).map((r) => ({
    traineeName: r.traineeName,
    traineeKey: r.traineeKey,
    program: r.program,
    status: r.status,
    creditsRemaining: r.creditsRemaining,
    lastAttendanceISO: r.lastAttendanceISO,
    pendingClassISO: r.pendingClassISO,
    sessionToken:
      r.status === 'active' || r.status === 'exhausted'
        ? signRebookToken({ contactId, traineeKey: r.traineeKey, ttlDays: 1 / 96 })
        : undefined,
  }));
```

- [ ] **Step 3: Update the success response**

Replace the final `return json({ ok: true, contactId, tokenTraineeKey, trainees });` with:

```ts
  const contactToken = signRebookToken({
    contactId,
    traineeKey: CONTACT_SCOPED_TRAINEE_KEY,
    ttlDays: 1 / 96,
  });

  return json({
    ok: true,
    contactId,
    contactToken,
    tokenTraineeKey,
    trainees,
  });
```

- [ ] **Step 4: Type-check**

Run: `npm run check`
Expected: no errors in `rebook-context.ts` or `rebook-lookup.ts`.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`
Expected: PASS — all existing tests plus the 8 new resolver tests.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/rebook-context.ts
git commit -m "feat(rebook): merge trial-conv opps into rebook-context, add contact token"
```

---

## Task 4: New endpoint `/api/rebook-add-person`

Books a brand-new trainee's first trial through the existing trial-booking handler.

**Files:**
- Create: `src/pages/api/rebook-add-person.ts`

- [ ] **Step 1: Create the endpoint file**

Create `src/pages/api/rebook-add-person.ts`:

```ts
/**
 * POST /api/rebook-add-person
 *
 * Books a brand-new family member's first trial class for an existing
 * active-trial customer, from /rebook. Reuses the parent contact (resolved
 * server-side from contactId) so no parent PII travels in the request body.
 *
 * Auth: the contact-scoped token returned by /api/rebook-lookup or
 * /api/rebook-context — a rebook token whose traineeKey is the reserved
 * CONTACT_SCOPED_TRAINEE_KEY sentinel.
 *
 * Effect: creates the appointment + runs handleBooking(flow:'trial'), which
 * creates a Trial Conversion opp at INTRO BOOKED. Does NOT create a credit
 * pass — that happens later at trial activation.
 *
 * Returns:
 *   { ok: true, trainee: { traineeName, traineeKey, program,
 *                          status: 'pending', pendingClassISO } }
 *   | { ok: false, code: 'INVALID_INPUT' | 'INVALID_TOKEN' | 'NOT_FOUND'
 *                       | 'SLOT_TAKEN' | 'RATE_LIMITED' | 'GHL_FAILED',
 *       alternates?, message? }
 */
import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { createHash } from 'node:crypto';
import {
  getContact,
  getFreeSlots,
  createAppointment,
  createAppointmentNote,
  GhlError,
  readEnv,
} from '../../lib/ghl';
import { handleBooking } from '../../lib/ghl-adapter';
import { getProgram, type ProgramKey } from '../../data/programs';
import { generateSlots } from '../../lib/slot-resolver';
import { blackouts } from '../../data/blackouts';
import { verifyRebookToken } from '../../lib/rebook-token';
import { CONTACT_SCOPED_TRAINEE_KEY } from '../../lib/rebook-cards';
import { deriveTraineeKey } from '../../lib/trainee-key';
import type { AvailabilitySlot } from '../../lib/booking-types';

export const prerender = false;

const MIN_DWELL_MS = 3000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 5;
const MIN_LEAD_MINUTES = 60;

const buckets = new Map<string, { count: number; firstSeen: number }>();

const PROGRAM_KEYS: [ProgramKey, ...ProgramKey[]] = ['tiny', 'lc1', 'lc2', 'juniors', 'adults'];

const AddPersonRequest = z.object({
  contactId: z.string().min(1).max(100),
  sessionToken: z.string().min(20).max(2000),
  program: z.enum(PROGRAM_KEYS),
  trainee: z.object({
    firstName: z.string().min(1).max(50),
    age: z.number().int().min(3).max(99),
  }),
  slotStartISO: z.string().datetime({ offset: true }),
  ts: z.number().int(),
  website: z.string().optional(),
});

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const ip = clientAddress || 'unknown';

  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ ok: false, code: 'INVALID_INPUT' }); }
  const parsed = AddPersonRequest.safeParse(payload);
  if (!parsed.success) return json({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  // Honeypot — silent OK so bots don't learn.
  if (body.website && body.website.length > 0) {
    return json({ ok: true, trainee: spamTrainee(body.program) });
  }
  // Min dwell time.
  if (Date.now() - body.ts < MIN_DWELL_MS) {
    return json({ ok: true, trainee: spamTrainee(body.program) });
  }
  // Per-IP rate limit.
  if (!checkRate(ip)) return json({ ok: false, code: 'RATE_LIMITED' }, 429);

  // Verify the contact-scoped token: must resolve to contactId with the sentinel traineeKey.
  const verified = verifyRebookToken(body.sessionToken);
  if (!verified.ok) return json({ ok: false, code: 'INVALID_TOKEN' });
  if (
    verified.payload.contactId !== body.contactId ||
    verified.payload.traineeKey !== CONTACT_SCOPED_TRAINEE_KEY
  ) {
    return json({ ok: false, code: 'INVALID_TOKEN' });
  }

  // Resolve calendar for the program.
  const calendarId = readEnv(getProgram(body.program).calendarIdEnvVar);
  if (!calendarId) {
    console.error('[rebook-add-person] missing calendar env var', getProgram(body.program).calendarIdEnvVar);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Calendar not configured.' });
  }

  // Re-validate slot availability.
  const slotMs = Date.parse(body.slotStartISO);
  let stillFree: Set<string>;
  try {
    stillFree = await getFreeSlots({ calendarId, startDate: slotMs - 60_000, endDate: slotMs + 60_000 });
  } catch (err) {
    console.error('[rebook-add-person] getFreeSlots failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not verify slot availability.' });
  }
  if (!stillFree.has(body.slotStartISO)) {
    return json({ ok: false, code: 'SLOT_TAKEN', alternates: nextAlternates(body.program, body.slotStartISO, 3) });
  }

  // Resolve the parent contact (server-side — no PII in the request body).
  let contact;
  try {
    contact = await getContact(body.contactId);
  } catch (err) {
    console.error('[rebook-add-person] getContact failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not load contact.' });
  }
  if (!contact) return json({ ok: false, code: 'NOT_FOUND', message: 'Contact not found.' });

  const parent = {
    firstName: contact.firstName ?? '',
    lastName:  contact.lastName  ?? '',
    email:     contact.email     ?? '',
    phone:     contact.phone     ?? '',
  };

  // Create the appointment.
  const endISO = computeEndISO(body.slotStartISO, body.program);
  const traineeName = body.trainee.firstName.trim();
  const title = `${getProgram(body.program).name} trial — ${traineeName} (${body.trainee.age})`;

  let appointmentId: string;
  try {
    appointmentId = await createAppointment({
      calendarId,
      contactId: body.contactId,
      startISO: body.slotStartISO,
      endISO,
      title,
    });
  } catch (err) {
    console.error('[rebook-add-person] createAppointment failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_FAILED', message: 'Could not create appointment.' });
  }

  try {
    await createAppointmentNote(appointmentId, [
      title, '',
      `When: ${formatWhen(body.slotStartISO)}`, '',
      `Parent: ${`${parent.firstName} ${parent.lastName}`.trim()}`,
      `Phone: ${parent.phone}`,
      `Email: ${parent.email}`,
      '', 'Added via /rebook (add a new person).',
    ].join('\n'));
  } catch (err) {
    console.warn('[rebook-add-person] createAppointmentNote failed (non-fatal)',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
  }

  // Orchestrate the Trial Conversion opp. Appointment is already created —
  // an orchestration failure is logged, not fatal (parity with /api/book).
  try {
    await handleBooking({
      contactId: body.contactId,
      appointmentId,
      parent,
      trainee: { firstName: traineeName, age: body.trainee.age, isSelf: false },
      program: body.program,
      programName: getProgram(body.program).name,
      slotStartISO: body.slotStartISO,
      slotEndISO: endISO,
      flow: 'trial',
    });
  } catch (err) {
    console.error('[rebook-add-person] handleBooking failed (appointment did succeed)',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
  }

  const traineeKey = deriveTraineeKey({
    isSelf: false,
    firstName: traineeName,
    lastName: parent.lastName,
  });

  return json({
    ok: true,
    trainee: {
      traineeName,
      traineeKey,
      program: body.program,
      status: 'pending' as const,
      pendingClassISO: body.slotStartISO,
    },
  });
};

function spamTrainee(program: ProgramKey) {
  return { traineeName: '', traineeKey: 'spam-discarded', program, status: 'pending' as const, pendingClassISO: null };
}

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
  const duration = program === 'adults' || program === 'juniors' ? 60 : 45;
  const end = new Date(Date.parse(startISO) + duration * 60_000);
  const offset = startISO.slice(-6);
  const sign = offset.startsWith('-') ? -1 : 1;
  const op = offset.slice(1).split(':').map(Number);
  const offMin = sign * ((op[0] ?? 0) * 60 + (op[1] ?? 0));
  const local = new Date(end.getTime() + offMin * 60_000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${offset}`;
}

function nextAlternates(program: ProgramKey, takenStartISO: string, count: number): AvailabilitySlot[] {
  const start = takenStartISO.slice(0, 10);
  const endDate = new Date(Date.parse(`${start}T00:00:00Z`) + 14 * 86_400_000);
  return generateSlots({
    programKey: program,
    fromISODate: start,
    toISODate: endDate.toISOString().slice(0, 10),
    bookedStartISOs: new Set([takenStartISO]),
    blackoutDates: new Set(blackouts),
    now: new Date(),
    minLeadMinutes: MIN_LEAD_MINUTES,
  }).slice(0, count);
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Verify helper signatures against the codebase**

Confirm each imported symbol exists with the assumed shape:

Run: `npm run check`
Expected: no errors in `rebook-add-person.ts`. If `getProgram(...).calendarIdEnvVar` is named differently, check `src/data/programs.ts` and use the correct property (`/api/book`'s rebook path uses `getProgram(body.program).calendarIdEnvVar` — mirror it). If `deriveTraineeKey` requires a `dob` field, pass `dob: undefined`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/rebook-add-person.ts
git commit -m "feat(rebook): /api/rebook-add-person endpoint for new-trainee trials"
```

---

## Task 5: `/rebook` UI — add-person tile, panel, new card states

All changes are in the single `<script>` controller and markup of `rebook.astro`.

**Files:**
- Modify: `src/pages/rebook.astro`

- [ ] **Step 1: Extend the client `Trainee` interface and add `contactToken` state**

In the `<script>` block of `src/pages/rebook.astro`, replace the `Trainee` interface with:

```ts
  type TraineeStatus = 'enrolled' | 'active' | 'exhausted' | 'pending';
  interface Trainee {
    traineeName: string;
    traineeKey: string;
    program: string;
    status: TraineeStatus;
    creditsRemaining: number;
    lastAttendanceISO: string | null;
    pendingClassISO: string | null;
    sessionToken?: string;
  }
```

In the `state` object, add a field after `contactId`:

```ts
      contactToken: null as string | null,
```

In `applyLookupContext`, set it — change the signature and body to accept and store the token:

```ts
    function applyLookupContext(ctx: { contactId: string; contactToken: string; trainees: Trainee[]; autoExpandTraineeKey: string | null }) {
      state.contactId = ctx.contactId;
      state.contactToken = ctx.contactToken;
      state.trainees = ctx.trainees;
      state.step = 'dashboard';
      renderStep();
      renderCards();
      if (ctx.autoExpandTraineeKey) {
        const found = ctx.trainees.find((x) => x.traineeKey === ctx.autoExpandTraineeKey);
        if (found && found.status === 'active') {
          toggleCard(found.traineeKey);
        }
      }
    }
```

Update the two callers: in the lookup-form handler pass `contactToken: json.contactToken`, and in `tryMagicLink` pass `contactToken: data.contactToken`.

- [ ] **Step 2: Add Tailwind safelist classes**

In `rebook.astro` markup, replace the existing hidden safelist `<span>` (the one with `sm:col-span-2 lg:col-span-3 order-first`) with:

```astro
      <span hidden class="sm:col-span-2 lg:col-span-3 order-first
        border-dashed border-gb-text-muted text-gb-text-muted
        bg-gb-bg-light text-gb-navy"></span>
```

- [ ] **Step 3: Branch `buildCard` on status for `pending` and `enrolled`**

In `buildCard(t: Trainee)`, the credit counter and action button currently assume an active/exhausted card. Replace the credit-counter `<div class="text-right shrink-0">...</div>` inside `header.innerHTML` with a status-driven badge. Add this helper above `buildCard`:

```ts
    function statusBadge(t: Trainee): string {
      if (t.status === 'enrolled') {
        return `<div class="text-right shrink-0"><span class="inline-block bg-gb-bg-light text-gb-navy text-[10px] font-bold tracking-wider px-2 py-1 rounded uppercase whitespace-nowrap">Enrolled</span></div>`;
      }
      if (t.status === 'pending') {
        return `<div class="text-right shrink-0"><span class="inline-block bg-gb-bg-light text-gb-navy text-[10px] font-bold tracking-wider px-2 py-1 rounded uppercase whitespace-nowrap">Trial booked</span></div>`;
      }
      return `<div class="text-right shrink-0">
          <p class="text-2xl md:text-3xl font-extrabold text-gb-red leading-none">${t.creditsRemaining}</p>
          <p class="text-xs text-gb-text-muted">${t.creditsRemaining === 1 ? 'class left' : 'classes left'}</p>
        </div>`;
    }
```

In `buildCard`, change the header `innerHTML` so the right-hand block uses `statusBadge(t)` instead of the hardcoded counter, and change the "Last attended" line so a `pending` card shows the booked class instead:

```ts
          ${
            t.status === 'pending' && t.pendingClassISO
              ? `<p class="mt-1 text-xs text-gb-text-muted">Trial class: ${formatDate(t.pendingClassISO)}</p>`
              : t.lastAttendanceISO
                ? `<p class="mt-1 text-xs text-gb-text-muted">Last attended: ${formatDate(t.lastAttendanceISO)}</p>`
                : ''
          }
```

- [ ] **Step 4: Suppress action button + change-class link on `pending`/`enrolled` cards**

In `buildCard`, wrap the `actions` block so non-bookable cards render no button. Replace the `const actions = document.createElement('div'); ...` button-building section's start with a guard: if `t.status === 'pending' || t.status === 'enrolled'`, append `actions` containing only an informational line and skip the button + change-class link:

```ts
      const actions = document.createElement('div');
      actions.className = 'mt-5';

      if (t.status === 'pending' || t.status === 'enrolled') {
        const note = document.createElement('p');
        note.className = 'text-sm text-gb-text-muted';
        note.textContent = t.status === 'pending'
          ? "We'll see them in class — booking opens once they've attended."
          : 'Enrolled student.';
        actions.appendChild(note);
        card.appendChild(actions);
        const successArea = document.createElement('div');
        successArea.dataset.cardSuccess = '';
        successArea.hidden = true;
        successArea.className = 'mt-5 pt-5 border-t border-gb-bg-light text-sm text-gb-text-muted font-semibold';
        card.appendChild(successArea);
        return card;
      }
```

Place this guard immediately after the `card.appendChild(header);` line and before the existing button-building code. The existing `isExhausted`/`isActive` button logic below it then only runs for `active`/`exhausted` cards. Update the `isExhausted` computation to `const isExhausted = t.status === 'exhausted';`.

- [ ] **Step 5: Render the "Add a new person" tile**

In `renderCards()`, after the `for` loop that appends trainee cards, append the tile:

```ts
    function renderCards() {
      if (!traineeList) return;
      traineeList.innerHTML = '';
      for (const t of state.trainees) {
        traineeList.appendChild(buildCard(t));
      }
      traineeList.appendChild(buildAddPersonTile());
    }

    function buildAddPersonTile(): HTMLElement {
      const tile = document.createElement('article');
      tile.dataset.addPersonTile = '';
      tile.className = 'rounded-2xl border-2 border-dashed border-gb-text-muted p-5 md:p-6 flex flex-col';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.addPersonOpen = '';
      btn.className = 'flex-1 w-full text-gb-navy font-bold text-base flex items-center justify-center gap-2 min-h-[7rem] hover:text-gb-red transition-colors';
      btn.textContent = '+ Add a new person';
      btn.addEventListener('click', () => openAddPerson());
      tile.appendChild(btn);
      const area = document.createElement('div');
      area.dataset.addPersonArea = '';
      area.hidden = true;
      tile.appendChild(area);
      return tile;
    }
```

- [ ] **Step 6: Add the add-person state fields**

In the `state` object add:

```ts
      addPerson: {
        open: false,
        step: 'details' as 'details' | 'date' | 'slot' | 'confirm' | 'error',
        firstName: '',
        age: 0,
      },
```

`age` 0 means unselected. Program is derived from age via the existing `programToAge` mapping (inverted below).

- [ ] **Step 7: Implement the add-person details step**

Add these functions near `renderChangeProgramPicker`:

```ts
    const AGE_TO_PROGRAM: Array<{ age: number; program: ProgramKey }> = [
      { age: 3, program: 'tiny' }, { age: 5, program: 'lc1' }, { age: 7, program: 'lc2' },
      { age: 10, program: 'juniors' }, { age: 16, program: 'adults' },
    ];

    function openAddPerson() {
      if (state.addPerson.open) { closeAddPerson(); return; }
      collapseActive();
      state.addPerson = { open: true, step: 'details', firstName: '', age: 0 };
      const tile = traineeList?.querySelector<HTMLElement>('[data-add-person-tile]');
      const openBtn = tile?.querySelector<HTMLButtonElement>('[data-add-person-open]');
      const area = tile?.querySelector<HTMLElement>('[data-add-person-area]');
      if (!tile || !area || !openBtn) return;
      tile.classList.add('border-gb-gold', ...ACTIVE_SPAN_CLASSES);
      tile.classList.remove('border-dashed', 'border-gb-text-muted');
      openBtn.hidden = true;
      area.hidden = false;
      renderAddPersonDetails(area);
      tile.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function closeAddPerson() {
      state.addPerson.open = false;
      if (bookingFlow && bookingFlowParking) bookingFlowParking.appendChild(bookingFlow);
      renderCards();
    }

    function renderAddPersonDetails(area: HTMLElement) {
      area.innerHTML = `
        <h4 class="text-base md:text-lg font-bold text-gb-navy mb-1">Add a new person</h4>
        <p class="text-sm text-gb-text-muted mb-4">Enter the new student's name and age. We'll use the account details we already have.</p>
        <div class="space-y-3">
          <label class="block">
            <span class="text-sm font-medium text-gb-text">Student first name</span>
            <input data-ap-first type="text" maxlength="50"
              class="mt-1 w-full h-12 px-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-gb-red focus:border-gb-red" />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-gb-text">Student age</span>
            <select data-ap-age
              class="mt-1 w-full h-12 px-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-gb-red focus:border-gb-red bg-white">
              <option value="">Select age range</option>
              <option value="3">Ages 3–4</option>
              <option value="5">Ages 5–6</option>
              <option value="7">Ages 7–9</option>
              <option value="10">Ages 10–15</option>
              <option value="16">Ages 16+</option>
            </select>
          </label>
        </div>
        <p data-ap-error class="hidden mt-3 text-sm text-gb-red" role="alert"></p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <button type="button" data-ap-cancel
            class="h-12 rounded-full bg-gb-white border-2 border-gb-navy text-gb-navy font-bold hover:bg-gb-bg-light transition-colors">Cancel</button>
          <button type="button" data-ap-continue
            class="h-12 rounded-full bg-gb-red text-gb-white font-bold hover:bg-gb-red-dark transition-colors">Continue</button>
        </div>
      `;
      const firstEl = area.querySelector<HTMLInputElement>('[data-ap-first]');
      const ageEl = area.querySelector<HTMLSelectElement>('[data-ap-age]');
      const errEl = area.querySelector<HTMLElement>('[data-ap-error]');
      area.querySelector('[data-ap-cancel]')?.addEventListener('click', () => closeAddPerson());
      area.querySelector('[data-ap-continue]')?.addEventListener('click', () => {
        const firstName = (firstEl?.value ?? '').trim();
        const age = Number(ageEl?.value ?? '');
        if (!firstName || !age) {
          if (errEl) { errEl.textContent = 'Please enter a name and pick an age range.'; errEl.classList.remove('hidden'); }
          return;
        }
        state.addPerson.firstName = firstName;
        state.addPerson.age = age;
        startAddPersonBooking();
      });
    }
```

- [ ] **Step 8: Wire the add-person booking flow into the shared `#booking-flow`**

Add `startAddPersonBooking` and a submit handler. It mirrors `toggleCard`, but targets the add-person tile and uses `state.addPerson`:

```ts
    function addPersonProgram(): ProgramKey {
      const sorted = [...AGE_TO_PROGRAM].sort((a, b) => b.age - a.age);
      return (sorted.find((m) => state.addPerson.age >= m.age)?.program) ?? 'adults';
    }

    function startAddPersonBooking() {
      const tile = traineeList?.querySelector<HTMLElement>('[data-add-person-tile]');
      const area = tile?.querySelector<HTMLElement>('[data-add-person-area]');
      if (!tile || !area || !bookingFlow) return;
      area.innerHTML = '';
      area.appendChild(bookingFlow);

      state.activeTraineeKey = null;
      state.program = addPersonProgram();
      state.programName = PROGRAM_NAME[state.program] ?? state.program;
      state.selectedDate = null;
      state.selectedSlot = null;
      state.slots = [];
      state.slotsByDate = {};
      state.loadedMonths = new Set<string>();
      const today = todayInTZ();
      state.viewYear = today.year;
      state.viewMonth = today.month;
      state.cardStep = 'date';
      state.addPerson.step = 'date';

      renderBookingFlow();
      void loadMonth(state.program, state.viewYear, state.viewMonth);
    }
```

The existing `booking:slot-selected` handler builds `confirmSummary` from `activeTrainee()`. Extend it so it falls back to the add-person name when no trainee card is active. Replace the body of the `booking:slot-selected` listener with:

```ts
      bookingFlow.addEventListener('booking:slot-selected', (e: Event) => {
        const slot = (e as CustomEvent).detail as Slot;
        state.selectedSlot = slot;
        const t = activeTrainee();
        const who = t ? t.traineeName : state.addPerson.firstName;
        if (confirmSummary && state.selectedSlot && who) {
          confirmSummary.textContent = `Booking ${state.programName} for ${who} on ${state.selectedSlot.label}.`;
        }
        state.cardStep = 'confirm';
        renderBookingFlow();
      });
```

Extend `confirmSubmit`'s click handler to branch: if `state.addPerson.open` and no `activeTraineeKey`, call `submitAddPerson()`; otherwise the existing `submitBooking()`:

```ts
      confirmSubmit?.addEventListener('click', async () => {
        if (state.addPerson.open && !state.activeTraineeKey) {
          await submitAddPerson();
        } else {
          await submitBooking();
        }
      });
```

- [ ] **Step 9: Implement `submitAddPerson`**

Add near `submitBooking`:

```ts
    async function submitAddPerson() {
      if (state.submitting) return;
      if (!state.contactId || !state.contactToken || !state.selectedSlot) return;
      state.submitting = true;
      if (confirmSubmit) { confirmSubmit.disabled = true; confirmSubmit.textContent = 'Booking…'; }
      confirmError?.classList.add('hidden');

      const slot = state.selectedSlot;
      try {
        const res = await fetch('/api/rebook-add-person', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: state.contactId,
            sessionToken: state.contactToken,
            program: addPersonProgram(),
            trainee: { firstName: state.addPerson.firstName, age: state.addPerson.age },
            slotStartISO: slot.startISO,
            ts: state.pageRenderTs,
            website: '',
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.code ?? 'unknown');

        // Prepend the new pending card, close the panel, show success on it.
        const newTrainee: Trainee = {
          traineeName: data.trainee.traineeName,
          traineeKey: data.trainee.traineeKey,
          program: data.trainee.program,
          status: 'pending',
          creditsRemaining: 0,
          lastAttendanceISO: null,
          pendingClassISO: data.trainee.pendingClassISO,
        };
        state.trainees.unshift(newTrainee);
        if (bookingFlow && bookingFlowParking) bookingFlowParking.appendChild(bookingFlow);
        state.addPerson.open = false;
        renderCards();
        const card = traineeList?.querySelector<HTMLElement>(`[data-trainee-key="${cssEscape(newTrainee.traineeKey)}"]`);
        const successEl = card?.querySelector<HTMLElement>('[data-card-success]');
        if (successEl) {
          successEl.hidden = false;
          successEl.textContent = `✓ Trial booked for ${slot.label}. We'll send a reminder before class.`;
        }
      } catch (err) {
        console.warn('[rebook] add-person failed', err);
        confirmError?.classList.remove('hidden');
      } finally {
        state.submitting = false;
        if (confirmSubmit) { confirmSubmit.disabled = false; confirmSubmit.textContent = 'Confirm Booking'; }
      }
    }
```

- [ ] **Step 10: Type-check and build**

Run: `npm run check`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 11: Manual verification**

Start the dev server (`npm run dev`) and, against a GHL test contact with an active trial pass:
1. Look up the contact by email → dashboard shows existing card(s) + the dashed "+ Add a new person" tile.
2. Click the tile → details panel; enter a name + age → Continue → date picker appears.
3. Pick a date → slot → confirm → Confirm Booking → panel closes, a new "Trial booked" card appears with the green success line.
4. Refresh the page and look up again → the new person still shows as a "Trial booked" pending card (durable via `/api/rebook-lookup`).
5. Confirm an enrolled household member (won Trial Conversion opp) renders as an "Enrolled" card with no buttons.

- [ ] **Step 12: Commit**

```bash
git add src/pages/rebook.astro
git commit -m "feat(rebook): add-a-new-person tile, panel, and pending/enrolled cards"
```

---

## Self-review notes

- **Spec coverage:** four-state card model (Task 1, 5); durable persistence via lookup/context (Task 2, 3); new endpoint with contact-scoped token (Task 4); add-person tile + panel + reused booking flow (Task 5); Tailwind safelist (Task 5 Step 2); edge cases — duplicate person handled by `handleBooking` trial-path `findByTraineeKey`, priority dedup in resolver, token expiry → `INVALID_TOKEN`, `SLOT_TAKEN` alternates (Task 4). ✅
- **Endpoint tests:** the spec listed `/api/rebook-add-person` unit tests; the codebase has no API-route test harness (no GHL mocking infrastructure). Coverage is the fully-TDD'd pure resolver (Task 1) plus the Task 5 Step 11 manual checklist — a deliberate scope decision consistent with the existing repo convention.
- **Type consistency:** `TraineeCard` (endpoints), `ResolvedTrainee` (resolver), and the client `Trainee` interface all carry `status` / `creditsRemaining` / `lastAttendanceISO` / `pendingClassISO`; `sessionToken` optional everywhere. `CONTACT_SCOPED_TRAINEE_KEY` is defined once in `rebook-cards.ts` and imported by both the lookup/context endpoints and `rebook-add-person`.
