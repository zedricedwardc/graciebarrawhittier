# Workflow Audit Findings — Task 1 Output

**Captured:** 2026-07-31, location `eMHOrbrPAfFd2S1ORNKL` (Gracie Barra Whittier)
**Method:** read-only GETs against `backend.leadconnectorhq.com` workflow-builder internals, using an iframe-scoped JWT. All 25 published workflows swept: triggers, step graphs, cumulative waits, and opportunity-stage writes.
**Raw capture:** `workflow-json/eMHOrbrPAfFd2S1ORNKL/13a7c569-885f-4d50-a9ce-0a8583115197/` (workflow.json, trigger.json, workflow-steps.json)

> **Read this before acting on the plan.** The sweep confirmed the duplicate-enrollment mechanism but **refuted three assumptions** the plan was built on. Tasks 2, 3 and 4 change as a result. This is why Task 1 was a gate.

---

## Confirmed structure

### Q1 — Does `Trial Nurture Campaign` have a `Pipeline Stage Changed → TRIAL NURTURE` trigger? **YES**

```
name:       "Lead Acq → Trial Nurture entered"
type:       pipeline_stage_updated
active:     true
conditions: opportunity.pipelineId      == iCvmuak82CNxovJfbWs8   (Lead Acquisition)
            opportunity.pipelineStageId == 754647c6-…             (TRIAL NURTURE)
action:     add_to_workflow -> 13a7c569-… (itself)
```

### Q2 — Does it contain an `Update Opportunity Stage → TRIAL NURTURE` action? **NO — assumption refuted**

`Trial Nurture Campaign` has exactly one opportunity write, the final step (`order 16`, `internal_update_opportunity`, named "Move Pipeline"), and it targets **NURTURE CAMPAIGN** (`abf6c87c-…`), not TRIAL NURTURE.

**The NEW LEAD → TRIAL NURTURE move is performed by a different workflow: `Opt in Message`.**

```
Opt in Message   [reentry=true, 5 steps, total wait 1d]
  TRIGGER pipeline_stage_updated @ Lead Acquisition / NEW LEAD
  WRITE   day 1 -> Lead Acquisition / TRIAL NURTURE
```

### Q3 — "Allow Re-entry" on `Trial Nurture Campaign`? **ENABLED** (`allowMultiple: true`)

### The actual duplicate-enrollment mechanism (confirmed end-to-end)

| # | What happens | Result |
|---|---|---|
| 1 | Website `handleOptIn` creates the Lead Acq opp in **NEW LEAD** | fires `Opt in Message` |
| 2 | Website *also* calls `addContactToWorkflow(WORKFLOW_ID_TRIAL_NURTURE)` — `src/lib/ghl-adapter.ts:194-196` | **Trial Nurture run #1 starts, day 0** |
| 3 | `Opt in Message` waits 1 day, then moves the opp to **TRIAL NURTURE** | fires the Q1 trigger |
| 4 | Trigger enrols the contact again; `allowMultiple: true` permits it | **Trial Nurture run #2 starts, day 1** |
| 5 | Both runs proceed independently, 24h out of phase | **every email + SMS sent twice, ~24h apart** |

This matches the observed 86 duplicate sends spaced ~24h apart exactly.

### Q4 — Cumulative wait before `Update Opportunity Stage → NURTURE CAMPAIGN`? **23.00 days** (spec: 7)

| ord | step | cumulative |
|---|---|---|
| 1 | Wait 1 day | 1.00 |
| 4 | Wait 3 days | 4.00 |
| 6 | Wait 3 days | 7.00 |
| 9 | Wait 7 days | 14.00 |
| 12 | Wait 7 days | 21.00 |
| 15 | Wait 2 days | 23.00 |
| 16 | **Move Pipeline → NURTURE CAMPAIGN** | **23.00** |

Behavioural measurement predicted ~24 days (23 in-workflow + the 1-day `Opt in Message` step). Confirmed.

### Q5 — Do `Last Chance Nurture` / `Another Trial Booking` have terminal Wait + Update Stage steps? **YES — assumption refuted**

Both tails **exist**. They are not missing; they are set 3–4× too long, so almost no contact has survived long enough to reach them. The campaign only began mid-May, which is why the terminal stages read as permanently empty.

| Workflow | Terminal write | Configured | Spec (`CUSTOM_VALUES`) | Overshoot |
|---|---|---|---|---|
| Trial Nurture Campaign | → Lead Acq / NURTURE CAMPAIGN | **23 d** | 7 d | 3.3× |
| Last Chance Nurture Campaign | → Lead Acq / LOST / COLD | **51 d** | 14 d | 3.6× |
| Another Trial Booking Campaign | → Credit Mon / REACTIVATION | **57 d** | 14 d | 4.1× |
| Trial Active Reactivation Campaign | → Credit Mon / LOST | 14 d | 21 d | under by 7 d |

A lead therefore takes **1 + 23 + 51 = 75 days** to reach LOST/COLD instead of the specified 22 — while being messaged in duplicate the whole way.

---

## Additional defects found by the sweep (not in the original plan)

**D1 — `Trial Inactive Reactivation Campaign` is orphaned.** 13 steps, writes `Trial Conversion / LOST / COLD` at day 51, but has **no trigger at all**. It can never run. `WORKFLOW_ID_INACTIVE_REACTIVATION` is declared in `config/ghl-schema.ts` as firing on `TRIAL_CONV → TRIAL INACTIVE REACTIVATION`; that trigger does not exist.

**D2 — `Intro Class Rebooking Campaign` skips a stage.** Triggered on `Trial Conversion / NO-SHOW`, it writes `INTRO CLASS REBOOKING` at day 0 and then jumps straight to `LOST / COLD` at day 13 — bypassing `TRIAL INACTIVE REACTIVATION` entirely. Combined with D1, the TRIAL INACTIVE REACTIVATION stage is unreachable, which is why it holds zero opportunities.

**D3 — `Student Enrolled` writes an unresolvable stage.** Its day-0 opportunity write has an `undefined` stage id.

**D4 — `BTM Re-Booking Campaign (no-show)` writes a stage id that resolves to nothing:** `81d64f43-9ef5-4bd5-a9a2-912aefdf1d8b` is not present in any current pipeline — likely a deleted stage.

**D5 — three published workflows have no triggers and can never fire:** `SMS/EMAIL DRIP` (45 steps), `New Active Student review campaign` (46 steps), and `**EDIT USER** Appt Confirmation + Reminder` (33 steps).

---

## Q-extra — the appointment-reminder duplicates: original hypothesis **refuted**

The plan assumed `**EDIT USER** Appt Confirmation + Reminder` was firing alongside `Pre-Trial Reminders`. **It has no triggers** (D5) and therefore never runs. It is not the cause.

The real cause is `Pre-Trial Reminders` itself:

```
Pre-Trial Reminders   [reentry=true, 38 steps]
  TRIGGER customer_appointment
  WRITE   day 0.01 -> Trial Conversion / TRIAL APPOINTMENT DONE
```

`allowMultiple: true` on an appointment trigger means **one enrolment per appointment booked**. A parent booking three sessions in one sitting (observed: "Rhett" — 3 appointments created within 1 minute) or two siblings booked together enrols the contact 2–3 times, producing confirmation/reminder duplicates minutes-to-hours apart. That matches the observed 0–2h duplicate cluster (111 events) and the specific samples (`Gavan Ibarra` 0h and 1h apart; `Luke Carrillo` 54h apart across two bookings).

### Published-workflow trigger inventory (appointment-triggered)

| Workflow | Trigger | Re-entry | Fires? |
|---|---|---|---|
| `Pre-Trial Reminders` | `customer_appointment` | **true** | yes — duplicate source |
| `BTM Appointment Confirmation` | `customer_appointment` | false | yes |
| `[Backflow] Bot Booking → Pipeline Orchestrator` | `customer_appointment` | — | yes |
| `[Backflow] Appointment status changed → website webhook` | `appointment` | — | yes |
| `**EDIT USER** Appt Confirmation + Reminder` | **none** | — | **never** |

---

## Consequences for the plan

| Task | Planned | Corrected by this audit |
|---|---|---|
| **2** | Remove the stage trigger from `Trial Nurture Campaign` (GHL UI) | **Remove the explicit `addContactToWorkflow` call** at `src/lib/ghl-adapter.ts:194-196` instead. `Opt in Message` already moves the opp into TRIAL NURTURE, so the trigger alone enrols exactly once — no deadlock. This is a **code** change, so it is templatable, unlike the UI route. |
| **3** | Unpublish `**EDIT USER** Appt Confirmation + Reminder` | Premise refuted — it has no triggers and never fires. Unpublishing it is harmless housekeeping but fixes nothing. **Real fix: set `allowMultiple: false` on `Pre-Trial Reminders`**, or add a de-dupe guard so multiple appointments booked together yield one reminder sequence. Needs care: a genuine rebook weeks later *should* re-enrol. |
| **4** | Add missing Wait + Update Stage tails | Tails already exist. **Correct their durations instead**: 23→7 d, 51→14 d, 57→14 d. Also fix D1 (add the missing trigger) and D2 (stop skipping TRIAL INACTIVE REACTIVATION). |
| **5** | Unchanged — no inbound-reply workflow exists | Confirmed: no published workflow triggers on `customer_reply` except `[Revival] Mark Revived Lead` (Revival-specific) and `[Inbound] Chat Widget → Pipeline Orchestrator`. The gap is real. |

## Deviation from the Academy Launch templating goal

Stage auto-move timers are configured by hand inside GHL workflows rather than driven from `STAGE_TRANSITIONS` in code. They are therefore NOT reproducible by `npm run onboard:ghl` and must be rebuilt manually for every new academy. They already drifted badly — every one of the four measured timers is wrong, by 3–4× in three cases — with no alarm. `scripts/audit-messaging-health.ts` is the compensating control. The durable fix is a cron-driven stage sweeper enforcing `STAGE_TRANSITIONS` from code: deferred, not rejected.
