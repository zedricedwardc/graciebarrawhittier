# Appointment Collapse Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore GBW's trial-booking volume by eliminating duplicate outbound messaging, repairing the stage auto-move timers, catching inbound replies, and recovering the leads and trial-pass holders already stranded by the defects.

**Architecture:** Four defects compound into one symptom. Two are GHL workflow-configuration faults (duplicate enrollment, missing/mistimed Wait tails) fixed in the GHL UI. One is a missing capability (nobody reacts to inbound replies) added as a new GHL workflow. One is accumulated bad state (stranded opportunities) fixed by a dry-run-default backfill script. A new permanent audit script makes all four failure modes detectable so they cannot silently recur.

**Tech Stack:** Astro 6, TypeScript, Vitest, `tsx` for scripts, GHL REST API v2 (`services.leadconnectorhq.com`), GHL workflow builder UI.

## Global Constraints

- **Location:** `GHL_LOCATION_ID=eMHOrbrPAfFd2S1ORNKL` (Gracie Barra Whittier).
- **Auth for all scripts:** `GHL_PIT_TOKEN` from `.env` via `dotenv`. The `uxie-ghl-mcp` MCP token returns HTTP 401 `This location is not accessible from this token!` for this location — never use MCP for this work.
- **`.env.local` values carry a UTF-8 BOM** (`\uFEFF`) on the first key and are double-quoted. Any env reader must strip both.
- **GHL API headers:** `Authorization: Bearer <pit>`, `Version: 2021-07-28`, `Accept: application/json`.
- **Opportunity search must pass `status: 'all'`** — the default omits `won`/`lost` opps and will silently understate counts.
- **Every script mutating GHL is dry-run by default** and requires an explicit `--apply` flag, matching `scripts/backfill-lead-acq-renurture.ts`.
- **Outward-facing actions** (anything that sends SMS/email to real customers) additionally require `--confirm` and must be reported to the user before running.
- **Academy Launch deviation rule (CLAUDE.md):** repairing timers inside the GHL UI is *not* templatable for other gyms. Task 8 records this as a tracked deviation. Do not silently accept it.
- **Tests:** `npm test` (vitest). Pure logic is extracted into testable functions; network I/O stays in thin uncovered wrappers.
- **`tsconfig.json` sets `noUncheckedIndexedAccess: true`.** Indexed access is `T | undefined`, so `npm run check` fails on `arr[0].prop` even after `expect(arr).toHaveLength(1)`. Repo convention is the non-null assertion — `arr[0]!.prop` (see `src/lib/ghl-blog.test.ts:420`, `src/lib/ghl-opportunities.test.ts:45`). Never relax tsconfig or add `ts-ignore` to work around this.
- **Commit after every task.** Branch off `master`, not the current `feat/admin-dashboard-widgets`.

## Baseline Measurements (2026-07-30, for post-fix comparison)

| Metric | Baseline |
|---|---|
| Open appointments on the books | 4 (was 37 on Jun 15) |
| New leads/week | 6–15 (flat — not the problem) |
| Lead→booking conversion | 13% wk of Jul 20, 0% wk of Jul 27 (was 50–83%) |
| Outbound SMS/week | 75–100, 2–3% failure |
| Inbound replies/week | 4 (was 31 on Jun 29) |
| Contacts receiving duplicate sends | 33 of 100 sampled; 233 duplicate events |
| Replies unanswered >24h | 28 of 62 (45%) |
| `LEAD_ACQ` opps ever reaching LOST/COLD | **0** |
| `CREDIT_MON` opps in REACTIVATION / CREDITS EXHAUSTED / LOST | **0** |
| `CREDIT ACTIVE` opps stale past their 14d timer | 31 of 31 (26 of them 31–60d) |

## File Structure

| File | Responsibility |
|---|---|
| `docs/superpowers/specs/2026-07-31-workflow-audit-findings.md` | **Create.** Task 1 output: the actual exported config of the three suspect workflows. Evidence base for Tasks 2 & 4. |
| `src/lib/messaging-audit.ts` | **Create.** Pure detection logic: duplicate sends, unanswered replies, overdue opportunities. No network I/O. |
| `src/lib/messaging-audit.test.ts` | **Create.** Unit tests for the above. |
| `scripts/audit-messaging-health.ts` | **Create.** Thin GHL-fetching CLI that feeds `messaging-audit.ts` and prints the health report. Read-only. |
| `src/lib/opp-rescue.ts` | **Create.** Pure selection logic for which stranded opps to move and where. |
| `src/lib/opp-rescue.test.ts` | **Create.** Unit tests for the above. |
| `scripts/rescue-stranded-opps.ts` | **Create.** Dry-run-default CLI applying `opp-rescue.ts` selections against GHL. |
| `config/ghl-schema.ts` | **Modify** (~line 546–551, 708–711). Correct the `Trial Nurture Campaign` trigger declaration and the auto-move implementation note so the schema matches reality. |
| `package.json` | **Modify.** Add `audit:messaging` and `rescue:opps` scripts. |
| `docs/replication/ghl-workflow-build-from-scratch.md` | **Modify.** Document the single-enrollment rule and the required Wait+UpdateStage tails. |
| `docs/replication/ghl-onboarding-runbook.md` | **Modify.** Add the post-launch messaging-health check. |

**GHL UI changes (no repo file):** Tasks 2, 3, 4, 5.

---

### Task 1: Export and verify the actual workflow configuration

Read-only. Everything downstream depends on knowing what these workflows really contain — the structure below is *inferred from runtime behavior*, not yet read from source. Do not skip.

**Files:**
- Create: `docs/superpowers/specs/2026-07-31-workflow-audit-findings.md`

**Interfaces:**
- Produces: a findings doc whose "Confirmed structure" section Tasks 2 and 4 read to pick their branch.

- [ ] **Step 1: Export the three suspect workflows**

Invoke the `uxie-ghl-factory:get-ghl-workflow-json` skill (read-only; browser JWT interception, requires a logged-in GHL session). Export these workflows from location `eMHOrbrPAfFd2S1ORNKL`:

| Workflow | Env var | Why |
|---|---|---|
| `Trial Nurture Campaign` | `WORKFLOW_ID_TRIAL_NURTURE` = `13a7c569-885f-4d50-a9ce-0a8583115197` | Suspected self-retriggering + 24d tail |
| `Last Chance Nurture Campaign` | `WORKFLOW_ID_NURTURE_CAMPAIGN` = `03885bd2-8793-404f-9c4c-fe2372eeb02c` | Suspected missing LOST/COLD tail |
| `Another Trial Booking Campaign` | `WORKFLOW_ID_ANOTHER_TRIAL_CAMPAIGN` (read from `.env.local`) | Suspected missing REACTIVATION tail |

- [ ] **Step 2: Record answers to five specific questions**

Write `docs/superpowers/specs/2026-07-31-workflow-audit-findings.md` answering each explicitly:

1. **Trial Nurture Campaign — trigger list.** Does it include a `Pipeline Stage Changed → Lead Acquisition → TRIAL NURTURE` trigger? (Expected: yes. This is the self-retrigger.)
2. **Trial Nurture Campaign — does it contain an `Update Opportunity Stage → TRIAL NURTURE` action?** (Expected: yes, ~24h in. Combined with #1 this is the duplicate-enrollment loop.)
3. **Trial Nurture Campaign — "Allow Re-entry" setting.** (Expected: enabled — required for the duplicate to occur.)
4. **Trial Nurture Campaign — cumulative wait before its `Update Opportunity Stage → NURTURE CAMPAIGN` step.** Sum every Wait step on the path. (Observed runtime: ~24 days. Spec: 7 days.)
5. **Last Chance Nurture / Another Trial Booking — is there any terminal `Wait` + `Update Opportunity Stage` step at all?** (Expected: absent in both.)

- [ ] **Step 3: Record the trigger inventory for appointment workflows**

List every **published** workflow whose trigger fires on appointment booking. Known candidates: `Pre-Trial Reminders`, `**EDIT USER** Appt Confirmation + Reminder`, `BTM Appointment Confirmation`. For each, record its trigger and whether its calendar filter includes the five trial calendars (`GHL_CAL_TINY`, `GHL_CAL_LC1`, `GHL_CAL_LC2`, `GHL_CAL_JUNIORS`, `GHL_CAL_ADULTS`).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-31-workflow-audit-findings.md
git commit -m "docs(ghl): export and record actual config of the three suspect nurture workflows"
```

---

### Task 2: Eliminate the duplicate nurture enrollment

**Root cause:** `handleOptIn` (`src/lib/ghl-adapter.ts:194-196`) enrolls the contact in `WORKFLOW_ID_TRIAL_NURTURE` at opt-in. The workflow then waits ~24h and sets the opp stage to TRIAL NURTURE, which fires the workflow's own `Pipeline Stage Changed → TRIAL NURTURE` trigger, enrolling the contact a **second** time. The two runs proceed 24h out of phase — matching the 86 observed duplicate sends spaced ~24h apart.

**Critical:** Do **not** "fix" this by deleting the `addContactToWorkflow` call. The step that moves an opp into TRIAL NURTURE lives *inside* the workflow, so the explicit enroll is the only thing that bootstraps the funnel. Removing it strands every new lead in NEW LEAD forever.

**Files:**
- Modify: GHL UI — `Trial Nurture Campaign` workflow
- Modify: `config/ghl-schema.ts:546-551`

- [ ] **Step 1: Apply the fix indicated by Task 1**

Use the findings doc:

| Task 1 finding | Action |
|---|---|
| Q1 = yes **and** Q2 = yes (expected) | In the GHL workflow builder, delete the `Pipeline Stage Changed → TRIAL NURTURE` **trigger** from `Trial Nurture Campaign`. Keep the internal `Update Opportunity Stage → TRIAL NURTURE` action (it drives pipeline visibility). The website's `addContactToWorkflow` becomes the single enrollment path. |
| Q1 = yes, Q2 = no | The stage trigger is the only enrollment path and the code call is the duplicate. Delete lines 194–196 of `src/lib/ghl-adapter.ts` instead, and change `createOpp` at `src/lib/ghl-adapter.ts:182-189` to use `stageName: 'TRIAL NURTURE'` so leads still enter the funnel. |
| Q3 = "Allow Re-entry" disabled | Duplicates cannot come from this loop; stop and re-investigate before changing anything. Report to the user. |

- [ ] **Step 2: Correct the schema declaration to match reality**

In `config/ghl-schema.ts`, replace the `WORKFLOW_ID_TRIAL_NURTURE` entry's trigger (currently `{ type: 'opp_stage_changed', pipelineKey: 'LEAD_ACQ', enterStage: 'TRIAL NURTURE' }`):

```ts
  {
    envVarKey: 'WORKFLOW_ID_TRIAL_NURTURE',
    name: 'Trial Nurture Campaign',
    description:
      'Email/SMS sequence inviting NEW LEAD contacts to book their first trial. Runs for 7 days. ' +
      'ENROLLMENT IS EXPLICIT: the website calls addContactToWorkflow() in handleOptIn — this workflow ' +
      'MUST NOT also carry a "Pipeline Stage Changed → TRIAL NURTURE" trigger. It contains an internal ' +
      'Update Opportunity Stage → TRIAL NURTURE step, so a stage trigger would re-enroll the contact and ' +
      'send every message twice, 24h out of phase (root cause of the Jul 2026 booking collapse). ' +
      'Contact is removed from this workflow by the website on successful booking (see exitNurtureWorkflows).',
    trigger: { type: 'manual_enroll' },
    callsWebsiteWebhook: false,
  },
```

- [ ] **Step 3: Verify the schema still compiles and tests pass**

Run: `npm run check && npm test`
Expected: PASS. `config/ghl-schema.ts` has no test of its own; this guards against a type error in the `WorkflowTrigger` union.

- [ ] **Step 4: Probe with a live test lead**

Submit the homepage opt-in form using the honeypot-safe probe pattern documented in `docs/replication/ghl-api-integration-spec.md` (a real submission with an obvious test name, e.g. `DupeCheck Probe`). Then, 48 hours later, run:

```bash
npm run audit:messaging -- --contact="DupeCheck Probe"
```
(This script is built in Task 7 — if running Task 2 first, inspect the contact's conversation in the GHL UI instead.)

Expected: each nurture email/SMS appears **exactly once**. Before the fix, each appeared twice ~24h apart.

- [ ] **Step 5: Commit**

```bash
git add config/ghl-schema.ts
git commit -m "fix(ghl): stop double nurture enrollment - drop self-retriggering stage trigger

Trial Nurture Campaign both triggered on entry to TRIAL NURTURE and contained
an Update Opportunity Stage -> TRIAL NURTURE action, re-enrolling every lead and
sending the full sequence twice, 24h out of phase. Enrollment is now explicit-only
via handleOptIn. Schema updated to declare the invariant."
```

---

### Task 3: Retire the duplicate appointment-reminder workflow

**Root cause:** the leftover snapshot workflow `**EDIT USER** Appt Confirmation + Reminder` is still *published* alongside the purpose-built `Pre-Trial Reminders`. Both fire on appointment booking, producing the 111 observed duplicates spaced 0–2h apart (`"Make sure to bring water..."`, `"Gracie Barra Whittier is easy to find..."` sent twice within the hour).

**Files:**
- Modify: GHL UI — workflow publish states

- [ ] **Step 1: Confirm the overlap from Task 1 Step 3**

Open the findings doc's trigger inventory. Proceed only if `**EDIT USER** Appt Confirmation + Reminder` is published *and* its trigger covers any of the five trial calendars. If it does not overlap, stop — the 0–2h duplicates have another source; re-investigate and report.

- [ ] **Step 2: Unpublish the leftover workflow**

In the GHL workflow builder, set `**EDIT USER** Appt Confirmation + Reminder` to **Draft**. Do not delete it — draft preserves it for audit and is instantly reversible.

- [ ] **Step 3: Sweep the other 109 draft leftovers for published strays**

The account has 135 workflows, 110 draft and 25 published. Review the 25 published ones and confirm each is either (a) declared in `WORKFLOWS` in `config/ghl-schema.ts`, or (b) deliberately kept. Record any undeclared published workflow in the Task 1 findings doc under a new "Undeclared published workflows" heading. Known undeclared candidates to assess: `SMS/EMAIL DRIP` (updated 2026-07-02), `Opt in Message`, `New Active Student review campaign`, `Recipe - Review Request`.

Do **not** unpublish anything beyond `**EDIT USER** Appt Confirmation + Reminder` in this task — flag them and report to the user first. Several send live customer messaging.

- [ ] **Step 4: Verify with a test booking**

Book a trial through the website booking flow using an obvious test name. Inspect the contact's conversation in GHL.
Expected: exactly one confirmation SMS and one confirmation email. Before the fix, two of each arrived within ~1 hour.

- [ ] **Step 5: Commit the findings update**

```bash
git add docs/superpowers/specs/2026-07-31-workflow-audit-findings.md
git commit -m "docs(ghl): record undeclared published workflows; retire duplicate appt reminder"
```

---

### Task 4: Repair the stage auto-move timers

**Root cause:** `auto_move_after` is declared in `STAGE_TRANSITIONS` but implemented in **no code and no cron** — it exists only as Wait + Update Opportunity Stage steps inside the GHL workflows. Two of those tails are missing entirely and one is mistimed.

**Files:**
- Modify: GHL UI — three workflows

- [ ] **Step 1: Fix the Trial Nurture Campaign tail timing**

Spec (`config/ghl-schema.ts`, custom value `trial_nurture_to_nurture_campaign_days`) is **7 days**. Task 1 Q4 measured the actual cumulative wait (observed runtime: ~24 days, n=10).

In `Trial Nurture Campaign`, adjust the Wait steps preceding `Update Opportunity Stage → NURTURE CAMPAIGN` so the **cumulative** wait from enrollment to that step totals 7 days. If the message sequence itself spans longer than 7 days, shorten the message spacing to fit — do not leave the stage move trailing the messages.

Set the wait to read from the custom value where the builder allows it: `{{custom_values.trial_nurture_to_nurture_campaign_days}}`.

- [ ] **Step 2: Add the missing Last Chance Nurture tail**

Spec: `NURTURE CAMPAIGN → LOST / COLD` after `nurture_campaign_to_lost_days` (default **14 days**). Currently absent — zero `LEAD_ACQ` opps have ever reached LOST/COLD.

At the end of `Last Chance Nurture Campaign`, append:
1. `Wait` — 14 days (`{{custom_values.nurture_campaign_to_lost_days}}`)
2. `Update Opportunity Stage` → pipeline `Lead Acquisition`, stage `LOST / COLD`

Entering LOST/COLD fires the existing published `Quarterly Reactivation Tag` workflow, which applies the `quarterly-reactivation` tag. That is intended.

- [ ] **Step 3: Add the missing Another Trial Booking tail**

Spec: `CREDIT ACTIVE → REACTIVATION` after `credit_active_to_reactivation_days` (default **14 days**). Currently absent — 31 of 31 CREDIT ACTIVE opps are stale past this timer.

At the end of `Another Trial Booking Campaign`, append:
1. `Wait` — 14 days (`{{custom_values.credit_active_to_reactivation_days}}`)
2. `Update Opportunity Stage` → pipeline `Trial Credit Monitoring`, stage `REACTIVATION`

- [ ] **Step 4: Confirm each Wait step cancels on stage exit**

`config/ghl-schema.ts` documents the invariant: *"All `auto_move_*` actions cancel automatically if the opportunity exits the stage before the timer fires."* For each of the three tails, add a condition immediately before the `Update Opportunity Stage` step that checks the opp is still in the expected source stage, and ends the workflow otherwise. Without this, a lead who books on day 3 still gets dragged to LOST/COLD on day 14.

- [ ] **Step 5: Record the deviation**

Append to `docs/superpowers/specs/2026-07-31-workflow-audit-findings.md`:

```markdown
## Deviation from the Academy Launch templating goal

Stage auto-move timers are configured by hand inside three GHL workflows rather
than driven from `STAGE_TRANSITIONS` in code. They are therefore NOT reproducible
by `npm run onboard:ghl` and must be rebuilt manually for every new academy.
They already drifted once (Jul 2026: two tails missing, one set to ~24d instead
of 7d) with no alarm. `scripts/audit-messaging-health.ts` (Task 7) is the
compensating control. Durable fix: a cron-driven stage sweeper that enforces
STAGE_TRANSITIONS from code — deferred, not rejected.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-31-workflow-audit-findings.md
git commit -m "docs(ghl): repair stage auto-move tails; record templating deviation"
```

---

### Task 5: Catch inbound replies — staff alert and drip pause

**Root cause:** nothing reacts to an inbound message. 28 of 62 conversations with a reply (45%) got no response within 24h, including explicit booking intent (*"We can do 4pm on Tuesday, is there another link?"*) — while automation kept sending scheduled drip messages over them.

**Files:**
- Create: GHL UI — new workflow `[Ops] Inbound Reply → Pause Drips + Alert Staff`

- [ ] **Step 1: Create the workflow**

New workflow, name exactly: `[Ops] Inbound Reply → Pause Drips + Alert Staff`

**Trigger:** `Customer Replied` — channels SMS and Email. Set "Allow Re-entry" **enabled** so every reply re-fires it, not just the first.

- [ ] **Step 2: Add the drip-removal actions**

Add a `Remove From Workflow` action for each of the six nurture drips, matching the `exitNurtureWorkflows` list in `src/lib/ghl-adapter.ts:305-330` plus the two credit drips:

| Workflow to remove from | Env var |
|---|---|
| Trial Nurture Campaign | `WORKFLOW_ID_TRIAL_NURTURE` |
| Last Chance Nurture Campaign | `WORKFLOW_ID_NURTURE_CAMPAIGN` |
| Intro Class Rebooking Campaign | `WORKFLOW_ID_REBOOKING_CAMPAIGN` |
| Trial Inactive Reactivation Campaign | `WORKFLOW_ID_INACTIVE_REACTIVATION` |
| Another Trial Booking Campaign | `WORKFLOW_ID_ANOTHER_TRIAL_CAMPAIGN` |
| Trial Active Reactivation Campaign | `WORKFLOW_ID_CREDIT_REACTIVATION` |

Deliberately **not** removed: `Pre-Trial Reminders` and `BTM Appointment Confirmation`. Those are logistics for an appointment the customer has already booked; a reply must not cancel their class reminders.

- [ ] **Step 3: Add the tag and the staff alert**

1. `Add Tag` → `awaiting-human-reply`
2. `Internal Notification` → to the studio's notification user/email. Subject: `Reply from {{contact.first_name}} {{contact.last_name}}`. Body must include `{{message.body}}` and a direct link to the conversation.

- [ ] **Step 4: Register the new tag in the schema**

In `config/ghl-schema.ts`, add to the `TAGS` array:

```ts
  { name: 'awaiting-human-reply', description: 'Applied by [Ops] Inbound Reply → Pause Drips + Alert Staff when a contact replies. Marks contacts pulled out of automated drips and waiting on a human. Remove manually once answered.' },
```

- [ ] **Step 5: Publish and verify end-to-end**

Publish the workflow. From a test contact enrolled in `Trial Nurture Campaign`, send an inbound SMS reply. Confirm all four outcomes:
1. Staff notification received
2. `awaiting-human-reply` tag applied
3. Contact removed from `Trial Nurture Campaign` (check the contact's workflow enrollments)
4. Contact still enrolled in `Pre-Trial Reminders` if they had a booked appointment

- [ ] **Step 6: Commit**

```bash
git add config/ghl-schema.ts
git commit -m "feat(ghl): register awaiting-human-reply tag for inbound reply handling"
```

---

### Task 6: Build the stranded-opportunity rescue (pure logic + tests)

Splits the *decision* (pure, tested here) from the *mutation* (Task 7's CLI). Two distinct populations:

- **Overdue lead-acq opps → LOST/COLD.** 3 opps stuck in TRIAL NURTURE for 67–76 days, and 12 never-booked opps in NURTURE CAMPAIGN 18–49 days past due. Per spec they should have reached LOST/COLD by day 21. Moving them there is state correction and sends no drip.
- **Idle credit-pass holders → REACTIVATION.** 31 opps in CREDIT ACTIVE, all past their 14-day timer, 26 of them 31–60 days. These are warm students holding unused trial passes. Moving them to REACTIVATION fires the published `Trial Active Reactivation Campaign` — **this sends live SMS/email** and is the revenue play.

**Files:**
- Create: `src/lib/opp-rescue.ts`
- Create: `src/lib/opp-rescue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RescueOpp { id: string; contactId: string; stageName: string; createdAt: string; updatedAt: string; hasTrialConvOpp: boolean; }
  export interface RescueMove { oppId: string; contactId: string; fromStage: string; toStage: string; pipelineKey: 'LEAD_ACQ' | 'CREDIT_MON'; daysOverdue: number; sendsMessages: boolean; }
  export function selectOverdueLeadAcqOpps(opps: RescueOpp[], now: number): RescueMove[];
  export function selectIdleCreditOpps(opps: RescueOpp[], now: number): RescueMove[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/opp-rescue.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectOverdueLeadAcqOpps, selectIdleCreditOpps, type RescueOpp } from './opp-rescue';

const NOW = Date.parse('2026-07-30T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

function opp(over: Partial<RescueOpp>): RescueOpp {
  return {
    id: 'o1', contactId: 'c1', stageName: 'TRIAL NURTURE',
    createdAt: daysAgo(30), updatedAt: daysAgo(30), hasTrialConvOpp: false, ...over,
  };
}

describe('selectOverdueLeadAcqOpps', () => {
  it('moves a never-booked TRIAL NURTURE opp past day 21 to LOST / COLD', () => {
    const moves = selectOverdueLeadAcqOpps([opp({ createdAt: daysAgo(75), updatedAt: daysAgo(74) })], NOW);
    expect(moves).toHaveLength(1);
    expect(moves[0]!).toMatchObject({ toStage: 'LOST / COLD', pipelineKey: 'LEAD_ACQ', sendsMessages: false });
    expect(moves[0]!.daysOverdue).toBe(54); // 75 days old - 21 day spec deadline
  });

  it('moves a never-booked NURTURE CAMPAIGN opp past its 14d timer to LOST / COLD', () => {
    const moves = selectOverdueLeadAcqOpps(
      [opp({ stageName: 'NURTURE CAMPAIGN', createdAt: daysAgo(60), updatedAt: daysAgo(40) })], NOW);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.toStage).toBe('LOST / COLD');
    expect(moves[0]!.daysOverdue).toBe(26); // 40 days in stage - 14 day timer
  });

  it('leaves an opp that is still within its timer alone', () => {
    const moves = selectOverdueLeadAcqOpps(
      [opp({ stageName: 'NURTURE CAMPAIGN', createdAt: daysAgo(20), updatedAt: daysAgo(5) })], NOW);
    expect(moves).toEqual([]);
  });

  it('skips opps that were re-nurtured from Trial Conversion', () => {
    const moves = selectOverdueLeadAcqOpps(
      [opp({ stageName: 'NURTURE CAMPAIGN', updatedAt: daysAgo(40), hasTrialConvOpp: true })], NOW);
    expect(moves).toEqual([]);
  });

  it('ignores stages with no auto-move rule', () => {
    const moves = selectOverdueLeadAcqOpps([opp({ stageName: 'INTRO BOOKED (WON)', updatedAt: daysAgo(90) })], NOW);
    expect(moves).toEqual([]);
  });
});

describe('selectIdleCreditOpps', () => {
  it('moves a CREDIT ACTIVE opp past its 14d timer to REACTIVATION and flags it as messaging', () => {
    const moves = selectIdleCreditOpps([opp({ stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(45) })], NOW);
    expect(moves).toHaveLength(1);
    expect(moves[0]!).toMatchObject({ toStage: 'REACTIVATION', pipelineKey: 'CREDIT_MON', sendsMessages: true });
    expect(moves[0]!.daysOverdue).toBe(31);
  });

  it('leaves a CREDIT ACTIVE opp within its timer alone', () => {
    expect(selectIdleCreditOpps([opp({ stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(10) })], NOW)).toEqual([]);
  });

  it('ignores opps already past CREDIT ACTIVE', () => {
    expect(selectIdleCreditOpps([opp({ stageName: 'ANOTHER TRIAL BOOKED', updatedAt: daysAgo(90) })], NOW)).toEqual([]);
  });

  it('returns most-overdue first so batching rescues the coldest leads last', () => {
    const moves = selectIdleCreditOpps([
      opp({ id: 'a', stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(20) }),
      opp({ id: 'b', stageName: 'CREDIT ACTIVE', updatedAt: daysAgo(50) }),
    ], NOW);
    expect(moves.map((m) => m.oppId)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/opp-rescue.test.ts`
Expected: FAIL — `Failed to resolve import "./opp-rescue"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/opp-rescue.ts`:

```ts
/**
 * Selection logic for rescuing opportunities stranded by the Jul 2026 stage-timer
 * failure. Pure — no network I/O — so the "who moves where" decision is testable
 * before anything mutates a live account. Applied by scripts/rescue-stranded-opps.ts.
 *
 * Timer values mirror the CUSTOM_VALUES defaults in config/ghl-schema.ts.
 */

const DAY_MS = 86_400_000;

/** NEW LEAD (24h) + TRIAL NURTURE (7d) + NURTURE CAMPAIGN (14d) = 22d; use 21 as the practical deadline. */
const LEAD_ACQ_TERMINAL_DAYS = 21;
const NURTURE_CAMPAIGN_TO_LOST_DAYS = 14;
const CREDIT_ACTIVE_TO_REACTIVATION_DAYS = 14;

export interface RescueOpp {
  id: string;
  contactId: string;
  stageName: string;
  createdAt: string;
  updatedAt: string;
  /** True when this contact also has a Trial Conversion opp — i.e. they booked at least once. */
  hasTrialConvOpp: boolean;
}

export interface RescueMove {
  oppId: string;
  contactId: string;
  fromStage: string;
  toStage: string;
  pipelineKey: 'LEAD_ACQ' | 'CREDIT_MON';
  daysOverdue: number;
  /** True when entering toStage fires a workflow that messages the customer. */
  sendsMessages: boolean;
}

const daysBetween = (fromIso: string, now: number): number =>
  Math.round((now - Date.parse(fromIso)) / DAY_MS);

/**
 * Never-booked Lead Acquisition opps that blew past their terminal deadline.
 * Re-nurtured opps (contact has a Trial Conv opp) are excluded — their presence in
 * NURTURE CAMPAIGN is the intended result of the Trial Conv LOST/COLD cross-move,
 * and their clock legitimately restarted.
 */
export function selectOverdueLeadAcqOpps(opps: RescueOpp[], now: number): RescueMove[] {
  const moves: RescueMove[] = [];
  for (const o of opps) {
    if (o.hasTrialConvOpp) continue;

    let daysOverdue: number;
    if (o.stageName === 'TRIAL NURTURE') {
      daysOverdue = daysBetween(o.createdAt, now) - LEAD_ACQ_TERMINAL_DAYS;
    } else if (o.stageName === 'NURTURE CAMPAIGN') {
      daysOverdue = daysBetween(o.updatedAt, now) - NURTURE_CAMPAIGN_TO_LOST_DAYS;
    } else {
      continue;
    }
    if (daysOverdue <= 0) continue;

    moves.push({
      oppId: o.id,
      contactId: o.contactId,
      fromStage: o.stageName,
      toStage: 'LOST / COLD',
      pipelineKey: 'LEAD_ACQ',
      daysOverdue,
      sendsMessages: false,
    });
  }
  return moves.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/**
 * Trial-pass holders idle past the CREDIT ACTIVE timer. Moving them to REACTIVATION
 * fires the published Trial Active Reactivation Campaign — this MESSAGES REAL CUSTOMERS.
 */
export function selectIdleCreditOpps(opps: RescueOpp[], now: number): RescueMove[] {
  const moves: RescueMove[] = [];
  for (const o of opps) {
    if (o.stageName !== 'CREDIT ACTIVE') continue;
    const daysOverdue = daysBetween(o.updatedAt, now) - CREDIT_ACTIVE_TO_REACTIVATION_DAYS;
    if (daysOverdue <= 0) continue;

    moves.push({
      oppId: o.id,
      contactId: o.contactId,
      fromStage: o.stageName,
      toStage: 'REACTIVATION',
      pipelineKey: 'CREDIT_MON',
      daysOverdue,
      sendsMessages: true,
    });
  }
  return moves.sort((a, b) => b.daysOverdue - a.daysOverdue);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/opp-rescue.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/opp-rescue.ts src/lib/opp-rescue.test.ts
git commit -m "feat(rescue): pure selection logic for opportunities stranded by dead stage timers"
```

---

### Task 7: Build the messaging-health audit (pure logic + tests)

Makes all four failure modes detectable. Without it, the Task 4 UI fixes can silently drift again exactly as they did — this is the compensating control named in the deviation record.

**Files:**
- Create: `src/lib/messaging-audit.ts`
- Create: `src/lib/messaging-audit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AuditMessage { id: string; contactId: string; direction: 'inbound' | 'outbound'; messageType: string; body: string; status?: string; dateAdded: string; }
  export interface DuplicateSend { contactId: string; messageType: string; bodyPrefix: string; hoursApart: number; }
  export interface UnansweredReply { contactId: string; repliedAt: string; body: string; hoursWaiting: number; }
  export function detectDuplicateSends(messages: AuditMessage[], windowHours: number): DuplicateSend[];
  export function findUnansweredReplies(messages: AuditMessage[], slaHours: number, now: number): UnansweredReply[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/messaging-audit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectDuplicateSends, findUnansweredReplies, type AuditMessage } from './messaging-audit';

const NOW = Date.parse('2026-07-30T00:00:00Z');
const hoursAgo = (n: number) => new Date(NOW - n * 3600000).toISOString();

function msg(over: Partial<AuditMessage>): AuditMessage {
  return {
    id: 'm1', contactId: 'c1', direction: 'outbound', messageType: 'TYPE_SMS',
    body: 'Book your first class', status: 'delivered', dateAdded: hoursAgo(1), ...over,
  };
}

describe('detectDuplicateSends', () => {
  it('flags the same body sent twice to one contact inside the window', () => {
    const dupes = detectDuplicateSends([
      msg({ id: 'a', dateAdded: hoursAgo(48) }),
      msg({ id: 'b', dateAdded: hoursAgo(24) }),
    ], 72);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!).toMatchObject({ contactId: 'c1', hoursApart: 24 });
  });

  it('does not flag the same body sent outside the window', () => {
    expect(detectDuplicateSends([
      msg({ id: 'a', dateAdded: hoursAgo(200) }),
      msg({ id: 'b', dateAdded: hoursAgo(24) }),
    ], 72)).toEqual([]);
  });

  it('does not flag the same body sent to different contacts', () => {
    expect(detectDuplicateSends([
      msg({ id: 'a', contactId: 'c1' }),
      msg({ id: 'b', contactId: 'c2' }),
    ], 72)).toEqual([]);
  });

  it('does not flag inbound messages', () => {
    expect(detectDuplicateSends([
      msg({ id: 'a', direction: 'inbound' }),
      msg({ id: 'b', direction: 'inbound' }),
    ], 72)).toEqual([]);
  });

  it('treats SMS and email with identical text as distinct channels', () => {
    expect(detectDuplicateSends([
      msg({ id: 'a', messageType: 'TYPE_SMS' }),
      msg({ id: 'b', messageType: 'TYPE_EMAIL' }),
    ], 72)).toEqual([]);
  });
});

describe('findUnansweredReplies', () => {
  it('flags an inbound reply with no outbound response inside the SLA', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', body: 'Can we do 4pm?', dateAdded: hoursAgo(48) }),
    ], 24, NOW);
    expect(un).toHaveLength(1);
    expect(un[0]!).toMatchObject({ contactId: 'c1', body: 'Can we do 4pm?', hoursWaiting: 48 });
  });

  it('does not flag a reply that got an outbound response inside the SLA', () => {
    expect(findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', dateAdded: hoursAgo(48) }),
      msg({ id: 'b', direction: 'outbound', dateAdded: hoursAgo(40) }),
    ], 24, NOW)).toEqual([]);
  });

  it('flags when the only outbound response arrives after the SLA', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', dateAdded: hoursAgo(96) }),
      msg({ id: 'b', direction: 'outbound', dateAdded: hoursAgo(40) }),
    ], 24, NOW);
    expect(un).toHaveLength(1);
  });

  it('does not flag a reply still inside its SLA window', () => {
    expect(findUnansweredReplies([
      msg({ id: 'a', direction: 'inbound', dateAdded: hoursAgo(3) }),
    ], 24, NOW)).toEqual([]);
  });

  it('judges each contact independently', () => {
    const un = findUnansweredReplies([
      msg({ id: 'a', contactId: 'c1', direction: 'inbound', dateAdded: hoursAgo(48) }),
      msg({ id: 'b', contactId: 'c2', direction: 'inbound', dateAdded: hoursAgo(48) }),
      msg({ id: 'c', contactId: 'c2', direction: 'outbound', dateAdded: hoursAgo(47) }),
    ], 24, NOW);
    expect(un.map((u) => u.contactId)).toEqual(['c1']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/messaging-audit.test.ts`
Expected: FAIL — `Failed to resolve import "./messaging-audit"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/messaging-audit.ts`:

```ts
/**
 * Detection logic for the four failure modes behind the Jul 2026 booking collapse:
 * duplicate sends, unanswered replies, and (via opp-rescue.ts) stalled stage timers.
 *
 * Pure — no network I/O — so it is unit-testable. scripts/audit-messaging-health.ts
 * supplies the GHL data. This is the compensating control for stage timers being
 * hand-configured in the GHL UI rather than driven from STAGE_TRANSITIONS.
 */

const HOUR_MS = 3_600_000;
/** Bodies are compared on a prefix — merge tags make full-body equality useless. */
const BODY_PREFIX_LEN = 60;

export interface AuditMessage {
  id: string;
  contactId: string;
  direction: 'inbound' | 'outbound';
  messageType: string;
  body: string;
  status?: string;
  dateAdded: string;
}

export interface DuplicateSend {
  contactId: string;
  messageType: string;
  bodyPrefix: string;
  hoursApart: number;
}

export interface UnansweredReply {
  contactId: string;
  repliedAt: string;
  body: string;
  hoursWaiting: number;
}

const normalise = (body: string): string =>
  body.replace(/\s+/g, ' ').trim().slice(0, BODY_PREFIX_LEN);

/** Same channel + same body prefix + same contact, sent twice within windowHours. */
export function detectDuplicateSends(messages: AuditMessage[], windowHours: number): DuplicateSend[] {
  const out: DuplicateSend[] = [];
  const lastSeen = new Map<string, number>();

  const ordered = messages
    .filter((m) => m.direction === 'outbound')
    .slice()
    .sort((a, b) => Date.parse(a.dateAdded) - Date.parse(b.dateAdded));

  for (const m of ordered) {
    const prefix = normalise(m.body);
    const key = `${m.contactId}|${m.messageType}|${prefix}`;
    const prev = lastSeen.get(key);
    const at = Date.parse(m.dateAdded);
    if (prev !== undefined) {
      const hoursApart = Math.round((at - prev) / HOUR_MS);
      if (hoursApart <= windowHours) {
        out.push({ contactId: m.contactId, messageType: m.messageType, bodyPrefix: prefix, hoursApart });
      }
    }
    lastSeen.set(key, at);
  }
  return out;
}

/**
 * A contact's most recent inbound message that received no outbound reply within
 * slaHours. Replies still inside their SLA window are not yet late and are skipped.
 */
export function findUnansweredReplies(
  messages: AuditMessage[],
  slaHours: number,
  now: number,
): UnansweredReply[] {
  const byContact = new Map<string, AuditMessage[]>();
  for (const m of messages) {
    const list = byContact.get(m.contactId);
    if (list) list.push(m);
    else byContact.set(m.contactId, [m]);
  }

  const out: UnansweredReply[] = [];
  for (const [contactId, list] of byContact) {
    const ordered = list.slice().sort((a, b) => Date.parse(a.dateAdded) - Date.parse(b.dateAdded));
    const lastInbound = [...ordered].reverse().find((m) => m.direction === 'inbound');
    if (!lastInbound) continue;

    const repliedAt = Date.parse(lastInbound.dateAdded);
    const hoursWaiting = Math.round((now - repliedAt) / HOUR_MS);
    if (hoursWaiting < slaHours) continue;

    const answered = ordered.some(
      (m) =>
        m.direction === 'outbound' &&
        Date.parse(m.dateAdded) > repliedAt &&
        Date.parse(m.dateAdded) - repliedAt <= slaHours * HOUR_MS,
    );
    if (answered) continue;

    out.push({ contactId, repliedAt: lastInbound.dateAdded, body: lastInbound.body, hoursWaiting });
  }
  return out.sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/messaging-audit.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/messaging-audit.ts src/lib/messaging-audit.test.ts
git commit -m "feat(audit): duplicate-send and unanswered-reply detection logic"
```

---

### Task 8: Wire up the audit and rescue CLIs

**Files:**
- Create: `scripts/audit-messaging-health.ts`
- Create: `scripts/rescue-stranded-opps.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `selectOverdueLeadAcqOpps`, `selectIdleCreditOpps` from `src/lib/opp-rescue.ts`; `detectDuplicateSends`, `findUnansweredReplies` from `src/lib/messaging-audit.ts`.

- [ ] **Step 1: Write the audit CLI**

Create `scripts/audit-messaging-health.ts`. Follow the shape of `scripts/backfill-lead-acq-renurture.ts` (shebang, `dotenv`, local `ghl<T>()` helper, `GHL_BASE`, `VERSION`). Read-only — no `--apply` flag.

It must:
1. Fetch pipelines via `GET /opportunities/pipelines?locationId=<loc>` and build a `stageId → stageName` map.
2. Fetch all opps for `PIPELINE_ID_LEAD_ACQ`, `PIPELINE_ID_TRIAL_CONV`, `PIPELINE_ID_CREDIT_MON` via `GET /opportunities/search` with `location_id`, `pipeline_id`, `limit=100`, `page`, and **`status=all`**.
3. Fetch the 100 most recent conversations via `GET /conversations/search?locationId=<loc>&limit=100&sortBy=last_message_date&sort=desc`, then each one's messages via `GET /conversations/{id}/messages?limit=100`.
4. Map GHL messages to `AuditMessage` (keep only `TYPE_SMS` and `TYPE_EMAIL`) and report:
   - `detectDuplicateSends(messages, 72)` — count, affected-contact count, and the offset distribution bucketed as `0-2h` / `~24h` / `~48h` / `50-72h`
   - `findUnansweredReplies(messages, 24, Date.now())` — count and the 20 longest-waiting
   - `selectOverdueLeadAcqOpps` / `selectIdleCreditOpps` counts as the stage-timer health check
   - Weekly outbound SMS/email volume, SMS failure rate, and inbound reply count
5. Exit non-zero if duplicates > 0 **or** overdue opps > 0, so it can gate CI or a cron later.

Build the `RescueOpp.hasTrialConvOpp` flag by collecting the set of `contactId`s that have any `TRIAL_CONV` opp.

- [ ] **Step 2: Run the audit against production and confirm it reproduces the baseline**

Run: `npx tsx scripts/audit-messaging-health.ts`
Expected: numbers materially matching the Baseline Measurements table above (duplicates across ~33% of sampled contacts; ~45% unanswered replies; 31 idle credit opps; 15 overdue lead-acq opps). If the duplicate and unanswered counts come back near zero, the script is wrong — not the account. Debug before continuing.

- [ ] **Step 3: Write the rescue CLI**

Create `scripts/rescue-stranded-opps.ts`, same conventions. Flags:

| Flag | Effect |
|---|---|
| *(none)* | Dry-run. Print every planned move; mutate nothing. |
| `--scope=leads` | Overdue Lead Acq opps → LOST/COLD only (**sends no messages**). Default scope. |
| `--scope=credits` | Idle CREDIT ACTIVE opps → REACTIVATION (**sends live SMS/email**). |
| `--apply` | Actually perform the moves. |
| `--confirm` | Additionally required whenever any selected move has `sendsMessages: true`. |
| `--limit=N` | Cap moves this run (default 10 for `credits`, unlimited for `leads`). |

Rules:
- Abort with a clear error if `--scope=credits --apply` is passed without `--confirm`.
- Move via `PUT /opportunities/{id}` with `{ pipelineId, pipelineStageId, status: 'open' }`. Resolve stage IDs by name from the pipelines endpoint — never hardcode IDs (schema reproducibility contract).
- Print a one-line summary per move: `oppId  fromStage → toStage  (Nd overdue)`.
- For `credits`, insert a 2-second delay between moves so 31 reactivation drips do not start in the same second.

- [ ] **Step 4: Dry-run both scopes**

```bash
npx tsx scripts/rescue-stranded-opps.ts --scope=leads
npx tsx scripts/rescue-stranded-opps.ts --scope=credits
```
Expected: ~15 lead moves to LOST/COLD, ~31 credit moves to REACTIVATION. Nothing mutated.

- [ ] **Step 5: Add the npm scripts**

In `package.json`, add to `scripts`:

```json
    "audit:messaging": "tsx scripts/audit-messaging-health.ts",
    "rescue:opps": "tsx scripts/rescue-stranded-opps.ts",
```

- [ ] **Step 6: Verify the full suite still passes**

Run: `npm test && npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/audit-messaging-health.ts scripts/rescue-stranded-opps.ts package.json
git commit -m "feat(ops): messaging-health audit + stranded-opportunity rescue CLIs"
```

---

### Task 9: Execute the rescue against production

**Gated on Tasks 2–5 being live.** Rescuing opps before the duplicate-send and timer fixes ship would push 31 warm customers into a still-doubled drip.

**Files:** none — operational.

- [ ] **Step 1: Confirm the prerequisites are live**

Verify all four before proceeding:
1. Task 2 — `Trial Nurture Campaign` has no stage trigger
2. Task 3 — `**EDIT USER** Appt Confirmation + Reminder` is in Draft
3. Task 4 — all three Wait+UpdateStage tails present and correctly timed
4. Task 5 — `[Ops] Inbound Reply → Pause Drips + Alert Staff` is published

If any is incomplete, stop.

- [ ] **Step 2: Rescue the overdue leads (sends no messages)**

```bash
npm run rescue:opps -- --scope=leads --apply
```
Expected: ~15 opps move to LOST/COLD. Re-run `npm run audit:messaging` and confirm `LEAD_ACQ` LOST/COLD is no longer 0.

- [ ] **Step 3: Report to the user before the messaging step**

Step 4 sends live SMS and email to ~31 real customers. Present the dry-run output and get explicit go-ahead. Do not proceed on assumed approval.

- [ ] **Step 4: Rescue the idle trial-pass holders in batches**

```bash
npm run rescue:opps -- --scope=credits --apply --confirm --limit=10
```
Run one batch of 10. Wait 24 hours. Check `npm run audit:messaging` for reply volume and any spike in SMS failures or opt-outs (`STOP` replies). If healthy, run the next batch until all ~31 are moved.

- [ ] **Step 5: Record the outcome**

Append the post-rescue numbers to `docs/superpowers/specs/2026-07-31-workflow-audit-findings.md` under a "Rescue outcome" heading: opps moved, replies received, bookings generated, opt-outs.

---

### Task 10: Documentation and session close-out

**Files:**
- Modify: `docs/replication/ghl-workflow-build-from-scratch.md`
- Modify: `docs/replication/ghl-onboarding-runbook.md`
- Modify: `C:\Users\herna\Downloads\Work\Zedric Workspace\04 Knowledge\AI Memory\Lessons Learned.md`
- Modify: `C:\Users\herna\Downloads\Work\Zedric Workspace\03 Dev\Web Apps\GBW Website.md`

- [ ] **Step 1: Document the single-enrollment invariant**

In `docs/replication/ghl-workflow-build-from-scratch.md`, add a section **"Enrollment must have exactly one path"**: a workflow that contains an `Update Opportunity Stage → X` action must **not** also carry a `Pipeline Stage Changed → X` trigger, or it re-enrolls every contact and doubles every message. Name `Trial Nurture Campaign` as the instance that failed this way in Jul 2026.

- [ ] **Step 2: Document the required stage-timer tails**

In the same file, add a table of every `auto_move_after` in `STAGE_TRANSITIONS` alongside the workflow that must implement it, its Wait duration, its custom-value merge tag, and the required still-in-stage guard condition. Cover all three repaired in Task 4 plus the remaining declared timers (`rebooking_to_inactive_days`, `inactive_reactivation_to_lost_days`, `credit_reactivation_to_lost_days`) — those were not verified in this investigation and may be missing too.

- [ ] **Step 3: Add the post-launch health check to the runbook**

In `docs/replication/ghl-onboarding-runbook.md`, add a step: run `npm run audit:messaging` 7 and 30 days after launch. Non-zero exit means duplicate sends or stalled timers. Note the known limitation that timers live in the GHL UI and are not provisioned by `npm run onboard:ghl`.

- [ ] **Step 4: Append the lesson (required by CLAUDE.md)**

Append to `Lessons Learned.md`:

```markdown
## 2026-07-31 · GBW Website · Booking collapse traced to doubled drips, not dead follow-ups

Open appointments fell 37 (Jun 15) → 4 (Jul 30). Lead volume was FLAT and outbound
messaging was at full volume the whole time — the instinct that "follow-ups aren't
going through" was wrong in a costly way. They were going through TWICE, over 3x the
intended duration, and 45% of the people who replied got no answer.

Causes: (1) Trial Nurture Campaign both triggered on entry to TRIAL NURTURE and
contained an Update Opportunity Stage → TRIAL NURTURE action, re-enrolling every
lead; (2) a leftover snapshot workflow was still published alongside Pre-Trial
Reminders; (3) two of three stage auto-move tails were never built and the third
was set to ~24d instead of 7d; (4) nothing reacted to inbound replies.

Cost: roughly six weeks of declining bookings, ~31 trial-pass holders left idle,
and an unknown number of lost bookings from ignored replies.

Rule: separate LEAD VOLUME from CONVERSION before diagnosing any funnel drop —
they have opposite fixes. "Upcoming appointments" is a lagging metric (median
booking lead time here is 5.2 days), so it collapses ~2 weeks after the real
breakage. Declaring a timer in STAGE_TRANSITIONS does not implement it: if no code
and no cron reads it, it exists only as a hand-built Wait step someone can omit.
Ship a detector alongside any config that lives outside version control.
```

- [ ] **Step 5: Add the changelog line (required by CLAUDE.md)**

Under `## 📝 Changelog` in the vault tracker `GBW Website.md`:

```markdown
- 2026-07-31 — Diagnosed and remediated the booking collapse (37 → 4 open appointments). Fixed duplicate nurture enrollment, retired a stray published reminder workflow, repaired three stage auto-move timers, added inbound-reply alerting, and rescued ~15 stranded leads + ~31 idle trial-pass holders. Added `npm run audit:messaging` as the ongoing detector.
```

- [ ] **Step 6: Commit**

```bash
git add docs/replication/ghl-workflow-build-from-scratch.md docs/replication/ghl-onboarding-runbook.md
git commit -m "docs(replication): single-enrollment invariant, stage-timer tails, post-launch health check"
```

---

---

## Follow-ups discovered during implementation (Tasks 6–8, 2026-07-31)

Both are real limitations of the delivered detector. Neither blocks merging the branch or running Task 9; **both block Task 10 Step 3** (wiring `audit:messaging` into a recurring check) and both bound how much the detector can be trusted.

### FU-1: the audit exits non-zero on every run, so it cannot be a cron gate yet

Task 8 correctly made the script declare `INCOMPLETE` and exit non-zero whenever it could not read all the data. This account has more than 100 conversations, so the `limit=100` conversation cap trips on **every** run and the INCOMPLETE banner short-circuits before any verdict.

That is right for correctness — a detector must never report PASS on data it did not read — but it recreates the exact failure the review was guarding against: a permanently-red alarm gets ignored, which is how this outage went unnoticed for six weeks.

**Fix before Task 10 Step 3:** implement real pagination for `GET /conversations/search` (and per-conversation `GET /conversations/{id}/messages`, which caps at 100 and whose `nextPage` is currently only detected, not followed). Keep the `degraded` machinery — it should stay as the guard for genuinely unreadable data, not fire on ordinary volume.

### FU-2: the detector is effectively SMS-only

`GET /conversations/{id}/messages` omits the `direction` field on most email records. Measured live on 2026-07-31 across 25 conversations: **462 of 653 `TYPE_EMAIL` messages (71%) had no `direction`**, plus all 10 `TYPE_CAMPAIGN_EMAIL`. `TYPE_SMS` was unaffected (0 missing). The audit drops any message without a direction, so email duplicates and unanswered emails are invisible to it.

Consequences, both of which understate the problem:
- The **233 duplicate sends / 33 contacts** baseline is largely SMS-only. The true duplicate load is higher — the nurture drip sends email *and* SMS, and the investigation observed both being doubled.
- Unanswered-reply detection sees SMS replies but not email replies.

**Fix:** infer direction for email records from another field on the message payload (investigate what GHL does return — e.g. a `from`/`to` address compared against the location's sending address, or the `status` field's presence). This is a behaviour change that will move the baseline numbers, so re-measure and restate the Definition of Done targets after it lands. Do not treat the pre-fix and post-fix duplicate counts as comparable.

---

## Verification: Definition of Done

Re-run `npm run audit:messaging` 14 days after Task 9 completes and compare against the baseline:

| Metric | Baseline | Target |
|---|---|---|
| Contacts receiving duplicate sends | 33% | **0%** |
| Duplicate send events | 233 | **0** |
| Replies unanswered >24h | 45% | **<10%** |
| `LEAD_ACQ` opps in LOST/COLD | 0 | **>0 and growing** |
| `CREDIT_MON` opps in REACTIVATION | 0 | **>0** |
| `CREDIT ACTIVE` opps past their 14d timer | 31 | **0** |
| Outbound messages per contact per week | ~2× intended | **1× intended** |
| Inbound replies/week | 4 | **rising** |
| Lead→booking conversion | 13% | **back toward 50–83%** |
| Open appointments on the books | 4 | **15–30** |

The last two are lagging — booking lead time is a 5.2-day median, so allow a full 14 days after the fixes before judging them.
