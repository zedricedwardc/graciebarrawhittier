# SMS Bot → Pipeline Orchestration Setup

The SMS AI booking bot creates appointments via GHL's native Appointment Booking action — bypassing `/api/book` and skipping the website's pipeline orchestration (`handleBooking()`). This integration bridges that gap so every booking — whether from the website or the bot — produces the same pipeline state.

**Flow:**
```
SMS conversation → bot decides to book
   ↓
bot: Capture Contact Info actions  (Child Name, Age_hidden, Trainee_Is_Self)
   ↓
bot: Appointment Booking action  → creates appointment on age-tier calendar
   ↓
bot: Trigger a Workflow action  → fires "Bot Booking → Pipeline Orchestrator"
   ↓
workflow: Webhook step  → POST /api/webhooks/ghl/agent-booking-completed
   ↓
website: handleBooking()  → creates TRIAL_CONV opp, moves LEAD_ACQ opp, sets CFs, adds tag
```

---

## Step 1 — Add a third Contact Info action to the bot

The bot needs one more captured field so the webhook handler knows whether the booking is for the contact themselves (Case 1) or for someone else (Case 2/3).

GHL → AI Employee → your bot config → **+ Add new field** under "Setup your Actions → Contact Info":

| Field | Value |
|---|---|
| **Action name** | `Capture Trainee Is Self` |
| **Which contact field** | Create a new custom field: `Trainee Is Self` (type: Text). GHL will auto-generate the fieldKey `trainee_is_self` |
| **What to update in the field** | `"yes" when the trainee is the contact themselves (Case 1, age 16+ self-booking). "no" when the trainee is the contact's child or another person (Case 2/3).` |

After saving, the bot's Actions panel should show `Contact Info: 3`.

---

## Step 2 — Create the orchestrator workflow in GHL

GHL → **Automation → Workflows → + Create Workflow** (start from blank).

| Field | Value |
|---|---|
| **Name** (must match exactly) | `[Backflow] Bot Booking → Pipeline Orchestrator` |
| **Trigger** | `Workflow Triggered` — this exposes the workflow as something the bot's `Trigger a Workflow` action can call |
| **Folder** | Backflow Webhooks (or wherever you keep the existing backflow workflows) |

### Webhook action — the only step

Add a single **Webhook** action (under "Send Webhook" or similar):

| Field | Value |
|---|---|
| **URL** | `{{custom_values.website_webhook_base_url}}/agent-booking-completed` |
| **Method** | POST |
| **Custom Headers** | Key: `X-GBW-Secret`  ·  Value: `{{custom_values.website_webhook_secret}}` |
| **Custom Headers** | Key: `Content-Type`  ·  Value: `application/json` |
| **Body type** | Custom JSON |

**Body** (paste verbatim, then GHL substitutes the merge tags):

```json
{
  "customData": {
    "appointment_id": "{{appointment.id}}",
    "contact_id": "{{contact.id}}",
    "appointment_start_iso": "{{appointment.start_time}}",
    "child_name": "{{contact.child_name}}",
    "child_age": "{{contact.age_hidden}}",
    "trainee_is_self": "{{contact.trainee_is_self}}",
    "ts": "{{appointment.date_created}}"
  }
}
```

If any of those merge-tag names differ in your GHL location (e.g. you renamed the contact CF), match the actual `fieldKey` here.

---

## Step 3 — Add the `Trigger a Workflow` action at the end of the bot's booking sequence

In the bot config, after the Appointment Booking action succeeds, append a **Trigger a Workflow** action pointing at `[Backflow] Bot Booking → Pipeline Orchestrator`.

This is what causes the workflow (and therefore the webhook) to fire on every booking.

---

## Step 4 — Discover the new workflow ID + add to Vercel

```bash
npm run onboard:ghl discover
```

The output will include:

```
WORKFLOW_ID_BOT_BOOKING_ORCHESTRATOR=<uuid>
```

Copy that line and add it to Vercel:
- Production AND Preview targets
- Trigger a redeploy after saving

---

## Step 5 — Bot prompt update

Open the bot's persona prompt (Personality → Additional Information section) and add the following blocks. The first updates trainee capture; the second handles former-student handover.

### Add to TRAINEE INFO section

After the "CASE 3" block, add:

```
=== ADDITIONAL FIELD: Trainee Is Self ===
For EVERY booking, set the Trainee Is Self field BEFORE finalizing:
- Case 1 (self-booking): set Trainee Is Self = "yes"
- Case 2 (child): set Trainee Is Self = "no"
- Case 3 (other person): set Trainee Is Self = "no"
This field tells the system which person owns the appointment so trainee-level
pipeline state is created correctly.
```

### Add a new section: FORMER STUDENT DETECTION

Add this before the HUMAN HANDOVER section:

```
=== FORMER STUDENT DETECTION ===
If the contact has the tag `back-to-the-mats-import` or `return-class-booked`,
they are a FORMER student of the academy — not a new prospect. They should
NOT be booked into the trial flow.

If you detect this case (e.g., contact mentions they trained here before,
or their tags show former-student status), respond:
"It sounds like you've trained with us before — welcome back! Let me get
Alex involved directly so we can sort out your re-enrollment offer."
Then trigger Human Handover. Do NOT proceed with a trial booking.
```

### Add to HARD NEVER-DO LIST

Append this line:

```
Never book a former student (tagged back-to-the-mats-import or return-class-booked) into the trial flow. Hand over to Alex.
```

---

## Step 6 — Test end-to-end

1. **Create a test contact in GHL** with email `bot-test+1@gracie.test` and a real phone number you can text from
2. **SMS your bot's number** from that phone — start a conversation
3. **Book a trial for yourself (Case 1, age 16+)** — let the bot run through the flow
4. **Verify in GHL after the booking confirms:**
   - Appointment appears on the right age-tier calendar ✓
   - Contact has tag `source-agent-booking` ✓
   - Trial Conversion pipeline has a new opp at INTRO BOOKED for this contact ✓
   - Contact CFs `last_trainee_key` and `household_trainee_keys` are populated ✓
   - Pre-Trial Reminders workflow is enrolled (check workflow enrollment history) ✓
5. **Repeat with a child booking (Case 2)** — different name + child age — verify a per-trainee opp appears
6. **Check Vercel logs** (`vercel logs --prod` or in dashboard) for `[agent-booking-completed]` entries

If anything fails, the webhook returns `200` with `ok: false` and an error code — visible in:
- GHL workflow execution history (look for the webhook step's response body)
- Vercel function logs

---

## Failure modes + recovery

| Symptom | Cause | Fix |
|---|---|---|
| Webhook returns `INVALID_SECRET` | `X-GBW-Secret` header missing/wrong | Verify the header value matches `GHL_WEBHOOK_SECRET` in Vercel |
| `INVALID_INPUT` with missing `appointment_start_iso` | Merge tag `{{appointment.start_time}}` didn't resolve | Workflow trigger isn't running in appointment context. The orchestrator workflow must be triggered DIRECTLY by the bot's appointment booking — not from a separate trigger that doesn't carry appointment context. Use `Trigger a Workflow` action immediately after the Appointment Booking action |
| `INVALID_AGE` | `child_age` field empty or non-numeric | Bot's Capture Child Age action failed to set the value. Check the conversation transcript |
| `CONTACT_NOT_FOUND` | `contact_id` doesn't resolve | Wrong contact merge tag; verify it's `{{contact.id}}` not `{{customer.id}}` |
| Bot books, no Trial Conversion opp appears | Workflow not triggered, or webhook 4xx/5xx | Check GHL workflow execution history. Verify `Trigger a Workflow` action is in the bot's flow |
| Duplicate opps appear | Webhook fired twice (GHL retry on transient error) | Idempotency key (`appointment_id`) should dedupe within 60s. If duplicates persist after 60s, that's a real bug — open an issue |

---

## What this integration does NOT handle

- **BTM bookings via the bot.** The bot is trial-only. Former students who somehow reach the bot get logged + flagged via tag detection (Step 5 prompt update routes them to Alex). The webhook handler logs a warning if it detects a BTM-tagged contact but still orchestrates the booking as trial — so the appointment doesn't disappear, but admin should manually clean up.
- **Cancellations.** Bot is booking-only. If the bot ever gains cancellation ability, it needs its own webhook → `handleCancellation()` orchestration.
- **Rescheduling.** Same as cancellations — not in scope for v1.
- **Multi-trainee race conditions.** The bot's prompt says to handle one trainee at a time. The Contact Info actions (Child Name, Age, Is Self) get overwritten per trainee, so the webhook payload is correct AS LONG AS the bot doesn't fire the workflow until each appointment is finalized. Verify in the bot's flow that `Trigger a Workflow` is the LAST step after each booking confirmation.
