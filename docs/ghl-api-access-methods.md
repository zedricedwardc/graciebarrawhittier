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

## 7. The better approach to using the internal backend

The trial-and-error path we used to figure this out (probe endpoints, guess body shapes, PUT and see what breaks) is the WORST way to use this API. It cost us a workflow wipe and several hours. Here's how to do it right from the start when you DO need internal-backend access.

### Principle 1 — Capture first, code second

Never guess at an endpoint or body shape. The GHL UI is itself a client of the same API, and it always sends the correct shape. Before writing ANY automation, do the change once manually in the UI with DevTools Network tab recording:

1. **Open the GHL feature you want to automate** (a workflow, an AI agent, a custom value, etc.).
2. **DevTools → Network tab → check "Preserve log" and "Disable cache"**.
3. **Make the smallest possible change in the UI** (e.g., add one trigger filter and save).
4. **Find the request that performs the change** — it's usually a PUT or POST with `backend.leadconnectorhq.com` in the URL. Filter the network panel by `backend.leadconnectorhq.com` to make it easier to spot.
5. **Right-click the request → Copy → Copy as cURL (bash)**. That's the entire correct shape: URL, headers, method, body, query params. Verbatim.
6. **Save that cURL command to a file** (e.g., `scripts/ghl-captures/trigger-update.sh`). This is your ground-truth template.
7. **Then write your automation by parameterizing the template** — replace specific values (workflow ID, tag name, etc.) with variables.

This is dramatically faster and safer than probing. It also documents itself — anyone reading the saved cURL knows exactly what the API expects.

### Principle 2 — Build a thin wrapper, not a script per task

Every internal-backend call repeats the same boilerplate: headers, token handling, JSON encoding, error parsing. Extract it into a small TS module (since this repo already has TypeScript + node).

Sketch of what that would look like:

```ts
// scripts/ghl-internal/client.ts
interface GHLInternalAuth {
  sessionToken: string;  // from DevTools, ~1hr TTL
  tokenId: string;       // Firebase JWT from DevTools, ~1hr TTL
  locationId: string;
}

interface GHLInternalRequest {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  path: string;          // e.g., "workflow/{loc}/{wf}"
  body?: unknown;
  query?: Record<string, string>;
}

async function callInternal(auth: GHLInternalAuth, req: GHLInternalRequest) {
  const url = new URL(`https://backend.leadconnectorhq.com/${req.path}`);
  for (const [k, v] of Object.entries(req.query ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${auth.sessionToken}`,
    'Token-Id': auth.tokenId,
    'Channel': 'APP',
    'Source': 'WEB_USER',
    'Origin': 'https://client-app-automation-workflows.leadconnectorhq.com',
    'Referer': 'https://client-app-automation-workflows.leadconnectorhq.com/',
    'Accept': 'application/json, text/plain, */*',
  };
  if (req.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: req.method,
    headers,
    body: req.body ? JSON.stringify(req.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new GHLInternalError(res.status, req.method, url.toString(), text);
  }
  return res.status === 204 ? null : await res.json();
}
```

Then concrete helpers built on top:

```ts
// scripts/ghl-internal/workflow.ts
export async function getWorkflow(auth, workflowId) { ... }
export async function getTriggers(auth, workflowId) { ... }
export async function updateTriggerConditions(auth, triggerId, conditions) { ... }
export async function updateWorkflowSafe(auth, workflowId, mutate: (wf) => void) {
  const current = await getWorkflow(auth, workflowId);
  await fs.writeFile(`./backups/wf-${workflowId}-${Date.now()}.json`, JSON.stringify(current));
  mutate(current);  // in-place edit
  return await putWorkflow(auth, workflowId, current);
}
```

The `updateWorkflowSafe` pattern is the most important one: **GET, backup, mutate in place, PUT the full doc**. That single function would have prevented the workflow wipe.

### Principle 3 — Backup before every write

Internal-backend writes are full-replace. A partial body silently zeros out unsent fields. The cheapest insurance is to checkpoint the current state to a timestamped JSON file before any mutation.

A worktree-style pattern:
```
ghl-backups/
  workflow-3ba5c152-7ecb-466f-82db-1dba8b94c843/
    2026-05-26T16-30-00Z.json  ← before change
    2026-05-26T16-30-12Z.json  ← after change
    2026-05-26T18-45-00Z.json  ← next session
```

If anything goes wrong, you have an exact restore point. Doesn't cost anything since these JSONs are small.

### Principle 4 — Token-aware code that fails fast

The 1-hour session token TTL means long automation runs will silently hit expired tokens mid-way. The wrapper should:

- **Decode the session JWT on use**, check the `exp` claim, and refuse to start work if there's less than 5 minutes left.
- **Surface 401 responses immediately** — don't retry with stale auth.
- **Print a clear "fetch fresh token from DevTools" message** when tokens expire, with the exact URL pattern to look for.

```ts
function assertTokenFresh(auth: GHLInternalAuth) {
  const claims = JSON.parse(Buffer.from(auth.sessionToken.split('.')[1], 'base64url').toString());
  const expiresInSec = claims.exp - Date.now() / 1000;
  if (expiresInSec < 300) {
    throw new Error(`Session token expires in ${expiresInSec.toFixed(0)}s. Refresh from DevTools before continuing.`);
  }
}
```

### Principle 5 — Sanity-check the validator before trusting save success

The customer_reply validator is a no-op (and likely others). A successful 200 from PUT means "the bytes were stored" — NOT "the trigger will fire correctly at runtime." 

After every trigger or workflow change, ALWAYS do at least one smoke test that exercises the new behavior end-to-end. For trigger filters: send a real test message in the channel; verify the workflow fires (or doesn't) in GHL → Execution History. Don't trust the API response alone.

### Principle 6 — Treat the internal backend as fragile

GHL can change endpoints, body shapes, or auth requirements at any time. They owe no SemVer. Build automation against the internal backend assuming it MIGHT break next week.

Concretely:
- **Pin to a recent capture date.** If your `scripts/ghl-captures/trigger-update.sh` was captured 2026-05-26, write that date in a comment. When something breaks, knowing the capture is N weeks stale tells you to re-capture.
- **Don't put internal-backend calls on the critical path of customer-facing flows.** Backend changes are admin tooling, not runtime infra.
- **Have a "rebuild from UI" plan documented** for every workflow/trigger you manage via API. If GHL breaks the API tomorrow, can someone get the same state back by clicking through the UI? Yes? Then you're fine.

### Decision flow

For ANY new GHL automation task:

```
                ┌──────────────────────────────────┐
                │ Does the public API cover this?  │
                └──────────┬───────────────────────┘
                           │
                ┌──────────┴──────────┐
              YES                    NO
                │                     │
                ▼                     ▼
        Use services.../  Capture the UI's actual save
        (with PIT token)  request via DevTools first
                                      │
                                      ▼
                          Parameterize the captured cURL
                                      │
                                      ▼
                              Run via thin wrapper
                              with GET-then-PUT-full
                              and backup-before-write
                                      │
                                      ▼
                          Verify end-to-end with a real
                              smoke test in GHL UI
```

If the public API covers what you need, use it. If not, capture-first (don't guess), wrapper-second, smoke-test-always.

---

## 8. References

- **uxieee/ghl-workflow-api-docs** — https://github.com/uxieee/ghl-workflow-api-docs — sniff'd JS bundle docs with trigger/step shapes, microservice topology, validators. Indispensable for the internal backend path.
- **GHL Marketplace API docs** — https://marketplace.gohighlevel.com/docs/ghl/ — official docs for the public API. Notably has `/conversation-ai/agents` documented.
- **This repo's `scripts/onboard-client.ts`** — example of the public API pattern in production code for pipeline/workflow/calendar discovery.
