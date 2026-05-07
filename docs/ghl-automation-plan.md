# GHL Automation Plan — Trial Conversion Funnel

Locked plan for the multi-pipeline automation system in GoHighLevel that handles the trial-class conversion funnel for Gracie Barra Whittier.

> **Status:** Locked. Ready to build.
> **Last updated:** 2026-05-07
> **Inputs:** Architect synthesis of audit findings + GHL capability research, with user decisions on 7 open questions.

---

## 1. Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Walk-ins go through the public opt-in + booking pages like everyone else | Avoids a separate code path; revisit later if volume justifies it |
| 2 | Default trial credits stored as a GHL **Custom Value** `trial_credits_default = 3` | Admin can change without editing workflows |
| 3 | Contact-form leads create a Lead Acquisition opp at NEW LEAD | Reporting parity with opt-in leads |
| 4 | `lead_source` overwrites on every opt-in | Captures most recent intent |
| 5 | Adult bookings always have `trainee_is_self = true` | No adult-books-for-another-adult case |
| 6 | Admin notifications use the existing notification workflow | "Add to Workflow → [admin notifications]" wherever needed |
| 7 | (no #7 — see open items at bottom for `BOOKED_FOR` derivation) | |

## 2. Architecture decisions (the "why")

**Flat payloads.** GHL inbound webhooks don't reliably resolve nested dot-notation, and arrays definitely can't be referenced. The website's webhook handler flattens `parent`/`trainee` objects into flat snake_case keys before POSTing to GHL.

**Credits live on the Contact, mirrored to the Opportunity.** GHL's Math Operation only writes to Contact custom fields. Canonical source of truth is the contact field `credits_remaining`; we copy to opp `credits_remaining_display` for visibility on the kanban.

**`trainee_key` is a deterministic slug generated at the website.** Format: `slugify(firstName)-YYYYMMDD` for kids (using DOB), `slugify(firstName)-slugify(lastName)-self` for self-bookings. Used for sibling matching and rebook detection because GHL's Find Opportunity can't filter by arbitrary opp custom fields.

**Rebooking detection happens in `/api/book`, not in GHL.** Before POSTing, the handler queries GHL `/opportunities/search` for an open Trial Conversion opp with this `trainee_key` for this contact. If found, it adds `is_rebook=true` and `existing_opp_id=<id>` to the payload. GHL workflow takes a different branch instead of duplicating opps.

**Single source of truth for WON closure: Trial Credit Monitoring pipeline.** Only W5 closes the Lead Acquisition + Trial Conversion opps as ENROLLED. If admin moves Trial Conversion → ENROLLED directly (bypass), W5's back-stop synthesizes the missing Credit Monitoring opp and lets that pipeline cascade the close.

---

## 3. Required website code changes (PR 1)

These ship before any GHL workflow is built.

### 3.1 Flatten both webhook payloads

Replace nested `parent` / `trainee` objects with flat keys.

**Opt-in webhook payload (new shape):**
```
parent_first_name, parent_last_name, parent_email, parent_phone,
parent_consent_sms, parent_zip,
trainee_is_self (bool), trainee_first_name, trainee_last_name,
trainee_dob, trainee_age, trainee_program, trainee_key,
form_source ("homepage-optin" | "kids-optin" | "adults-optin" | "contact-form"),
page,
message,
idempotency_key
```

**Appointment webhook payload (new shape):** all of the above plus:
```
appointment_id, appointment_contact_id, appointment_calendar_id,
trial_date_iso, trial_date_display,
program, program_name,
booked_for ("self" | "child"),  // derived from trainee_is_self
is_rebook (bool), existing_opp_id (string | "")
```

### 3.2 `trainee_key` generator

Create `src/lib/trainee-key.ts`:

```ts
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function traineeKey(input: {
  isSelf: boolean;
  firstName: string;
  lastName: string;
  dobYYYYMMDD?: string;
}): string {
  if (input.isSelf) return `${slug(input.firstName)}-${slug(input.lastName)}-self`;
  return `${slug(input.firstName)}-${input.dobYYYYMMDD || 'nodob'}`;
}
```

### 3.3 Idempotency keys

- **Opt-in:** `idempotency_key = sha1(parent_email + trainee_key + form_source + dayBucket)`
- **Appointment:** `idempotency_key = appointment_id`

Maintain a 24h dedupe set (in-memory + KV-backed). Duplicates → drop with `200 OK`.

### 3.4 Pre-POST rebook lookup

In `/api/book` handler, before POSTing the appointment webhook to GHL:

1. GET `/opportunities/search?contactId=<contactId>&pipelineId=<TrialConversion>` via GHL API.
2. Filter results client-side by `trainee_key` AND stage in `{INTRO BOOKED, NO-SHOW, TRIAL ACTIVE NURTURE}`.
3. If match found → set `is_rebook=true`, `existing_opp_id=<id>`. Else `is_rebook=false`, `existing_opp_id=""`.

### 3.5 Compute `booked_for` server-side

Derive from `trainee_is_self`. Don't trust admin edits.

---

## 4. GHL Custom Values

Create in **GHL → Settings → Custom Values**:

| Key | Default | Notes |
|---|---|---|
| `trial_credits_default` | 3 | Admin can edit without touching workflows |
| `nurture_no_show_timeout_days` | 14 | NO-SHOW → DROPPED auto-move timeout |
| `credit_idle_timeout_days` | 7 | CREDIT ACTIVE → CREDIT IDLE |
| `credit_expired_timeout_days` | 21 | CREDIT IDLE → CREDIT EXPIRED |

---

## 5. Custom fields

### 5.1 Contact custom fields

| Field | Type | Set by |
|---|---|---|
| `credits_remaining` | Number | Webhook (init from Custom Value) / W4 (Math decrement) |
| `last_trainee_key` | Text | Webhook |
| `active_trial_trainee_key` | Text | Workflow |
| `active_trial_date_iso` | DateTime | Workflow |
| `last_idempotency_key` | Text | Webhook |
| `last_decrement_trial_date` | DateTime | W4 (idempotency guard) |
| `lead_source` | Text | Webhook (overwrite on every opt-in) |
| `household_trainee_count` | Number | Webhook |

### 5.2 Lead Acquisition opportunity fields

| Field | Set by |
|---|---|
| `form_source` | Webhook |
| `household_trainee_keys` (comma list) | W1 (append-if-missing) |
| `first_trainee_key` | Webhook |

### 5.3 Trial Conversion opportunity fields

| Field | Set by |
|---|---|
| `trainee_key` | Webhook |
| `trainee_first_name` | Webhook |
| `trainee_program` | Webhook |
| `appointment_id` | Webhook |
| `trial_date_iso` | Webhook |
| `trial_date_display` | Webhook |
| `booked_for` | Webhook (Self/Child) |
| `is_rebook` | Webhook |

### 5.4 Trial Credit Monitoring opportunity fields

| Field | Set by |
|---|---|
| `trainee_key` | Workflow (copied from Trial Conversion) |
| `trainee_first_name` | Workflow |
| `credits_remaining_display` | Workflow (mirrored from contact) |
| `last_trial_date_iso` | Workflow (set on every CREDIT ACTIVE entry) |
| `idle_since_iso` | Workflow |

---

## 6. Pipelines & stages (final)

### 6.1 Lead Acquisition (parent contact)

```
NEW LEAD → ENGAGED → TRIAL BOOKED → ENROLLED (won) | LOST (lost)
```

### 6.2 Trial Conversion (one opp per booked trial; disambiguated by `trainee_key`)

```
INTRO BOOKED → TRIAL ATTENDED → TRIAL ACTIVE NURTURE → ENROLLED (won) | DROPPED (lost)
                ↘ NO-SHOW ↗
```

> Note: original "TRIAL APPOINTMENT DONE" stage removed. Admin moves directly from INTRO BOOKED to TRIAL ATTENDED or NO-SHOW.

### 6.3 Trial Credit Monitoring (one opp per active trial pass; disambiguated by `trainee_key`)

```
CREDIT ACTIVE → CREDIT IDLE → CREDIT EXPIRED (lost)
              ↘ STUDENT ENROLLED (won)
```

---

## 7. Workflows

Six workflows + one calendar-trigger sub-workflow.

### W1 — Opt-in Intake

- **Trigger:** Inbound Webhook (opt-in)
- **Filter:** `idempotency_key` ≠ `{{contact.last_idempotency_key}}`

**Actions:**
1. Upsert Contact by `parent_email` + `parent_phone`.
2. Set contact fields: `last_idempotency_key`, `last_trainee_key`, `lead_source` (overwrite), `household_trainee_count`.
3. If `credits_remaining` is empty → Math: set to `{{custom_values.trial_credits_default}}`.
4. **Find Opportunity** in Lead Acquisition for this contact.
   - **Not found:** Create Lead Acquisition opp at NEW LEAD. Set `form_source`, `first_trainee_key`, `household_trainee_keys = trainee_key`.
   - **Found:** Update opp — append `trainee_key` to `household_trainee_keys` if not already present. **Do not create a second opp.**
5. Add to "Lead Nurture" campaign.
6. Add to admin-notifications workflow.

**Addresses:** P0-5 (multi-child dedupe), P1-5 (idempotency), P1-7 (contact-form opp), P2 (lead source).

---

### W2 — Appointment Intake

- **Trigger:** Inbound Webhook (appointment)
- **Filter:** `idempotency_key` ≠ `{{contact.last_idempotency_key}}`

**Actions:**
1. Set `last_idempotency_key`.
2. **If/Else on `is_rebook`:**
   - **`true` (rebook):**
     - Update Opportunity by ID = `existing_opp_id`:
       - Stage → INTRO BOOKED
       - Update `appointment_id`, `trial_date_iso`, `trial_date_display`, `is_rebook=true`
     - **Do not create a new Trial Conversion opp.**
   - **`false`:**
     - Find Lead Acquisition opp.
       - If none → Create at TRIAL BOOKED with `form_source="walkin"` (back-stop; in practice all bookings should have one from W1).
       - Else → Update Lead Acquisition stage → TRIAL BOOKED.
     - Create Trial Conversion opp at INTRO BOOKED with all webhook fields. Use `trainee_is_self` to set `booked_for` and the opp name:
       - `isSelf=true` → name = `{{parent_first_name}} {{parent_last_name}}`
       - `isSelf=false` → name = `{{trainee_first_name}} {{parent_last_name}}`
3. Set contact: `active_trial_trainee_key = trainee_key`, `active_trial_date_iso = trial_date_iso`.
4. Remove from "Lead Nurture" campaign.

**Addresses:** P0-2 (rebook collision), P0-3 (trainee key), P1-1 (no Lead Acq fallback), P1-5, P1-8 (booked_for derivation).

---

### W3 — Trial Conversion stage router

- **Trigger:** Pipeline Stage Changed → Trial Conversion (any stage)

Branch on the new stage:

#### INTRO BOOKED entry
- No internal timer. The `W3-reminders` sub-workflow (calendar-trigger) handles all time-relative reminders. Admin moves manually to TRIAL ATTENDED or NO-SHOW.

#### TRIAL ATTENDED entry
- Find Opportunity in Trial Credit Monitoring.
  - Manual filter: in If/Else, check `{{opportunity.trainee_key}} == {{trigger.trainee_key}}`.
  - **Not found:** Create Credit Monitoring opp at CREDIT ACTIVE:
    - Name = same as Trial Conversion opp
    - `trainee_key`, `trainee_first_name`, `last_trial_date_iso = trial_date_iso`
    - `credits_remaining_display = {{contact.credits_remaining}}`
  - **Found:** Update opp → stage CREDIT ACTIVE, set `last_trial_date_iso`, `credits_remaining_display`.
- Move Trial Conversion opp to TRIAL ACTIVE NURTURE.
- Add to "Post-trial nurture" campaign.

#### NO-SHOW entry
- Wait → Condition (timeout `{{custom_values.nurture_no_show_timeout_days}}`, cancel-on-stage-change):
  - Condition = stage moved to INTRO BOOKED (rebook) OR ENROLLED.
  - **Timeout:** move opp → DROPPED, remove from all nurture campaigns.
  - **Condition met:** exit (W3 re-triggers on the new stage).

#### TRIAL ACTIVE NURTURE entry
- Wait → Condition (timeout 14 days, cancel-on-stage-change):
  - Condition = ENROLLED OR DROPPED.
  - **Timeout:** stay at NURTURE; remove from short-cycle campaigns; add to long-cycle "Convert to Member" campaign.

#### ENROLLED entry (won)
- No-op here. W5 is the source of truth for cascading closes.

#### DROPPED entry (lost)
- Remove from all Trial Conversion campaigns.
- If contact has no other open Trial Conversion opps → move Lead Acquisition opp to LOST.

**Addresses:** P0-1 (no auto-move race), P0-6 setup, P1-2 (cancel-on-rebook), P1-3 (no theatrical wait), P1-4 (Trial Date on credit opp), P1-6, P1-9.

---

### W3-reminders — Pre-trial reminders

- **Trigger:** Calendar Appointment Created (filtered to trial calendars: TINY, LC1, LC2, JUNIORS, ADULTS)

**Actions:**
1. Wait until appointment − 24h → SMS/email reminder.
2. Wait until appointment − 2h → SMS reminder.
3. Wait until appointment + 1h → "Add to Workflow → admin notifications" with note "trial just ended, mark attended/no-show."

**Why separate:** Calendar-relative waits only work natively when the workflow context is a real Calendar Appointment. Trials ARE real appointments (created by `/api/book` calling GHL's `createAppointment`), so this trigger family Just Works.

**Addresses:** R3 (capability gap), removes need for custom datetime waits in W2.

---

### W4 — Credit Decrement

- **Trigger:** Pipeline Stage Changed → Trial Credit Monitoring → CREDIT ACTIVE
- **Filter:** `{{opportunity.last_trial_date_iso}}` ≠ `{{contact.last_decrement_trial_date}}`

**Actions:**
1. Math Operation on Contact: `credits_remaining = credits_remaining − 1`.
2. Set contact `last_decrement_trial_date = {{opportunity.last_trial_date_iso}}`.
3. Update Opportunity: `credits_remaining_display = {{contact.credits_remaining}}`.
4. **If/Else on credits_remaining:**
   - `≤ 0` → move opp to CREDIT EXPIRED.
   - `> 0` → Wait `{{custom_values.credit_idle_timeout_days}}` days (cancel on stage change away from CREDIT ACTIVE). On timeout: move to CREDIT IDLE, set `idle_since_iso = now`.

**Addresses:** P0-4 (the trial-date guard means re-entry from IDLE→ACTIVE on the same trial is a no-op; only a NEW trial date triggers a real decrement).

---

### W5 — Sibling Reconciliation

- **Trigger A:** Pipeline Stage Changed → Trial Credit Monitoring → STUDENT ENROLLED
- **Trigger B (back-stop):** Pipeline Stage Changed → Trial Conversion → ENROLLED

#### Trigger A actions:
1. Find all Credit Monitoring opps for this contact.
   - If all are in `{STUDENT ENROLLED, CREDIT EXPIRED}` → move Lead Acquisition opp to ENROLLED.
   - Else → leave Lead Acquisition open (sibling still active).
2. Find matching Trial Conversion opp by `trainee_key` → move to ENROLLED.
3. Remove contact from all trial/credit nurture campaigns.

#### Trigger B actions (bypass back-stop):
1. Find Credit Monitoring opp by `trainee_key`.
2. **Not found:** Create one at STUDENT ENROLLED (synthesizes the missing opp).
3. Exit. The new STUDENT ENROLLED entry will re-fire Trigger A and complete the cascade.

**Addresses:** P0-6 (bypass case), P1-6 (single source of truth for WON), P1-9.

---

### W6 — Credit Idle / Expiry Lifecycle

- **Trigger:** Pipeline Stage Changed → Trial Credit Monitoring (any stage)

#### CREDIT IDLE entry
- Add to "Reactivation" campaign.
- Wait `{{custom_values.credit_expired_timeout_days}}` days (cancel on stage change):
  - Condition = stage = CREDIT ACTIVE OR STUDENT ENROLLED.
  - **Timeout:** move opp to CREDIT EXPIRED.

#### CREDIT EXPIRED entry (lost)
- Remove from all credit campaigns.
- Add to "Long-term winback" campaign.
- Find matching Trial Conversion opp by `trainee_key`. If still open → move to DROPPED.

#### CREDIT ACTIVE re-entry (from IDLE)
- Remove from "Reactivation" campaign.
- Does NOT re-trigger W4 decrement (idempotency guard handles this).

#### STUDENT ENROLLED entry
- Handled by W5.

**Addresses:** P0-4, P1-6, P1-9.

---

## 8. Build sequence

### PR 1 — Website infra

1. Create `src/lib/trainee-key.ts`.
2. Update `OptInForm.astro` submit handler: flatten payload, add `trainee_key` (set isSelf based on form context — adult page = true, kids pages = false), add `idempotency_key`.
3. Update contact form submit handler: same flattening, `form_source = "contact-form"`.
4. Update `/api/book.ts`: flatten payload, generate `trainee_key`, do pre-POST rebook lookup against GHL `/opportunities/search`.
5. Add 24h dedupe storage (in-memory Map keyed by `idempotency_key`, with optional KV upgrade later).

**Test:** POST sample opt-in + appointment to staging GHL sub-account; verify flat fields land on contact.

### PR 2 — GHL config

1. Create Custom Values (Section 4).
2. Create Custom Contact Fields (Section 5.1).
3. Create Custom Opportunity Fields per pipeline (Sections 5.2–5.4).
4. Create / verify pipeline stages (Section 6).

**Test:** manually set values in admin UI, confirm `{{contact.credits_remaining}}` and `{{opportunity.trainee_key}}` resolve in a test email.

### PR 3 — Workflows

Build in order, with a smoke test after each:

1. **W1** — POST opt-in for new family. Expect 1 Lead Acquisition opp at NEW LEAD, contact `credits_remaining=3`. POST second opt-in same parent different child. Expect SAME opp updated, `household_trainee_keys` has 2 entries.
2. **W2** — Book trial for child from W1 → Trial Conversion opp at INTRO BOOKED, Lead Acq → TRIAL BOOKED. Book again same child → existing opp updated, no duplicate.
3. **W3-reminders** — Use a test calendar appointment. Verify 24h-before reminder fires (shorten timer for test).
4. **W3** — Move Trial Conversion → TRIAL ATTENDED → Credit Monitoring opp at CREDIT ACTIVE. Move to NO-SHOW → 14-day timer starts; rebook within window → timer cancels.
5. **W4** — TRIAL ATTENDED for trial #1 → credits 3→2. Move opp IDLE→ACTIVE without changing trial date → credits stay at 2 (idempotency holds — P0-4 fix verified). Mark trial #2 attended (new `trial_date_iso`) → credits 2→1.
6. **W5** —
   - (a) Single child, move credit opp → STUDENT ENROLLED → Lead Acq + Trial Conv both → ENROLLED.
   - (b) Two siblings, enroll first → Lead Acq stays open. Enroll second → Lead Acq → ENROLLED.
   - (c) Bypass — manually move Trial Conv → ENROLLED with no credit opp; confirm synthesized credit opp + cascade.
7. **W6** — Force credit opp to IDLE; wait 21 days (or shrink for staging) → EXPIRED + matching Trial Conv → DROPPED.

---

## 9. Items still pending user input at build time

- **Admin notifications workflow ID/name** — needed for "Add to Workflow" actions in W1, W2, W3-reminders, etc.
- **Campaign IDs** — names listed in this plan ("Lead Nurture", "Post-trial nurture", "Reactivation", "Long-term winback", "Convert to Member"). Confirm or rename to match what's already in GHL.
- **DOB collection on opt-in / booking** — `trainee_key` uses DOB for kids. Currently the website collects `age` (number), not DOB. Need to either (a) collect DOB on the booking form, or (b) accept that age-based key has collision risk for siblings ~1 year apart born in same calendar window. Recommend option (a) — small form change.

---

## 10. References

- **Audit (P0/P1/P2 findings):** ran via subagent on 2026-05-07.
- **GHL capability research:** ran via subagent on 2026-05-07. Key sources:
  - https://help.gohighlevel.com/support/solutions/articles/155000003147-workflow-trigger-inbound-webhook
  - https://help.gohighlevel.com/support/solutions/articles/155000004752-workflow-action-create-opportunity
  - https://help.gohighlevel.com/support/solutions/articles/155000004751-workflow-action-find-opportunity
  - https://help.gohighlevel.com/support/solutions/articles/155000004753-workflow-action-update-opportunity
  - https://help.gohighlevel.com/support/solutions/articles/155000003356-workflow-action-math-operation
  - https://help.gohighlevel.com/support/solutions/articles/155000002470-workflow-action-wait
- **Architect synthesis:** ran via subagent on 2026-05-07.
