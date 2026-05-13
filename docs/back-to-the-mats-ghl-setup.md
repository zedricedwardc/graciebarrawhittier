# Back to the Mats — GHL Setup Guide

End-to-end checklist for wiring the Back to the Mats campaign into GHL after the website code changes ship. Follow in order; each step has explicit click-paths and exact names that the schema (`config/ghl-schema.ts`) expects.

> **Why exact names matter:** the website's runtime resolver (`src/lib/ghl-pipelines.ts`) matches schema entries to live GHL records by name. Drift will be flagged by `GET /api/health/ghl?key=…` after deploy, but it's faster to get names right the first time.

---

## What you're building

| Layer | Owner | Tool |
|---|---|---|
| Pipeline 4 stages | **You** | GHL UI (calendars/pipelines/stages aren't API-creatable) |
| 3 BTM workflows | **You** | GHL UI |
| 5 BTM calendars | **You** | GHL UI (clone from existing trial calendars to preserve staff/hours) |
| 3 BTM custom values | Script | `npm run onboard:ghl provision` |
| 1 new contact custom field | Script | `npm run onboard:ghl provision` |
| Pipeline + workflow ID discovery | Script | `npm run onboard:ghl discover` |
| Calendar ID discovery | Script | `npx tsx scripts/discover-btm-calendars.ts` |
| Vercel env var paste | **You** | Vercel dashboard |

Sequence: **Stages → Workflows → Calendars → Provision Script → Discover Scripts → Env Paste → Test**.

---

## Step 1 — Add the missing pipeline stage

`Pipeline 4 — Back to the Mats` already has these stages: `FORMER STUDENT`, `RE ENROLLMENT CLASS BOOKED`, `APPOINTMENT TODAY`, `NO-SHOW`, `RE ENROLLED`. **Add one more:**

1. GHL → **Settings → Pipelines** → click `Back to the Mats`
2. Click **+ Add Stage**
3. Name: `OFFER EXPIRED` (case-sensitive, hyphen-free)
4. Save

Stage order should now read top-to-bottom:
1. FORMER STUDENT
2. RE ENROLLMENT CLASS BOOKED
3. APPOINTMENT TODAY
4. NO-SHOW
5. RE ENROLLED
6. OFFER EXPIRED

---

## Step 2 — Create the 3 BTM workflows

GHL → **Automation → Workflows** → `+ Create Workflow` (start from blank).

### 2.1 — `BTM 30-Day Campaign`

| Field | Value |
|---|---|
| **Name** (exact) | `BTM 30-Day Campaign` |
| **Trigger** | Pipeline Stage Changed → Pipeline: `Back to the Mats`, Stage: `FORMER STUDENT` |
| **Exit (no Goal Event needed)** | The website removes the contact from this workflow via API on successful BTM booking (`handleBtmBooking` → `exitNurtureWorkflows`). No tag-based goal to configure. |
| **Wait + Update Stage step at end** | Wait `30` days → Update Opp Stage to `OFFER EXPIRED`. Edit the day count inside the workflow if you need to change it. |

**Body — 9 emails + 3 SMS** per docx Part 2. Copy from `GBW_Back_To_Mats_Full_Build_Package.docx`:

| Day | Type | Subject / Body |
|---|---|---|
| 1 | Email | "Your mat is still here, {{contact.first_name}}" |
| 1 | SMS | "Hi {{contact.first_name}}, …" |
| 3 | Email | "What you left on the mat is still there" |
| 4 | SMS | "Hey {{contact.first_name}}, did you see our Back to the Mats offer?" |
| 6 | Email | "The unfinished journey" |
| 10 | Email | "Here's exactly what we're offering — {{contact.first_name}}, this is real" |
| 10 | SMS | "{{contact.first_name}}, your Back to the Mats offer: first 2 months at $97/month" |
| 14 | Email | "What held you back before might not be the same obstacle anymore" |
| 16 | SMS | "{{contact.first_name}}, reminder — Back to the Mats offer closes" |
| 20 | Email | "Halfway to the deadline — have you seen the full offer?" |
| 25 | Email | "Someone came back after 3 years. Here's what they told me." |
| 28 | Email | "{{contact.first_name}}, the deadline is in a few days" |
| 28 | SMS | "{{contact.first_name}}, Back to the Mats offer at {{custom_values.academy_name}} closes" |
| 29 | SMS | "{{contact.first_name}}, last day tomorrow for Back to the Mats" |
| 30 | Email | "Last chance — this offer closes today, {{contact.first_name}}" |
| 30 | SMS | "{{contact.first_name}}, today is the last day" |

> Use `{{custom_values.back_to_the_mats_page_url}}` in every CTA link, `{{custom_values.back_to_the_mats_deadline}}` in every "ends" line, and `{{custom_values.academy_name}}` for the studio name. (The provision script creates these.)

### 2.2 — `BTM Appointment Confirmation`

| Field | Value |
|---|---|
| **Name** (exact) | `BTM Appointment Confirmation` |
| **Trigger** | Pipeline Stage Changed → Pipeline: `Back to the Mats`, Stage: `RE ENROLLMENT CLASS BOOKED` |

**Body — 3 emails + 2 SMS** per docx Part 3:

| Timing | Type | Subject |
|---|---|---|
| Immediate (within 5 min of booking) | Email | "You're booked — welcome back, {{contact.first_name}}" |
| Immediate | SMS | "You're booked at {{custom_values.academy_name}}, {{contact.first_name}}!" |
| Day before session | Email | "Tomorrow you're back on the mat" |
| Day before | SMS | "See you tomorrow at {{custom_values.academy_name}}, {{contact.first_name}}!" |
| 2 hours before | Email | "Class in 2 hours — see you on the mat" |

> All bodies in docx Part 3.

### 2.3 — `BTM Re-Booking Campaign (no-show)`

| Field | Value |
|---|---|
| **Name** (exact) | `BTM Re-Booking Campaign (no-show)` |
| **Trigger** | Pipeline Stage Changed → Pipeline: `Back to the Mats`, Stage: `NO-SHOW` |
| **Exit (no Goal Event needed)** | The website removes the contact from this workflow via API on successful BTM re-booking (`handleBtmBooking` → `exitNurtureWorkflows`). No tag-based goal to configure. |
| **Wait + Update Stage step at end** | Wait `14` days → Update Opp Stage to `OFFER EXPIRED`. Edit the day count inside the workflow if you need to change it. |

**Body — 4 emails + 1 SMS** per docx Part 4:

| Day | Type | Subject |
|---|---|---|
| 1 (same day as no-show) | Email | "We missed you today — let's find another time" |
| 1 | SMS | "Hey {{contact.first_name}}, we missed you today" |
| 3 | Email | "Your Back to the Mats spot is still here" |
| 7 | Email | "Quick question, {{contact.first_name}}" |
| 12 (final) | Email | "Last attempt — the deadline is close" |

---

## Step 3 — Create the 5 BTM calendars

The brief calls for separate BTM calendars (admin should see BTM bookings independently from trial bookings).

**Easiest path: clone the existing trial calendars.**

For each trial calendar (`Tiny Champions`, `Little Champions 1`, `Little Champions 2`, `Juniors Jiu-Jitsu`, `Adults Brazilian Jiu-Jitsu`):

1. GHL → **Settings → Calendars** → click the trial calendar
2. **⋯ Menu → Duplicate**
3. **Rename** the copy to: `BTM <Program Name>` (e.g. `BTM Tiny Champions`, `BTM Adults`)
4. **Calendar Group**: assign to a new group `Back to the Mats` (create the group on first calendar)
5. Save

You should end up with 5 new calendars in the `Back to the Mats` group, names following the `BTM <Program>` pattern.

---

## Step 4 — Provision custom values + custom fields

Run from the project root:

```bash
npm run onboard:ghl provision
```

This idempotently creates (skipping any that already exist):

**3 new BTM custom values:**
- `back_to_the_mats_deadline`
- `back_to_the_mats_page_url` (default: `https://gbwhittier.com/back-to-the-mats`)
- `back_to_the_mats_offer_name` (default: `Back to the Mats Special`)

> The Wait + Update Stage day counts (30d for FORMER STUDENT → OFFER EXPIRED, 14d for NO-SHOW → OFFER EXPIRED) live as literal values inside each BTM workflow, not as custom values. Edit them in the workflow if you need to change them.

**1 new contact custom field:**
- `back_to_mats_imported_at` (DATE) — used for dedupe + audit on CSV import

**Tags** are created implicitly the first time they're applied (no provision step needed):
- `back-to-the-mats-import` (set by CSV import; consumed by SMS-bot prompt to detect former students)

After the script runs, **set the deadline value in GHL UI**:

GHL → Settings → Custom Values → `Back to the Mats Deadline` → set to the human-readable label of your deadline (e.g. `Friday, June 8, 2026`). Update before every campaign run.

---

## Step 5 — Discover IDs

### 5.1 Pipeline + workflow IDs

```bash
npm run onboard:ghl discover
```

Writes `.env.client.local` with all the discovered IDs. Open the file and copy the BTM-related lines:

```
PIPELINE_ID_BACK_TO_MATS=...
WORKFLOW_ID_BTM_30DAY=...
WORKFLOW_ID_BTM_CONFIRMATION=...
WORKFLOW_ID_BTM_REBOOKING=...
```

### 5.2 Calendar IDs

```bash
npx tsx scripts/discover-btm-calendars.ts
```

Outputs:

```
GHL_CAL_BTM_TINY=...
GHL_CAL_BTM_LC1=...
GHL_CAL_BTM_LC2=...
GHL_CAL_BTM_JUNIORS=...
GHL_CAL_BTM_ADULTS=...
```

If any are missing, the script tells you which calendar names didn't match the expected pattern. Rename the calendar in GHL UI (must contain "BTM" or "Back to the Mats" + a program-tier word like "tiny", "lc1", "junior", "adult") and re-run.

---

## Step 6 — Add to Vercel env

Vercel → `graciebarrawebsite` project → **Settings → Environment Variables**.

Add these to **Production** AND **Preview** (each as a new variable):

```
PIPELINE_ID_BACK_TO_MATS=…
WORKFLOW_ID_BTM_30DAY=…
WORKFLOW_ID_BTM_CONFIRMATION=…
WORKFLOW_ID_BTM_REBOOKING=…

GHL_CAL_BTM_TINY=…
GHL_CAL_BTM_LC1=…
GHL_CAL_BTM_LC2=…
GHL_CAL_BTM_JUNIORS=…
GHL_CAL_BTM_ADULTS=…

# Note: deadline is NO LONGER a Vercel env var.
# It lives in the GHL custom value `back_to_the_mats_deadline` and the page
# fetches it at request time. Update it in GHL UI per campaign run.
```

Trigger a redeploy after saving (or push any commit).

---

## Step 7 — Smoke-test before real CSV import

**Don't import the full CSV first.** Test with a single contact:

1. GHL → **Contacts → New Contact** with your own email + phone
2. **Add to Pipeline:** `Back to the Mats → FORMER STUDENT` (manually create the opp)
3. Wait ~30 seconds — you should receive Email 1 of the 30-Day Campaign
4. Visit `https://gbwhittier.com/back-to-the-mats` and book a class using your contact's email
5. Verify in GHL:
   - Your BTM opp moved to `RE ENROLLMENT CLASS BOOKED` ✓
   - Your contact was removed from the `BTM 30-Day Campaign` workflow (Contact → Workflows tab — no longer active) ✓
   - Email 1 of the BTM Confirmation Campaign arrived ✓
   - **No new opp was created in `Lead Acquisition`** ✓ (the BTM detection should have skipped it)
   - A per-trainee opp WAS created in `Trial Conversion` at `INTRO BOOKED` ✓ (existing flow continues)

If any of these fail, check `/api/health/ghl?key=<HEALTH_KEY>` for drift, and check Vercel logs for `[handleBooking] BTM` messages.

---

## Step 8 — Verify health endpoint

```bash
curl "https://gbwhittier.com/api/health/ghl?key=$HEALTH_KEY"
```

Should return:
```json
{ "ok": true, "drift": [] }
```

If `drift` is non-empty, fix the named items (typically a stage or workflow with the wrong name in GHL). Re-run discover after each fix.

---

## Step 9 — SMS opt-in compliance check (BEFORE CSV import)

The CSV importer in GHL will enroll contacts in the BTM 30-Day Campaign, which sends SMS. CTIA/TCPA require prior express written consent before bulk SMS to a number. Before importing:

- **If you have prior SMS opt-in records** for these former students (from when they originally enrolled): proceed.
- **If you don't, or aren't sure:** strip phone numbers without recorded consent from the CSV before import. Email-only nurture is fine without per-message SMS opt-in.

---

## Step 10 — Bulk CSV import

Once everything above is green:

1. Format CSV with at minimum: `email`, `firstName`, `lastName`, `phone` (optional)
2. GHL → **Contacts → Import** → upload CSV
3. **Tag on import:** `back-to-the-mats-import`
4. **Add to Pipeline:** `Back to the Mats → FORMER STUDENT`
5. Set Custom Field `back_to_mats_imported_at` = today's date

The 30-Day Campaign will fire automatically on each new opp. Monitor delivery + bounce rate via GHL's email reports.

---

## Operational notes

- **Update the deadline before every campaign run.** Set the `back_to_the_mats_deadline` GHL custom value (Settings → Custom Values) — the website fetches it at request time and parses it for the countdown timer + display label. Format: ISO 8601 with offset, e.g. `2026-06-08T23:59:00-07:00`. The change propagates to the live page within ~5 minutes (cache TTL).
- **Re-running CSV import:** GHL will create duplicate opps even for contacts already in BTM. Filter your CSV to exclude contacts where `back_to_mats_imported_at` was set within the last 60 days.
- **Multi-trainee bookings:** A parent who books multiple kids in one session sees their BTM opp move to RE ENROLLMENT CLASS BOOKED on the first booking. Subsequent bookings in the same session are no-ops on BTM (logged but don't move stage). Per-trainee tracking happens in TRIAL_CONV opps.
- **NO-SHOW classification:** Admin manually moves opps from `APPOINTMENT TODAY` → `NO-SHOW` or `RE ENROLLED`. The 14-day re-booking workflow fires automatically on NO-SHOW. Auto-move to OFFER EXPIRED happens 14 days later if they don't re-book.
