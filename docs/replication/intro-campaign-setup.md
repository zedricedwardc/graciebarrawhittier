# Intro Campaign — GHL Setup Guide

End-to-end setup guide for the **first-trial funnel**: every contact who opts in through the website, books their first trial, attends, burns their 3-class pass, and either enrolls or goes cold.

## Who runs what

This setup has two roles. Don't try to do all of it in one seat — you'll get stuck.

| Role | What they do | Phases in §10 |
|---|---|---|
| **Developer** | Anything in a terminal: `git clone`, `npm install`, `npm run …`, `npx tsx scripts/…`, Vercel env-var paste, deploy. | A, B, D, E, F |
| **Studio admin** | GHL UI work: create pipelines, stages, workflows, set custom values, run the smoke test. | C, G |

If you only have an admin available, the developer phases can run once and be left alone — they're idempotent. The admin then does Phase C + G with the developer on standby for env-var pastes.

**The exact names you'll need to type in GHL are all in code blocks throughout this doc. Paste them; don't retype.** Schema-matched names are case-sensitive, and hyphens, spaces, and slashes around words like `LOST / COLD` and `NO-SHOW` are literal.

## Story (read first)

A prospect fills out an opt-in form on the website. Over the next week we email them to book a trial class. They book; we send reminders; they show up. The admin marks them attended. The website grants them a 3-class pass. Over the next two weeks we invite them back to use their pass. They either enroll (win) or fall off (loss). Every step lives as a stage in one of three GHL pipelines, and each pipeline has its own set of workflows pushing the customer along. This doc explains how to wire each of those pieces.

## Concepts you need to know first

- **Opportunity (opp)**: one row in a pipeline. Has a stage, a status (`open`/`won`/`lost`/`abandoned`), a contact, and custom fields.
- **Pipeline**: an ordered set of stages. NOT API-creatable — you make these by hand in the GHL UI.
- **Stage**: a position within a pipeline. Opps move between stages either by user action or by a workflow.
- **Workflow**: a sequence of steps (Send Email / Send SMS / Wait / Update Opportunity Stage / Custom Webhook / Find Opportunity) triggered by an event. UI-only.
- **Custom Value**: account-wide global (e.g. `academy_name`). Referenced in workflows as `{{custom_values.field_key}}`.
- **Custom Field**: per-record field on a Contact or Opportunity. Referenced as `{{contact.field_key}}` or `{{opportunity.field_key}}`.
- **Merge tag**: `{{…}}` placeholder evaluated at workflow execution time. Examples: `{{contact.first_name}}`, `{{appointment.start_time}}`, `{{opportunity.id}}`.

Full glossary at §15.

> **Source of truth:** [`config/ghl-schema.ts`](../../config/ghl-schema.ts). The website resolves pipelines, stages, and custom fields by **name** at runtime, so anything you create in GHL must match this doc exactly. If you ever need to double-check a name, that file is canonical — but every name you need to type appears in this doc inside a code block.

> **Your safety net is** `GET /api/health/ghl?key=<HEALTH_KEY>` — a single endpoint that compares the live GHL state to the schema and reports drift. Bookmark the URL after deploy. Run it after every change. If it returns `{ ok: true, drift: [] }`, you're aligned.

---

## 1. Overview

The Intro Campaign tracks a lead from first opt-in to enrolled member, spread across three pipelines:

| Pipeline | Who's in it | Granularity | Closes when |
|---|---|---|---|
| **Lead Acquisition** | Anyone who opted in via the website | One opp per **parent contact** | Trial booked (won) or 21+ days idle (lost) |
| **Trial Conversion** | Anyone who booked a trial | One opp per **booked trial / trainee** (keyed by `trainee_key`) | Enrolled (won) or trial gone cold (lost) |
| **Trial Credit Monitoring** | Anyone whose admin has activated their 3-class pass | One opp per **trainee** | Pass exhausted + enrolled (won), or pass abandoned (lost) |

### Customer journey at each stage

| Stage of life | Where the customer is | What the website does | What GHL does |
|---|---|---|---|
| Lands on site | Browsing pages | — | — |
| Submits opt-in form | Just gave email/phone | `POST /api/optin` → upsert contact, create LEAD_ACQ opp at NEW LEAD, fire `Trial Nurture Campaign` workflow | Sends nurture emails/SMS over 7 days |
| Submits `/kickstart` booking | Picked a slot | `POST /api/book` → create appointment, create TRIAL_CONV opp at INTRO BOOKED, move LEAD_ACQ to INTRO BOOKED (WON), exit nurture | Sends `Pre-Trial Reminders` (3d / 1d / 2h) |
| Shows up to class | At the academy | — | Admin moves TRIAL_CONV opp to `TRIAL ACTIVE NURTURE` |
| Trial active nurture stage entered | Has a class pass | `POST /api/webhooks/ghl/stage-changed` → `handleAttendance` creates CREDIT_MON opp at CREDIT ACTIVE, sets `credits_remaining = 3`, mints `rebook_link_token` | Sends `Another Trial Booking Campaign` with magic /rebook link |
| Re-books via /rebook page | Wants another class on the pass | `POST /api/book` (rebook branch) → create appointment, move CREDIT_MON opp to ANOTHER TRIAL BOOKED | Fires `Pre-Trial Reminders` again (rebook branch) |
| Admin marks ATTENDED APPOINTMENT | Just attended | `POST /api/webhooks/ghl/credit-stage-changed` → `handleCreditDecrement` decrements credits, conditionally moves opp to CREDIT ACTIVE or CREDITS EXHAUSTED | — |
| Enrolled | Signed up for membership | Admin moves TRIAL_CONV to STUDENT ENROLLED (WON); webhook closes matching CREDIT_MON opp as WON | Sends `90-Day Review Campaign` |

The Back to the Mats campaign is a **separate funnel** for former students — see [`btm-campaign-setup.md`](./btm-campaign-setup.md). It does not interact with this funnel.

---

## 2. Architecture

```
                                    ┌────────────────────────────────────┐
   Opt-in form ──────► [LEAD_ACQ]   │  Lead Acquisition (parent contact) │
                          │         │                                    │
                          │ 24h     │  NEW LEAD                          │
                          ▼         │     │ 24h timer                    │
                       TRIAL        │  TRIAL NURTURE     ◄── workflow    │
                       NURTURE      │     │ 7d timer                     │
                          │         │  NURTURE CAMPAIGN  ◄── workflow    │
                          │ 7d      │     │ 14d timer                    │
                          ▼         │  LOST / COLD       ◄── + tag       │
                       NURTURE      │                                    │
                       CAMPAIGN     │  Book ─► INTRO BOOKED (WON)        │
                          │         └────────────────────────────────────┘
                          ▼
                       LOST/COLD
                                    ┌────────────────────────────────────┐
   /kickstart book ───► [TRIAL_CONV]│  Trial Conversion (per-trainee)    │
                                    │                                    │
                                    │  INTRO BOOKED ◄── /api/book        │
                                    │     │ auto @ appt end              │
                                    │  TRIAL APPOINTMENT DONE            │
                                    │     │ admin classifies             │
                                    │     ├─► NO-SHOW ─► REBOOKING ─► …  │
                                    │     ├─► TRIAL ACTIVE NURTURE       │
                                    │     │      │                       │
                                    │     │      ▼ creates ▼             │
                                    │     │  [CREDIT_MON]                │
                                    │     └─► STUDENT ENROLLED (WON)     │
                                    └────────────────────────────────────┘

                                    ┌────────────────────────────────────┐
   /rebook  ──────────► [CREDIT_MON]│  Trial Credit Monitoring (trainee) │
                                    │                                    │
                                    │  CREDIT ACTIVE  ◄── handleAttendance│
                                    │     │ /rebook book                 │
                                    │  ANOTHER TRIAL BOOKED              │
                                    │     │ auto @ 00:01 appt day        │
                                    │  APPOINTMENT TODAY                 │
                                    │     │ admin classifies             │
                                    │     ├─► NO-SHOW ──► CREDIT ACTIVE  │
                                    │     └─► ATTENDED APPOINTMENT       │
                                    │            │ decrement_credits     │
                                    │            ├─► CREDIT ACTIVE       │
                                    │            └─► CREDITS EXHAUSTED   │
                                    │  → REACTIVATION → LOST → (loop)    │
                                    │  → WON ENROLLED                    │
                                    └────────────────────────────────────┘
```

Every "auto" transition is implemented inside a **campaign workflow**'s tail (a Wait step followed by Update Opportunity Stage). There is no separate timer-only workflow.

---

## 3. Prerequisites

Before you start:

1. **GHL sub-account admin access** (Settings + Automation + Pipelines + Custom Fields write).
2. **GHL Private Integration Token (PIT)** with scopes:
   - `contacts.readonly`, `contacts.write`
   - `opportunities.readonly`, `opportunities.write`
   - `calendars.readonly`, `calendars/events.readonly`, `calendars/events.write`
   - `locations.readonly`
   - `workflows.readonly`
   - `conversations/message.write` (only if sending SMS programmatically)
3. **Local checkout of this repo** with `npm install` complete (developer task).
4. **Vercel project access** with write on env vars.
5. **`.env` populated** with at least `GHL_PIT_TOKEN`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`, `CANCEL_SIGNING_KEY`, `REBOOK_SIGNING_KEY`, `HEALTH_KEY`. Generate the secrets with `openssl rand -hex 32` (16 for `HEALTH_KEY`).
   > **Save `HEALTH_KEY` somewhere you can find it later** — a password manager, a sticky note, the team's secrets vault. You'll need it for every drift check during setup and forever after.
6. The **5 trial calendars** already exist in GHL (Tiny / LC1 / LC2 / Juniors / Adults). Live IDs are in [`docs/_audit/ghl-inventory-2026-05-15.txt`](_audit/ghl-inventory-2026-05-15.txt).
7. **(Optional) An SMS bot** configured in GHL Conversations AI is required for the `[Backflow] Bot Booking → Pipeline Orchestrator` workflow (§7.13). If you don't have one, skip §7.13 — trial bookings still work through the website's `/api/book` endpoint.

### 3.1 Logging in to GHL

Studio admins start here:

1. Go to `https://app.gohighlevel.com` (or your agency's white-labeled URL if you've been given one).
2. After login, the URL becomes `https://app.gohighlevel.com/v2/location/<location-id>/dashboard`. **Copy the `<location-id>` value from that URL** and confirm it matches `GHL_LOCATION_ID` in `.env` (developer can read this off if you don't have the file).
3. If you have access to multiple sub-accounts, use the agency-level switcher (top-left) to land in the right one. The URL above is the proof you're in the right place.

Total time budget: 90–120 minutes for a fresh sub-account.

---

## 4. Custom Values to create

These are GHL account-level globals. They power workflow timers and message merge tags.

> **Order of operations:** Run the developer provision script **first** (see §10 Phase D / §11), THEN come back to **Settings → Custom Values** and verify each entry exists with the correct `Key`. The only two values the admin must enter manually post-provision are `Website Webhook Base URL` and `Website Webhook Secret` (marked "manual" below). Do NOT hand-create the rest — the script handles them idempotently.

> **Verifying the Key matches:** the GHL list page shows display names; click into each value's edit dialog to confirm the `Key` matches the `fieldKey` column below. Display-name match alone is not enough — workflows resolve merge tags by Key.

| GHL display name (exact) | fieldKey | Default | Why it exists |
|---|---|---|---|
| `Trial Credits Default` | `trial_credits_default` | `3` | Credits granted on first trial attendance (read by `handleAttendance` via env var fallback). |
| `NEW LEAD → TRIAL NURTURE timeout (hours)` | `new_lead_to_trial_nurture_hours` | `24` | Wait inside Trial Nurture Campaign workflow before opp moves to TRIAL NURTURE. |
| `TRIAL NURTURE → NURTURE CAMPAIGN timeout (days)` | `trial_nurture_to_nurture_campaign_days` | `7` | Wait inside Trial Nurture Campaign workflow before pushing to last-chance Nurture. |
| `NURTURE CAMPAIGN → LOST/COLD timeout (days)` | `nurture_campaign_to_lost_days` | `14` | Wait inside Last Chance Nurture workflow before marking lost. |
| `NO-SHOW → INTRO CLASS REBOOKING delay (minutes)` | `no_show_to_rebooking_minutes` | `5` | Short pad so admin can undo a misclick before rebook campaign fires. |
| `INTRO CLASS REBOOKING → TRIAL INACTIVE REACTIVATION timeout (days)` | `rebooking_to_inactive_days` | `14` | Wait inside Intro Class Rebooking Campaign workflow. |
| `TRIAL INACTIVE REACTIVATION → LOST timeout (days)` | `inactive_reactivation_to_lost_days` | `21` | Wait inside Trial Inactive Reactivation Campaign. |
| `CREDIT ACTIVE → REACTIVATION timeout (days)` | `credit_active_to_reactivation_days` | `14` | Wait inside Another Trial Booking Campaign. |
| `CREDIT REACTIVATION → LOST timeout (days)` | `credit_reactivation_to_lost_days` | `21` | Wait inside Trial Active Reactivation Campaign. |
| `Website Webhook Base URL` | `website_webhook_base_url` | _(set after deploy)_ | Used as `{{custom_values.website_webhook_base_url}}/stage-changed` in workflow webhook URL fields. No trailing slash. Example: `https://www.graciebarrawhittier.com/api/webhooks/ghl` |
| `Website Webhook Secret` | `website_webhook_secret` | _(your `GHL_WEBHOOK_SECRET`)_ | Used as `{{custom_values.website_webhook_secret}}` in the `X-GBW-Secret` custom-header value on every backflow workflow. |
| `Academy Name` | `academy_name` | `Gracie Barra Whittier` | Studio display name; shared with BTM. |

> Edit the timer-day-count values in **Settings → Custom Values** directly. Workflow Wait steps read the merge tag at execution time — no redeploy needed.

---

## 5. Custom Fields to create

All custom fields are API-creatable. `npm run onboard:ghl provision` creates these idempotently. The `fieldKey` column is what the runtime resolver matches on (GHL auto-prefixes with `contact.` or `opportunity.`).

### Contact custom fields

| fieldKey | GHL label | Type | Set by | Why |
|---|---|---|---|---|
| `last_trainee_key` | Last Trainee Key | TEXT | webhook | Slug of most recent trainee booked (e.g. `eli-20210315`). Used for audit only — do NOT use as a fallback in workflow customData, it collides across siblings. |
| `household_trainee_keys` | Household Trainee Keys | TEXTAREA | webhook | Comma-separated list of trainee_keys belonging to this contact. |
| `lead_source` | Lead Source | TEXT | webhook | Latest form source: `homepage-optin` / `kids-optin` / `adults-optin` / `contact-form`. |
| `last_page` | Last Page | TEXT | webhook | Path of last page they submitted from. |
| `last_idempotency_key` | Last Idempotency Key | TEXT | webhook | Last webhook idempotency key processed (24h dedupe). |
| `back_to_the_mats_imported_at` | Back to the Mats Imported At | DATE | admin | BTM-only — declared here for cross-reference; see [`btm-campaign-setup.md`](./btm-campaign-setup.md). |

### Opportunity custom fields (shared across all 4 pipelines)

| fieldKey | GHL label | Type | Set by | Why |
|---|---|---|---|---|
| `trainee_key` | Trainee Key | TEXT | webhook | The trainee this opp tracks. Powers sibling/rebook disambiguation. |
| `trainee_first_name` | Trainee First Name | TEXT | webhook | Display name. Recommend "Show on Card". |
| `trainee_dob` | Trainee DOB | DATE | webhook | For age-based program assignment. |
| `program` | Program | TEXT | webhook | Program key: `tiny` / `lc1` / `lc2` / `juniors` / `adults`. Recommend "Show on Card". |
| `last_appointment_id` | Last Appointment ID | TEXT | webhook | GHL appointment ID of the most recent booking on this opp. |
| `last_appointment_start_iso` | Last Appointment Start ISO | DATE | webhook | Full ISO datetime. Use for time-of-day waits like "2h before". |
| `appointment_date` | Appointment Date | DATE | webhook | YYYY-MM-DD in `America/Los_Angeles`. Use for "is today" filters and morning-of moves — immune to UTC date drift. |
| `appointment_history` | Appointment History | TEXTAREA | webhook | Comma-separated list of all appointment IDs this opp has owned. |
| `credits_remaining` | Credits Remaining | NUMBER | workflow / `handleCreditDecrement` | Per-trainee class-pass count. Recommend "Show on Card". |
| `last_decrement_trial_date` | Last Decrement Trial Date | DATE | `handleCreditDecrement` | Idempotency guard — last trial_date_iso for which credits were decremented on this opp. |
| `last_attendance_iso` | Last Attendance ISO | DATE | `handleAttendance` / `handleCreditDecrement` | When the trainee last attended. Used for idle-timeout filters. |
| `rebook_link_token` | Rebook Link Token | TEXT | `handleAttendance` | HMAC-signed token for /rebook magic link, 90-day expiry. |

> **Why `appointment_date` AND `last_appointment_start_iso`?** Both are needed. The datetime drives time-of-day waits (`2h before {{appointment.start_time}}`). The date drives day-of "is today" filters and the morning-of auto-move. Comparing a full ISO across the UTC/LA boundary drifts; an 11pm PT slot reads as next-day UTC. See the comment in [`ghl-schema.ts`](../../config/ghl-schema.ts) for the rationale.

---

## 6. Pipelines + Stages to create

In **GHL → Settings → Pipelines → + Create Pipeline**. Names are case-sensitive. Stage names are case-sensitive and **hyphens are literal** (e.g. `NO-SHOW`, not `NO SHOW`).

### Pipeline 1: `Lead Acquisition`

Stages, top-to-bottom:

1. `NEW LEAD`
2. `TRIAL NURTURE`
3. `NURTURE CAMPAIGN`
4. `INTRO BOOKED (WON)` — mark **Won** in stage settings
5. `LOST / COLD` — mark **Lost** in stage settings

### Pipeline 2: `Trial Conversion`

1. `INTRO BOOKED`
2. `TRIAL APPOINTMENT DONE`
3. `NO-SHOW`
4. `INTRO CLASS REBOOKING`
5. `TRIAL ACTIVE NURTURE`
6. `TRIAL INACTIVE REACTIVATION`
7. `STUDENT ENROLLED (WON)` — mark **Won**
8. `LOST / COLD` — mark **Lost**

### Pipeline 3: `Trial Credit Monitoring`

1. `CREDIT ACTIVE`
2. `ANOTHER TRIAL BOOKED`
3. `APPOINTMENT TODAY`
4. `ATTENDED APPOINTMENT`
5. `NO-SHOW`
6. `CREDITS EXHAUSTED`
7. `REACTIVATION`
8. `WON ENROLLED` — mark **Won**
9. `LOST` — mark **Lost**

Sanity check: 5 + 8 + 9 = **22 stages** across the three intro pipelines.

---

## 7. Workflows to create

Go to **Automation → Workflows → + Create Workflow → Start from scratch** for each. Names must match exactly — the discover script matches by name. **After building each workflow, click the Draft / Published toggle at the top-right to flip it to Published.** Draft workflows do not fire.

For every workflow that ends with a stage-advance timer, the tail looks like: `Wait <N> <unit>` → `Update Opportunity Stage → Pipeline=<X> → Stage=<Y>`. The Wait references the corresponding custom-value timer via merge tag (`{{custom_values.trial_nurture_to_nurture_campaign_days}}` etc.).

### 7.0 Trigger reference (find these in GHL's trigger dropdown)

When you click `+ Add New Trigger` inside a workflow, GHL shows a categorized list. Below is exactly where each trigger we use lives, and the exact dropdown label.

| Trigger label in this doc | GHL dropdown category | Exact dropdown label |
|---|---|---|
| Opportunity Stage Changed | Opportunities | `Pipeline Stage Changed` |
| Customer Booked Appointment | Appointments | `Customer Booked Appointment` |
| Appointment Status Changed | Appointments | `Appointment Status` |
| Workflow Triggered (manual) | Workflow / Other | `Manual Trigger` or `Workflow Trigger` (varies by GHL version — pick whichever is present) |

After picking, fill in the filters (Pipeline / Stage / Calendar / Calendar Group) as specified per workflow below.

### 7.1 `Trial Nurture Campaign`

| Field | Value |
|---|---|
| Trigger | Opportunity Stage Changed → Pipeline: `Lead Acquisition`, Stage: `TRIAL NURTURE` |
| Body | Email + SMS sequence inviting the lead to book their first trial (content lives inside the GHL workflow editor) |
| Tail | `Wait {{custom_values.trial_nurture_to_nurture_campaign_days}} days` → `Update Opp Stage → Lead Acquisition → NURTURE CAMPAIGN` |
| Notes | Website auto-removes contact via `exitNurtureWorkflows('trial')` on successful booking. No goal-event configuration needed. |

### 7.2 `Last Chance Nurture Campaign`

| Field | Value |
|---|---|
| Trigger | Opp Stage Changed → `Lead Acquisition` / `NURTURE CAMPAIGN` |
| Tail | `Wait {{custom_values.nurture_campaign_to_lost_days}} days` → `Update Opp Stage → Lead Acquisition → LOST / COLD` |
| Notes | Removed by website on booking. |

### 7.3 `Quarterly Reactivation Tag`

| Field | Value |
|---|---|
| Trigger | Opp Stage Changed → `Lead Acquisition` / `LOST / COLD` |
| Body | Single step: `Add Contact Tag → quarterly-reactivation`. The separate quarterly winback workflow picks up tagged contacts. |

### 7.4 `Pre-Trial Reminders` (merged workflow — first-trial + rebook)

This is the most complex workflow in the funnel. Build it carefully. It handles BOTH first-trial bookings AND rebook bookings against an active 3-class pass, because both flows write to the same per-program trial calendar.

#### 7.4.1 Trigger + first step

| Field | Value |
|---|---|
| Trigger | **Customer Booked Appointment** → **Calendar Group**: select all 5 trial calendars (Tiny / LC1 / LC2 / Juniors / Adults). If you don't have a "trial calendars" calendar group yet, create one in Settings → Calendars → Groups and add the 5 trial calendars to it. |
| First step | **Find Opportunity** action → Pipeline: `Trial Credit Monitoring` → Contact: workflow contact → Status: `Open`. **Branches: FOUND / NOT FOUND**. The result drives the rest of the workflow. |

#### 7.4.2 Branch NOT FOUND (first-trial path)

The contact has no active 3-class pass yet → this is their first trial. Send the welcome bits, then the reminders.

| Step | Action |
|---|---|
| 1 | `Send Email` → "Confirmation" subject/body (content lives in GHL UI). |
| 2 | `Send SMS` → confirmation SMS. |
| 3 | `Wait Until` → `Specific Day & Time based on Custom Field` → source `Appointment Start Time` (the trigger event field, NOT an opportunity field) → **3 days before**. |
| 4 | `Send Email` + `Send SMS` → 3-day reminder. |
| 5 | `Wait Until` → 1 day before `{{appointment.start_time}}`. |
| 6 | `Send Email` + `Send SMS` → 1-day reminder. |
| 7 | `Wait Until` → 2 hours before `{{appointment.start_time}}`. |
| 8 | `Send Email` + `Send SMS` → 2-hour reminder. |
| 9 | END. |

#### 7.4.3 Branch FOUND (rebook path) — REQUIRED extra tail step

The contact already has a pass → don't send the welcome. Just the reminders, then a critical morning-of stage advance.

| Step | Action |
|---|---|
| 1 | `Wait Until` → 3 days before `{{appointment.start_time}}` → `Send Email` + `Send SMS` rebook 3-day copy. |
| 2 | `Wait Until` → 1 day before `{{appointment.start_time}}` → 1-day reminder. |
| 3 | `Wait Until` → 2 hours before `{{appointment.start_time}}` → 2-hour reminder. |
| 4 | **REQUIRED morning-of step** — see §7.4.4 below. |

#### 7.4.4 REQUIRED final step on the REBOOK branch — morning-of stage advance

This is the step most likely to be missed. Without it, `CREDIT_MON` opps stuck in `ANOTHER TRIAL BOOKED` forever. The old standalone `Rebooking Reminders` workflow handled this; the merged workflow must explicitly include it.

1. After the 2-hour reminder, add a `Wait Until` step.
2. Configure: `Specific Day & Time` → based on `{{appointment.start_time}}` → set "Time of day" to `12:01 AM` and "Time zone" to `America/Los_Angeles`. (You're waiting until 00:01 AM PT of the appointment day.)
3. Add `Update Opportunity Stage` → Pipeline: `Trial Credit Monitoring` → Stage: `APPOINTMENT TODAY`.
4. **Inside the Update Opportunity action's config panel, scroll down and toggle `Duplicate Opportunity` to OFF.** Default is ON; leaving it ON creates a second opp instead of moving the existing one.
5. Save and re-publish the workflow.

> **Wait-anchor warning:** every wait step in this workflow MUST anchor on `{{appointment.start_time}}` from the trigger event. Do NOT use `{{opportunity.last_appointment_start_iso}}` — the opp custom field races with the stage-change commit and resolves to a stale value. (This was the root cause of the prior bug where all rebook reminders skipped: see [git log entry "drop Rebooking Reminders workflow refs"](../../config/ghl-schema.ts).)

> **Acceptance check for §7.4:** open the workflow editor and confirm: (a) Find Opportunity is the first action, (b) the FOUND branch has the morning-of `Wait Until` + Update Stage tail with Duplicate Opportunity disabled, (c) every Wait step references `{{appointment.start_time}}` (not an opp field), (d) the workflow status badge reads `Published` (not Draft).

### 7.5 `Intro Class Rebooking Campaign`

| Field | Value |
|---|---|
| Trigger | Opp Stage Changed → `Trial Conversion` / `INTRO CLASS REBOOKING` |
| Body | Email + SMS sequence pushing the no-show to rebook |
| Tail | `Wait {{custom_values.rebooking_to_inactive_days}} days` → `Update Opp Stage → Trial Conversion → TRIAL INACTIVE REACTIVATION` |
| Notes | Removed by website on successful rebook. |

### 7.6 `Trial Inactive Reactivation Campaign`

| Field | Value |
|---|---|
| Trigger | Opp Stage Changed → `Trial Conversion` / `TRIAL INACTIVE REACTIVATION` |
| Tail | `Wait {{custom_values.inactive_reactivation_to_lost_days}} days` → `Update Opp Stage → Trial Conversion → LOST / COLD` |

### 7.7 `90-Day Review Campaign`

| Field | Value |
|---|---|
| Trigger | **Manual enrollment** (called by website on `STUDENT ENROLLED (WON)` and `WON ENROLLED`) |
| Body | Post-enrollment review/feedback emails |

### 7.8 `Another Trial Booking Campaign`

| Field | Value |
|---|---|
| Trigger | Opp Stage Changed → `Trial Credit Monitoring` / `CREDIT ACTIVE` |
| Body | Invites the active-trial student to book another class. Includes the `/rebook?token={{opportunity.rebook_link_token}}` magic link. |
| Tail | `Wait {{custom_values.credit_active_to_reactivation_days}} days` → `Update Opp Stage → Trial Credit Monitoring → REACTIVATION` |
| Notes | Removed by website on successful rebook (`exitNurtureWorkflows('credit')`). |

### 7.9 `Credit-Pipeline No-Show Message`

| Field | Value |
|---|---|
| Trigger | Opp Stage Changed → `Trial Credit Monitoring` / `NO-SHOW` |
| Body | Single message, then `Update Opp Stage → CREDIT ACTIVE` (this implements `auto_move_immediate`). |

### 7.10 `Credits Exhausted Notification`

| Field | Value |
|---|---|
| Trigger | Opp Stage Changed → `Trial Credit Monitoring` / `CREDITS EXHAUSTED` |
| Body | Notify customer their pass is used. Push membership CTA. |

### 7.11 `Trial Active Reactivation Campaign`

| Field | Value |
|---|---|
| Trigger | Opp Stage Changed → `Trial Credit Monitoring` / `REACTIVATION` |
| Tail | `Wait {{custom_values.credit_reactivation_to_lost_days}} days` → `Update Opp Stage → Trial Credit Monitoring → LOST` |
| Notes | Removed by website on successful rebook. |

### 7.12 Backflow webhooks (3)

These three workflows POST to the website. Each one has the **same shape**: trigger fires → single **Custom Webhook** action → done.

For all three, configure the webhook step like this:

- **URL**: `{{custom_values.website_webhook_base_url}}/<path>` (path varies — see table below)
- **Method**: `POST`
- **Headers**: add one custom header — Name: `X-GBW-Secret`, Value: `{{custom_values.website_webhook_secret}}`
- **Content-Type**: `application/json`
- **Response handling**: "Continue regardless" — don't retry-loop on website failures.

**Body — paste this exactly, then use the GHL merge-tag picker to confirm each `{{…}}` placeholder resolves to a real field:**

```json
{
  "opp_id": "{{opportunity.id}}",
  "contact_id": "{{contact.id}}",
  "to_stage": "{{opportunity.pipeline_stage}}",
  "from_stage": "{{opportunity.previous_pipeline_stage}}",
  "trainee_key": "{{opportunity.trainee_key}}",
  "trainee_first_name": "{{opportunity.trainee_first_name}}",
  "parent_last_name": "{{contact.last_name}}",
  "program": "{{opportunity.program}}",
  "last_appointment_start_iso": "{{opportunity.last_appointment_start_iso}}",
  "ts": "{{date_created}}"
}
```

For the appointment-status webhook, use this body instead (no opp context):

```json
{
  "appointment_id": "{{appointment.id}}",
  "contact_id": "{{contact.id}}",
  "status": "{{appointment.status}}",
  "prev_status": "{{appointment.previous_status}}",
  "reason": "{{appointment.cancellation_reason}}",
  "ts": "{{date_created}}"
}
```

| Workflow name | Trigger | Path |
|---|---|---|
| `[Backflow] Trial Conversion stage changed → website webhook` | Opportunity Stage Changed → Pipeline: `Trial Conversion` → **Any stage** | `/stage-changed` |
| `[Backflow] Trial Credit Monitoring stage changed → website webhook` | Opportunity Stage Changed → Pipeline: `Trial Credit Monitoring` → **Any stage** | `/credit-stage-changed` |
| `[Backflow] Appointment status changed → website webhook` | Appointment Status Changed → Calendar: **any** | `/appointment-status` |

### 7.13 `[Backflow] Bot Booking → Pipeline Orchestrator`

Special — invoked by the SMS bot at the end of every booking via its **`Trigger a Workflow`** action.

| Field | Value |
|---|---|
| Trigger | **Workflow Triggered** (no native trigger; the bot fires it) |
| Action | Custom Webhook → URL `{{custom_values.website_webhook_base_url}}/agent-booking-completed`, header `X-GBW-Secret: {{custom_values.website_webhook_secret}}`, body includes `appointment_id`, `contact_id`, `appointment_start_iso`, `is_self`, `child_name`, `child_age`, `ts`. |
| Purpose | Bridges the gap when the bot books via GHL's native action (bypassing `/api/book`). The website then runs `handleBooking` to create the TRIAL_CONV opp and move LEAD_ACQ. |

---

## 8. Stage transitions / auto-actions

This is the canonical map of what fires when an opp enters each stage. Use it as a cross-reference when configuring workflows.

### Lead Acquisition

| Enter stage | Action(s) |
|---|---|
| `NEW LEAD` | `fire_workflow` Trial Nurture Campaign (which opens with a 24h Wait, then sends its body, then moves the opp to `NURTURE CAMPAIGN`). See note below. |
| `TRIAL NURTURE` | (transitional only — opps land here as the Trial Nurture Campaign workflow advances them) |
| `NURTURE CAMPAIGN` | `fire_workflow` Last Chance Nurture; `auto_move_after` 14d → `LOST / COLD` |
| `INTRO BOOKED (WON)` | `set_status` won |
| `LOST / COLD` | `set_status` lost; `add_tag` `quarterly-reactivation` |

> **`NEW LEAD → TRIAL NURTURE` implementation:** the Trial Nurture Campaign workflow's FIRST step is `Wait {{custom_values.new_lead_to_trial_nurture_hours}} hours`. Its trigger is `Pipeline Stage Changed → Lead Acquisition → NEW LEAD`. After the wait, the workflow runs its body (emails + SMS) and a final `Update Opportunity Stage → Lead Acquisition → NURTURE CAMPAIGN` step. This is the only place that handles the 24h delay — do NOT also configure the website to write opps directly into `TRIAL NURTURE`.

### Trial Conversion

| Enter stage | Action(s) |
|---|---|
| `INTRO BOOKED` | `fire_workflow` Pre-Trial Reminders (NOT-FOUND branch); `add_audit_note`; `auto_move_at_appointment_end` → `TRIAL APPOINTMENT DONE` |
| `TRIAL APPOINTMENT DONE` | None — admin classifies |
| `NO-SHOW` | `auto_move_after` 5 min → `INTRO CLASS REBOOKING` |
| `INTRO CLASS REBOOKING` | `fire_workflow` Intro Class Rebooking Campaign; `auto_move_after` 14d → `TRIAL INACTIVE REACTIVATION` |
| `TRIAL ACTIVE NURTURE` | `create_opp` in CREDIT_MON at CREDIT ACTIVE (website-side, via `handleAttendance`); `set_credits` default |
| `TRIAL INACTIVE REACTIVATION` | `fire_workflow` Trial Inactive Reactivation; `auto_move_after` 21d → `LOST / COLD` |
| `STUDENT ENROLLED (WON)` | `set_status` won; `fire_workflow` 90-Day Review |
| `LOST / COLD` | `set_status` lost; `cross_pipeline_move` LEAD_ACQ to `NURTURE CAMPAIGN` |

### Trial Credit Monitoring

| Enter stage | Action(s) |
|---|---|
| `CREDIT ACTIVE` | `fire_workflow` Another Trial Booking; `auto_move_after` 14d → `REACTIVATION` |
| `ANOTHER TRIAL BOOKED` | `auto_move_on_appointment_day` → `APPOINTMENT TODAY` (implemented as Wait + Update Stage at the end of the Pre-Trial Reminders REBOOK branch — see §7.4) |
| `APPOINTMENT TODAY` | None — admin classifies |
| `ATTENDED APPOINTMENT` | `decrement_credits` (handler-side, idempotency-guarded by `last_decrement_trial_date`); conditional move to `CREDIT ACTIVE` or `CREDITS EXHAUSTED` |
| `NO-SHOW` | `fire_workflow` Credit-Pipeline No-Show Message; `auto_move_immediate` → `CREDIT ACTIVE` |
| `CREDITS EXHAUSTED` | `fire_workflow` Credits Exhausted Notification |
| `REACTIVATION` | `fire_workflow` Trial Active Reactivation; `auto_move_after` 21d → `LOST` |
| `WON ENROLLED` | `set_status` won; `fire_workflow` 90-Day Review |
| `LOST` | `set_status` lost; `set_credits` 0; `cross_pipeline_move` LEAD_ACQ to `NURTURE CAMPAIGN` |

The handler logic for `decrement_credits` and `cross_pipeline_move` lives in [`ghl-adapter.ts`](../../src/lib/ghl-adapter.ts) and is triggered by the **backflow webhooks** in §7.12.

---

## 9. Website ↔ GHL contract

### Website → GHL (outbound)

| Website endpoint | What it does | Pipelines touched |
|---|---|---|
| `POST /api/optin` | Upsert contact, set source CFs, create LEAD_ACQ opp at `NEW LEAD`, enroll in Trial Nurture workflow | LEAD_ACQ |
| `POST /api/book` (trial branch) | Create appointment, create TRIAL_CONV opp at `INTRO BOOKED`, move LEAD_ACQ to `INTRO BOOKED (WON)`, exit nurture | LEAD_ACQ, TRIAL_CONV |
| `POST /api/book` (rebook branch — `rebook` field in payload) | Verify HMAC token, create appointment, move CREDIT_MON opp to `ANOTHER TRIAL BOOKED`, exit credit nurture | CREDIT_MON |
| `POST /api/cancel` | Mark TRIAL_CONV opp `abandoned`, add note | TRIAL_CONV |

### GHL → Website (backflow webhooks)

All three send `Content-Type: application/json`, `X-GBW-Secret: <secret>`, payload is a flat-ish JSON object. The website is tolerant of GHL's typo `pipleline_stage` (sic) and falls back across `customData` → top-level.

| Path | Trigger workflow | Payload fields (flat) | Handler |
|---|---|---|---|
| `/api/webhooks/ghl/stage-changed` | `[Backflow] Trial Conversion stage changed` | `opp_id`, `contact_id`, `to_stage`, `from_stage`, `trainee_key`, `trainee_first_name`, `parent_last_name`, `program`, `last_appointment_start_iso`, `ts` | Dispatch on `to_stage`: `TRIAL ACTIVE NURTURE` → `handleAttendance`; `LOST / COLD` → cross-pipeline-move; `STUDENT ENROLLED (WON)` → close matching CREDIT_MON. |
| `/api/webhooks/ghl/credit-stage-changed` | `[Backflow] Trial Credit Monitoring stage changed` | Same shape minus parent/trainee_first_name. | `ATTENDED APPOINTMENT` → `handleCreditDecrement`; `LOST` → close + cross-pipeline; `WON ENROLLED` → close + mark TRIAL_CONV won. |
| `/api/webhooks/ghl/appointment-status` | `[Backflow] Appointment status changed` | `appointment_id`, `contact_id`, `status`, `prev_status`, `reason`, `ts` | `status=cancelled` → `handleCancellation` with `source=admin`. |
| `/api/webhooks/ghl/agent-booking-completed` | `[Backflow] Bot Booking → Pipeline Orchestrator` | `appointment_id`, `contact_id`, `appointment_start_iso`, `is_self`, `child_name`, `child_age`, `ts` | Calls `handleBooking` to bridge bot bookings into the pipeline orchestrator. |

The website returns `200 ok` with `{ ok: true | false, code }` on logical errors so GHL doesn't infinite-retry. Only `401 INVALID_SECRET` causes GHL to mark the delivery failed.

---

## 10. Step-by-step setup checklist

Work top-down. Each step has an acceptance criterion you can verify before moving on. Phase labels marked **[DEV]** require a terminal and the repo checked out; **[ADMIN]** is all GHL UI work; **[BOTH]** is hand-off between them.

### Phase A — Repo + Vercel **[DEV]**

1. **Clone the repo, install, copy env. Run from repo root throughout this doc.**
   ```bash
   git clone <repo>
   cd <repo>
   npm install
   cp .env.example .env
   ```
   Open `.env` in a text editor and fill in `GHL_PIT_TOKEN`, `GHL_LOCATION_ID`, plus generate the 4 secrets with:
   ```bash
   openssl rand -hex 32   # for GHL_WEBHOOK_SECRET, CANCEL_SIGNING_KEY, REBOOK_SIGNING_KEY
   openssl rand -hex 16   # for HEALTH_KEY
   ```
   **Save `HEALTH_KEY` to a password manager.** You'll need it for every drift check below.
   **Accept:** `cat .env | grep -E "^(GHL_PIT_TOKEN|GHL_LOCATION_ID|HEALTH_KEY)" ` prints all three with non-empty values.

2. **Import to Vercel.** Settings → set production domain. Skip env vars; we'll do it in Phase F.
   **Accept:** A build completes (endpoints will 502 — expected until Phase F).

### Phase B — Print the checklist **[DEV]**

3. **Print the schema-derived setup list:**
   ```bash
   npm run onboard:ghl checklist > onboarding-checklist.txt
   ```
   This file is a printable cross-reference of every artifact the schema expects. Use it as a tick-list while you go through Phase C. The doc you're reading now is authoritative; the file is a quick-lookup companion.
   **Accept:** `onboarding-checklist.txt` lists every pipeline, stage, custom field, and workflow.

### Phase C — Manual GHL UI work **[ADMIN]**

4. **Create pipeline `Lead Acquisition`** with 5 stages per §6. Mark `INTRO BOOKED (WON)` as Won, `LOST / COLD` as Lost. **Paste names — don't retype.** Hyphens, spaces, slashes are all literal (e.g. `LOST / COLD` has spaces around the slash; `NO-SHOW` has a hyphen).
   **Accept:** Pipeline visible at Settings → Pipelines with all 5 stages in order, correct Won/Lost flags.

5. **Create pipeline `Trial Conversion`** with 8 stages per §6.
   **Accept:** 8 stages, correct Won/Lost flags.

6. **Create pipeline `Trial Credit Monitoring`** with 9 stages per §6.
   **Accept:** 9 stages, correct Won/Lost flags.

7. **Create the 12 intro workflows + 4 backflow webhook workflows** per §7. The 3 backflow workflows MUST include the `X-GBW-Secret` custom header.
   **Per-workflow acceptance:** open each workflow, click `Test Workflow` (top-right) to fire a test execution against a sample contact/opp. Confirm: (a) trigger fires, (b) all expected body actions execute (Test runs skip Wait delays), (c) no red error markers in the editor. Then flip the toggle from Draft to **Published**.
   **Accept after all 16:** all listed at Automation → Workflows with status **Published** (not Draft); each tested via `Test Workflow` without errors.

### Phase D — Provision custom values + fields **[DEV]**

8. **Run the provision script** (idempotent — safe to re-run from repo root):
   ```bash
   npm run onboard:ghl provision
   ```
   Sample success output ends with `✓ Provision complete. <N> custom values + <M> custom fields verified.` Common errors:
   - `401 Unauthorized` → `GHL_PIT_TOKEN` is wrong or lacks scopes. Check §3.2.
   - `409 Conflict` → custom value/field already exists. Safe; provision is idempotent.
   - Network timeout → re-run.
   **Accept:** Custom Values and Custom Fields tables in §4 and §5 are populated in GHL (Settings → Custom Values / Custom Fields). The `Key` (visible in each value's edit dialog) matches the `fieldKey` column.

9. **[ADMIN]** Set the two reproducibility custom values manually in GHL UI:
   - `Website Webhook Base URL` → `https://<your-domain>/api/webhooks/ghl` (no trailing slash)
   - `Website Webhook Secret` → exactly the same value as the `GHL_WEBHOOK_SECRET` you put in `.env`
   **Accept:** Both values appear in Settings → Custom Values with their correct keys (`website_webhook_base_url`, `website_webhook_secret`). Backflow workflows will use these merge tags.

### Phase E — Discover IDs **[DEV]**

10. **Run the discover script** to match names → IDs:
    ```bash
    npm run onboard:ghl discover
    ```
    Writes `.env.client.local` in the repo root with all pipeline + workflow + calendar IDs. This file is **gitignored** — keep it on your local machine; do NOT commit it; you can delete it after pasting to Vercel.
    **Accept:** No "Could not find …" warnings. If any, fix the GHL UI name (most common: stage name typo, missing hyphen, retyped instead of pasted) and re-run.

### Phase F — Vercel env **[DEV]**

11. **Paste every `key=value` from `.env.client.local` into Vercel:**
    1. Go to Vercel → your project → **Settings** → **Environment Variables**.
    2. For each line in `.env.client.local`, click `Add New`.
    3. Paste the `key` into "Name" and the value into "Value".
    4. Check **Production** AND **Preview** (leave Development unchecked unless you specifically deploy a Development env).
    5. Click **Save**.
    6. Repeat for every variable.
    See §12 for the full paste list.
    7. After all env vars are saved, redeploy: Vercel → Deployments → click the latest deployment → `Redeploy`.
    **Accept:** `curl "https://<your-domain>/api/health/ghl?key=<HEALTH_KEY>"` returns `{ ok: true, drift: [] }`.

### Phase G — Smoke test **[ADMIN]**

12. **End-to-end smoke**: see §13.

---

## 11. Provisioning scripts

All scripts run from the **repo root** (the directory containing `package.json`). They live under `scripts/` and read from [`ghl-schema.ts`](../../config/ghl-schema.ts). They never write to GHL state that isn't API-creatable (pipelines + workflows are UI-only — admin's job).

| Command | What it does | When to run | Success looks like |
|---|---|---|---|
| `npm run onboard:ghl checklist` | Prints schema as a setup checklist | Before Phase C | Writes a multi-section text file: pipelines, stages, custom fields, workflows, env vars |
| `npm run onboard:ghl provision` | Creates Custom Values + Custom Fields via API. Idempotent. | After Phase C | Final line: `✓ Provision complete. N custom values + M custom fields verified.` Safe to re-run if interrupted. |
| `npm run onboard:ghl discover` | Reads live GHL, matches names → IDs, writes `.env.client.local` | After Phases C + D, and every time you rename or add a workflow / pipeline in GHL | New file `.env.client.local` exists in repo root; no `Could not find …` warnings in stdout |

---

## 12. Env var paste list (Vercel)

After `discover` runs, `.env.client.local` looks like this. Paste each line as a Vercel env var on **Production AND Preview**:

```
# Secrets you generated
GHL_PIT_TOKEN=…
GHL_LOCATION_ID=…
GHL_WEBHOOK_SECRET=…
CANCEL_SIGNING_KEY=…
REBOOK_SIGNING_KEY=…
HEALTH_KEY=…

# Pipeline IDs (intro funnel)
PIPELINE_ID_LEAD_ACQ=…
PIPELINE_ID_TRIAL_CONV=…
PIPELINE_ID_CREDIT_MON=…

# Workflow IDs — intro funnel
WORKFLOW_ID_TRIAL_NURTURE=…
WORKFLOW_ID_NURTURE_CAMPAIGN=…
WORKFLOW_ID_QUARTERLY_REACTIVATION=…
WORKFLOW_ID_PRE_TRIAL_REMINDERS=…
WORKFLOW_ID_REBOOKING_CAMPAIGN=…
WORKFLOW_ID_INACTIVE_REACTIVATION=…
WORKFLOW_ID_90_DAY_REVIEW=…
WORKFLOW_ID_ANOTHER_TRIAL_CAMPAIGN=…
WORKFLOW_ID_NO_SHOW_MESSAGE=…
WORKFLOW_ID_CREDITS_EXHAUSTED=…
WORKFLOW_ID_CREDIT_REACTIVATION=…

# Backflow workflow IDs (for documentation; the website doesn't read them)
WORKFLOW_ID_TRIAL_CONV_STAGE_WEBHOOK=…
WORKFLOW_ID_CREDIT_STAGE_WEBHOOK=…
WORKFLOW_ID_APPT_STATUS_WEBHOOK=…
WORKFLOW_ID_BOT_BOOKING_ORCHESTRATOR=…

# Trial calendar IDs (already exist in GBW account)
GHL_CAL_TINY=…
GHL_CAL_LC1=…
GHL_CAL_LC2=…
GHL_CAL_JUNIORS=…
GHL_CAL_ADULTS=…
```

> **`WORKFLOW_ID_REBOOK_REMINDERS` is intentionally absent.** The standalone `Rebooking Reminders` workflow was merged into `Pre-Trial Reminders`. Do not add this env var; the schema does not declare it.

---

## 13. Validation / smoke test

Use a real test contact (your own email + phone — a forwarded burner number works).

1. **Submit the homepage opt-in form** with your test email.
2. **GHL → Contacts** → confirm contact created, tagged `kickstart-funnel` + `source-homepage-optin`, `lead_source = "homepage-optin"`.
3. **GHL → Lead Acquisition pipeline** → confirm an opp at `NEW LEAD` for this contact.
4. **Contact → Workflows tab** → confirm `Trial Nurture Campaign` is active.
5. **Submit `/kickstart`** form, book a trial with the same email.
6. Confirm:
   - LEAD_ACQ opp moved to `INTRO BOOKED (WON)`.
   - A new TRIAL_CONV opp at `INTRO BOOKED` exists with `trainee_key`, `trainee_first_name`, `appointment_date` populated.
   - `Trial Nurture Campaign` shows status **Removed** on the contact's Workflows tab (within ~10s).
   - `Pre-Trial Reminders` is now active. The NOT-FOUND branch should fire because there's no CREDIT_MON opp.
   - Confirmation Email + SMS landed in your inbox/phone.
7. **Manually move the TRIAL_CONV opp to `TRIAL ACTIVE NURTURE`** in GHL UI. Within ~10s, a CREDIT_MON opp should appear at `CREDIT ACTIVE`, `credits_remaining = 3`, `rebook_link_token` set.
8. **Open the /rebook magic link** (from the Another Trial Booking email, or copy the token from the opp CF). Book another slot.
9. Confirm:
   - CREDIT_MON opp moved to `ANOTHER TRIAL BOOKED`.
   - `Another Trial Booking Campaign` shows **Removed**.
   - `Pre-Trial Reminders` is active again, this time on the FOUND branch (no welcome message — only reminders).
10. **On the morning of the rebooked slot** (00:01 PT), the CREDIT_MON opp should auto-move to `APPOINTMENT TODAY`. If it doesn't, the Wait + Update Stage step at the end of the Pre-Trial Reminders REBOOK branch is missing.

   > **Same-day verification (don't wait overnight):** book the rebook test for **tomorrow**. After booking, open the `Pre-Trial Reminders` workflow in the editor, switch to the FOUND branch, and confirm visually: (a) a `Wait Until` step set to `Specific Day & Time → {{appointment.start_time}} → 12:01 AM PT` exists, (b) followed by `Update Opportunity Stage → Trial Credit Monitoring → APPOINTMENT TODAY` with Duplicate Opportunity OFF. That's sufficient verification; you don't need to physically observe the morning-of move.
11. **Move the CREDIT_MON opp to `ATTENDED APPOINTMENT`** manually. Within ~10s it should land at `CREDIT ACTIVE` with `credits_remaining = 2`, and a contact note logs the decrement.
12. **Run** `curl "https://<your-domain>/api/health/ghl?key=<HEALTH_KEY>"`. Expect `{ ok: true, drift: [] }`.

If any step fails, check Vercel runtime logs for the matching handler tag (`[handleBooking]`, `[stage-changed]`, etc.) and `/api/health/ghl` for drift.

---

## 14. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Pre-Trial Reminders` sends reminders at wrong times | Wait step anchored on `{{opportunity.last_appointment_start_iso}}` instead of `{{appointment.start_time}}` | Edit each Wait step to use the trigger's `{{appointment.start_time}}`. The opp CF races with the stage commit — never use it. |
| First-trial bookings get reminders but no welcome message | Find Opportunity at the top of Pre-Trial Reminders is matching the wrong pipeline or returning wrong branch | Verify Find Opportunity → Pipeline = `Trial Credit Monitoring` (NOT Trial Conversion) + Status = `Open`. A first-trial booking has no CREDIT_MON opp yet → branch must be NOT FOUND. |
| Rebook bookings send the welcome message | Same root cause — Find Opportunity returns "not found" because CREDIT_MON opp is in a non-`Open` status, or the search is on the wrong pipeline | Verify the CREDIT_MON opp is `Open` when the rebook fires. If admin closed it manually, the branch flips to first-trial. |
| `ANOTHER TRIAL BOOKED` opps never auto-move to `APPOINTMENT TODAY` | Wait + Update Stage tail missing on the REBOOK branch of `Pre-Trial Reminders` — this used to live in a separate workflow (`Rebooking Reminders`, now unpublished) | Re-add the tail: `Wait until {{appointment.start_time}} at 00:01` → `Update Opp Stage → Trial Credit Monitoring → APPOINTMENT TODAY`. **Disable Duplicate Opportunity** on the Update step. If the wait spans days, add a second `Find Opportunity` right before the Update step — opp context can drop across multi-day waits. |
| Backflow webhook returns 401 | `X-GBW-Secret` header value doesn't match `GHL_WEBHOOK_SECRET` env var | Update either side to match. Verify by tailing Vercel logs: `[stage-changed] verifyGhlWebhook` returns `false`. |
| Credit opp never decrements after `ATTENDED APPOINTMENT` | `last_decrement_trial_date` CF was set to the same value already (idempotency no-op), or the CF doesn't exist | Check the opp CFs in GHL. If `last_decrement_trial_date == last_appointment_start_iso`, the decrement is correctly suppressed (admin clicked twice). If the CF is missing, re-run `npm run onboard:ghl provision`. |
| Contact keeps getting nurture messages after booking | `exitNurtureWorkflows` is no-op — `WORKFLOW_ID_*` env vars unset in Vercel | Re-run `npm run onboard:ghl discover` and paste all `WORKFLOW_ID_*` into Vercel. Redeploy. |
| `/api/health/ghl` reports stage-name drift | Stage was renamed in GHL UI | Either rename back to match schema, or update the schema and redeploy. The schema name is canonical. |
| Multiple LEAD_ACQ opps for the same contact | Rapid opt-in resubmits before the website's dedup completes | Handled — `handleTrialBooking` consolidates on booking (keeps one, marks won, deletes the rest). No action needed. |

---

## 15. Glossary

- **Opportunity (opp)**: a row in a pipeline. Has a stage, a status (`open`/`won`/`lost`/`abandoned`), a contact, and custom fields. The website creates/moves opps via `/locations/{locationId}/opportunities`.
- **Pipeline**: an ordered set of stages. Pipelines aren't API-creatable in GHL — UI only.
- **Stage**: a position within a pipeline. Has a name and an optional Won/Lost flag. Opps move between stages.
- **Workflow**: a sequence of steps (Wait / Send Email / Send SMS / Update Opp Stage / Custom Webhook / Find Opportunity / etc.) triggered by an event. Workflows are UI-only.
- **Trigger**: the event that starts a workflow. Types we use: `Opportunity Stage Changed`, `Customer Booked Appointment`, `Appointment Status Changed`, `Workflow Triggered` (manual / chained), `Contact Created` (not used).
- **Custom Value**: account-level global, admin-editable in Settings → Custom Values. Referenced in workflows as `{{custom_values.field_key}}`. We use these for timer day-counts, message URLs, the webhook base URL + secret. Created via API.
- **Custom Field**: per-record field on a Contact or Opportunity. Referenced in merge tags as `{{contact.field_key}}` or `{{opportunity.field_key}}`. Created via API.
- **Merge tag**: `{{…}}` placeholder evaluated at workflow execution time. Examples: `{{contact.first_name}}`, `{{custom_values.academy_name}}`, `{{appointment.start_time}}`, `{{opportunity.id}}`.
- **Calendar group**: a folder of calendars used as a filter in the `Customer Booked Appointment` trigger. We have a "Back to the Mats" group for BTM calendars; trial calendars are loose (no group).
- **`trainee_key`**: deterministic slug generated by the website (`<firstname>-<dobYYYYMMDD>` or `self-<contactId>` for self-bookings). The only safe key for distinguishing siblings on a shared parent contact.
- **Backflow / backflow webhook**: a workflow whose only action is a Custom Webhook posting to the website. Used when GHL state changes need to drive website logic (cross-pipeline moves, credit decrements, cancellations).
- **`exitNurtureWorkflows`**: website helper that removes a contact from every active nurture workflow on a funnel. Called after every booking. See [`ghl-adapter.ts`](../../src/lib/ghl-adapter.ts).
- **Find Opportunity step**: a workflow action that looks up an existing opp by pipeline/stage/status/contact filter. If not found, the step can either Stop, Skip, or Branch. Used in `Pre-Trial Reminders` to disambiguate first-trial vs rebook.
