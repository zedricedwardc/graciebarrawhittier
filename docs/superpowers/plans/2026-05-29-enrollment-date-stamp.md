# Enrollment Date Stamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp `opportunity.enrollment_date` (YYYY-MM-DD, America/Los_Angeles) when an opp first reaches an enrolled stage. First-write-wins; preserves the original enrollment date across admin stage corrections.

**Architecture:** Two paths.
- **TRIAL_CONV `STUDENT ENROLLED (WON)`** is handled by the website's existing `stage-changed` webhook. We add a new helper `stampEnrollmentDateIfEmpty(opp)` and call it from the WON branch, wrapped in its own try/catch so a stamp failure does not break the subsequent Credit-opp-close step.
- **BACK_TO_MATS `RE ENROLLED`** has no backflow webhook. The existing GHL workflow that already runs `Update Opportunity → Monetary Value` on entry gets one additional `Update Opportunity → Enrollment Date` step, gated by an `Enrollment Date is empty` If/Else filter for first-write-wins.

The new `enrollment_date` field is declared in `OPPORTUNITY_CUSTOM_FIELDS` so the onboarding script provisions it for new academies. The GBW production account already has the field (id `91nvu2zJbZC7CJf22MCL`, verified live 2026-05-29).

**Tech Stack:** TypeScript, Astro (server endpoints), Zod (already in use), Vitest (test runner — verified in `package.json`). GHL API via existing `src/lib/ghl-opportunities.ts` + `src/lib/ghl-custom-fields.ts` helpers.

**Spec:** `docs/superpowers/specs/2026-05-29-enrollment-date-stamp-design.md`

---

## Task 1: Declare `enrollment_date` in the schema

**Files:**
- Modify: `config/ghl-schema.ts` (append entry to `OPPORTUNITY_CUSTOM_FIELDS` array, ends at line 348 — append before the closing `] as const;`)

- [ ] **Step 1: Add the field declaration**

Insert this entry as the last item of `OPPORTUNITY_CUSTOM_FIELDS` (after the `rebook_link_token` entry on line 347, before the closing `]`):

```ts
  {
    fieldKey: 'enrollment_date',
    label: 'Enrollment Date',
    type: 'DATE',
    description:
      'YYYY-MM-DD (America/Los_Angeles) when this opp first reached an enrolled stage ' +
      '(TRIAL_CONV STUDENT ENROLLED (WON) or BACK_TO_MATS RE ENROLLED). First-write-wins — ' +
      'admin nudges of the stage do not reset it. Set by the stage-changed webhook for ' +
      'TRIAL_CONV and by the BTM RE ENROLLED workflow for BACK_TO_MATS.',
    setBy: 'webhook',
  },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. The schema array is `readonly CustomFieldDef[]` — appending a well-typed entry is safe.

- [ ] **Step 3: Commit**

```bash
git add config/ghl-schema.ts
git commit -m "feat(ghl): declare enrollment_date opportunity custom field

Already exists in the GBW live account (id 91nvu2zJbZC7CJf22MCL); declaring
it so scripts/onboard-client.ts provisions it for new academies."
```

---

## Task 2: Write `stampEnrollmentDateIfEmpty` helper (TDD)

**Files:**
- Test: `src/lib/ghl-opportunities.test.ts` (create)
- Modify: `src/lib/ghl-opportunities.ts` (add `todayInLA` private helper + `stampEnrollmentDateIfEmpty` export)

The helper signature:

```ts
export async function stampEnrollmentDateIfEmpty(opp: OpportunityRecord): Promise<void>
```

Behavior:
- Reads `enrollment_date` off the passed-in opp via `getOppCfValueByKey<string>(opp, 'enrollment_date')`.
- If the existing value is a non-empty string, returns without writing (first-write-wins).
- Otherwise builds the CF payload via `cfPayload('opportunity', { enrollment_date: todayInLA() })` and calls `updateOppFields(opp.id, payload)`.

`todayInLA()` returns YYYY-MM-DD using `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })` — `en-CA` formats as `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ghl-opportunities.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpportunityRecord } from './ghl';

vi.mock('./ghl', async () => {
  const actual = await vi.importActual<typeof import('./ghl')>('./ghl');
  return {
    ...actual,
    updateOpportunity: vi.fn(),
  };
});
vi.mock('./ghl-custom-fields', async () => {
  const actual = await vi.importActual<typeof import('./ghl-custom-fields')>('./ghl-custom-fields');
  return {
    ...actual,
    getCfId: vi.fn(async (_obj: string, key: string) => `cfid-${key}`),
    cfPayload: vi.fn(async (_obj: string, values: Record<string, unknown>) =>
      Object.entries(values).map(([k, v]) => ({ id: `cfid-${k}`, field_value: v as string | number | boolean | null })),
    ),
  };
});

import { stampEnrollmentDateIfEmpty } from './ghl-opportunities';
import { updateOpportunity } from './ghl';

const updateOppMock = vi.mocked(updateOpportunity);

function makeOpp(overrides: Partial<OpportunityRecord> = {}, cfs: Array<{ id: string; fieldValue?: string }> = []): OpportunityRecord {
  return {
    id: 'opp_123',
    customFields: cfs,
    ...overrides,
  } as OpportunityRecord;
}

beforeEach(() => {
  updateOppMock.mockReset();
  updateOppMock.mockResolvedValue({ id: 'opp_123' } as OpportunityRecord);
});

describe('stampEnrollmentDateIfEmpty', () => {
  it('writes enrollment_date when the opp has no existing value', async () => {
    const opp = makeOpp({}, []);
    await stampEnrollmentDateIfEmpty(opp);
    expect(updateOppMock).toHaveBeenCalledTimes(1);
    const [oppId, args] = updateOppMock.mock.calls[0];
    expect(oppId).toBe('opp_123');
    expect(args.customFields).toEqual([
      { id: 'cfid-enrollment_date', field_value: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    ]);
  });

  it('does not write when enrollment_date is already set', async () => {
    const opp = makeOpp({}, [{ id: 'cfid-enrollment_date', fieldValue: '2026-01-15' }]);
    await stampEnrollmentDateIfEmpty(opp);
    expect(updateOppMock).not.toHaveBeenCalled();
  });

  it('treats whitespace-only existing value as empty and writes', async () => {
    const opp = makeOpp({}, [{ id: 'cfid-enrollment_date', fieldValue: '   ' }]);
    await stampEnrollmentDateIfEmpty(opp);
    expect(updateOppMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/ghl-opportunities.test.ts`
Expected: FAIL with `stampEnrollmentDateIfEmpty is not exported from './ghl-opportunities'` (or similar).

- [ ] **Step 3: Add the helper to `src/lib/ghl-opportunities.ts`**

The existing imports at the top of the file already include `getCfId` and `cacheOpportunityCustomFields` from `./ghl-custom-fields`. Add `cfPayload` to that import:

Modify the import block at the top (currently line 18):

```ts
import { cacheOpportunityCustomFields, getCfId, cfPayload } from './ghl-custom-fields';
```

Then append these to the end of the file (after the existing `export type` line, currently line 218):

```ts
/** YYYY-MM-DD in America/Los_Angeles. en-CA formats as ISO calendar date. */
function todayInLA(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })
    .format(new Date());
}

/**
 * Stamp `enrollment_date` on an opportunity if it's currently empty.
 *
 * First-write-wins: returns without writing when the opp already has a
 * non-empty `enrollment_date`. This preserves the original enrollment date
 * across admin stage corrections (moves out of and back into the WON stage).
 *
 * Called from the stage-changed webhook on entry to STUDENT ENROLLED (WON).
 */
export async function stampEnrollmentDateIfEmpty(opp: OpportunityRecord): Promise<void> {
  const existing = await getOppCfValueByKey<string>(opp, 'enrollment_date');
  if (typeof existing === 'string' && existing.trim()) return;
  const payload = await cfPayload('opportunity', { enrollment_date: todayInLA() });
  await updateOppFields(opp.id, payload);
}
```

Note: `getCfId` is no longer needed in the new code (we use `cfPayload`), but it remains used elsewhere in the file — leave the existing import intact.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/ghl-opportunities.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ghl-opportunities.ts src/lib/ghl-opportunities.test.ts
git commit -m "feat(ghl): add stampEnrollmentDateIfEmpty helper

YYYY-MM-DD in America/Los_Angeles, first-write-wins. Caller passes an
already-fetched opp so the helper can check the existing CF value without
a redundant GHL round-trip."
```

---

## Task 3: Wire helper into stage-changed.ts WON branch

**Files:**
- Modify: `src/pages/api/webhooks/ghl/stage-changed.ts:24-31` (add helper to import block)
- Modify: `src/pages/api/webhooks/ghl/stage-changed.ts:185-211` (WON branch)

- [ ] **Step 1: Add `stampEnrollmentDateIfEmpty` to the import block**

Currently lines 24-31:

```ts
import {
  findOpps,
  setOppStatus,
  setOppValue,
  enrolledStudentValue,
  moveStage,
  getOppCfValueByKey,
} from '../../../../lib/ghl-opportunities';
```

Change to:

```ts
import {
  findOpps,
  setOppStatus,
  setOppValue,
  enrolledStudentValue,
  moveStage,
  getOppCfValueByKey,
  stampEnrollmentDateIfEmpty,
} from '../../../../lib/ghl-opportunities';
```

- [ ] **Step 2: Add the stamp call to the WON branch**

Currently the WON branch (lines 185-211) reads:

```ts
case 'STUDENT ENROLLED (WON)': {
  await setOppStatus(body.opp_id, 'won');
  // set_opp_value transition action — stamp revenue for the dashboard.
  await setOppValue(body.opp_id, await enrolledStudentValue());
  // Close the matching Credit Mon opp as won, if any
  if (body.trainee_key) {
    /* ...existing code... */
  }
  break;
}
```

Insert the stamp logic between `setOppValue` and the Credit-opp-close block. Wrap it in its own try/catch so a stamp failure does not skip Credit-opp-close:

```ts
case 'STUDENT ENROLLED (WON)': {
  await setOppStatus(body.opp_id, 'won');
  // set_opp_value transition action — stamp revenue for the dashboard.
  await setOppValue(body.opp_id, await enrolledStudentValue());

  // Stamp enrollment_date for tenure/anniversary use. First-write-wins.
  // Isolated in its own try/catch so a stamp failure does not skip the
  // Credit-opp-close step below.
  try {
    const opp = await getOpportunity(body.opp_id);
    if (opp) await stampEnrollmentDateIfEmpty(opp);
  } catch (err) {
    console.error('[stage-changed WON] enrollment_date stamp failed', err);
  }

  // Close the matching Credit Mon opp as won, if any
  if (body.trainee_key) {
    /* ...existing code unchanged... */
  }
  break;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run full vitest suite**

Run: `npm test`
Expected: all tests pass (no existing test for stage-changed.ts means no test regressions; the new helper's tests pass from Task 2).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds. This is the same build Vercel runs on deploy.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/webhooks/ghl/stage-changed.ts
git commit -m "feat(webhook): stamp enrollment_date on STUDENT ENROLLED (WON)

Calls stampEnrollmentDateIfEmpty after setOppStatus + setOppValue.
Isolated in its own try/catch so a stamp failure does not block the
Credit-opp-close step that runs after it."
```

---

## Task 4: Update docs (schema comment + runbook)

**Files:**
- Modify: `config/ghl-schema.ts:1044-1054` (BACK_TO_MATS RE ENROLLED transition action comment)
- Modify: `docs/replication/ghl-onboarding-runbook.md` (BTM RE ENROLLED workflow section — find via grep)

- [ ] **Step 1: Find the BTM RE ENROLLED runbook section**

Run: `grep -n "RE ENROLLED\|set_opp_value\|Monetary Value" docs/replication/ghl-onboarding-runbook.md`
Expected: returns the line numbers of the BTM RE ENROLLED workflow setup section. If no match, fall back to:
`grep -n "BACK_TO_MATS\|BTM\|Back to the Mats" docs/replication/ghl-onboarding-runbook.md`

Read the section to understand its current structure before editing.

- [ ] **Step 2: Update the schema comment near `BACK_TO_MATS.RE ENROLLED`**

The current comment at lines 1048-1052 reads:

```ts
{ type: 'set_status', status: 'won' },
// No BTM backflow webhook — an admin moving an opp here never reaches the
// website. set_opp_value must be applied by a GHL workflow triggered on
// entry to RE ENROLLED (Update Opportunity → Monetary Value).
{ type: 'set_opp_value', fromCustomValueKey: 'enrolled_student_value' },
```

Change the comment to:

```ts
{ type: 'set_status', status: 'won' },
// No BTM backflow webhook — an admin moving an opp here never reaches the
// website. Both set_opp_value AND enrollment_date stamping must be applied
// by a GHL workflow triggered on entry to RE ENROLLED:
//   Update Opportunity → Monetary Value = {{custom_values.enrolled_student_value}}
//   Update Opportunity → Enrollment Date = today  (gated by an
//     "Enrollment Date is empty" If/Else for first-write-wins parity with
//     the TRIAL_CONV stage-changed webhook handler).
// See docs/replication/ghl-onboarding-runbook.md.
{ type: 'set_opp_value', fromCustomValueKey: 'enrolled_student_value' },
```

- [ ] **Step 3: Add the runbook step**

In `docs/replication/ghl-onboarding-runbook.md`, locate the BTM RE ENROLLED workflow setup section (from Step 1). Append a new bullet/step describing the Enrollment Date stamp:

```markdown
- **Update Opportunity → Enrollment Date.** In the same workflow that stamps Monetary Value on entry to RE ENROLLED, add an If/Else step *before* this action with the condition `Opportunity → Enrollment Date is empty`. On the matched branch, add an `Update Opportunity` action that sets Enrollment Date to **today** (use `{{event.date_added}}` if your trigger surfaces it, otherwise the workflow's built-in "current date" merge). This enforces first-write-wins parity with the TRIAL_CONV stage-changed webhook handler, so admin-initiated stage nudges do not reset the original enrollment date.
```

Match the surrounding heading level + list style of the existing BTM section — do not introduce a new top-level heading.

- [ ] **Step 4: Verify both edits render correctly**

Run: `git diff config/ghl-schema.ts docs/replication/ghl-onboarding-runbook.md`
Expected: only the two changes above; no whitespace or unrelated edits.

- [ ] **Step 5: Commit**

```bash
git add config/ghl-schema.ts docs/replication/ghl-onboarding-runbook.md
git commit -m "docs(ghl): document enrollment_date stamping for BTM RE ENROLLED

Extends the existing BACK_TO_MATS schema comment and the BTM workflow
setup runbook to cover the new Update Opportunity → Enrollment Date
step (gated by 'Enrollment Date is empty' for first-write-wins parity
with the TRIAL_CONV webhook)."
```

---

## Task 5: Manual GHL configuration (one-time, in the live GBW account)

This task is performed in the GHL UI, not in the codebase. It cannot be automated — GHL's API does not expose workflow step editing (see `config/ghl-schema.ts:17-22`).

- [ ] **Step 1: Open the BTM workflow that handles RE ENROLLED entry**

In the GHL UI, navigate to: Automation → Workflows. Open the workflow that runs on entry to `BACK_TO_MATS → RE ENROLLED` (the same workflow that already contains the `Update Opportunity → Monetary Value` action). The exact workflow name is account-specific — find it via the Monetary Value action.

- [ ] **Step 2: Add an If/Else condition before the new Update Opportunity action**

- Condition: `Opportunity → Enrollment Date is empty`.
- Place this branch *above* the new Enrollment Date update action.

- [ ] **Step 3: Add the Update Opportunity → Enrollment Date action on the matched branch**

- Action: `Update Opportunity`.
- Field: `Enrollment Date`.
- Value: today's date — use `{{event.date_added}}` if available on the trigger, otherwise the workflow's built-in current-date merge tag. Either is fine; the BTM stage entry timestamp is functionally equivalent to "now."

- [ ] **Step 4: Save and publish the workflow**

- [ ] **Step 5: Smoke-test in the live account**

- Pick a BTM contact in the LEAD or FORMER STUDENT stage. Move them through to RE ENROLLED.
- Open the resulting opp and confirm `Enrollment Date` is populated with today's date.
- Move the opp out and back into RE ENROLLED. Confirm `Enrollment Date` does *not* change (first-write-wins).

---

## Task 6: End-to-end verification (TRIAL_CONV path) and final wrap-up

- [ ] **Step 1: Smoke-test the TRIAL_CONV path in the live account**

Move a TRIAL_CONV opp into `STUDENT ENROLLED (WON)` (a real test contact, or use a staging opp). Confirm in the GHL opp card that:
- `Enrollment Date` is populated with today's date in YYYY-MM-DD.
- Status flipped to Won.
- Monetary Value populated from `enrolled_student_value`.
- The matching CREDIT_MON opp moved to `WON ENROLLED` (existing behavior).

Then move the opp out of WON and back in. Confirm `Enrollment Date` does *not* change.

- [ ] **Step 2: Confirm onboarding script sees the new field declaration**

Run: `npx tsx scripts/onboard-client.ts --help` (or whatever command lists the script's modes) to confirm the script still loads with the updated schema. We do not run provision against a real account here — the GBW account already has the field.

If the script has a dry-run / audit mode, run it against the GBW account and confirm `enrollment_date` is reported as "already exists" rather than "would create."

- [ ] **Step 3: Final type + build sanity check**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 4: Push and (optionally) open PR**

```bash
git log --oneline -6
git push
```

If pushing to a feature branch, open the PR with the spec doc linked in the description.

---

## Self-Review Notes

**Spec coverage verified:**
- Schema declaration → Task 1.
- `stampEnrollmentDateIfEmpty` helper + tests → Task 2.
- Webhook wiring (WON branch, try/catch isolation) → Task 3.
- BTM schema comment + runbook → Task 4.
- Manual BTM workflow config → Task 5.
- Verification → Task 6.

**No placeholders.** Every code block is complete and copy-pasteable; every command has an expected outcome.

**Type / name consistency.** `stampEnrollmentDateIfEmpty` is the same name everywhere. `enrollment_date` (snake_case, matching GHL fieldKey) is used everywhere. `cfPayload` is the codebase-idiomatic way to build CF arrays — already used in `src/pages/api/rebook-change-program.ts:81`.
