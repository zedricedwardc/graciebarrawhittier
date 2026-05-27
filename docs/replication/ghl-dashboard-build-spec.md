# GHL Custom Dashboard — Build Spec (Gracie Barra Whittier)

Corrected, subaccount-accurate build spec for the studio dashboard. Derived from
the generic *CIT Jiu-Jitsu Dashboard Template* (docx, May 2026) and reconciled
against the live Gracie Barra Whittier subaccount (`eMHOrbrPAfFd2S1ORNKL`) and
this repo's `config/ghl-schema.ts`.

Read this **instead of** the generic docx — the docx's pipeline/stage names do
not match this subaccount.

---

## 1. Why the generic docx can't be followed literally

| Generic docx assumes | This subaccount actually has |
|---|---|
| 4 pipelines (Lead Acq, Trial Conversion, "Active Students", Back to the Mats) | **5 CIT pipelines** + **7 legacy pipelines** with 5,800+ legacy opps |
| Stage "Student Enrolled (WON)" in P2 and P3 | Enrollment WON lives in `Trial Conversion / STUDENT ENROLLED (WON)` and `Trial Credit Monitoring / WON ENROLLED`; the "Active Students" pipeline is empty and has no enrolled stage |
| Lead Source = `Website` / `Walk-In` / `Meta Ads` / `Google Ads` custom field | Lead channel is written to GHL's **native contact `source`** attribute by the website (`Website` today; `Walk-In` once the front-desk form exists) |
| Pipelines carry a default $ value | Set per-opportunity by the website's `set_opp_value` action (see §3) |

### CIT pipelines (use these)

| Schema key | GHL name | Pipeline ID |
|---|---|---|
| `LEAD_ACQ` | Lead Acquisition | `iCvmuak82CNxovJfbWs8` |
| `TRIAL_CONV` | Trial Conversion | `RxJkooNY7kA5sIyuOorI` |
| `CREDIT_MON` | Trial Credit Monitoring | `orJdRIeRqRqZpVTDnZpO` |
| `BACK_TO_MATS` | Back to the Mats | `EWTA8eW0UNTsMioWI0Ce` |
| `REVIVAL` | Revival Protocol | `ZfyLP6ghuqzsOPqNr7N7` |

### Legacy pipelines — EXCLUDE from every "all pipelines" widget

`30 Day Jiu-Jitsu Challenge`, `Academy Launch Pipeline` (3,326 opps),
`Active Students` (empty), `Night King Pipeline` (1,457), `Sales Pipeline
(Editable)`, `The Ultimate Jiu-Jitsu Trial` (224), `🔨 Home Services New
Customer Pipeline` (815). Any widget the docx labels "All Pipelines" must be
configured to select **only the 5 CIT pipelines** — otherwise 5,800+ legacy
opportunities pollute the numbers.

---

## 2. Corrected widget spec (all 31)

Date filter default: **Last 30 Days**. Width as in the docx.

### Section 1 — Lead Flow Overview

| # | Widget | Corrected config |
|---|---|---|
| 1 | New Leads — Last 30 Days | Contacts, Created Date = Last 30 Days. Count. |
| 2 | New Leads — Month to Date | Contacts, Created Date = Month to Date. Count. |
| 3 | Intro Classes Booked — 30 Days | Opportunities, **Trial Conversion**, Stage = `INTRO BOOKED`, Created last 30 days. |
| 4 | Lead Source Breakdown | Contacts, Last 30 Days, group by **Source** (native attribute). Shows Website / Walk-In / Meta Ads / Google Ads / Referral. |
| 5 | Leads Over Time | Contacts, new by day, Last 30 Days. |

### Section 2 — Client Acquisition & Revenue

| # | Widget | Corrected config |
|---|---|---|
| 6 | New Enrollments — Last 30 Days | Opportunities, **Trial Conversion**, Stage = `STUDENT ENROLLED (WON)`, Last 30 Days. Both the direct-trial and credit-pass paths land here, so this single stage = all new enrollments. **Do not also count `Trial Credit Monitoring / WON ENROLLED`** — it cross-marks the same Trial Conversion opp (double-count). |
| 7 | New Enrollments — Month to Date | Same as #6, Month to Date. |
| 8 | Revenue Generated — Last 30 Days | Opportunities, status = Won, pipelines = **Trial Conversion + Back to the Mats only**, Last 30 Days. Uses `monetaryValue` (set automatically — see §3). |
| 9 | Total Revenue — All Time | Same as #8, no date filter. Trial Conversion + Back to the Mats only (Credit Monitoring excluded to avoid double-count). |
| 10 | Conversion Rate | Opportunities, **Trial Conversion** pipeline, Won vs Open. |

### Section 3 — Pipeline Health

| # | Widget | Corrected config |
|---|---|---|
| 11 | Pipeline Funnel — Trial Conversion | Funnel, pipeline = **Trial Conversion**. |
| 12 | Stage Distribution | **Trial Conversion**, current opps per stage. |
| 13 | Upcoming Classes — Next 7 Days | Appointments, status = Confirmed/Scheduled, next 7 days, the 5 trial calendars (+ 5 BTM calendars if desired). |
| 14 | No-Shows — Last 30 Days | Appointments, status = No-Show, Last 30 Days. |
| 15 | Leads Stuck — Nurture Campaign | Opportunities, **Lead Acquisition**, Stage = `NURTURE CAMPAIGN`. |
| 16 | Opportunity Status Overview | Opportunities, Open/Won/Lost, **5 CIT pipelines only** (exclude legacy). |

### Section 4 — Actions & Follow-Up

| # | Widget | Corrected config |
|---|---|---|
| 17 | Pending Tasks | Tasks, Status = Pending, All Users. As docx. |
| 18 | Manual Actions Needed | Manual actions widget. As docx. |
| 19 | Unread Conversations | Conversations, Status = Unread. As docx. |
| 20 | Overdue Tasks | Tasks, Status = Overdue. As docx. |
| 21 | SMS Sent — Last 30 Days | Conversations, outbound SMS, Last 30 Days. As docx. |

### Section 5 — Lead Sources

| # | Widget | Corrected config |
|---|---|---|
| 22 | Lead Source Report | Contacts, Last 30 Days, full breakdown by native **Source**. Values: `Website` (live now), `Walk-In` (after the front-desk form is built), `Meta Ads` / `Google Ads` (when ads run), `Referral` (manual). |
| 23 | Website Leads — Last 30 Days | Contacts, Source = `Website`, Last 30 Days. |
| 24 | Walk-In Leads — Last 30 Days | Contacts, Source = `Walk-In`, Last 30 Days. 0 until the front-desk QR form exists. |
| 25 | Paid Ad Leads — Last 30 Days | Contacts, Source = `Meta Ads` OR `Google Ads`, Last 30 Days. 0 until ads run. |

### Section 6 — Website & Reputation

| # | Widget | Corrected config |
|---|---|---|
| 26 | Website Sessions — 30 Days | GA4 widget. Requires GA4 integration (§4). |
| 27 | Website Users — 30 Days | GA4 widget. Requires GA4 integration. |
| 28 | Top Traffic Sources | GA4 channel grouping. Requires GA4 integration. |
| 29 | New Reviews — Last 30 Days | Reputation widget. Requires Google Business Profile connected (§4). |
| 30 | Average Star Rating | Reputation widget. |
| 31 | Total Review Count | Reputation widget. |

---

## 3. System adaptations — DONE in the website codebase

These shipped so the dashboard reads real data (commit on branch `master`):

- **Lead channel → native `source`.** `handleOptIn` sets the GHL native contact
  `source` attribute via `channelForSource()` (`src/lib/lead-types.ts`). Every
  website opt-in resolves to `Website Leads`. Powers widgets 4, 22, 23, 25.
- **Opt-in page sub-layer → `optin_page` CF.** `handleOptIn` also sets the
  `optin_page` dropdown CF (Homepage / Kids Page / Adults Page / Offer Page (QR)
  / Contact Page) via `pageLabelForSource()` — the page-level breakdown within
  each Lead Source channel. The `LEAD_SOURCES` registry in `lead-types.ts` is
  the single place that maps an opt-in slug to its channel + page label; adding
  a Meta/Google ad landing page is one registry entry there.
- **Revenue on WON.** New `set_opp_value` transition action stamps an opp's
  `monetaryValue` when it reaches `Trial Conversion / STUDENT ENROLLED (WON)`,
  read from the `enrolled_student_value` GHL custom value. Powers widgets 8–10.
- **`enrolled_student_value` custom value** — created in GHL (id
  `wPliAH37pBhbofozbNGA`, value `160`). Studio admin can edit it under
  Settings → Custom Values to change the per-enrollment dollar value.
- **Health check** — `/api/health/ghl` now flags drift if
  `enrolled_student_value` is unset.

---

## 4. Operator runbook — remaining GHL-UI steps (need a human)

These cannot be done via API and need the studio admin / Zedric logged into the
GHL subaccount with a Google account:

1. **Back to the Mats revenue.** BTM has no backflow webhook — an admin moving
   an opp to `RE ENROLLED` never reaches the website, so `monetaryValue` stays
   `$0`. Create (or extend) a GHL workflow:
   - **Trigger:** Opportunity Stage Changed → *Back to the Mats* → stage `RE ENROLLED`
   - **Action:** Update Opportunity → Monetary Value = `{{custom_values.enrolled_student_value}}`

   Do **not** put this on the *BTM Appointment Confirmation* workflow — that one
   triggers on `RE ENROLLMENT CLASS BOOKED` (booking, not the sale).
2. **GA4 integration** (widgets 26–28). Settings → Integrations → Google
   Analytics → connect the studio's GA4 property. Needs the GTM/GA4 tracking
   code already live on the website. 24–48 h data delay.
3. **Reputation** (widgets 29–31). Settings → Integrations → connect Google
   Business Profile so reviews flow into the Reputation widgets.
4. **Walk-In front-desk QR intake form** (widgets 24, 22). Build a GHL form
   (form builder is UI-only), print its public URL as a QR code for the front
   desk, and confirm submitted contacts get native Source = `Walk-In`
   (set a hidden field or the form's source setting).
5. **Build the dashboard.** Dashboard → Edit Dashboard → add the 31 widgets per
   §2, 6 sections / 13 rows, default date range Last 30 Days. GHL has no
   cross-subaccount dashboard clone, so this is a manual build.

---

## 5. Step-by-step — BTM `RE ENROLLED` revenue workflow (runbook item #1)

Builds the workflow that stamps `monetaryValue` on a Back to the Mats
opportunity when an admin moves it to `RE ENROLLED`. ~5 minutes in the GHL UI.

**Prerequisite (already done):** the `enrolled_student_value` custom value
exists in the subaccount (value `160`).

1. **Open Workflows.** Left nav → **Automation → Workflows**.

2. **Start the workflow.** A draft named **`WF4 — BTM Re-Enrolled Handoff`**
   may already exist — if so, open it and skip to step 4. Otherwise click
   **+ Create Workflow → Start from Scratch**.

3. **Name it.** Top-left title → `BTM — Set Revenue on RE ENROLLED`.

4. **Add the trigger.** Click **Add New Trigger** → search `stage` → choose
   **Pipeline Stage Changed** (older GHL labels it *Opportunity Stage Changed*).
   - Trigger name: `Moved to RE ENROLLED`
   - **Add filter** → `In Pipeline` → **Back to the Mats**
   - **Add filter** → `In Stage` → **RE ENROLLED**
   - **Save Trigger**.

5. **Add the action.** Click the **+** below the trigger → **Add Action** →
   search `Update Opportunity` → select **Update Opportunity**.

6. **Set the value.** In the Update Opportunity panel, leave Pipeline / Stage /
   Status **blank** (don't change them). Find the **Lead Value** field
   (a.k.a. *Opportunity Value* / *Monetary Value*):
   - Click into it → click the merge-tag icon **`{}`**
   - **Custom Values → Enrolled Student Value** — inserts
     `{{ custom_values.enrolled_student_value }}`
   - **Save Action**.

7. **Publish.** Top-right toggle: switch from **Draft** to **Publish**.

8. **Settings (optional).** The gear → defaults are fine. *Allow Re-Entry* can
   stay off; re-stamping the same value on re-entry would be harmless anyway.

9. **Test.** Move a test BTM opportunity into `RE ENROLLED`, then open the
   opportunity card — **Lead Value** should now read `160`.

**Note — no backfill needed.** The `RE ENROLLED` stage currently holds 0 opps,
so there is nothing to retro-fix; the workflow covers every future move.
