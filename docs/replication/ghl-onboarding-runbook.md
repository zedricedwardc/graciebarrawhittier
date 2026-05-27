# GHL Onboarding Runbook

Step-by-step for onboarding a new client onto the Gracie Barra Whittier integration template.

> **Audience:** technical operator (you, or a teammate). Assumes git + npm + Vercel access.
> **Time budget:** 90–120 minutes start to finish.
> **Source of truth:** [`config/ghl-schema.ts`](../../config/ghl-schema.ts) — the schema this runbook walks you through implementing.

---

## Before you start

You need:
- A Vercel account and a new project for the client
- A GHL sub-account with admin access
- The schema PR has been deployed (latest `master` works)
- ~2h of focused time

---

## Phase A — Repo + Vercel setup *(15 min)*

1. Clone or fork the website repo.
2. In Vercel, **Import Project** from GitHub.
3. Set the project's domain (or use the default `*.vercel.app`).
4. **Skip env vars for now** — we'll populate them once we know the IDs.
5. Trigger an initial deploy. It'll build successfully but most endpoints will 502 until env is set. That's expected.

---

## Phase B — Print the GHL setup checklist *(2 min)*

Locally:

```bash
cp .env.example .env
# Fill in just GHL_PIT_TOKEN and GHL_LOCATION_ID for now.
# Generate the PIT in GHL → Settings → Private Integrations.
# Required scopes:
#   contacts.readonly, contacts.write
#   opportunities.readonly, opportunities.write
#   calendars.readonly, calendars/events.readonly, calendars/events.write
#   locations.readonly
#   workflows.readonly
#   conversations/message.write   (only if sending SMS programmatically)

npm install
npm run onboard:ghl checklist
```

This prints every pipeline, stage, custom field, and workflow you need to create in GHL UI. Print or pipe to a file:

```bash
npm run onboard:ghl checklist > onboarding-checklist.txt
```

---

## Phase C — Manual GHL UI work *(60–90 min)*

Follow the checklist exactly. **Names matter** — the schema resolves names → IDs at runtime, so a typo here will silently break the integration.

### C.1 Pipelines (15 min)

In **GHL → Settings → Pipelines**, create 3 pipelines:

#### 1. Lead Acquisition
Stages (in this exact order):
- NEW LEAD
- TRIAL NURTURE
- NURTURE CAMPAIGN
- INTRO BOOKED (WON) ← mark as WON
- LOST / COLD ← mark as LOST

#### 2. Trial Conversion
Stages:
- INTRO BOOKED
- TRIAL APPOINTMENT DONE
- NO-SHOW
- INTRO CLASS REBOOKING
- TRIAL ACTIVE NURTURE
- TRIAL INACTIVE REACTIVATION
- STUDENT ENROLLED (WON) ← mark as WON
- LOST / COLD ← mark as LOST

#### 3. Trial Credit Monitoring
Stages:
- CREDIT ACTIVE
- ANOTHER TRIAL BOOKED
- APPOINTMENT TODAY
- ATTENDED APPOINTMENT
- NO-SHOW
- CREDITS EXHAUSTED
- REACTIVATION
- WON ENROLLED ← mark as WON
- LOST ← mark as LOST

> **Sanity check:** count stages — 5 / 8 / 9. Total = 22.

### C.2 Custom Fields (20 min)

In **GHL → Settings → Custom Fields → Contact**, create the 7 contact custom fields listed in the checklist. **Use the exact `fieldKey` strings** — they're case-sensitive and the integration resolves by them.

In **GHL → Settings → Custom Fields → Opportunity**, create the 10 opportunity custom fields. **All 10 must be available across all 3 pipelines** (this is GHL's default — opp custom fields are global by object, not per-pipeline).

> **Tip:** Click "Show on Card" for `trainee_first_name`, `program`, and `credits_remaining_display` — they're the most useful at-a-glance fields on the kanban view.

### C.3 Workflows (30–45 min)

In **GHL → Automation → Workflows**, create 15 workflows. Group them by purpose. The checklist shows the trigger config for each.

For the **3 backflow webhooks** (Trial Conversion stage changed, Credit Monitoring stage changed, Appointment status changed):

1. Create the workflow with the matching trigger.
2. Add a **Webhook action** with these settings:
   - URL: `https://<your-domain>/api/webhooks/ghl/<path>` (path varies — see checklist)
   - Method: POST
   - Custom Header: `X-GBW-Secret: <your GHL_WEBHOOK_SECRET value>`
   - Body: include all relevant merge fields (opp ID, contact ID, stage, trainee_key custom field, etc.)
3. Set the response handling to "Continue regardless" — we don't want failed retries blocking other actions.

For **campaign workflows** (Trial Nurture, Nurture Campaign, etc.):

- Add the SMS/email steps your client wants for that campaign.
- At the **end** of the campaign, add: **Wait** + **Update Opportunity Stage** to advance the opp to the next stage in the funnel. (This is how `auto_move_after` is implemented — declared in the schema, executed inside the campaign workflow.)

#### C.3.1 Nurture-campaign exits *(handled by website code)*

When a contact in a nurture stage books an appointment, the website moves their opp off the nurture stage (e.g. Lead Acq `TRIAL NURTURE` → `INTRO BOOKED (WON)`) AND calls `removeContactFromWorkflow` for every nurture workflow in that funnel. See `exitNurtureWorkflows` in [src/lib/ghl-adapter.ts](../../src/lib/ghl-adapter.ts).

This covers all 6 nurture workflows:

| Workflow env var | Pipeline | Funnel |
|---|---|---|
| `WORKFLOW_ID_TRIAL_NURTURE` | LEAD_ACQ | trial |
| `WORKFLOW_ID_NURTURE_CAMPAIGN` | LEAD_ACQ | trial |
| `WORKFLOW_ID_REBOOKING_CAMPAIGN` | TRIAL_CONV | trial |
| `WORKFLOW_ID_INACTIVE_REACTIVATION` | TRIAL_CONV | trial |
| `WORKFLOW_ID_ANOTHER_TRIAL_CAMPAIGN` | CREDIT_MON | credit |
| `WORKFLOW_ID_CREDIT_REACTIVATION` | CREDIT_MON | credit |

**No GHL UI configuration needed.** The website calls the GHL API directly on every booking; both code paths (`handleTrialBooking` for `/api/book` + `/api/webhooks/ghl/agent-booking-completed`, and `handleRebook` for credit-pipeline rebooks) invoke `exitNurtureWorkflows`.

> **Caveat — contact scope:** GHL workflows are contact-scoped, so the removal clears ALL of this contact's active enrollments in the workflow, not just the enrollment tied to the booking opp. For a parent with multiple trainees in the same nurture stage simultaneously, this means the other trainees' nurture also stops. Accepted trade-off: the alternative is the contact getting nurture messages AFTER booking, which is worse.
>
> **Bookings made manually in GHL UI** (admin books directly without going through the website) bypass this code path → contact stays enrolled. Admin should manually remove from the workflow, or the workflow will naturally time out on its built-in duration.

---

## Phase D — Provision API-creatable assets *(2 min)*

```bash
npm run onboard:ghl provision
```

Creates the 9 Custom Values defined in the schema (e.g. `trial_credits_default = 3`). Idempotent — safe to re-run.

---

## Phase E — Discover IDs *(2 min)*

```bash
npm run onboard:ghl discover
```

Reads the live GHL state, matches pipelines + workflows by name to the schema, and writes `.env.client.local` with all the discovered IDs.

> **If `discover` reports drift** (e.g. "Could not find workflow 'Trial Nurture Campaign'"), go back to Phase C and fix the GHL UI. The schema and the live GHL state must match exactly.

---

## Phase F — Populate Vercel env *(5 min)*

1. Open `.env.client.local`. It contains every discovered ID.
2. Copy all key=value pairs into Vercel → Project → Settings → Environment Variables (Production).
3. Also set the secrets you generated:
   - `GHL_WEBHOOK_SECRET` (32-byte hex)
   - `CANCEL_SIGNING_KEY` (32-byte hex)
   - `REBOOK_SIGNING_KEY` (32-byte hex)
   - `HEALTH_KEY` (16-byte hex)
4. Set `GHL_PIT_TOKEN` and `GHL_LOCATION_ID` if not already.
5. Trigger a Vercel redeploy.

---

## Phase G — Smoke test *(10 min)*

### G.1 Health check

```
GET https://<your-domain>/api/health/ghl?key=<HEALTH_KEY>
```

Expected: `{ ok: true, drift: [] }`. If `drift` is non-empty, fix what it lists.

### G.2 End-to-end opt-in

1. Submit the homepage opt-in form on the live site with a test email.
2. In GHL: confirm the contact is created with `lead_source = "homepage-optin"`.
3. Confirm a Lead Acquisition opp is at NEW LEAD stage.
4. Confirm the Trial Nurture campaign workflow is enrolled.
5. Wait 24 hours (or manually advance the timer) — opp should auto-move to TRIAL NURTURE.

### G.3 End-to-end booking

1. Use the test contact from G.2 to book a trial.
2. In GHL: confirm a Trial Conversion opp at INTRO BOOKED is created.
3. Confirm Lead Acquisition opp moved to INTRO BOOKED (WON).
4. Confirm `appointment_id`, `trainee_key`, `trial_date_iso` custom fields are populated.
5. **Confirm the Trial Nurture workflow exited:** GHL → Contacts → test contact → Workflows tab → `Trial Nurture Campaign` should show status *Removed* (within ~10s of booking). If still *Active*, the `exitNurtureWorkflows` call failed silently — check Vercel runtime logs for `[exitNurtureWorkflows]` warnings.
6. Wait until appointment end time — opp should auto-move to TRIAL APPOINTMENT DONE.

### G.4 Stage-change webhook

1. Manually move the Trial Conversion opp to TRIAL ACTIVE NURTURE in GHL UI.
2. Confirm a Trial Credit Monitoring opp is created at CREDIT ACTIVE.
3. Confirm `credits_remaining = 3` on the contact, `credits_remaining_display = 3` on the opp.

If all 4 smoke tests pass, the integration is live for this client.

---

## Common drift / failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `discover` can't find a workflow | Workflow name typo'd in GHL UI | Rename in UI to match schema, re-run discover |
| `health/ghl` reports custom-field drift | CF `fieldKey` typo'd | Fix in UI or schema, redeploy |
| Backflow webhook returns 401 | `X-GBW-Secret` header value differs from env | Update either; secret rotation is OK, must match |
| Auto-move never fires | Campaign workflow missing the Wait + Update Stage steps at end | Add them per checklist |
| Opps create duplicates on rebook | `trainee_key` not being set on opp | Verify CF exists in GHL and is populated by webhook handler |
| Credits never decrement | `last_decrement_trial_date` field missing on contact | Verify CF exists |
| Contact keeps getting nurture messages after booking | `WORKFLOW_ID_*` env vars unset, or admin booked manually in GHL UI bypassing the website | Verify env vars in Vercel; for manual GHL bookings, admin removes contact from workflow by hand. See §C.3.1. |

---

## Maintenance

- **Schema changes** (adding a stage, custom field, workflow): edit `config/ghl-schema.ts`, push. Existing clients re-run `onboard:ghl checklist` to see the diff and update GHL UI.
- **Custom Value tweaks** (e.g. change default credits from 3 → 5): edit in GHL UI directly, no redeploy needed.
- **Drift detection**: cron `/api/health/ghl?key=…` every 6 hours; pipe failures to Slack.

---

## When you've onboarded 2+ clients

The reproducibility tooling extracts naturally:

- The `onboard-client.ts` CLI handles 100% of the API-creatable work.
- The checklist + this runbook handle 100% of the manual UI work.
- The schema captures every per-client variable that isn't a credential.

If you find yourself doing the same fix on multiple clients, that's a schema gap — push the fix into `config/ghl-schema.ts` and re-deploy all clients.
