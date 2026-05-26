# GHL API Access Methods — Internal vs Public

Two distinct ways to talk to GoHighLevel programmatically. They have different hosts, different auth, different scopes, and different use cases. This doc captures what was learned reverse-engineering both during the 2026-05-26 chat-widget integration build.

**TL;DR:** Use the **public API** (PIT token) whenever it covers what you need — it's stable, supported, documented. Fall back to the **internal backend** (session JWT + Token-Id) only for things the public API doesn't expose, and treat that path as fragile.

---

## 1. Public API — `services.leadconnectorhq.com`

The official, documented, supported GHL API. Marketplace partners build against this.

### Auth

| Header | Value | Notes |
|---|---|---|
| `Authorization` | `Bearer <PIT>` | Private Integration Token from GHL → Settings → Private Integrations. Long-lived (does not expire automatically). Scoped per-resource. |
| `Version` | `2021-04-15` | Pins the API version. Required. |
| `Content-Type` | `application/json` (for write methods) |  |

PIT for this project lives in Vercel as `GHL_PIT_TOKEN`. Pull locally with `vercel env pull C:/tmp/gbw.env --environment=production`.

### Scope rotation gotcha

When you add a new scope to an existing PIT (e.g., "View Conversation AI Agents"), you DO NOT need to regenerate the token value — the existing token just gains the new capability. But if scopes were missing, calls return `401 "The token is not authorized for this scope."` until rotated.

Adding scope: GHL → Settings → Private Integrations → edit the token → tick the new scope → Save. No Vercel update needed since the token string is unchanged.

### Verified endpoints

**Conversation AI agents:**

| Method | Path | Body / Notes |
|---|---|---|
| `GET` | `/conversation-ai/agents/search` | NO query params — the PIT carries the location scope. Returns `{agents:[...], totalCount, count}` |
| `POST` | `/conversation-ai/agents` | Create agent. See body shape below. |
| `PUT` | `/conversation-ai/agents/{agentId}` | Update agent. Same body shape as POST. |
| `GET` | `/conversation-ai/agents/{agentId}` | Get single agent. |
| `DELETE` | `/conversation-ai/agents/{agentId}` | Delete agent. |

**Agent body shape (POST/PUT):**

```jsonc
{
  "name": "[Chat] Whittier Concierge",
  "businessName": "Gracie Barra Whittier",
  "mode": "auto-pilot",         // or "off"
  "channels": ["Live_Chat"],    // any of: Live_Chat, SMS, Email, FB, IG
  "waitTime": 5,
  "waitTimeUnit": "seconds",
  "sleepEnabled": false,        // if false, OMIT sleepTime/sleepTimeUnit entirely
  "autoPilotMaxMessages": 50,
  "isPrimary": false,
  "respondToAudio": false,
  "respondToImages": false,
  "knowledgeBaseIds": [],
  "actions": [],
  "goal": "<one-paragraph purpose>",
  "personality": "<system prompt — identity, tone, never-do list>",
  "instructions": "<extended instructions — redirect map, FAQ corpus, etc.>"
}
```

**Server-rejected fields** (auto-derived, do NOT send): `nameLower`, `llm` (server picks the model based on plan), `id`, `createdAt`, `updatedAt`.

### Encoding gotcha

When sending UTF-8 bodies via `curl` on Windows, em-dashes (`—`) and bullets (`•`) get stored as Latin-1 mojibake (`â€"`, `â€¢`). Either:
1. Use ASCII-safe punctuation (`--` for em-dash, `*` for bullet, straight quotes only), OR
2. Use `\uXXXX` JSON escape sequences in the body, OR
3. Send `Content-Type: application/json; charset=utf-8` AND verify the request actually round-trips clean

We've verified ASCII-safe is the most reliable on Windows.

### Pros

- **Stable.** Documented at https://marketplace.gohighlevel.com/docs/ghl/
- **Long-lived auth.** PIT doesn't expire hourly.
- **Versioned.** The `Version: 2021-04-15` header pins behavior — GHL won't break you with a silent change.
- **Predictable error codes.** Real validation messages like `"sleepTime should not be provided when sleepEnabled is false"`.

### Cons

- **Not everything is exposed.** Workflow steps, trigger conditions, custom values, location settings — many things ONLY the internal backend can do.
- **Scope friction.** New surface = potential new scope to add to PIT.

---

## 2. Internal backend — `backend.leadconnectorhq.com`

The undocumented backend that GHL's own web UI talks to. Used internally; unofficial for third-party use. We use it for things the public API doesn't cover (workflow trigger conditions, workflow step edits, etc.).

### Auth

| Header | Value | Notes |
|---|---|---|
| `Authorization` | `Bearer <session-token>` | Short-lived JWT (~1 hour). Issued by GHL backend, NOT Firebase. Claims include `channel: APP`, `source: WEB_USER`, `authClass: User`. |
| `Token-Id` | `<firebase-jwt>` | Firebase identity token. Also short-lived (~1 hour). Issued by `securetoken.google.com/highlevel-backend`. |
| `Channel` | `APP` | Required. |
| `Source` | `WEB_USER` | Required. |
| `Origin` | `https://client-app-automation-workflows.leadconnectorhq.com` | Or `https://app.gohighlevel.com` depending on context. |
| `Referer` | matches Origin + `/` |  |

### How to get the tokens

There's no programmatic way — they come from a live browser session:

1. Log into GHL in Chrome/Brave
2. Open DevTools → Network tab → check "Preserve log"
3. Trigger any backend call (open a workflow, click a setting, etc.)
4. Find a request to `backend.leadconnectorhq.com`
5. Copy the `Authorization` header value (after `Bearer `) → that's the session token
6. Copy the `Token-Id` header value → that's the Firebase JWT

Both expire after ~1 hour. For long-running work, plan to refresh them mid-task.

### Token corruption gotcha

When pasting these JWTs into bash variables (especially in Windows / WSL / Git Bash environments), the middle `payload` segment can mangle silently — characters get substituted, the `jti` claim becomes garbage. The workflow service tolerates malformed tokens (lax validation), but the Conversation AI service rejects with `"Bad control character in string literal in JSON at position 212"`.

**Check** by decoding the middle JWT segment after pasting:
```bash
echo "$SESSION" | cut -d. -f2 | base64 -d | head -c 300
```
If you see anything other than clean JSON (no `\uXXXX` escapes, valid keys), the token got corrupted in paste. Re-paste from the user message.

### Verified endpoints

**Workflows:**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/workflow/{loc}/{wf}?includeScheduledPauseInfo=true` | Full workflow doc including `workflowData.templates` (the steps) |
| `PUT` | `/workflow/{loc}/{wf}` | Updates BOTH metadata AND `workflowData.templates`. Requires `version` in body matching current. **GET-THEN-PUT, NEVER PARTIAL** (see Critical Gotchas below) |

**Workflow triggers:**

| Method | Path | Notes |
|---|---|---|
| `GET` | `/workflow/{loc}/trigger?workflowId={wf}` | Array of triggers for a workflow |
| `PUT` | `/workflow/{loc}/trigger/{triggerId}` | Partial-update merge on a single trigger. Send `{"conditions": [...]}` to swap filters; other fields preserved. |

**Critical: GET-then-PUT pattern for workflows**

Workflow PUT is a FULL REPLACE (not a merge). Sending a partial body like `{"allowMultiple": true}` defaults all unsent fields to their zero values — `allowMultipleOpportunity` flips to `false`, `workflowData.templates` becomes empty (this **wipes all steps**).

Correct pattern:
```bash
# 1. GET first
curl ... > current.json

# 2. Modify the fields you need to change (in-place edit of current.json)
# Be sure to keep ALL existing fields

# 3. PUT the FULL doc back, including current version
# Server will increment version on success
```

Worst case if you damage a workflow this way: you can restore from a clean GET captured before the damage. Always capture the GET to a file BEFORE experimenting.

**Trigger condition shapes** (must match the validator — server is no-op, accepts garbage):

```jsonc
// Filter: Reply channel is Chat
{
  "field": "message.type",
  "type": "select",
  "title": "Reply channel",
  "value": 29,                  // 29 = Chat channel; varies by GHL version
  "operator": "=="
}

// Filter: Contact does NOT have tag "X"
{
  "field": "contact.tags",      // NOT just "tags"
  "type": "select",             // NOT "multi_select"
  "title": "Doesn't have tag",
  "value": "source-chat-widget", // single string, NOT array
  "operator": "index-of-false"  // NOT "not_in" or "not_contains"
}

// Filter: Contact HAS tag "X"
{
  "field": "contact.tags",
  "type": "select",
  "title": "Has tag",
  "value": "tag-name",
  "operator": "index-of-true"
}
```

**Validator no-op gotcha:** the `customer_reply` trigger validator returns `[]` regardless of input — the server accepts ANY shape you send, but only the documented shapes actually fire correctly at runtime. A trigger with `operator: "not_in"` saves successfully and looks plausible in the GHL UI, but never matches anything. Source: the validators are sniff'd from the JS bundle in [`uxieee/ghl-workflow-api-docs`](https://github.com/uxieee/ghl-workflow-api-docs) → `reference/triggers/og/customer_reply.md`.

### Pros

- **Reaches everything.** The UI talks to this, so anything the UI does, you can do too.
- **Same shapes as the UI.** Body schemas match exactly what the UI sends.

### Cons

- **Hourly token TTL.** Plan around it; refresh tokens mid-task for long work.
- **Undocumented.** Endpoint discovery requires either reading the [uxieee/ghl-workflow-api-docs](https://github.com/uxieee/ghl-workflow-api-docs) repo (sniff'd from the JS bundle) or capturing browser DevTools network requests.
- **Silent validation failures.** Some endpoints accept invalid shapes that don't work at runtime.
- **GHL can change it without notice.** It's their internal API; they owe no SemVer.

---

## 3. Which to use for what

| Task | Path | Why |
|---|---|---|
| Create / list / update Conversation AI agents | **Public** (`services.../conversation-ai/agents`) | Documented, stable. Just needs PIT scope. |
| Read / send messages in conversations | **Public** | Officially supported. |
| Edit workflow trigger conditions | **Internal** (`backend.../workflow/{loc}/trigger/{triggerId}`) | Public API doesn't expose this. |
| Edit workflow steps (templates) | **Internal** (`backend.../workflow/{loc}/{wf}`) | Public API doesn't expose this. Beware the GET-then-PUT-full pattern. |
| Bulk contact tagging / custom field updates | **Public** | Supported. |
| Custom Values CRUD | **Public** | Supported via `/locations/{id}/customValues`. |
| Auto-discover workflow / location IDs for onboarding | **Public** | Already in this project's `scripts/onboard-client.ts`. |

Rule of thumb: **always try the public API first.** Only fall back to the internal backend when the public API genuinely doesn't expose what you need.

---

## 4. Headers cheat-sheet

### Public API
```
Authorization: Bearer ${GHL_PIT_TOKEN}
Version: 2021-04-15
Accept: application/json
Content-Type: application/json
```

### Internal backend
```
Authorization: Bearer ${SESSION_JWT}
Token-Id: ${FIREBASE_JWT}
Channel: APP
Source: WEB_USER
Origin: https://client-app-automation-workflows.leadconnectorhq.com
Referer: https://client-app-automation-workflows.leadconnectorhq.com/
Accept: application/json, text/plain, */*
Content-Type: application/json
```

---

## 5. Failure modes seen during this build

| What broke | Why | Fix |
|---|---|---|
| `400 "Bad control character in string literal at position 212"` from Conversation AI service | Session JWT was silently corrupted on paste (Git Bash on Windows mangled the middle segment) | Re-paste the token verbatim from the user message |
| Mojibake in stored bot prompt (`â€"` everywhere) | Curl on Windows sent UTF-8 em-dashes; GHL stored as Latin-1 | Rewrite body with ASCII-safe punctuation, PUT again |
| `422 "Your version is outdated"` on workflow PUT | Sent stale `version` after a prior PUT bumped it | Re-GET, update body with new `version`, PUT again |
| Workflow templates wiped to `[]` | Partial PUT to workflow that included `workflowData` but at wrong version | Restore from backed-up GET, send full doc with current version |
| `allowMultiple` silently flipped to `false` | Minimal PUT body omitted the field — server defaulted it | Always PUT the FULL doc, not partial fields |
| 401 "Token is not authorized for this scope" on public API | PIT missing the relevant scope | Add scope in GHL → Settings → Private Integrations |

---

## 6. Recommended workflow for future changes

When making any change via the API:

1. **GET the current state first** — save to a timestamped backup file.
2. **Inspect the response** — confirm you understand the current shape.
3. **Make the minimum change** in your modified copy.
4. **PUT the full modified doc back** — including current `version` for endpoints that require it.
5. **GET again to verify** — confirm the change landed and nothing else regressed.
6. **If something looks off, restore from the backup file.** Don't keep PUT-ing in the hope of fixing it; that compounds version drift.

For trigger updates specifically, the partial-update pattern works (`PUT /workflow/{loc}/trigger/{triggerId}` with just `{"conditions": [...]}`). For workflow-level updates, always send the full doc.

---

## 7. References

- **uxieee/ghl-workflow-api-docs** — https://github.com/uxieee/ghl-workflow-api-docs — sniff'd JS bundle docs with trigger/step shapes, microservice topology, validators. Indispensable for the internal backend path.
- **GHL Marketplace API docs** — https://marketplace.gohighlevel.com/docs/ghl/ — official docs for the public API. Notably has `/conversation-ai/agents` documented.
- **This repo's `scripts/onboard-client.ts`** — example of the public API pattern in production code for pipeline/workflow/calendar discovery.
