# GHL Chat Widget — Content + Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a GHL chat widget into the Gracie Barra Whittier site so visitor chat submissions become typed leads in the existing Lead Acquisition pipeline.

**Architecture:** Reuse the existing `/api/lead` endpoint by adding a trusted-caller short-circuit, then have a GHL workflow POST to it on chat-widget Contact Created. Embed the GHL widget on three conversion pages (home, kids, adults) via the existing `AIChatWidget` component slot. Lead Nurture workflow auto-takes over from there.

**Tech Stack:** Astro (SSR endpoints), Zod (schema), vitest (unit), GHL workflows (no-code), Vercel envs.

**Spec:** [docs/superpowers/specs/2026-05-25-chat-widget-content-and-integration-design.md](../specs/2026-05-25-chat-widget-content-and-integration-design.md)

---

## Phase 1 — Type schema foundation

Adds the new `chat-widget` source slug, `Website Chat` channel, and `Chat Widget` page label. Pure type/data additions — no behavior change yet.

### Task 1: Add `Website Chat` channel + `chat-widget` source to lead-types

**Files:**
- Modify: [src/lib/lead-types.ts](../../../src/lib/lead-types.ts)
- Test: [src/lib/lead-types.test.ts](../../../src/lib/lead-types.test.ts)

- [ ] **Step 1: Write the failing tests**

Append to [src/lib/lead-types.test.ts](../../../src/lib/lead-types.test.ts) inside the existing `describe('lead source registry', ...)` block:

```ts
  it('routes chat-widget to the Website Chat channel', () => {
    expect(channelForSource('chat-widget')).toBe('Website Chat');
  });

  it('gives chat-widget a readable page label', () => {
    expect(pageLabelForSource('chat-widget')).toBe('Chat Widget');
  });

  it('includes Website Chat in the LEAD_CHANNELS enum', () => {
    expect(LEAD_CHANNELS).toContain('Website Chat');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lead-types`

Expected: three new tests FAIL — `channelForSource('chat-widget')` is a TypeScript error (string literal not in `SOURCES` enum). vitest will surface compile errors as test failures.

- [ ] **Step 3: Update `LEAD_CHANNELS` tuple**

In [src/lib/lead-types.ts:24](../../../src/lib/lead-types.ts#L24), append `'Website Chat'`:

```ts
export const LEAD_CHANNELS = ['Website Leads', 'Walk-In', 'Meta Ads', 'Google Ads', 'Referral', 'Website Chat'] as const;
```

- [ ] **Step 4: Add `chat-widget` to `LEAD_SOURCES`**

In [src/lib/lead-types.ts](../../../src/lib/lead-types.ts), inside the `LEAD_SOURCES` object (after the `'qr-offer-optin'` entry, before the commented-out FUTURE block):

```ts
  // Chat-widget intake — visitors who submit the contact form inside the
  // bottom-right chat widget. Comes in via /api/lead from the GHL workflow
  // [Inbound] Chat Widget → Pipeline Orchestrator.
  'chat-widget':    { channel: 'Website Chat', pageLabel: 'Chat Widget' },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- lead-types`

Expected: ALL tests in `lead-types.test.ts` PASS, including the three new ones and the existing parametric ones that iterate `SOURCES` (they implicitly cover the new entry).

- [ ] **Step 6: Run typecheck**

Run: `npm run check`

Expected: no new errors. (Astro check covers TS across `src/`.)

### Task 2: Add `Chat Widget` to `OPTIN_PAGE_LABELS`

**Files:**
- Modify: [config/ghl-schema.ts](../../../config/ghl-schema.ts)

- [ ] **Step 1: Find the `OPTIN_PAGE_LABELS` declaration**

Run: `grep -n "OPTIN_PAGE_LABELS" config/ghl-schema.ts` (or use Grep tool on `OPTIN_PAGE_LABELS`).

Expected output: one line declaring the tuple, e.g.
```
export const OPTIN_PAGE_LABELS = ['Homepage', 'Kids Page', 'Adults Page', 'Contact Page', 'Offer Page (QR)'] as const;
```

- [ ] **Step 2: Append `'Chat Widget'`**

Modify the line in [config/ghl-schema.ts](../../../config/ghl-schema.ts):

```ts
export const OPTIN_PAGE_LABELS = ['Homepage', 'Kids Page', 'Adults Page', 'Contact Page', 'Offer Page (QR)', 'Chat Widget'] as const;
```

(Adapt exact spacing/formatting to match what's there — only the tuple contents change.)

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: all tests pass. The existing `lead-types.test.ts` test "maps every opt-in source to a valid optin_page label" iterates `SOURCES` and would have failed if `Chat Widget` was missing from `OPTIN_PAGE_LABELS`.

- [ ] **Step 4: Run typecheck**

Run: `npm run check`

Expected: no errors.

- [ ] **Step 5: Commit Phase 1**

```bash
git add src/lib/lead-types.ts src/lib/lead-types.test.ts config/ghl-schema.ts
git commit -m "$(cat <<'EOF'
feat(lead-types): add chat-widget source + Website Chat channel

Adds the schema entries that let /api/lead accept payloads from the
upcoming GHL Chat Widget orchestrator workflow.
EOF
)"
```

---

## Phase 2 — /api/lead trusted-caller short-circuit

Lets a GHL workflow (server-to-server) bypass the per-IP rate limit and min-dwell-time checks when it presents a valid `X-GBW-Secret` header. Browser callers (existing forms) are unchanged.

### Task 3: Add trusted-caller logic to /api/lead

**Files:**
- Modify: [src/pages/api/lead.ts](../../../src/pages/api/lead.ts)

- [ ] **Step 1: Open the file and locate the dwell + rate-limit block**

Read [src/pages/api/lead.ts:54-61](../../../src/pages/api/lead.ts#L54-L61). The block looks like:

```ts
  // Min dwell time
  if (Date.now() - body.ts < MIN_DWELL_MS) {
    return json({ ok: true, contactId: 'spam-discarded', opportunityId: null, isReplay: false });
  }

  // Per-IP rate limit
  const ip = clientAddress || 'unknown';
  if (!checkRate(ip)) return json({ ok: false, code: 'RATE_LIMITED' });
```

- [ ] **Step 2: Insert the trusted-caller check above the dwell block**

Replace those lines with the version that short-circuits on a valid secret. Insert immediately after the existing honeypot check (around line 52, before `Min dwell time`):

```ts
  // Trusted-caller short-circuit: a server-to-server call from a GHL
  // workflow can present X-GBW-Secret to skip the browser-targeted abuse
  // checks (per-IP rate limit + min-dwell). Honeypot, schema validation,
  // and idempotency still apply to everyone.
  const expectedSecret = process.env.GHL_WEBHOOK_SECRET;
  const trustedCaller =
    typeof expectedSecret === 'string' &&
    expectedSecret.length > 0 &&
    request.headers.get('X-GBW-Secret') === expectedSecret;

  if (!trustedCaller) {
    // Min dwell time
    if (Date.now() - body.ts < MIN_DWELL_MS) {
      return json({ ok: true, contactId: 'spam-discarded', opportunityId: null, isReplay: false });
    }

    // Per-IP rate limit
    const ip = clientAddress || 'unknown';
    if (!checkRate(ip)) return json({ ok: false, code: 'RATE_LIMITED' });
  }
```

- [ ] **Step 3: Run typecheck**

Run: `npm run check`

Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`

Expected: all existing tests still pass. No new unit test is added here — the behavior is exercised end-to-end by the smoke test in Phase 6 (a curl with the secret bypasses rate limit; one without is still subject to it). Adding a vitest harness for an Astro endpoint that depends on `clientAddress` is heavier than the change justifies.

- [ ] **Step 5: Local manual verification with curl**

Start dev server in a separate terminal: `npm run dev`

Then, with `GHL_WEBHOOK_SECRET` set in your local `.env` (read its value first with `grep GHL_WEBHOOK_SECRET .env`), run:

```bash
# Request WITHOUT the secret + ts=0 — should be silently discarded as spam (dwell-time short-circuit)
curl -s -X POST http://localhost:4321/api/lead \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"t@example.com","phone":"+15555550100","source":"chat-widget","page":"chat-widget","ts":0,"website":""}'
```

Expected: `{"ok":true,"contactId":"spam-discarded",...}` (because dwell-time check fired).

```bash
# Request WITH the secret + ts=0 — should pass dwell check and reach handleOptIn (will fail at GHL adapter without test creds, but you'll see GHL_FAILED rather than spam-discarded)
curl -s -X POST http://localhost:4321/api/lead \
  -H "Content-Type: application/json" \
  -H "X-GBW-Secret: <paste-secret-here>" \
  -d '{"name":"Test User","email":"t@example.com","phone":"+15555550100","source":"chat-widget","page":"chat-widget","ts":0,"website":""}'
```

Expected: either `{"ok":true,...}` (if GHL creds work locally) or `{"ok":false,"code":"GHL_FAILED",...}` (if no creds). Either result confirms the dwell-time check was bypassed.

- [ ] **Step 6: Commit Phase 2**

```bash
git add src/pages/api/lead.ts
git commit -m "$(cat <<'EOF'
feat(api/lead): trusted-caller short-circuit via X-GBW-Secret

Lets GHL workflows POST chat-widget leads through /api/lead without
hitting the browser-targeted dwell-time / rate-limit checks. Honeypot,
schema validation, and idempotency still apply to all callers.
EOF
)"
```

---

## Phase 3 — Frontend embed component

Replaces the AIChatWidget stub with the real GHL embed, switches from one env var to two, and moves the include from BaseLayout (site-wide) to three specific pages.

### Task 4: Refactor AIChatWidget.astro to render the real GHL embed

**Files:**
- Modify: [src/components/widgets/AIChatWidget.astro](../../../src/components/widgets/AIChatWidget.astro)

- [ ] **Step 1: Replace the entire file contents**

```astro
---
/**
 * AIChatWidget — GHL Conversations chat bubble.
 * Renders only when both env vars are set; otherwise renders nothing.
 * Loaded with `defer` so the script doesn't block initial parse.
 *
 * Per the chat widget design (docs/superpowers/specs/2026-05-25-...),
 * this widget appears only on /, /kids-martial-arts, and /adults-jiu-jitsu —
 * include it directly on those pages rather than site-wide via BaseLayout.
 */
const widgetId = import.meta.env.PUBLIC_GHL_CHAT_WIDGET_ID as string | undefined;
const locationId = import.meta.env.PUBLIC_GHL_LOCATION_ID as string | undefined;
---

{widgetId && locationId && (
  <>
    <div data-chat-widget data-widget-id={widgetId} data-location-id={locationId}></div>
    <script
      is:inline
      defer
      src="https://beta.leadconnectorhq.com/loader.js"
      data-resources-url="https://beta.leadconnectorhq.com/chat-widget/loader.js"
      data-widget-id={widgetId}
    ></script>
  </>
)}
```

Note: `is:inline` tells Astro to emit the script tag as-is rather than processing it through the bundler — required for third-party loaders.

- [ ] **Step 2: Run typecheck**

Run: `npm run check`

Expected: no errors.

### Task 5: Remove the site-wide include from BaseLayout

**Files:**
- Modify: [src/layouts/BaseLayout.astro](../../../src/layouts/BaseLayout.astro)

- [ ] **Step 1: Remove the import line**

Delete [src/layouts/BaseLayout.astro:11](../../../src/layouts/BaseLayout.astro#L11):

```astro
import AIChatWidget from '../components/widgets/AIChatWidget.astro';
```

- [ ] **Step 2: Remove the component usage**

Delete [src/layouts/BaseLayout.astro:84](../../../src/layouts/BaseLayout.astro#L84):

```astro
    <AIChatWidget />
```

- [ ] **Step 3: Update the header comment**

In [src/layouts/BaseLayout.astro:4](../../../src/layouts/BaseLayout.astro#L4), change:

```astro
 * Includes: SeoHead, GTM, Nav, StickyMobileCTA, slot, Footer, AIChatWidget, Inter font.
```

to:

```astro
 * Includes: SeoHead, GTM, Nav, StickyMobileCTA, slot, Footer, Inter font.
```

- [ ] **Step 4: Run typecheck**

Run: `npm run check`

Expected: no errors.

### Task 6: Add the widget include to the three conversion pages

**Files:**
- Modify: [src/pages/index.astro](../../../src/pages/index.astro)
- Modify: [src/pages/kids-martial-arts.astro](../../../src/pages/kids-martial-arts.astro)
- Modify: [src/pages/adults-jiu-jitsu.astro](../../../src/pages/adults-jiu-jitsu.astro)

For EACH of the three files:

- [ ] **Step 1: Add the import at the top frontmatter block**

Find the existing imports in the file's frontmatter (between the `---` fences at the top) and add this line near the other `components/` imports:

```astro
import AIChatWidget from '../components/widgets/AIChatWidget.astro';
```

- [ ] **Step 2: Add the component usage**

At the end of the page body, immediately before the closing `</BaseLayout>` tag (or the closing tag of whatever layout wrapper this page uses), add:

```astro
<AIChatWidget />
```

If the page uses a `<main>` element directly with no layout wrapper, place `<AIChatWidget />` just before `</main>`.

- [ ] **Step 3: Repeat for the other two pages**

Repeat Steps 1–2 on the remaining files. The exact import line and component tag are identical.

- [ ] **Step 4: Run typecheck**

Run: `npm run check`

Expected: no errors.

### Task 7: Local dev verification of widget visibility

- [ ] **Step 1: Set local env vars**

Add to your local `.env` (or `.env.local`):

```
PUBLIC_GHL_CHAT_WIDGET_ID=6a1457d0294a01e42f36f93f
PUBLIC_GHL_LOCATION_ID=eMHOrbrPAfFd2S1ORNKL
```

- [ ] **Step 2: Start dev server**

Run: `npm run dev`

- [ ] **Step 3: Visual check — three included pages**

Open in browser:
- `http://localhost:4321/`
- `http://localhost:4321/kids-martial-arts/`
- `http://localhost:4321/adults-jiu-jitsu/`

Expected: chat bubble appears in the bottom-right of each page after a few seconds. (The "Load on user interaction" toggle in the GHL config isn't set yet, so the iframe may load immediately — that's fine for now.)

- [ ] **Step 4: Visual check — excluded pages**

Open:
- `http://localhost:4321/contact/`
- `http://localhost:4321/reviews/`
- `http://localhost:4321/kickstart/`

Expected: NO chat bubble on any of these pages.

- [ ] **Step 5: View source check**

On `/`, view page source (Ctrl+U) and search for `leadconnectorhq.com`. Expected: one `<script defer src="https://beta.leadconnectorhq.com/loader.js" ...>` tag is present. The `defer` attribute should be on the tag.

On `/contact/`, repeat: expected NO `leadconnectorhq.com` in the source.

- [ ] **Step 6: Stop dev server**

Ctrl+C in the dev terminal.

- [ ] **Step 7: Commit Phase 3**

```bash
git add src/components/widgets/AIChatWidget.astro src/layouts/BaseLayout.astro src/pages/index.astro src/pages/kids-martial-arts.astro src/pages/adults-jiu-jitsu.astro
git commit -m "$(cat <<'EOF'
feat(chat-widget): render GHL chat widget on home, kids, adults pages

Replaces the AIChatWidget placeholder with the real GHL embed, switches
to two env vars (PUBLIC_GHL_CHAT_WIDGET_ID + PUBLIC_GHL_LOCATION_ID),
and moves the include out of BaseLayout so the widget shows only on
the three conversion pages.
EOF
)"
```

---

## Phase 4 — Vercel env vars + Preview deploy

### Task 8: Add the two PUBLIC env vars to Vercel

- [ ] **Step 1: Add `PUBLIC_GHL_CHAT_WIDGET_ID` to Vercel**

In the Vercel dashboard → project → Settings → Environment Variables, add:

| Key | Value | Targets |
|---|---|---|
| `PUBLIC_GHL_CHAT_WIDGET_ID` | `6a1457d0294a01e42f36f93f` | Production, Preview, Development |

- [ ] **Step 2: Add `PUBLIC_GHL_LOCATION_ID` to Vercel**

| Key | Value | Targets |
|---|---|---|
| `PUBLIC_GHL_LOCATION_ID` | `eMHOrbrPAfFd2S1ORNKL` | Production, Preview, Development |

- [ ] **Step 3: Push the Phase 1–3 commits and let Vercel build a Preview**

```bash
git push origin master
```

Wait for the Preview deployment to finish in Vercel.

- [ ] **Step 4: Visual check on the Preview URL**

Open the Preview URL on the home, kids, and adults pages. Confirm chat bubble appears. Open `/contact` on the same Preview URL — confirm no bubble.

- [ ] **Step 5: Network check**

In Chrome DevTools → Network tab on the Preview home page, confirm `beta.leadconnectorhq.com/loader.js` loads with status 200.

---

## Phase 5 — GHL configuration (no code)

All work in the GHL UI. Follow the spec's Section 1 + Section 3 verbatim — this plan summarizes the steps for tracking.

### Task 9: Configure the GHL chat widget UI

- [ ] **Step 1: Navigate to the widget config**

GHL → Sites → Chat Widgets → select the widget with ID `6a1457d0294a01e42f36f93f`.

- [ ] **Step 2: Fill the Style tab**

Use exact values from spec Section 1 "Style tab" table:
- Chat prompt ON, colored bubble style, speech-bubble icon
- Custom theme: primary `#0E2240`, accent `#C8102E`, highlight `#F2C94C`
- Welcome message: paste verbatim from spec
- Return visitor greeting ON, paste verbatim from spec

- [ ] **Step 3: Fill the Chat window tab**

Use exact values from spec Section 1 "Chat window tab" table:
- Title, intro, form fields (Name + Phone + Email all mandatory), button text
- Redirect call-to-action OFF

- [ ] **Step 4: Fill the Messaging tab**

Use exact values from spec Section 1 "Messaging tab" tables — both "Live chat assigned" and "Live chat closed" subsections — plus the business hours table.

- [ ] **Step 5: Fill the Additional options + Acknowledgement sections**

Use exact values from spec Section 1 "Additional options" and "Acknowledgement section" tables. Pay attention to the consent checkbox (labeled "HIPAA" by GHL) being ON with default-checked ON.

- [ ] **Step 6: Save the widget config + visual smoke check**

Click Save. Reload your Vercel Preview home page — the new copy, theme, and welcome teaser should reflect within ~30 seconds (GHL CDN refresh). If theme colors didn't update, hard-refresh (Ctrl+Shift+R) to bust CDN cache.

### Task 10: Build Workflow #1 — `[Inbound] Chat Widget → Pipeline Orchestrator`

- [ ] **Step 1: Create a new blank workflow**

GHL → Automation → Workflows → + Create Workflow → Start from blank.

Name: `[Inbound] Chat Widget → Pipeline Orchestrator`
Folder: Inbound Webhooks (or wherever other backflow workflows live)

- [ ] **Step 2: Add the trigger**

Trigger: `Contact Created`.

Filter: Add a filter that targets chat-widget-originated contacts. Try in order until one is available:
1. `Last Channel contains "Chat"`
2. `Last Channel = Chat`
3. `Source contains "chat"`

If none match, fall back to: `Tags contains "source-chat-widget"` (the tag is added later by `/api/lead`, so this filter would create a chicken-and-egg loop — use only as last resort, and in that case change Action 1 to also call /api/lead UNCONDITIONALLY on any new contact, which is too broad — prefer one of options 1–3).

- [ ] **Step 3: Add Action 1 — Webhook to /api/lead**

Add a "Send Webhook" / "Custom Webhook" action with:

| Field | Value |
|---|---|
| URL | `{{custom_values.website_webhook_base_url}}/lead` |
| Method | POST |
| Body type | Custom JSON |

Headers (add both):
- `X-GBW-Secret: {{custom_values.website_webhook_secret}}`
- `Content-Type: application/json`

Body (paste verbatim):

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

Note: If `{{conversation.last_message_body}}` isn't a recognized merge tag in this subaccount, use whichever tag the picker offers for the first chat message body. Empty string is acceptable as a fallback.

- [ ] **Step 4: Add Action 2 — Conditional LOST/COLD reactivation**

Add an If/Else condition:
- IF the contact has an open Lead Acquisition opportunity at stage `LOST / COLD`
- THEN: Update Opportunity Stage → move that opp to `NURTURE CAMPAIGN`
- ELSE: do nothing (Action 1 already created a NEW LEAD opp via /api/lead for fresh contacts)

- [ ] **Step 5: Publish the workflow**

Click "Publish" / "Save & Activate".

### Task 11: Build Workflow #2 — `[Inbound] Chat Widget Inbound Alert`

- [ ] **Step 1: Create a new blank workflow**

Name: `[Inbound] Chat Widget Inbound Alert`
Folder: Internal Notifications

- [ ] **Step 2: Add the trigger**

Trigger: `Customer Replied`.

Filter: `Channel = Chat` (or closest equivalent — verify in trigger filter dropdown).

- [ ] **Step 3: Add Action 1 — In-app notification**

Add an "In-App Notification" / "Internal Notification" action. Recipients: all assigned users (or specifically the front-desk role). Message:

```
Chat lead: {{contact.first_name}} — {{message.body}}
Open: {{contact.url}}
```

- [ ] **Step 4: Add Action 2 — Internal SMS to front desk**

Add an "Internal SMS" action targeting the front-desk phone number. Message:

```
Chat lead: {{contact.first_name}} — "{{message.body}}" → {{contact.url}}
```

- [ ] **Step 5: Publish the workflow**

Click Publish.

### Task 12: Discover the new workflow IDs + add to Vercel

- [ ] **Step 1: Run the discovery script**

In the project directory:

```bash
npm run onboard:ghl discover
```

Expected output: a list of `KEY=value` lines, including a new one similar to:

```
WORKFLOW_ID_CHAT_WIDGET_ORCHESTRATOR=<uuid>
```

(If the script doesn't auto-discover this workflow because it's filtering by name pattern, the spec name `[Inbound] Chat Widget → Pipeline Orchestrator` may need to be added to the script's expected-names list. Check [scripts/onboard-client.ts](../../../scripts/onboard-client.ts) for the workflow-discovery section and add the new name if so. If you make that change, commit it as a separate fixup.)

- [ ] **Step 2: Copy the workflow ID into Vercel**

In Vercel → Settings → Environment Variables, add:

| Key | Value | Targets |
|---|---|---|
| `WORKFLOW_ID_CHAT_WIDGET_ORCHESTRATOR` | (uuid from Step 1) | Production, Preview |

- [ ] **Step 3: Trigger a Vercel redeploy**

In Vercel → Deployments → click the three-dot menu on the latest Production deployment → Redeploy. (Env-var changes don't auto-redeploy.)

---

## Phase 6 — Dashboard widget + smoke test

### Task 13: Add dashboard widget #23b "Chat Widget Leads"

- [ ] **Step 1: Open the Studio Overview dashboard in edit mode**

GHL → Dashboard → Studio Overview → Edit Dashboard.

- [ ] **Step 2: Add a new widget alongside #23/#24/#25 in Row 11**

Click Add Widget. Configure:

| Field | Value |
|---|---|
| Widget type | Numeric / KPI |
| Name | `Chat Widget Leads — Last 30 Days` |
| Data source | Contacts |
| Filter | Source = `Website Chat` |
| Date range | Last 30 Days |
| Metric | Count |
| Width | 1/3 |

- [ ] **Step 3: Position the widget**

Drag it into Row 11 between widget #25 (Paid Ad Leads) and the next row, OR replace one of the empty 1/3 slots if Row 11 has space. Save the dashboard.

- [ ] **Step 4: Update the dashboard build guide**

Modify [docs/ghl-dashboard-build-guide.md](../../ghl-dashboard-build-guide.md) Row 11 table — add a fourth row entry:

```markdown
| 25b | Chat Widget Leads — Last 30 Days | Numeric / KPI | Source **Contacts**; **Source = Website Chat**; **Last 30 Days** | 1/3 |
```

(If the spec used `23b` for this widget, use `25b` here instead since the existing guide numbers Row 11 as 23/24/25 — choosing the next available suffix is fine; the number is positional, not load-bearing.)

- [ ] **Step 5: Commit the docs update**

```bash
git add docs/ghl-dashboard-build-guide.md
git commit -m "$(cat <<'EOF'
docs(ghl-dashboard): add Chat Widget Leads KPI to Row 11

Adds widget 25b — Chat Widget Leads — Last 30 Days — alongside the
existing Website Leads / Walk-In / Paid Ad source breakdown widgets.
EOF
)"
```

### Task 14: Smoke test the end-to-end flow

The 7-step verification from spec Section 5, executed on Preview first, then Production.

- [ ] **Step 1: Open Preview home in incognito**

Open the latest Vercel Preview URL (`/`) in an incognito browser. Confirm chat bubble appears in the bottom-right after a few seconds with the brand-navy welcome teaser.

- [ ] **Step 2: Open Preview /contact in the same incognito browser**

Navigate to `/contact` on the same Preview URL. Confirm NO chat bubble.

- [ ] **Step 3: Submit a test chat from Preview home**

Back on `/`, click the bubble. Fill:
- Name: `Smoke Test`
- Phone: a real phone number you can receive SMS on (yours)
- Email: `smoke-test+chat@gracie.test`
- Check the SMS-consent box
- Type message: `Just testing the new chat widget — please ignore.`
- Click Send Message.

- [ ] **Step 4: Verify GHL state within 60 seconds**

In a separate tab, open GHL → Contacts → search for `Smoke Test`. Confirm:

- [ ] Contact exists with native Source = `Website Chat`
- [ ] Contact has tags including `source-chat-widget` and `kickstart-funnel`
- [ ] Contact CF `lead_source` = `Website Chat`
- [ ] Contact CF `optin_page` = `Chat Widget`
- [ ] Lead Acquisition pipeline shows a new opp at `NEW LEAD` named something like `Smoke Test — chat-widget`
- [ ] Contact is enrolled in the Trial Nurture workflow (check Contact → Workflows tab)

- [ ] **Step 5: Verify Workflow #1 execution**

GHL → Automation → Workflows → `[Inbound] Chat Widget → Pipeline Orchestrator` → Execution History. Find the most recent run.

- [ ] Webhook action returned status 200 with response body containing `"ok":true`

If status was 4xx or 5xx, check the response body for the error code and fix before proceeding:
- `INVALID_INPUT` → schema mismatch in the JSON body (typo / wrong merge tag)
- `RATE_LIMITED` → secret header didn't match (trusted-caller short-circuit didn't trigger)
- `GHL_FAILED` → /api/lead reached `handleOptIn` but the adapter failed; check Vercel function logs

- [ ] **Step 6: Verify Workflow #2 fires on the second message**

Open the test chat again on Preview, send a second message: `Another test reply.`

Confirm: in-app notification appears in GHL for the assigned user, AND the front-desk phone receives the internal SMS.

- [ ] **Step 7: Test existing-LOST/COLD reactivation**

Prep: in GHL, manually create a test contact with phone `+15555550199`, email `smoke-reactivate@gracie.test`, and create a Lead Acquisition opp for that contact at stage `LOST / COLD`.

Then from Preview `/`, open the chat as a fresh incognito session, submit the contact form with the SAME phone + email + name `Reactivate Test`, send a message.

Within 60 seconds, verify:
- [ ] No DUPLICATE Lead Acq opp created (the existing opp got reused — confirm there's still only one open Lead Acq opp for this contact)
- [ ] The existing LOST/COLD opp moved to stage `NURTURE CAMPAIGN`
- [ ] Workflow #1 execution history shows Action 2 (the If/Else reactivation branch) fired its THEN branch

- [ ] **Step 8: Run the security network-leak scan**

```bash
bash tests/security/bundle-scan.sh
```

Expected: the scan completes without flagging `beta.leadconnectorhq.com` as an unexpected host. If it's flagged, add the domain to the allowed-host list inside the script and re-run.

- [ ] **Step 9: Run the e2e + unit test suites**

```bash
npm test
npx playwright test tests/e2e/smoke.spec.ts
```

Expected: all green. (The e2e suite doesn't test the chat widget directly but verifies that the three pages with the widget still render without JS errors.)

### Task 15: Promote to Production

- [ ] **Step 1: Confirm Preview smoke test is green**

All Task 14 steps pass on the Preview URL.

- [ ] **Step 2: Merge to master and trigger Production deploy**

If you've been working on a branch, merge to master:

```bash
git checkout master
git merge --no-ff <branch>
git push origin master
```

If you've been committing directly to master (per the project's existing pattern based on recent commits), just push:

```bash
git push origin master
```

- [ ] **Step 3: Wait for Production build + deploy**

Watch the Vercel dashboard for the Production deployment to finish.

- [ ] **Step 4: Repeat Task 14 Steps 1–6 on Production**

Use the production URL `https://www.graciebarrawhittier.com/` instead of the Preview URL. Use a different test contact (e.g., `smoke-prod+chat@gracie.test`) so it doesn't collide with the Preview test contact.

- [ ] **Step 5: Verify the dashboard widget #25b populates**

GHL → Dashboard → Studio Overview. The `Chat Widget Leads — Last 30 Days` KPI should show a count of at least 1 (your production test). May take up to 5 minutes for the dashboard query to refresh.

- [ ] **Step 6: Clean up test contacts**

Delete (or merge into a "test" tag for archival) the smoke-test contacts in GHL so they don't pollute real lead reports.

- [ ] **Step 7: Final commit if any fixups were needed during Phase 5/6**

If Phase 5/6 surfaced any small fixes (e.g., adjusting the onboard:ghl script to discover the new workflow), commit those now:

```bash
git add scripts/onboard-client.ts
git commit -m "fix(onboard:ghl): include chat-widget orchestrator workflow in discovery"
git push origin master
```

---

## Done criteria

- [ ] Chat bubble appears on production home, kids, and adults pages
- [ ] Chat bubble does NOT appear on contact, reviews, kickstart, rebook, back-to-the-mats, terms, privacy, offer, or 404 pages
- [ ] Submitting a chat creates a Contact with Source = `Website Chat`, tag `source-chat-widget`, and a NEW LEAD opp in Lead Acquisition
- [ ] Contact is enrolled in Trial Nurture
- [ ] Returning LOST/COLD contacts get reactivated to NURTURE CAMPAIGN, no duplicate opps
- [ ] Staff sees in-app + SMS notifications on every chat reply
- [ ] Dashboard widget #25b populates with chat-originated lead count
- [ ] `npm test`, `npm run check`, and `tests/security/bundle-scan.sh` all pass
