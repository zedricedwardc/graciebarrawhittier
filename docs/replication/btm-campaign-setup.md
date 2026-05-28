# Back to the Mats — GHL Setup Guide

End-to-end setup guide for the **Back to the Mats (BTM) re-enrollment campaign**: a 30-day winback for former students, with its own pipeline, calendars, and workflows. Completely independent from the intro funnel — no cross-contamination.

## Who runs what

Same two-role split as the intro doc. If you haven't done the intro setup, do it first.

| Role | What they do | Steps in §11 |
|---|---|---|
| **Developer** | `npm run onboard:ghl provision`, `npm run onboard:ghl discover`, `npx tsx scripts/discover-btm-calendars.ts`, Vercel env-var paste, deploy. | 4, 6, 7 |
| **Studio admin** | GHL UI: create pipeline + stages, create workflows, create BTM calendars, set deadline custom value, run smoke test, run CSV import. | 1, 2, 3, 5, 9, 10 |

> **Read [`intro-campaign-setup.md`](./intro-campaign-setup.md) first** if you haven't set up the intro funnel. BTM reuses the same custom fields (`trainee_key`, `appointment_date`, etc.), the same provision script, and the same webhook secret. This doc only covers what's specific to BTM.

## §0. What's different from the intro funnel

If you already know the intro funnel, here's the diff for BTM:

| New | Count |
|---|---|
| New pipeline (`Back to the Mats`) | 1, with 6 stages |
| New custom values | 4 (deadline, page URL, offer name, academy name — last one shared with intro) |
| New contact custom field | 1 (`back_to_the_mats_imported_at`) |
| New workflows | 3 (`BTM 30-Day Campaign`, `BTM Appointment Confirmation`, `BTM Re-Booking Campaign (no-show)`) |
| New calendars | 5 (one per program: Tiny / LC1 / LC2 / Juniors / Adults) in a new "Back to the Mats" calendar group |
| New env vars | `PIPELINE_ID_BACK_TO_MATS`, 3× `WORKFLOW_ID_BTM_*`, 5× `GHL_CAL_BTM_*` |
| New website code path | `handleBtmBooking` (in `/api/book` when `flow: 'btm'`) |
| Backflow webhooks | **None.** BTM does NOT fire any backflow webhooks. |

What's reused: contact + opp custom fields (`trainee_key`, `program`, `appointment_date`, etc.), webhook secret, PIT token, `90-Day Review Campaign` workflow (shared on `RE ENROLLED`).

> **Source of truth:** [`config/ghl-schema.ts`](../../config/ghl-schema.ts). Drift will be flagged by `GET /api/health/ghl?key=<HEALTH_KEY>` after deploy.

---

## 1. Overview

BTM targets the studio's existing list of former students. The flow:

1. Admin **bulk-imports** a CSV of former students into a tag (`back-to-the-mats-import`) and creates a BTM opp at `FORMER STUDENT` for each.
2. The `BTM 30-Day Campaign` workflow fires per opp — 9 emails + 3 SMS over 30 days.
3. Former student clicks the CTA → lands on **/back-to-the-mats** → fills out the booking form → website calls `POST /api/book` with `flow: 'btm'`.
4. Website's `handleBtmBooking` either creates a new BTM opp keyed by `trainee_key` (and deletes the parent's `FORMER STUDENT` opp on first booking) or moves the existing opp to `RE ENROLLMENT CLASS BOOKED`. Then removes the contact from the 30-Day Campaign workflow.
5. `BTM Appointment Confirmation` workflow sends 3 emails + 2 SMS leading up to the session, ending with a Wait + Update Stage to `APPOINTMENT TODAY` on the morning of the booked class.
6. Admin classifies after class: `NO-SHOW` (fires `BTM Re-Booking Campaign` for 14 days) or `RE ENROLLED` (won; fires 90-day review).
7. If the contact never books or never re-books after no-show, the campaign workflow's tail moves them to `OFFER EXPIRED` (30d or 14d respectively).

### Customer journey

| Stage | What they see | What GHL does | What the website does |
|---|---|---|---|
| CSV-imported | Lands in their inbox: Email 1 of 16 | Creates opp at `FORMER STUDENT`, fires `BTM 30-Day Campaign` | — |
| Reading messages | 9 emails + 3 SMS over 30d | Workflow runs | — |
| Books a class | Clicks CTA → /back-to-the-mats → picks slot | — | `handleBtmBooking` moves opp to `RE ENROLLMENT CLASS BOOKED`; exits 30-Day workflow |
| Pre-class period | 3 confirmation emails + 2 reminders | `BTM Appointment Confirmation` workflow | — |
| Morning of class | Opp shows in admin "classify today" view | Workflow's tail moves opp to `APPOINTMENT TODAY` at 00:01 PT | — |
| Attends or doesn't | Admin classifies | `RE ENROLLED` → won + 90-Day Review; `NO-SHOW` → fires Re-Booking Campaign | — |
| No-show, re-books | Clicks CTA in re-booking campaign | Workflow stops | `handleBtmBooking` moves opp back to `RE ENROLLMENT CLASS BOOKED` (Branch A) |

---

## 2. Architecture

```
   CSV import ──► [BACK_TO_MATS]
                       │
                       ▼
                  FORMER STUDENT  ◄── BTM 30-Day Campaign workflow
                       │              (9 emails + 3 SMS, 30d tail
                       │               → OFFER EXPIRED)
                       │
            ┌──────────┼──────────────────────────────┐
            │ /back-to-the-mats book                  │ 30d timer
            ▼                                         ▼
   RE ENROLLMENT CLASS BOOKED  ◄── BTM Appt           OFFER EXPIRED (lost)
            │                       Confirmation
            │ Wait until appt day   workflow
            ▼ 00:01 PT
   APPOINTMENT TODAY  ◄── admin classifies
            │
      ┌─────┴─────┐
      ▼           ▼
   NO-SHOW    RE ENROLLED (won → 90-Day Review)
      │ BTM Re-Booking
      │ Campaign (14d)
      ▼
   OFFER EXPIRED (lost)
      OR
   /back-to-the-mats book → moves back to RE ENROLLMENT CLASS BOOKED
```

---

## 3. Prerequisites

1. **Intro funnel is set up** ([`intro-campaign-setup.md`](./intro-campaign-setup.md) phases A–F complete). BTM reuses the contact + opp custom fields, the webhook secret, the PIT, etc.
2. **Intro funnel passed smoke test.** Don't layer BTM on top of a broken intro deployment.
3. **SMS opt-in compliance confirmed for the CSV you plan to import.** This is a legal gate, NOT a setup detail. CTIA/TCPA require prior express written consent before bulk SMS to former students. **Do not proceed past this point until you have confirmed SMS consent for every phone number in the CSV, OR have stripped non-consenting numbers from the CSV.** Email-only nurture is fine without per-message SMS opt-in. See §15 for details.
4. **Former-student CSV ready**, with at minimum these column headers (case-sensitive in GHL's importer): `email`, `firstName`, `lastName`, `phone`. UTF-8 encoding, comma-separated. See `docs/btm-import-template.csv` for a sample.
5. **5 BTM calendars** to create (cloned from the 5 trial calendars).
6. **BTM landing page deployed** at `/back-to-the-mats` (already in the repo; verify it renders before pointing emails at it).

---

## 4. Custom Values to create

The provision script creates these. You must **set the deadline manually** before each campaign run.

| GHL display name (exact) | fieldKey | Default | Why |
|---|---|---|---|
| `Academy Name` | `academy_name` | `Gracie Barra Whittier` | Studio name for merge tags. Shared with intro funnel. |
| `Back to the Mats Deadline` | `back_to_the_mats_deadline` | _(empty — set before each run)_ | Human-readable deadline label used in BTM emails/SMS. Format: e.g. `Friday, June 8, 2026`. The website reads this at request time to render the countdown timer + display label on `/back-to-the-mats`. The audit shows the current live value is an ISO datetime (`2026-06-15T23:59:00-07:00`) — the website parses both formats. |
| `Back to the Mats Page URL` | `back_to_the_mats_page_url` | `https://www.graciebarrawhittier.com/back-to-the-mats` | CTA link used in every BTM email/SMS. |
| `Back to the Mats Offer Name` | `back_to_the_mats_offer_name` | `Back to the Mats Special` | Display name used in subject lines / body copy. The live value in GHL is `The Back to the Mats Special` — either works. |

> **Wait + Update Stage timer day-counts (30d FORMER STUDENT → OFFER EXPIRED, 14d NO-SHOW → OFFER EXPIRED) are NOT custom values.** They're literal day counts inside the workflow Wait steps. Edit them inside the workflow if you need to change them. (Earlier drafts of the schema declared them as custom values; that was removed because nothing reads them at runtime.)

---

## 5. Custom Fields to create

BTM **reuses** the contact + opportunity custom fields defined in [`intro-campaign-setup.md`](./intro-campaign-setup.md) §5. Two fields are specific to BTM:

### Contact

| fieldKey | GHL label | Type | Set by | Why |
|---|---|---|---|---|
| `back_to_the_mats_imported_at` | Back to the Mats Imported At | DATE | admin | Set on CSV import. Used for dedupe (skip re-import if within 60 days) and audit. |

### Opportunity

No BTM-only opportunity fields. The flow reuses `trainee_key`, `trainee_first_name`, `trainee_dob`, `program`, `last_appointment_id`, `last_appointment_start_iso`, `appointment_date`, `appointment_history`. See intro doc §5.

### Tags

Auto-created on first use, no provisioning step:

- `back-to-the-mats-import` — applied on CSV import; consumed by the SMS-bot prompt to detect former students.

---

## 6. Pipeline + Stages to create

### Pipeline 4: `Back to the Mats`

In **GHL → Settings → Pipelines → + Create Pipeline**. Name: `Back to the Mats`. Stages, top-to-bottom (case-sensitive — note `RE ENROLLMENT` has a space, not a hyphen):

1. `FORMER STUDENT`
2. `RE ENROLLMENT CLASS BOOKED`
3. `APPOINTMENT TODAY`
4. `NO-SHOW`
5. `RE ENROLLED` — mark **Won**
6. `OFFER EXPIRED` — mark **Lost**

> **Stage order is for admin UX only — it doesn't affect runtime.** The website resolves stages by name, not by position. Reorder for readability if you want. The live account currently has `OFFER EXPIRED` listed before `RE ENROLLED` in the kanban view; that's a cosmetic difference from the doc above and is harmless. The names + Won/Lost flags are what matter.

> **Live state check (2026-05-15):** the pipeline exists with all 6 stages. If you're setting up a fresh sub-account, you'll create it from scratch in §11 step 1.

---

## 7. Calendars to create

The brief calls for separate BTM calendars so admin sees BTM bookings independently from trial bookings. The audit confirms 5 BTM calendars already exist in the GBW account (`BTM Tiny Champions` etc.).

For a fresh sub-account, clone the existing trial calendars:

1. **Settings → Calendars** → click each trial calendar.
2. **⋯ Menu → Duplicate**.
3. **Rename** the copy to `BTM <Program Name>` (e.g. `BTM Tiny Champions`, `BTM Adults Brazilian Jiu-Jitsu`).
4. **Calendar Group**: assign to a new group `Back to the Mats` (create the group on the first calendar; subsequent calendars join the existing group).
5. Save.

You should end up with 5 BTM calendars in the `Back to the Mats` group:

| Program key | Trial calendar (env: `GHL_CAL_*`) | BTM calendar (env: `GHL_CAL_BTM_*`) |
|---|---|---|
| `tiny` | `Tiny Champions (Ages 3-4)` | `BTM Tiny Champions (Ages 3-4)` |
| `lc1` | `Little Champions 1 (Ages 5-6)` | `BTM Little Champions 1 (Ages 5-6)` |
| `lc2` | `Little Champions 2 (Ages 7-9)` | `BTM Little Champions 2 (Ages 7-9)` |
| `juniors` | `Juniors Jiu-Jitsu (Ages 10-15)` | `BTM Juniors Jiu-Jitsu (Ages 10-15)` |
| `adults` | `Adults Brazilian Jiu-Jitsu (Ages 16+)` | `BTM Adults Brazilian Jiu-Jitsu (Ages 16+)` |

The mapping is enforced by [`programs.ts`](../../src/data/programs.ts).

---

## 8. Workflows to create

In **Automation → Workflows → + Create Workflow**.

### 8.1 `BTM 30-Day Campaign`

| Field | Value |
|---|---|
| **Name** (exact) | `BTM 30-Day Campaign` |
| **Trigger** | Opportunity Stage Changed → Pipeline: `Back to the Mats`, Stage: `FORMER STUDENT` |
| **Body** | 9 emails + 3 SMS over 30 days. Copy from `GBW_Back_To_Mats_Full_Build_Package.docx` Part 2 — content lives inside the GHL workflow editor, not in this repo. |
| **Tail (auto-expire)** | `Wait 30 days` → `Update Opp Stage → Back to the Mats → OFFER EXPIRED`. Literal day count, no merge tag. Edit inside the workflow to change. |
| **Exit** | Website removes contact on successful booking via `handleBtmBooking → exitNurtureWorkflows('btm')`. No goal-event needed. |
| **Merge tags used** | `{{contact.first_name}}`, `{{custom_values.academy_name}}`, `{{custom_values.back_to_the_mats_page_url}}`, `{{custom_values.back_to_the_mats_deadline}}`, `{{custom_values.back_to_the_mats_offer_name}}` |

### 8.2 `BTM Appointment Confirmation`

| Field | Value |
|---|---|
| **Name** (exact) | `BTM Appointment Confirmation` |
| **Trigger (recommended)** | Opp Stage Changed → Pipeline: `Back to the Mats`, Stage: `RE ENROLLMENT CLASS BOOKED`. The opp is in workflow context automatically — no Find Opportunity needed. |
| **Trigger (alternative)** | `Customer Booked Appointment` → Calendar Group: `Back to the Mats`. Use only if you also need to catch walk-in/calendar-direct bookings that bypass the website. **Requires** an explicit `Find Opportunity` step as the first action: Pipeline `Back to the Mats` → Stage `RE ENROLLMENT CLASS BOOKED` → Status `Open` → contact: workflow contact → If not found: Stop. Without it, the Update Stage step later fails with "Internal Action Error — Please use Opportunity trigger/find opportunity action to get the opportunity". |
| **Body** | 3 emails + 2 SMS — immediate confirmation, day-before reminder, 2h-before reminder. Per docx Part 3. |
| **Wait anchors** | Use `{{appointment.start_time}}` from the trigger event for the 2h-before and day-before Waits, NOT `{{opportunity.last_appointment_start_iso}}`. The opp CF races with the stage commit; the trigger event field is reliable. |
| **Tail (morning-of move) — step-by-step** | After the last reminder send, add these steps in order: **(1)** Click `+` → `Wait` → category `Wait Until`. **(2)** In the Wait config drawer: choose "Wait Type" = `Specific Day & Time based on Custom Field`. **(3)** "Source": `Opportunity Custom Field`. **(4)** "Field": `Appointment Date` (the date-only field — NOT `Last Appointment Start ISO`). **(5)** "Time of day": `12:01 AM`. **(6)** "Time zone": `America/Los_Angeles`. Save the Wait step. **(7)** Click `+` → `Update Opportunity` → "Pipeline": `Back to the Mats`, "Stage": `APPOINTMENT TODAY`. **(8)** Scroll down inside the Update Opportunity config drawer; find the `Duplicate Opportunity` toggle (it's at the bottom, default ON) — **switch it OFF**. Save. This implements the schema's `auto_move_on_appointment_day` rule. |
| **Multi-day wait quirk** | If you used the alternative trigger and see the "use Opportunity trigger/find opportunity action" error after a long wait, add a **second** Find Opportunity step right before the Update Stage — opp context can drop across multi-day waits. |

### 8.3 `BTM Re-Booking Campaign (no-show)`

| Field | Value |
|---|---|
| **Name** (exact) | `BTM Re-Booking Campaign (no-show)` |
| **Trigger** | Opp Stage Changed → Pipeline: `Back to the Mats`, Stage: `NO-SHOW` |
| **Body** | 4 emails + 1 SMS over 12–14 days. Per docx Part 4. |
| **Tail (auto-expire)** | `Wait 14 days` → `Update Opp Stage → Back to the Mats → OFFER EXPIRED`. Literal day count. |
| **Exit** | Website removes contact on successful re-booking via `handleBtmBooking → exitNurtureWorkflows('btm')`. |

---

## 9. Stage transitions / auto-actions

| Enter stage | Action(s) |
|---|---|
| `FORMER STUDENT` | `fire_workflow` BTM 30-Day Campaign. 30d Wait + Update Stage to `OFFER EXPIRED` configured inside that workflow. |
| `RE ENROLLMENT CLASS BOOKED` | `fire_workflow` BTM Appointment Confirmation; `auto_move_on_appointment_day` → `APPOINTMENT TODAY` (Wait + Update Stage tail inside the workflow). |
| `APPOINTMENT TODAY` | None — admin classifies. |
| `NO-SHOW` | `fire_workflow` BTM Re-Booking Campaign. 14d Wait + Update Stage to `OFFER EXPIRED` configured inside that workflow. |
| `RE ENROLLED` | `set_status` won; `set_opp_value` Monetary Value = `{{custom_values.btm_student_value}}`; stamp `Enrollment Date` = today; `fire_workflow` 90-Day Review (shared with intro funnel). See note below. |
| `OFFER EXPIRED` | `set_status` lost. |

### Note: RE ENROLLED workflow-only actions

BTM does **not** fire a backflow webhook to the website (§10 below), so the actions on entry to `RE ENROLLED` that mutate the opp (Monetary Value, Enrollment Date) live *inside* the GHL workflow that triggers on entry to `RE ENROLLED` — the **"Student Enrolled"** workflow (id `0cae67f2-c4e7-4d2c-8290-f1b18216e7b3` in the GBW account; a single unified workflow for both TRIAL_CONV STUDENT ENROLLED (WON) and BTM RE ENROLLED, with an If/Else routing BTM-specific updates to the BTM branch). On the BTM branch the Update Opportunity step sets:

1. **Monetary Value** = `{{custom_values.btm_student_value}}`. Note this is **`btm_student_value`**, NOT `enrolled_student_value` — re-enrolled former students have a separate (lower) LTV bucket. See the custom-value definitions in [`config/ghl-schema.ts`](../../config/ghl-schema.ts).
2. **Status** = won (the GHL stage's own Won flag handles this too, but the workflow asserts it explicitly).
3. **Enrollment Date** = `{{right_now.date}}`. Intentionally unconditional: BTM does NOT enforce first-write-wins. An admin moving an opp out of and back into RE ENROLLED resets the date. (The TRIAL_CONV path's `stage-changed` webhook handler at `src/pages/api/webhooks/ghl/stage-changed.ts` does enforce first-write-wins for its own enrollment_date stamp — the two paths are intentionally asymmetric.)

For the TRIAL_CONV path, equivalent enrollment_date / monetaryValue / status updates are applied in code by the website's `stage-changed` webhook handler; no GHL workflow step is needed for those mutations.

---

## 10. Website ↔ GHL contract

The website's [`handleBtmBooking`](../../src/lib/ghl-adapter.ts) is the only code path that touches the BTM pipeline. It is dispatched from `POST /api/book` when the request has `flow: 'btm'` (the `/back-to-the-mats` page sends this).

| Website endpoint | What it does | Pipelines touched |
|---|---|---|
| `POST /api/book` with `flow: 'btm'` | Branch A (existing trainee opp): move to `RE ENROLLMENT CLASS BOOKED` + update CFs + exit nurture. Branch B (new trainee for this contact): delete the `FORMER STUDENT` opp + create a new per-trainee opp at `RE ENROLLMENT CLASS BOOKED` + exit nurture. | `BACK_TO_MATS` only |

BTM **does NOT** trigger any backflow webhooks. The intro funnel's backflow webhooks (Trial Conversion / Credit Monitoring / Appointment Status) ignore the BACK_TO_MATS pipeline.

If `PIPELINE_ID_BACK_TO_MATS` is unset in Vercel env, `handleBtmBooking` returns `stage: 'NO_PIPELINE'` and short-circuits — graceful degradation during initial provisioning.

### Per-trainee model

| Scenario | Outcome |
|---|---|
| Parent books their first BTM session (multi-trainee or self) | `FORMER STUDENT` opp deleted; new per-trainee opp created at `RE ENROLLMENT CLASS BOOKED` |
| Parent books a second trainee in the same session | `FORMER STUDENT` is already gone (no-op); second per-trainee opp created |
| Same trainee re-books (e.g. after no-show) | Existing per-trainee opp moved back to `RE ENROLLMENT CLASS BOOKED` (Branch A) |

This means a parent with 2 kids in BTM ends up with 2 opps in `RE ENROLLMENT CLASS BOOKED`, not 1. Intentional — admin needs per-trainee tracking for downstream classify.

---

## 11. Step-by-step setup checklist

This assumes the intro funnel is already set up. If not, complete [`intro-campaign-setup.md`](./intro-campaign-setup.md) phases A–G first.

> **SMS compliance gate (§3.3 + §15):** before step 9 (smoke test) — actually before step 10 (bulk import) at the latest — you MUST have confirmed SMS consent records for every phone number in the CSV, or stripped non-consenting numbers. This is a TCPA legal requirement, not a setup nicety.

### Step 1 — Create the `Back to the Mats` pipeline **[ADMIN]**

If the pipeline does not exist (fresh sub-account):

1. GHL → Settings → Pipelines → `+ Create Pipeline`.
2. Name: `Back to the Mats` (paste; don't retype).
3. Add 6 stages in the exact order from §6:
   - `FORMER STUDENT`
   - `RE ENROLLMENT CLASS BOOKED`
   - `APPOINTMENT TODAY`
   - `NO-SHOW`
   - `RE ENROLLED` → click the stage → mark **Won**
   - `OFFER EXPIRED` → click the stage → mark **Lost**
4. Save.

If the pipeline exists but is missing `OFFER EXPIRED` (you inherited a partial setup): click the pipeline → `+ Add Stage` → name `OFFER EXPIRED` → mark **Lost**.

**Accept:** 6 stages total per §6; correct Won/Lost flags; pipeline visible at Settings → Pipelines.

### Step 2 — Create the 3 BTM workflows **[ADMIN]**

Per §8. **After building each, click the Draft / Published toggle at the top-right and confirm it reads `Published`.**

**Accept:** Automation → Workflows lists `BTM 30-Day Campaign`, `BTM Appointment Confirmation`, `BTM Re-Booking Campaign (no-show)` — all with status badge **Published**, all triggers configured per §8 tables.

### Step 3 — Create the 5 BTM calendars **[ADMIN]**

Per §7. Clone each trial calendar, rename to `BTM <Program Name>`, assign to a new "Back to the Mats" calendar group.

**Accept:** Settings → Calendars shows 5 new `BTM <Program>` calendars in the `Back to the Mats` group.

### Step 4 — Run provision **[DEV]**

```bash
npm run onboard:ghl provision
```

Idempotent — safe to re-run. From repo root only.

**Accept:** The 4 custom values from §4 exist (Settings → Custom Values), and `back_to_the_mats_imported_at` exists (Settings → Custom Fields → Contact). Click into each custom value to verify the `Key` matches the `fieldKey` column in §4. Display-name match alone is NOT sufficient.

### Step 5 — Set the deadline custom value **[ADMIN]**

GHL → Settings → Custom Values → `Back to the Mats Deadline` → set value. Either human-readable (`Friday, June 8, 2026`) or ISO (`2026-06-08T23:59:00-07:00`) — the website parses both.

**Accept:** Visiting `/back-to-the-mats` renders the correct deadline + working countdown (within ~5 min of saving, due to cache TTL).

### Step 6 — Discover the BTM IDs **[DEV]**

Both commands from repo root:

```bash
npm run onboard:ghl discover
npx tsx scripts/discover-btm-calendars.ts
```

The calendar discover script matches calendar names by regex. **Your calendar names from step 3 must contain "BTM" or "Back to the Mats"** AND a program identifier — the matcher recognizes program tiers from these keywords in the name:

| Program key the script needs | Keywords it looks for in the calendar name |
|---|---|
| `tiny` | `tiny` |
| `lc1` | `little champions 1`, `lc1`, `lc 1` |
| `lc2` | `little champions 2`, `lc2`, `lc 2` |
| `juniors` | `junior` (handles both "Juniors" and "Junior") |
| `adults` | `adult` |

So calendar names like `BTM Tiny Champions (Ages 3-4)` or `BTM Little Champions 1 (Ages 5-6)` match. If you see `Could not find calendar for program 'lc1'` in the script output, the most likely cause is a calendar name that doesn't include `lc1`, `lc 1`, or `little champions 1` — rename and re-run.

**Accept:** Both scripts emit non-empty values for `PIPELINE_ID_BACK_TO_MATS`, `WORKFLOW_ID_BTM_30DAY`, `WORKFLOW_ID_BTM_CONFIRMATION`, `WORKFLOW_ID_BTM_REBOOKING`, and all 5 `GHL_CAL_BTM_*` variables in `.env.client.local`.

### Step 7 — Paste BTM env vars into Vercel **[DEV]**

See §13 for the paste list. Same workflow as intro Phase F: Vercel → Project → Settings → Environment Variables → Add New → check Production + Preview → Save. Redeploy after the last paste.

**Accept:** `curl "https://<your-domain>/api/health/ghl?key=<HEALTH_KEY>"` returns `{ ok: true, drift: [] }`. If `drift` is non-empty and contains BTM entries, re-check the names in GHL vs the schema-expected names.

### Step 8 — SMS compliance final check **[ADMIN]**

Re-confirm consent for every phone number in the CSV. See §15.

### Step 9 — Smoke-test with a single test contact **[ADMIN]**

See §14. Do NOT bulk-import before this passes.

### Step 10 — Bulk CSV import **[ADMIN]**

This is a **two-stage import** in GHL — there is no single one-click flow.

#### Stage 10A — Import contacts with tag + custom field

1. GHL → Contacts → `Import` → upload your CSV.
2. **Column mapping**: GHL auto-detects `email`, `firstName`, `lastName`, `phone` if your headers match. If not, map each manually.
3. In the import options panel:
   - **Add Tag**: `back-to-the-mats-import` (lowercase, hyphens). The tag is auto-created if it doesn't exist.
   - **Set Custom Field** → `Back to the Mats Imported At` → today's date.
4. Click `Import`.
5. Wait for the import to finish (GHL shows a progress bar).

**Accept after 10A:** GHL → Contacts → filter by tag `back-to-the-mats-import` → row count matches the CSV. Each contact has `back_to_the_mats_imported_at` set to today's date.

#### Stage 10B — Create one `FORMER STUDENT` opp per imported contact

GHL's native CSV import does NOT create opportunities. Use one of these patterns:

**Pattern 1 (simpler — bulk action, recommended for small lists):**
1. GHL → Contacts → filter by tag `back-to-the-mats-import`.
2. Select all (or up to GHL's bulk-select limit, typically 500/page — repeat per page if larger).
3. Click `Bulk Actions` → `Add to Pipeline`.
4. Pipeline: `Back to the Mats`, Stage: `FORMER STUDENT`.
5. Confirm.

**Pattern 2 (workflow-driven — for large lists or future imports):**
Create a separate one-time workflow (you can delete it after):
- Trigger: `Contact Tag Applied` → tag: `back-to-the-mats-import`.
- Action: `Create Opportunity` → Pipeline: `Back to the Mats`, Stage: `FORMER STUDENT`, Owner: <assign as needed>.
- Publish, then run the import.
This auto-creates one opp per imported contact as the tag is applied.

**Accept after 10B:** Pipeline view of `Back to the Mats` shows N opps in `FORMER STUDENT` matching the CSV row count. Each opp's contact has the `back-to-the-mats-import` tag.

#### Stage 10C — Verify campaign fires

The `BTM 30-Day Campaign` workflow has trigger `Pipeline Stage Changed → FORMER STUDENT`, so it fires automatically per opp created in 10B.

**Accept after 10C:** Automation → Workflows → `BTM 30-Day Campaign` → Statistics → enrolled-contact count matches the import volume; Email 1 starts delivering within minutes.

### Step 11 — Final drift check **[DEV]**

```bash
curl "https://<your-domain>/api/health/ghl?key=<HEALTH_KEY>"
```

**Accept:** `{ ok: true, drift: [] }`.

---

## 12. Provisioning scripts

| Command | What it does | When |
|---|---|---|
| `npm run onboard:ghl provision` | Creates the 4 BTM custom values + `back_to_the_mats_imported_at` contact CF. Idempotent — shared with intro funnel. | Step 4 |
| `npm run onboard:ghl discover` | Writes pipeline + workflow IDs (including `PIPELINE_ID_BACK_TO_MATS`, `WORKFLOW_ID_BTM_*`) to `.env.client.local`. | Step 6 |
| `npx tsx scripts/discover-btm-calendars.ts` | Writes `GHL_CAL_BTM_*` calendar IDs to `.env.client.local`. Matches calendar names containing "BTM" or "Back to the Mats" + program-tier keywords (`tiny`, `lc1`, `junior`, `adult`). | Step 6 |

If `discover-btm-calendars.ts` reports a missing program, rename the calendar in GHL UI to match the naming convention and re-run.

---

## 13. Env var paste list (Vercel)

Add to **Production AND Preview**:

```
# Pipeline ID
PIPELINE_ID_BACK_TO_MATS=…

# Workflow IDs
WORKFLOW_ID_BTM_30DAY=…
WORKFLOW_ID_BTM_CONFIRMATION=…
WORKFLOW_ID_BTM_REBOOKING=…

# Calendar IDs (one per program)
GHL_CAL_BTM_TINY=…
GHL_CAL_BTM_LC1=…
GHL_CAL_BTM_LC2=…
GHL_CAL_BTM_JUNIORS=…
GHL_CAL_BTM_ADULTS=…
```

> **No `PUBLIC_BACK_TO_MATS_DEADLINE_ISO` Vercel env var** — the deadline lives in the GHL custom value `back_to_the_mats_deadline` and the page fetches it at request time. Update it in GHL UI per campaign run; no redeploy needed.

---

## 14. Validation / smoke test (before bulk CSV import)

**Don't import the full CSV first.** Test with a single contact:

1. **GHL → Contacts → New Contact** with your own email + phone.
2. **Add to Pipeline**: `Back to the Mats → FORMER STUDENT` (manually create the opp).
3. Wait ~30 seconds — you should receive **Email 1** of the 30-Day Campaign on the test email.
4. **Open `/back-to-the-mats`** in a browser and book a class using the test contact's email.
5. Verify in GHL:
   - BTM opp moved to `RE ENROLLMENT CLASS BOOKED` ✓
   - Contact's Workflows tab shows `BTM 30-Day Campaign` as **Removed** ✓
   - `BTM Appointment Confirmation` is **Active** ✓
   - Email 1 of BTM Confirmation Campaign arrived ✓
   - **No new opp in `Lead Acquisition`** ✓ (BTM detection skipped it — confirms `flow: 'btm'` dispatch)
   - **No new opp in `Trial Conversion`** ✓ (same reason)
6. **On the morning of the booked session** (00:01 PT) — the BTM opp should auto-move from `RE ENROLLMENT CLASS BOOKED` to `APPOINTMENT TODAY`. If it doesn't, the Wait-until + Update Stage tail of `BTM Appointment Confirmation` is missing or pointed at the wrong custom field — re-check §8.2.

   > **Same-day verification (don't wait overnight):** book the test class for **tomorrow**. After booking, open the `BTM Appointment Confirmation` workflow in the editor. Confirm the tail steps exist: (a) a `Wait Until` step set to `Specific Day & Time based on Custom Field` → source `Appointment Date` → 12:01 AM PT, (b) followed by `Update Opportunity Stage → Back to the Mats → APPOINTMENT TODAY` with **Duplicate Opportunity OFF**. That visual check is sufficient verification — you don't need to physically observe the morning-of move.
7. **Manually move the opp to `NO-SHOW`** and verify the Re-Booking Campaign starts. Then book again from `/back-to-the-mats` and confirm the opp moves back to `RE ENROLLMENT CLASS BOOKED` (Branch A).
8. **Health check:**
   ```bash
   curl "https://<your-domain>/api/health/ghl?key=$HEALTH_KEY"
   ```
   Expect `{ ok: true, drift: [] }`.

If any step fails, check Vercel logs for `[handleBtmBooking]` entries — every branch has a structured log line with `BRANCH_A` / `BRANCH_B` / `BTM_LOOKUP_FAILED` / `BTM_CREATE_FAILED`.

---

## 15. SMS opt-in compliance (BEFORE CSV import)

The 30-Day Campaign sends SMS. CTIA/TCPA require prior express written consent before bulk SMS. Before importing:

- **If you have recorded SMS opt-in for these former students** (from their original enrollment paperwork): proceed.
- **If you don't, or aren't sure**: strip phone numbers without recorded consent from the CSV before import. Email-only nurture is fine without per-message SMS opt-in.

---

## 16. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 30-Day Campaign never fires after CSV import | CSV import didn't add to the pipeline, only tagged | Re-import or manually move each contact to `FORMER STUDENT`. The trigger is stage entry, not tag. |
| BTM booking creates a `Trial Conversion` opp instead of moving BTM | Website received `flow: 'trial'` (default) instead of `flow: 'btm'` | Verify `/back-to-the-mats` page is sending `flow: 'btm'` in the `POST /api/book` payload. Tail Vercel logs: `[handleBooking] BTM` should appear. |
| BTM booking returns `stage: 'NO_PIPELINE'` | `PIPELINE_ID_BACK_TO_MATS` unset in Vercel env | Run `npm run onboard:ghl discover`, copy the value, paste into Vercel, redeploy. |
| `BTM Appointment Confirmation` workflow throws "Internal Action Error — Please use Opportunity trigger" | Used trigger (B) `Customer Booked Appointment` without an initial Find Opportunity, OR opp context dropped across a multi-day wait | If using trigger (B): add `Find Opportunity` as the first step. If error fires after the long Wait: add a second `Find Opportunity` right before `Update Opportunity Stage`. Or switch to recommended trigger (A) `Opportunity Stage Changed`. See §8.2. |
| Opp doesn't auto-move to `APPOINTMENT TODAY` morning-of | Wait-until step at the end of `BTM Appointment Confirmation` is missing or references `Last Appointment Start ISO` (datetime) instead of `Appointment Date` (date) | Edit the workflow: Wait-until → Date Custom Field → `Appointment Date` → 12:01 AM. Then Update Opp Stage → `APPOINTMENT TODAY`, with Duplicate Opportunity disabled. |
| Duplicate opps created on /back-to-the-mats booking | Update Opportunity step in `BTM Appointment Confirmation` has Duplicate Opportunity enabled | Open the step → disable Duplicate Opportunity. |
| Parent's FORMER STUDENT opp not deleted on first booking | `findOpps` returned 0 results, or `deleteOpportunity` errored | Check `[handleBtmBooking]` logs — look for `findOpps result count=0` (rare race) or `FORMER STUDENT delete failed`. Manually delete the parent opp; future bookings work normally. |
| Re-booking after no-show creates a 2nd opp instead of moving | `trainee_key` not populated on the existing BTM opp, so `findByTraineeKey` returned null | Check the existing opp's `Trainee Key` CF in GHL. If empty, set it manually to the same slug the website generates (`<firstname>-<dobYYYYMMDD>` or `self-<contactId>` for self-bookings). |
| 30-Day Campaign keeps sending after booking | `WORKFLOW_ID_BTM_30DAY` unset in Vercel; `exitNurtureWorkflows('btm')` is a no-op | Re-paste env vars and redeploy. |
| Deadline shows as the wrong date on `/back-to-the-mats` | Old custom value cache; or `back_to_the_mats_deadline` set to an unparseable string | Wait ~5 min for cache TTL, or force-redeploy. Test value formats: `Friday, June 8, 2026` (human-readable) or `2026-06-08T23:59:00-07:00` (ISO with offset). Both parse. |
| Re-running CSV import creates duplicate opps for already-imported contacts | GHL allows duplicate opps on import | Filter the CSV pre-import to exclude contacts whose `Back to the Mats Imported At` is within 60 days. |

---

## 17. Glossary

See [`intro-campaign-setup.md`](./intro-campaign-setup.md) §15 for the canonical glossary (opportunity, pipeline, stage, workflow, custom value, custom field, merge tag, trainee_key, backflow, calendar group, Find Opportunity). BTM uses the same terms.

BTM-specific:

- **FORMER STUDENT opp**: the placeholder opp created on CSV import for the parent contact. Deleted on first per-trainee booking.
- **Per-trainee BTM opp**: created at `RE ENROLLMENT CLASS BOOKED`, keyed by `trainee_key`. One per trainee per contact.
- **`back-to-the-mats-import` tag**: applied at CSV-import time. Used by the SMS bot to detect former students in conversation and route them to the BTM offer instead of the trial offer.
- **BTM calendar group**: a folder in GHL grouping the 5 BTM calendars, for filter use in the `Customer Booked Appointment` trigger alternative.
