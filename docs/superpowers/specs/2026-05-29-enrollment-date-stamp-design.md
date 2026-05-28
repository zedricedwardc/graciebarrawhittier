# Enrollment Date Stamp on Won Enrollment Stages

**Status:** Approved (design)
**Date:** 2026-05-29

## Problem

When an opportunity reaches an enrolled stage we already mutate the opp (set status=won, stamp monetary value, close the matching Credit opp), but we don't record *when* the enrollment happened. There is no first-class signal for tenure, anniversary messaging, or dashboard cohorting.

GHL already has an `opportunity.enrollment_date` DATE custom field (id `91nvu2zJbZC7CJf22MCL`, verified live 2026-05-29) but nothing reads or writes it. It also isn't declared in `config/ghl-schema.ts`, which means `scripts/onboard-client.ts` won't provision it for new academies — a reproducibility gap.

## Scope

Stamp `opportunity.enrollment_date` with the local enrollment date when an opp first reaches an enrolled stage.

In scope:
- `TRIAL_CONV → STUDENT ENROLLED (WON)` — handled by the existing `stage-changed` webhook.
- `BACK_TO_MATS → RE ENROLLED` — handled by the existing GHL workflow that already stamps monetary value on entry. No website webhook exists for BTM.
- Schema declaration so onboarding provisions the field for new academies.

Out of scope:
- `CREDIT_MON → WON ENROLLED`. This stage is reached as a side-effect of the `STUDENT ENROLLED (WON)` transition (`src/pages/api/webhooks/ghl/stage-changed.ts:203-209`); the TRIAL_CONV opp is the canonical record.
- A generic declarative `stamp_now_on_opp` TransitionAction verb. The schema's `transitionActions` arrays are documentation today, not a dispatcher — the existing `set_opp_value` action is also implemented inline in the webhook. Adding a verb without a dispatcher would just add ceremony.

## Semantics

**First-write-wins.** If `enrollment_date` is already set on the opp, do not overwrite. This preserves the *original* enrollment date when an admin nudges an opp out of and back into the WON stage (corrections, accidental moves).

**Date format.** `YYYY-MM-DD` in `America/Los_Angeles`. Matches the convention already used by `opportunity.appointment_date` (`config/ghl-schema.ts:307-312`), avoids UTC/LA boundary drift, renders cleanly in opp cards.

## Design

### TRIAL_CONV path (website code)

**Schema declaration** — `config/ghl-schema.ts`, append to `OPPORTUNITY_CUSTOM_FIELDS`:

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
}
```

**Helpers** — `src/lib/ghl-opportunities.ts`:

```ts
/** YYYY-MM-DD in America/Los_Angeles. en-CA's date format is ISO calendar. */
function todayInLA(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })
    .format(new Date());
}

/**
 * Stamp `enrollment_date` on an opp if it is currently empty.
 * No-op when already set (first-write-wins) — preserves original enrollment
 * date across admin stage corrections.
 */
export async function stampEnrollmentDateIfEmpty(opp: OpportunityRecord): Promise<void> {
  const existing = await getOppCfValueByKey<string>(opp, 'enrollment_date');
  if (typeof existing === 'string' && existing.trim()) return;
  const fieldId = await getCfId('opportunity', 'enrollment_date');
  await updateOppFields(opp.id, [{ id: fieldId, field_value: todayInLA() }]);
}
```

(`getCfId` is already imported in this file via `ghl-custom-fields`. `updateOppFields` is already exported.)

**Webhook handler** — `src/pages/api/webhooks/ghl/stage-changed.ts`, in the `STUDENT ENROLLED (WON)` case (currently lines 185-211):

The branch currently does not fetch the opp. We need the opp record to read the existing `enrollment_date` CF. Fetch once at the top of the branch and pass it to the helper:

```ts
case 'STUDENT ENROLLED (WON)': {
  await setOppStatus(body.opp_id, 'won');
  await setOppValue(body.opp_id, await enrolledStudentValue());

  const opp = await getOpportunity(body.opp_id);
  if (opp) await stampEnrollmentDateIfEmpty(opp);

  // Close the matching Credit Mon opp as won, if any (unchanged)
  if (body.trainee_key) { /* ...existing code... */ }
  break;
}
```

`getOpportunity` is already imported (`stage-changed.ts:32`). The TRIAL ACTIVE NURTURE branch demonstrates the same fetch pattern (line 145-148).

If `getOpportunity` returns null we silently skip the stamp — the WON transition still succeeds. This is consistent with the file's "always return 200 on logical errors so GHL doesn't infinite-retry" contract.

### BACK_TO_MATS path (GHL workflow + docs)

BTM has no backflow webhook (`config/ghl-schema.ts:1048-1052`). The same GHL workflow that already runs `Update Opportunity → Monetary Value` on entry to RE ENROLLED gets one additional step:

> **Update Opportunity → Enrollment Date = `{{ trigger.event_time }}`** (or "Today")
> Add an If/Else above this step: branch when *Enrollment Date is empty*. The "set" step runs only on the empty branch — that's how first-write-wins is enforced in GHL UI.

Documentation changes:
- `docs/replication/ghl-onboarding-runbook.md` — append a one-liner to the BTM RE ENROLLED workflow setup section describing the Update Opportunity step + empty-filter.
- `config/ghl-schema.ts` — extend the existing comment near `BACK_TO_MATS.RE ENROLLED` (around line 1048-1052) to mention `enrollment_date` alongside `set_opp_value`.

### Onboarding

No code change. Once declared in `OPPORTUNITY_CUSTOM_FIELDS`, the `provision` mode of `scripts/onboard-client.ts` will auto-create the field for new academies. For the GBW account where the field already exists with id `91nvu2zJbZC7CJf22MCL`, the script's idempotency (match by fieldKey) leaves it alone.

## Testing

If `src/pages/api/webhooks/ghl/stage-changed.test.ts` exists: add two cases to the WON branch — stamps `enrollment_date` when the opp's existing value is empty; does not write when it's already set. Mock `getOpportunity` to return an opp with/without the CF populated.

If no test file exists: write a focused unit test for `stampEnrollmentDateIfEmpty` (mock `getOppCfValueByKey` and `updateOppFields`).

Manual verification: in the GBW staging or live account, move a TRIAL_CONV opp into STUDENT ENROLLED (WON) and confirm the Enrollment Date field on the opp card populates with today's date in LA tz. Move the opp out and back in; confirm the date does not change.

## Risk and rollout

Low risk. The change is additive on the WON branch — no existing behavior is modified, only a new write is appended. Failure of the stamp (e.g., transient GHL error) does not affect the other actions because the original Credit-opp-close logic runs *after* the stamp call and we don't gate it on stamp success — actually, since both calls are inside the same `try/catch`, a stamp failure would skip Credit-opp-close. To preserve current behavior we wrap the stamp in its own `try/catch` and log on failure rather than throwing:

```ts
try {
  const opp = await getOpportunity(body.opp_id);
  if (opp) await stampEnrollmentDateIfEmpty(opp);
} catch (err) {
  console.error('[stage-changed WON] enrollment_date stamp failed', err);
}
```

This is the only nuance in the implementation. Capture it as an explicit step in the plan.

Manual GHL step (BTM workflow update) is a one-time configuration change in the GBW live account; if skipped, BTM re-enrollments simply won't have `enrollment_date` populated — no other regression.
