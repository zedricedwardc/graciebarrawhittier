# GHL Chat Widget — Content + Integration Design

**Date:** 2026-05-25
**Status:** Approved (pending user spec review)
**Owner:** tech@localcraze.com

## Goal

Wire a GHL chat widget into the Gracie Barra Whittier site as a lead-capture channel. Visitors who message in become typed leads in the existing Lead Acquisition pipeline and inherit the same Lead Nurture cadence as every other inbound channel.

## Non-goals

- Live agent chat (not staffed — async SMS reply only).
- AI conversation handling (out of scope; can be added later).
- Replacing existing opt-in forms.

## Architecture

```
Visitor on /, /kids-martial-arts, or /adults-jiu-jitsu
  ↓ types in widget, submits Name + Phone + Email + first message
GHL Chat Widget
  ↓ creates/matches Contact (channel = Chat)
GHL Workflow #1 — [Inbound] Chat Widget → Pipeline Orchestrator
  ↓ POST {website}/api/lead with X-GBW-Secret header
/api/lead → handleOptIn()
  ↓ upsert contact, set source/CFs/tags, create or skip Lead Acq opp
  ↓ enroll in WORKFLOW_ID_TRIAL_NURTURE
Existing Lead Nurture cadence (24h → 7d → 14d → LOST/COLD)

GHL Workflow #2 — [Inbound] Chat Widget Inbound Alert
  Trigger: Customer Replied, Channel = Chat
  Action:  staff in-app + internal SMS, fires on every message
```

### Why this shape

- **Approach C (forward to `/api/lead`)** was chosen over a pure-GHL workflow so chat-lead creation runs through the same typed adapter as every other website opt-in. Single source of truth in TypeScript.
- **Separate `Website Chat` channel** (vs merging into `Website Leads`) keeps dashboard reporting clean and lets staff distinguish chat-originated leads at a glance.
- **Existing-contact reactivation** lives in Workflow #1, not in the adapter. `handleOptIn` already refreshes CFs without moving open opps; the workflow adds one branch that moves LOST/COLD Lead Acq opps back to NURTURE CAMPAIGN. Mirrors locked decision #7 in [ghl-automation-plan.md](../../ghl-automation-plan.md).

---

## Section 1 — Chat widget content (GHL UI)

Paste-ready values for the GHL chat widget configuration screens.

### Style tab

| Field | Value |
|---|---|
| Chat prompt | ON |
| Prompt style | Colored bubble with text (left tile) |
| Chat icon | Speech bubble (leftmost) |
| Theme | Custom palette |
| Primary color | `#0E2240` (gb-navy) |
| Accent color | `#C8102E` (gb-red) |
| Highlight color | `#F2C94C` (gb-gold) |
| Welcome message | `Hey! Got a question about classes or the Free 3-Class Pass? Text us here — we'll reply right back.` |
| Return visitor custom greeting | ON |
| Return visitor message | `Welcome back {{name}}! Ready to lock in your Free 3-Class Pass, or still have questions?` |

### Chat window tab

| Field | Value |
|---|---|
| Chat window title | `Got a question? Text us.` |
| Intro message | `Type your question below and a Gracie Barra Whittier coach will text you right back — usually within an hour during open hours.` |
| Contact form options | Name, Phone, Email |
| Mandatory fields | Name, Phone, Email |
| Button text | `Send Message` |
| Redirect call-to-action | OFF |

### Messaging tab

**Live chat assigned:**

| Field | Value |
|---|---|
| Enable contact form | OFF |
| Show live chat welcome message | ON |
| Live chat welcome message | `Thanks {{name}} — got it. A coach will text you at {{phone}} shortly. If it's after hours, we'll reach out first thing when we're back on the mats.` |
| Time out delay | 15 mins |
| Time out user inactivity message | `Looks like everyone's on the mats right now. We've saved your message and will text you back at {{phone}} — usually within an hour during open hours (M–Th 11a–9p, F 4–8p, Sat 10a–2p).` |

**Live chat closed:**

| Field | Value |
|---|---|
| Chat closed inactivity time | 30 mins |
| Chat closed inactivity message | `Chat closed for now — but your message is in our queue. Expect a text from (562) 640-1400 soon. Prefer to skip the wait? Claim your Free 3-Class Pass at graciebarrawhittier.com/#trial.` |

**Live chat business hour setup:**

| Day | Hours |
|---|---|
| Mon–Thu | 11:00 AM – 9:00 PM |
| Fri | 4:00 PM – 8:00 PM |
| Sat | 10:00 AM – 2:00 PM |
| Sun | Closed |

**Additional options:**

| Toggle | Value |
|---|---|
| Notification sound | ON |
| Allow voice notes | ON |
| Allow attachments | ON |
| Load on user interaction | ON |
| Agency branding | OFF |
| Consent checkbox (labeled "HIPAA" by GHL) | ON |
| Default-checked | ON |
| Legal message | `By submitting this chat you agree to receive SMS and emails from Gracie Barra Whittier at the number/email provided, including class updates and offer reminders. Msg & data rates may apply. Reply STOP to opt out. See our Privacy Policy at graciebarrawhittier.com/privacy.` |

> Note: GHL's "HIPAA consent" toggle is a generic compliance checkbox, not healthcare-specific. We use it for TCPA/SMS consent capture. Do not rename or remove.

### Acknowledgement section

| Field | Value |
|---|---|
| Acknowledgement message | `Thanks for reaching out to Gracie Barra Whittier.` |
| Feedback message | `Quick favor — how was that?` |
| Feedback submission note | `Thanks — we'll use that to keep getting better. See you on the mats soon.` |
| Chat ended message | `Conversation closed. Need us again? Tap the chat bubble anytime, or claim your Free 3-Class Pass at graciebarrawhittier.com/#trial.` |
| Acknowledgement icon | Speech bubble (leftmost) |
| Placeholder color | `#F2C94C` (gb-gold) |

---

## Section 2 — Website code changes

### 2.1 [src/components/widgets/AIChatWidget.astro](../../../src/components/widgets/AIChatWidget.astro)

Replace the stub with the real GHL embed, gated on two env vars instead of one. Add `defer` to the script.

```astro
---
const widgetId = import.meta.env.PUBLIC_GHL_CHAT_WIDGET_ID as string | undefined;
const locationId = import.meta.env.PUBLIC_GHL_LOCATION_ID as string | undefined;
---

{widgetId && locationId && (
  <>
    <div data-chat-widget data-widget-id={widgetId} data-location-id={locationId}></div>
    <script
      defer
      src="https://beta.leadconnectorhq.com/loader.js"
      data-resources-url="https://beta.leadconnectorhq.com/chat-widget/loader.js"
      data-widget-id={widgetId}
    ></script>
  </>
)}
```

### 2.2 [src/layouts/BaseLayout.astro](../../../src/layouts/BaseLayout.astro)

Remove the `<AIChatWidget />` include and its import. The widget is no longer site-wide.

### 2.3 Per-page includes

Add `<AIChatWidget />` at the bottom of `<main>` (after the existing page content) on exactly these three pages:

- [src/pages/index.astro](../../../src/pages/index.astro)
- [src/pages/kids-martial-arts.astro](../../../src/pages/kids-martial-arts.astro)
- [src/pages/adults-jiu-jitsu.astro](../../../src/pages/adults-jiu-jitsu.astro)

Add the corresponding `import AIChatWidget from '../components/widgets/AIChatWidget.astro';` line to each.

### 2.4 [src/lib/lead-types.ts](../../../src/lib/lead-types.ts)

Two edits:

1. Add `'Website Chat'` to the `LEAD_CHANNELS` tuple:

```ts
export const LEAD_CHANNELS = ['Website Leads', 'Walk-In', 'Meta Ads', 'Google Ads', 'Referral', 'Website Chat'] as const;
```

2. Add a `'chat-widget'` entry to `LEAD_SOURCES`:

```ts
'chat-widget': { channel: 'Website Chat', pageLabel: 'Chat Widget' },
```

### 2.5 [config/ghl-schema.ts](../../../config/ghl-schema.ts)

Add `'Chat Widget'` to `OPTIN_PAGE_LABELS` so the `optin_page` dropdown CF accepts it.

### 2.6 [src/pages/api/lead.ts](../../../src/pages/api/lead.ts)

Add a trusted-caller short-circuit. If the request carries a valid `X-GBW-Secret` header matching `GHL_WEBHOOK_SECRET`, skip per-IP rate limit and min-dwell-time checks (these exist to deter browser-side abuse and are inapplicable to authenticated server-to-server calls). All other behavior — schema validation, honeypot, idempotency, `handleOptIn` dispatch — unchanged.

```ts
// Pseudocode — match the existing env-reader convention used in other
// webhook handlers (e.g. /api/webhooks/ghl/agent-booking-completed).
const expected = process.env.GHL_WEBHOOK_SECRET;
const trustedCaller =
  Boolean(expected) && request.headers.get('X-GBW-Secret') === expected;

if (!trustedCaller) {
  // existing dwell-time + rate-limit checks remain
}
// honeypot, schema validation, idempotency, handleOptIn dispatch run for everyone
```

`GHL_WEBHOOK_SECRET` already exists in Vercel (used by the agent-booking-completed webhook). Same secret is reused.

### 2.7 Vercel environment variables

Add to Production AND Preview targets:

| Key | Value |
|---|---|
| `PUBLIC_GHL_CHAT_WIDGET_ID` | `6a1457d0294a01e42f36f93f` |
| `PUBLIC_GHL_LOCATION_ID` | `eMHOrbrPAfFd2S1ORNKL` |
| `WORKFLOW_ID_CHAT_WIDGET_ORCHESTRATOR` | (populated after Section 3, via `npm run onboard:ghl discover`) |

Redeploy after env vars are saved.

---

## Section 3 — GHL workflows

### Workflow #1 — `[Inbound] Chat Widget → Pipeline Orchestrator`

| Field | Value |
|---|---|
| Folder | Inbound Webhooks |
| Trigger | `Contact Created` |
| Trigger filter | `Last Channel contains "Chat"` (use whichever filter your subaccount exposes most reliably — verify in GHL's trigger dropdown) |

**Action 1 — Webhook to /api/lead:**

| Field | Value |
|---|---|
| URL | `{{custom_values.website_webhook_base_url}}/lead` |
| Method | POST |
| Headers | `X-GBW-Secret: {{custom_values.website_webhook_secret}}` |
| Headers | `Content-Type: application/json` |
| Body type | Custom JSON |

Body:

```json
{
  "name": "{{contact.full_name}}",
  "email": "{{contact.email}}",
  "phone": "{{contact.phone}}",
  "source": "chat-widget",
  "page": "chat-widget",
  "message": "{{conversation.last_message_body}}",
  "ts": 0,
  "website": ""
}
```

Notes:

- The `ts` value can be any integer when the request carries a valid `X-GBW-Secret` header — the trusted-caller short-circuit (Section 2.6) skips the dwell-time check. `0` is safe.
- If the merge tag for the first chat message isn't `conversation.last_message_body` in this subaccount, substitute the correct tag (verify in GHL's tag picker — `conversation.lastMessageBody`, `chat.first_message`, etc. vary by version). Empty string is acceptable as fallback.

**Action 2 — Conditional reactivation branch:**

```
IF contact.opportunities[pipeline=LEAD_ACQ].stage == "LOST / COLD"
  THEN move that opp → NURTURE CAMPAIGN
  ELSE do nothing (Action 1 already created NEW LEAD opp via /api/lead)
```

Implement with GHL's "If/Else" condition + "Update Opportunity Stage" action.

### Workflow #2 — `[Inbound] Chat Widget Inbound Alert`

| Field | Value |
|---|---|
| Folder | Internal Notifications |
| Trigger | `Customer Replied` |
| Trigger filter | `Channel = Chat` |
| Action 1 | In-app notification to all assigned users |
| Action 2 | Internal SMS to front-desk number: `Chat lead: {{contact.first_name}} — "{{message.body}}" → {{contact.url}}` |

This fires on every inbound chat message, not just the first, so staff sees ongoing conversation activity in real time.

### Discovery + env wiring

After both workflows are saved:

```bash
npm run onboard:ghl discover
```

Copy the resulting `WORKFLOW_ID_CHAT_WIDGET_ORCHESTRATOR=<uuid>` line into Vercel (Production + Preview), then redeploy.

---

## Section 4 — Dashboard widget updates

The `Website Chat` channel is new and won't appear in existing dashboard widgets until they're updated.

| Widget | Change |
|---|---|
| #4 — Lead Source Breakdown (donut) | No code change. GHL auto-includes the new value once a chat lead exists. Verify after first test lead. |
| #22 — Lead Source Report | Same — auto-includes. |
| #23 — Website Leads KPI | Add a new widget #23b "Chat Widget Leads — Last 30 Days" alongside #23, configured: Source **Contacts**; **Source = Website Chat**; **Last 30 Days**. Width 1/3, same row as #23/#24/#25. |

Update [docs/ghl-dashboard-build-guide.md](../../ghl-dashboard-build-guide.md) Row 11 to add widget #23b after the rebuild.

---

## Section 5 — Testing

After deploy + GHL setup complete, run this smoke test:

1. Open `/` in an incognito browser. Confirm the chat bubble appears in the bottom-right corner with the brand-navy welcome teaser.
2. Open `/contact` in the same incognito browser. Confirm the chat bubble does NOT appear (excluded page).
3. Click the bubble → fill Name, Phone, Email → check consent → send a test message: `"Just testing the new chat widget — please ignore."`
4. Within 60 seconds, verify in GHL:
   - Contact created with Source = `Website Chat`
   - Contact has tags `kickstart-funnel` + `source-chat-widget`
   - Contact CFs `lead_source = "Website Chat"`, `optin_page = "Chat Widget"`
   - Lead Acquisition pipeline shows new opp at `NEW LEAD` named `<Name> — chat-widget`
   - Contact is enrolled in Trial Nurture workflow
   - Workflow #1 execution history shows the webhook action returned `200 { ok: true }`
5. Send a second message from the same chat session. Confirm Workflow #2 fires (in-app notification visible to staff user).
6. Repeat step 3–4 with a contact that already exists in GHL at LOST/COLD. Confirm: no duplicate opp created; the existing LOST/COLD opp moved to `NURTURE CAMPAIGN`.
7. Run [tests/security/bundle-scan.sh](../../../tests/security/bundle-scan.sh) and confirm `beta.leadconnectorhq.com` either appears in the allowed-host list or doesn't trip the network-leak check.

---

## Section 6 — Risks + open questions

| Risk | Mitigation |
|---|---|
| GHL workflow merge tag for the first chat message body differs across subaccount versions | Verify in GHL's tag picker before saving Workflow #1. Empty string fallback is acceptable. |
| `Last Channel` trigger filter may not exist verbatim in this subaccount | Use closest available filter (e.g., `Source contains chat` or `tags contains chat-widget`). Confirm at build time. |
| `beta.leadconnectorhq.com` is on a beta CDN; GHL may migrate to a stable host | Embed snippet was provided by the user from their current GHL install. If GHL emits a new snippet later, update the component. |
| /api/lead opens to authenticated callers — secret rotation needed | `GHL_WEBHOOK_SECRET` is already in rotation discipline (same secret as agent-booking-completed). No new operational burden. |
| Chat bubble may visually conflict with StickyMobileCTA on mobile | Verify in browser at mobile viewport after deploy. GHL bubble defaults to bottom-right; StickyMobileCTA is full-width bottom. Should coexist but confirm. |

---

## Implementation order

1. Code edits 2.1–2.6 (one PR).
2. Set Vercel env vars 2.7 (except `WORKFLOW_ID_CHAT_WIDGET_ORCHESTRATOR`).
3. Deploy to Preview, verify the widget renders on the three pages.
4. Build Workflow #1 + Workflow #2 in GHL.
5. Run `onboard:ghl discover`, add `WORKFLOW_ID_CHAT_WIDGET_ORCHESTRATOR` to Vercel, redeploy.
6. Configure the GHL chat widget UI per Section 1.
7. Update dashboard widget #23b per Section 4.
8. Run Section 5 smoke test.
9. Promote to Production.