# GHL — Building a Workflow From Scratch via API

Reverse-engineered procedure for creating a GoHighLevel workflow end-to-end through the internal backend API, without touching the UI. Captures everything learned building the "Domain Warm-Up - June 2026" workflow (5 emails + 4 waits + 2 tag actions) on 2026-05-28.

**TL;DR:** The hard part isn't the endpoints — it's the JSON shape of `workflowData.templates`. Don't guess it. **Find a similar published workflow in the same location, GET it, and mirror its structure.** Then use `PUT /workflow/{loc}/{wf}/auto-save` with the auto-save envelope. Two things still need the UI: trigger attachment, and smart-list engagement filters.

For the public-API side (custom values, tags, email templates), see [`ghl-api-access-methods.md`](./ghl-api-access-methods.md). This doc covers the internal-backend side and the schema-mining procedure.

---

## 1. What you can and cannot build via API

| Artifact | API-buildable? | Endpoint surface |
|---|---|---|
| Custom values | ✅ | Public — `POST /locations/{loc}/customValues` |
| Tags | ✅ (auto-create on apply also works) | Public — `POST /locations/{loc}/tags` |
| Email templates (subject + HTML body) | ✅ | Internal backend `backend.leadconnectorhq.com/emails/builder` (2-step) |
| Workflow shell (name, draft) | ✅ | Internal — `POST /workflow/{loc}` |
| Workflow step graph (`workflowData.templates`) | ✅ | Internal — `PUT /workflow/{loc}/{wf}/auto-save` |
| Workflow publish (flip draft → published) | ✅ | Internal — `PUT /workflow/{loc}/{wf}` with publish envelope |
| Workflow trigger attachment | ❌ | `POST /workflow/{loc}/trigger` silently no-ops |
| Smart list with "opened email in last N days" filter | ❌ | No engagement field in `/contacts/search` whitelist |

For the two ❌ items, build everything else via API and finish in the UI.

---

## 2. Auth setup

Same as [`ghl-api-access-methods.md` §2](./ghl-api-access-methods.md) — internal backend section. Tokens come from a live browser session and expire in ~1 hour.

### The 6 required headers on every internal-API call

```
Authorization: Bearer <session-jwt>
Token-Id: <firebase-jwt>
Channel: APP
Source: WEB_USER
Origin: https://client-app-automation-workflows.leadconnectorhq.com
Referer: https://client-app-automation-workflows.leadconnectorhq.com/
```

For `backend.leadconnectorhq.com/emails/*` paths, add one more:

```
Version: 2021-04-15
```

Without `Version` on the emails surface, you get `401 "version header was not found."` (counterintuitive — internal endpoint demanding a public-API header).

### Tokens-file-on-disk pattern

Don't paste JWTs into shell variables — Git Bash / WSL / Windows terminals can silently mangle the middle segment. Instead save once to a file and `source` it from every call:

```bash
# C:\tmp\ghl-tokens.env
GHL_LOCATION_ID=eMHOrbrPAfFd2S1ORNKL
GHL_BEARER=eyJhbGciOiJSUzI1NiIs...
GHL_TOKEN_ID=eyJhbGciOiJSUzI1NiIs...
```

```bash
source /c/tmp/ghl-tokens.env
curl -H "Authorization: Bearer $GHL_BEARER" -H "Token-Id: $GHL_TOKEN_ID" ...
```

Verify the bearer isn't corrupted before any expensive work:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $GHL_BEARER" -H "Token-Id: $GHL_TOKEN_ID" \
  -H "Channel: APP" -H "Source: WEB_USER" \
  -H "Origin: https://client-app-automation-workflows.leadconnectorhq.com" \
  -H "Referer: https://client-app-automation-workflows.leadconnectorhq.com/" \
  "https://backend.leadconnectorhq.com/workflow/$GHL_LOCATION_ID?limit=1"
```

200 = good. 401 = either expired or corrupted; refresh from browser.

---

## 3. Schema discovery — the key technique

**The single most important insight: do not invent the workflow JSON shape.** The schema is sprawling, undocumented, and full of defaults that look optional but aren't (`trackingOptions.sourceId`, `templateCreationMode: "existing"`, `isHybridAction: true`, etc.). Skipping any of them produces silently-broken workflows that look fine in the UI but never fire.

Instead, mine the shape from a working example:

### Procedure

1. **List all workflows in the location** to find candidates:

   ```bash
   curl -s "https://backend.leadconnectorhq.com/workflow/$LOC" \
     -H "Authorization: Bearer $BEARER" -H "Token-Id: $TOKID" \
     -H "Channel: APP" -H "Source: WEB_USER" \
     -H "Origin: https://client-app-automation-workflows.leadconnectorhq.com" \
     -H "Referer: https://client-app-automation-workflows.leadconnectorhq.com/" \
     | python -c "import sys,json; [print(f'{w[\"_id\"]}  {w[\"status\"]:>10}  {w[\"name\"]}') for w in json.load(sys.stdin)]"
   ```

2. **Pick a reference workflow that contains every node type you need.** Criteria, in order:
   - `status: "published"` — mature, validated, well-formed (drafts can be half-built)
   - Has every node type your target workflow uses (email, wait, add_contact_tag, etc.)
   - Bonus: similar topology (drip vs. branching)

   In this project, `Last Chance Nurture Campaign` (id `03885bd2-8793-404f-9c4c-fe2372eeb02c`) was perfect — published, with email + wait + sms + internal_update_opportunity + add_contact_tag + remove_contact_tag all in one graph.

3. **GET the full workflow with steps:**

   ```bash
   curl -s "https://backend.leadconnectorhq.com/workflow/$LOC/$REF_WF_ID?includeScheduledPauseInfo=true" \
     -H "Authorization: Bearer $BEARER" -H "Token-Id: $TOKID" \
     -H "Channel: APP" -H "Source: WEB_USER" \
     -H "Origin: https://client-app-automation-workflows.leadconnectorhq.com" \
     -H "Referer: https://client-app-automation-workflows.leadconnectorhq.com/" \
     > /c/tmp/ghl-reference-workflow.json
   ```

4. **Study `workflowData.templates`** — that's the step array. Each element is one node. Pull out one sample of each node type you plan to use. Those samples are the source of truth for the shape you build.

5. **Save the reference JSON.** Keep it around for the entire build — you'll re-read it when crafting each node type.

---

## 4. The 5 build phases

Execute in this order. Each phase is independent of later phases except where noted.

### Phase A — Custom values

Public API. Use the MCP (`locations__create-custom-value`) or curl directly:

```
POST https://services.leadconnectorhq.com/locations/{locationId}/customValues
Authorization: Bearer <PIT>
Version: 2021-04-15
Content-Type: application/json

{"name": "warmup_sender_signature", "value": "Alex\nProgram Director, Gracie Barra Whittier"}
```

Returns `{customValue: {id, fieldKey, name, value, ...}}`. The `fieldKey` is what merges into emails: `{{custom_values.warmup_sender_signature}}`.

### Phase B — Tags

Public API. Tags auto-create on first apply (e.g., when a workflow's `add_contact_tag` step runs), so this is usually skippable. But if you want a deterministic create:

```
POST https://services.leadconnectorhq.com/locations/{locationId}/tags
Authorization: Bearer <PIT>
Version: 2021-04-15

{"name": "warmup-2026-06"}
```

### Phase C — Email templates (2-step)

Two POSTs against the internal backend (NOT the public API — the MCP wrapper requires `importProvider`, which GHL itself rejects when `type != "import"`). Always include the `Version: 2021-04-15` header.

**Step 1 — create shell:**

```
POST https://backend.leadconnectorhq.com/emails/builder
+ all 6 internal headers + Version: 2021-04-15

{
  "locationId": "eMHOrbrPAfFd2S1ORNKL",
  "title": "Warmup 1 - Quick hello",
  "name":  "Warmup 1 - Quick hello",
  "type": "blank",
  "builderVersion": "2",
  "updatedBy": "<user-id from token>",
  "isPlainText": false
}
```

Returns `{id: "<templateId>", redirect: "<templateId>", status: "ok"}`.

**Step 2 — inject HTML body:**

```
POST https://backend.leadconnectorhq.com/emails/builder/data
+ all 6 internal headers + Version: 2021-04-15

{
  "locationId": "eMHOrbrPAfFd2S1ORNKL",
  "templateId": "<from step 1>",
  "updatedBy": "<user-id>",
  "title": "Warmup 1 - Quick hello",
  "name":  "Warmup 1 - Quick hello",
  "subject": "Quick hello from Gracie Barra Whittier",
  "previewText": "Just a quick hello from our team.",
  "dnd": "{\"elements\":[],\"attrs\":{},\"templateSettings\":{}}",
  "editorType": "html",
  "isPlainText": true,
  "html": "<!DOCTYPE html><html>...</html>"
}
```

For plain-text-feel emails, use `editorType: "html"` + `isPlainText: true` with a minimal HTML wrapper. The `dnd` field is the drag-and-drop builder state; for plain HTML, pass the empty-elements JSON literal shown above.

### Phase D — Workflow shell

Internal backend. Minimal body:

```
POST https://backend.leadconnectorhq.com/workflow/{locationId}
+ all 6 internal headers (NO Version header on /workflow/*)

{
  "locationId": "eMHOrbrPAfFd2S1ORNKL",
  "name": "Domain Warm-Up - June 2026",
  "timezone": "account",
  "creationSource": "builder"
}
```

Returns `{id: "<workflowId>"}`. **Use ASCII in the name** — em-dash gets mojibaked (see Gotchas §8).

Re-GET to capture the initial `version` (will be `1`) — you'll need it for the auto-save envelope:

```
GET https://backend.leadconnectorhq.com/workflow/{loc}/{wf}?includeScheduledPauseInfo=true
```

`workflowData` will be `{}` (empty) on a fresh shell.

### Phase E — Save the step graph

This is the load-bearing call. See §5 below for the envelope shape, §6 for node shapes.

```
PUT https://backend.leadconnectorhq.com/workflow/{loc}/{wf}/auto-save
+ all 6 internal headers (NO Version header)
Content-Type: application/json; charset=utf-8

<auto-save envelope with workflowData.templates populated>
```

Returns HTTP 200 + a small body with `ok: true`, a `filePath`, etc.

**Verify the save persisted** by re-GET'ing the workflow and counting nodes:

```bash
curl -s "https://backend.leadconnectorhq.com/workflow/$LOC/$WF?includeScheduledPauseInfo=true" \
  -H "Authorization: Bearer $BEARER" -H "Token-Id: $TOKID" \
  -H "Channel: APP" -H "Source: WEB_USER" \
  -H "Origin: https://client-app-automation-workflows.leadconnectorhq.com" \
  -H "Referer: https://client-app-automation-workflows.leadconnectorhq.com/" \
  | python -c "import sys,json; d=json.load(sys.stdin); print('nodes:', len(d['workflowData']['templates']), '| version:', d['version'], '| status:', d['status'])"
```

`version` should have bumped (1 → 2). `nodes` should match what you sent.

---

## 5. The auto-save envelope

Top-level shape required by `PUT /workflow/{loc}/{wf}/auto-save`:

```jsonc
{
  "isAutoSave": true,
  "autoSaveSession": {
    "workflowId": "<wf-id>",
    "id": "<random uuid v4 — session identifier>",
    "userId": "<user-id from token's sub claim>",
    "version": <current workflow version, e.g. 1>
  },
  "version": <current workflow version, e.g. 1>,
  "createdSteps": ["<id of every newly-added step>"],
  "modifiedSteps": [],
  "deletedSteps": [],

  // Mirror these from the GET response of the workflow:
  "name": "Domain Warm-Up - June 2026",
  "locationId": "eMHOrbrPAfFd2S1ORNKL",
  "status": "draft",
  "dataVersion": 7,
  "allowMultiple": false,
  "timezone": "account",
  "removeContactFromLastStep": true,
  "stopOnResponse": false,
  "autoMarkAsRead": false,
  "updatedBy": "<user-id>",

  "workflowData": {
    "templates": [ /* the array of node objects */ ]
  }
}
```

### The linear-chain invariant

`workflowData.templates` is a flat array — not a tree. Linkage is encoded redundantly three ways:

1. **`order`** (integer) — 0, 1, 2, ... N. Must be sequential.
2. **`next`** (string) — id of the next node. **First node omits OR has empty string; last node omits `next` entirely.**
3. **`parentKey`** (string) — id of the previous node. **First node omits `parentKey`; subsequent nodes always set it.**

All three must agree. The UI builder cross-checks them — if `next` says one thing but `order` implies another, the graph renders broken.

---

## 6. Node-shape reference

Every node has the same outer envelope:

```jsonc
{
  "id": "<uuid v4>",
  "order": <int>,
  "name": "<display name>",
  "type": "<node type>",
  "next": "<id of next node, OR omitted on last>",
  "parentKey": "<id of previous node, OR omitted on first>",
  "attributes": { /* type-specific */ }
}
```

`attributes` is where the per-type schema lives. Below are minimal-but-complete shapes mined from `C:\tmp\ghl-reference-workflow.json`.

### `email` — send an email from a template

```jsonc
{
  "id": "<uuid>",
  "order": 0,
  "name": "Email 1 - Quick hello",
  "type": "email",
  "next": "<next-id>",
  "attributes": {
    "trackingOptions": {
      "hasTrackingLinks": false,
      "hasUtmTracking": false,
      "hasTags": false,
      "sourceId": "<wf-id>:<node-id>"     // REQUIRED — must concatenate workflowId + nodeId
    },
    "conditions": [],
    "subject": "Quick hello from Gracie Barra Whittier",
    "preHeader": "",
    "from_email": "",                       // empty = inherit location default
    "from_name": "",
    "previewUrl": "",                       // GHL regenerates this
    "createdAt": "<ISO timestamp>",
    "templateCreationMode": "existing",    // REQUIRED — "existing" means link to an email-builder template
    "syncEnabled": true,
    "fieldDefaults": {},
    "template_id": "6a172e45100266e9f911de8f",  // id from Phase C
    "templatesource": "email-builder",
    "attachments": []
  }
}
```

### `wait` — pause for N units

```jsonc
{
  "id": "<uuid>",
  "order": 1,
  "name": "Wait 3 Days",
  "type": "wait",
  "next": "<next-id>",
  "parentKey": "<prev-id>",
  "attributes": {
    "type": "time",
    "startAfter": {"type": "days", "value": 3, "when": "after"},
    "name": "Wait 3 Days",
    "cat": "",
    "isHybridAction": true,
    "hybridActionType": "wait",
    "convertToMultipath": false,
    "transitions": []
  }
}
```

`startAfter.type` can be `"minutes"`, `"hours"`, `"days"`, `"weeks"`.

### `add_contact_tag`

```jsonc
{
  "id": "<uuid>",
  "order": 10,
  "name": "Add warmup-complete tag",
  "type": "add_contact_tag",
  "parentKey": "<prev-id>",        // last node — no `next`
  "attributes": {
    "tags": ["warmup-complete-2026-06"]
  }
}
```

### `remove_contact_tag`

```jsonc
{
  "id": "<uuid>",
  "order": 9,
  "name": "Remove warmup tag",
  "type": "remove_contact_tag",
  "next": "<next-id>",
  "parentKey": "<prev-id>",
  "attributes": {
    "tags": ["warmup-2026-06"],
    "type": "remove_contact_tag"        // yes, type is duplicated inside attributes too
  }
}
```

### `sms`

```jsonc
{
  "id": "<uuid>",
  "type": "sms",
  "attributes": {
    "body": "{{contact.first_name}}, book your free class: {{custom_values.kickstart_page_url}}",
    "attachments": []
  }
}
```

### `internal_update_opportunity` — move an opportunity between pipeline stages

```jsonc
{
  "id": "<uuid>",
  "type": "internal_update_opportunity",
  "name": "Move to Lost",
  "workflowsActionType": "INTERNAL",
  "attributes": {
    "allowBackward": false,
    "type": "internal_update_opportunity",
    "__customInputs__": {},
    "__customInputFields__": [
      {"__customInputs__": {}, "dataType": "SINGLE_OPTIONS", "filterField": "pipelineId",      "value": "<pipeline-id>",       "valueFieldType": "select"},
      {"__customInputs__": {}, "dataType": "SINGLE_OPTIONS", "filterField": "pipelineStageId", "value": "<stage-id>",         "valueFieldType": "select"}
    ]
  }
}
```

Other node types (webhook, conditional split, drip, etc.) — when needed, find a reference workflow that uses them and mirror.

---

## 7. Verification procedure

After the auto-save PUT returns 200:

1. **Re-GET the workflow** and count nodes — this is the only reliable verification.
2. **Check `version` bumped** — every successful auto-save increments it. If version stayed the same, the save was rejected.
3. **Open the workflow in the GHL UI builder** and visually confirm the graph. If a node renders as "Unknown Step" or the chain looks broken, you missed a required field in `attributes` — re-compare against the reference workflow.

**Important — `filePath` is not a reliability signal for drafts.** Earlier reverse-engineering held that `filePath` ending in `auto-save-{ts}` meant a rejected orphan and only `/{N}` was canonical. That was wrong. For DRAFT workflows, `auto-save-{ts}` IS the canonical store — Firebase keeps the latest auto-save as the live draft. The numeric `/{N}` filePath only appears after the workflow is **published**. Trust the re-GET node count, not the filePath suffix.

---

## 8. Known limitations + workarounds

### Trigger creation is a silent no-op

`POST /workflow/{loc}/trigger` accepts a well-formed trigger body, returns 200 + an id, but the trigger never persists. Subsequent `GET /workflow/{loc}/trigger?workflowId=<wf>` returns `[]`. The returned id can't be fetched back, and `triggersFilePath` on the workflow stays `null`.

Tried variants that all 404 or silent-no-op: `/triggers`, `/{wf}/trigger`, `/{wf}/triggers`, `/workflow-triggers/...`, `/workflows-srv/...`, bulk-array POST/PUT.

**The trigger condition shape we know works** (mined from existing triggers in the location, just can't write it):

```jsonc
{
  "workflow_id": "<wf>",
  "belongs_to": "workflow",
  "masterType": "highlevel",
  "name": "Contact Tag",
  "type": "contact_tag",
  "location_id": "<loc>",
  "active": true,
  "conditions": [{
    "title": "Tag Added",
    "type": "select",
    "operator": "index-of-true",
    "field": "tagsAdded",
    "id": "tag-added",
    "value": "warmup-2026-06"
  }],
  "actions": [{"workflow_id": "<wf>", "type": "add_to_workflow"}]
}
```

**Workaround:** API-build the workflow body + steps, then open it in the UI and click "Add New Trigger" manually. ~30 seconds per workflow. To unblock fully, someone needs to HAR-capture the real trigger-create URL from a live UI "Add Trigger" click.

### Smart-list "opened email in last N days" filter

`POST /contacts/search` only accepts these operators: `eq, not_eq, contains, not_contains, wildcard, not_wildcard, match, not_match, exists, not_exists, range, not_range, contains_set, contains_not_set` — and the field whitelist rejects every email-engagement candidate (`lastEmailOpenedAt`, `email_opened`, `emailEngagement`, etc., all 400 "Invalid field"). There is no `search-filters` discovery endpoint.

**Workaround:** Create the smart list in the GHL UI (Contacts → Smart Lists → New → Activity → "Email Opened in last N days"). Then reference its id from the workflow trigger ("Contact added to smart list") if needed.

### Publishing (draft → published)

Separate endpoint, separate envelope, stricter validation than auto-save. **MUST strip** `autoSaveSession` and `autoSaveSessionId` from the body before sending — otherwise 422. Use `PUT /workflow/{loc}/{wf}` (no `/auto-save`) with `{"status": "published"}` plus the full workflow doc. Out of scope here; deserves its own doc.

---

## 9. Gotchas

### Mojibake on non-ASCII characters

Em-dash `—`, fancy quotes, bullets — all get mangled by the time GHL stores them. Confirmed: sending `Domain Warm-Up — June 2026` via `curl -d` resulted in stored name `Domain Warm-Up � June 2026` (Unicode replacement char).

**Use ASCII** for every user-visible string (workflow names, email subjects, step names) OR escape as `—` in the JSON literal. Don't try to fix it with `Content-Type: application/json; charset=utf-8` — that header is honored but Windows curl re-encodes the body before sending.

### JWT corruption when pasted into bash variables

The middle `payload` segment of a JWT can silently mangle in shell paste. Workflow service tolerates this; Conversation AI service rejects with `"Bad control character in string literal in JSON at position 212"`. Always source tokens from a file (`source /c/tmp/ghl-tokens.env`), never paste them inline into a command.

### `importProvider` schema-vs-server conflict on email templates

The `uxie-ghl-mcp` wrapper marks `importProvider` as required client-side, but GHL itself returns 422 when `importProvider` is present and `type != "import"`. **Bypass the MCP for `POST /emails/builder`** — curl the internal backend directly (with `Version: 2021-04-15`). The MCP works fine for everything else under the public API.

### `Version: 2021-04-15` header is required on `/emails/*` but NOT on `/workflow/*`

Counterintuitive — the `backend.leadconnectorhq.com` host is the "internal" backend, but its `/emails/*` paths behave like the public API (require `Version`) while `/workflow/*` behave like pure internal (no `Version` allowed; sending it works but it's not required). Conclusion: when an internal endpoint 401s with "version header was not found", try adding `Version: 2021-04-15`.

### Don't use `PUT /workflow/{loc}/{wf}` for step changes

That's the **publish** endpoint, not the step-save endpoint. It accepts partial bodies and silently defaults missing fields — including `workflowData.templates: {}`, which **wipes your step graph**. Always use `/auto-save` for step changes. Reserve plain `PUT` for status transitions only.

---

## 10. Working reference script

This is the actual Python that built the warm-up workflow's 11-node graph on 2026-05-28 (cleaned slightly for reuse). Drop-in template — change the constants at top, replace the node list, and the rest works as-is.

```python
"""Build + save a GHL workflow step graph via the auto-save endpoint.

Requires:
  C:/tmp/ghl-tokens.env with GHL_LOCATION_ID, GHL_BEARER, GHL_TOKEN_ID
  An already-created (empty) workflow shell — its id goes in WF_ID
  Already-created email templates — their ids go in EMAILS
"""
import json, uuid, datetime, urllib.request, urllib.error

# ---- Configure ----
WF_ID = "f8d7a05b-1d76-4fa6-8e82-4532022dfb14"
LOC   = "eMHOrbrPAfFd2S1ORNKL"
USER  = "GPiTw1E099H7gbeSxL1I"
WF_NAME = "Domain Warm-Up - June 2026"   # ASCII only — no em-dash
DATA_VERSION = 7                          # mirror from GET of the empty shell

EMAILS = [
    # (template_id, subject, step_name)
    ("6a172e45100266e9f911de8f", "Quick hello from Gracie Barra Whittier", "Email 1 - Quick hello"),
    ("6a172e51564959929b576783", "A quick question",                       "Email 2 - A quick question"),
    ("6a172e558680ed1567c0793e", "The one tip we give every white belt",   "Email 3 - White belt tip"),
    ("6a172e5a7df235d6f7f2d971", "If you've been thinking about coming in","Email 4 - Intro week"),
    ("6a172e5e7526e3c32979f2bf", "Still good to keep in touch?",           "Email 5 - Still good"),
]
WAITS = [3, 4, 7, 7]                     # days between emails

# ---- Helpers ----
NOW = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') \
    + f'{datetime.datetime.now(datetime.timezone.utc).microsecond//1000:03d}Z'

def email_node(order, nid, next_id, parent, tmpl_id, subject, name):
    n = {
        "id": nid, "order": order, "name": name, "type": "email",
        "attributes": {
            "trackingOptions": {"hasTrackingLinks": False, "hasUtmTracking": False,
                                "hasTags": False, "sourceId": f"{WF_ID}:{nid}"},
            "conditions": [], "subject": subject, "preHeader": "",
            "from_email": "", "from_name": "", "previewUrl": "", "createdAt": NOW,
            "templateCreationMode": "existing", "syncEnabled": True, "fieldDefaults": {},
            "template_id": tmpl_id, "templatesource": "email-builder", "attachments": []
        }
    }
    if next_id: n["next"] = next_id
    if parent:  n["parentKey"] = parent
    return n

def wait_node(order, nid, next_id, parent, days):
    return {
        "id": nid, "order": order, "type": "wait",
        "name": f"Wait {days} Days", "next": next_id, "parentKey": parent,
        "attributes": {
            "type": "time",
            "startAfter": {"type": "days", "value": days, "when": "after"},
            "name": f"Wait {days} Days", "cat": "",
            "isHybridAction": True, "hybridActionType": "wait",
            "convertToMultipath": False, "transitions": []
        }
    }

def remove_tag_node(order, nid, next_id, parent, tags, name="Remove tag"):
    return {
        "id": nid, "order": order, "type": "remove_contact_tag",
        "name": name, "next": next_id, "parentKey": parent,
        "attributes": {"tags": tags, "type": "remove_contact_tag"}
    }

def add_tag_node(order, nid, parent, tags, name="Add tag"):
    return {
        "id": nid, "order": order, "type": "add_contact_tag",
        "name": name, "parentKey": parent,
        "attributes": {"tags": tags}
    }

# ---- Build the chain ----
ids = [str(uuid.uuid4()) for _ in range(11)]
nodes = []
nodes.append(email_node(0,  ids[0], ids[1], None,  *EMAILS[0]))
nodes.append(wait_node (1,  ids[1], ids[2], ids[0], WAITS[0]))
nodes.append(email_node(2,  ids[2], ids[3], ids[1], *EMAILS[1]))
nodes.append(wait_node (3,  ids[3], ids[4], ids[2], WAITS[1]))
nodes.append(email_node(4,  ids[4], ids[5], ids[3], *EMAILS[2]))
nodes.append(wait_node (5,  ids[5], ids[6], ids[4], WAITS[2]))
nodes.append(email_node(6,  ids[6], ids[7], ids[5], *EMAILS[3]))
nodes.append(wait_node (7,  ids[7], ids[8], ids[6], WAITS[3]))
nodes.append(email_node(8,  ids[8], ids[9], ids[7], *EMAILS[4]))
nodes.append(remove_tag_node(9,  ids[9], ids[10], ids[8], ["warmup-2026-06"], "Remove warmup tag"))
nodes.append(add_tag_node   (10, ids[10],         ids[9], ["warmup-complete-2026-06"], "Add complete tag"))

# ---- Build the envelope (mirror GET shape + auto-save fields) ----
payload = {
    "isAutoSave": True,
    "autoSaveSession": {"workflowId": WF_ID, "id": str(uuid.uuid4()),
                        "userId": USER, "version": 1},
    "version": 1,
    "createdSteps": ids,
    "modifiedSteps": [],
    "deletedSteps": [],
    "name": WF_NAME, "locationId": LOC, "status": "draft",
    "dataVersion": DATA_VERSION, "allowMultiple": False,
    "timezone": "account", "removeContactFromLastStep": True,
    "stopOnResponse": False, "autoMarkAsRead": False, "updatedBy": USER,
    "workflowData": {"templates": nodes}
}

# ---- Send ----
env = dict(line.strip().split('=', 1) for line in open(r'C:\tmp\ghl-tokens.env')
           if '=' in line and not line.startswith('#'))
headers = {
    'Authorization': f'Bearer {env["GHL_BEARER"]}',
    'Token-Id': env['GHL_TOKEN_ID'],
    'Channel': 'APP', 'Source': 'WEB_USER',
    'Origin':  'https://client-app-automation-workflows.leadconnectorhq.com',
    'Referer': 'https://client-app-automation-workflows.leadconnectorhq.com/',
    'Content-Type': 'application/json; charset=utf-8',
}
body = json.dumps(payload, ensure_ascii=True).encode('utf-8')
url = f'https://backend.leadconnectorhq.com/workflow/{LOC}/{WF_ID}/auto-save'
req = urllib.request.Request(url, data=body, method='PUT', headers=headers)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print(f'HTTP {r.status}'); print(r.read().decode())
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}'); print(e.read().decode())
```

---

## 11. What to do when the API changes

The GHL frontend JS bundle is the source of truth for schema. When a node shape stops working:

1. Build the same workflow type by hand in the GHL UI.
2. GET the freshly-built workflow via the internal backend.
3. Diff `workflowData.templates[N]` against your saved reference. The new required field or renamed key will be obvious.
4. Update your build code.

For deeper schema reference, the reverse-engineering community repo lives at `github.com/uxieee/ghl-workflow-api-docs` — sniffed JS bundles + endpoint catalogue. Worth cloning offline.

If you're stuck on what an endpoint expects: open Chrome DevTools → Network on a real GHL UI action → copy as curl → strip cookies/replace with our Bearer + Token-Id headers → iterate.

---

## 12. Enrolment must have exactly one path

**The rule:** a contact must be enrolled into a campaign workflow by exactly ONE mechanism — either a GHL trigger, or an explicit `addContactToWorkflow` call from the website — **never both**. A workflow that contains an `Update Opportunity Stage → X` action must not also carry a `Pipeline Stage Changed → X` trigger on that same workflow, because the action re-fires the trigger it lives inside.

### The failure this caused (Jul 2026 booking collapse)

`Trial Nurture Campaign` had:
- a `pipeline_stage_updated` trigger firing on entry to Lead Acquisition / TRIAL NURTURE, **and**
- `allowMultiple: true` ("Allow Re-entry") enabled.

Separately, the website's `handleOptIn` called `addContactToWorkflow` on this same workflow at opt-in time (day 0). A different workflow, `Opt in Message`, waited 1 day and then moved the opp from NEW LEAD to TRIAL NURTURE — which fired the stage trigger above. Because re-entry was allowed, the trigger enrolled the contact a **second** time.

Both runs then proceeded independently, 24 hours out of phase:

| # | What happens | Result |
|---|---|---|
| 1 | Website `handleOptIn` creates the Lead Acq opp in NEW LEAD | fires `Opt in Message` |
| 2 | Website *also* calls `addContactToWorkflow(WORKFLOW_ID_TRIAL_NURTURE)` | Trial Nurture run #1 starts, day 0 |
| 3 | `Opt in Message` waits 1 day, then moves the opp to TRIAL NURTURE | fires the stage trigger |
| 4 | Trigger enrols the contact again; `allowMultiple: true` permits it | Trial Nurture run #2 starts, day 1 |
| 5 | Both runs proceed independently, 24h out of phase | every email + SMS sent twice, ~24h apart |

Every nurture email and SMS went out twice, 24 hours out of phase, for every lead, for six weeks, before it was caught.

### The check to run when building any campaign workflow

Before publishing a campaign workflow, verify:

1. **Pick one enrolment mechanism.** If the workflow has a stage-changed trigger, the website must **not** also call `addContactToWorkflow` for it. If enrolment is meant to be explicit (website-driven), the workflow must **not** carry a stage trigger that duplicates it.
2. **`allowMultiple` ("Allow Re-entry") should be `false`** unless re-entry is a genuinely intended behaviour (e.g. a workflow meant to fire on every reply, or every appointment). Re-entry is what turns an enrolment race into a silent, sustained duplicate.
3. Cross-check against `config/ghl-schema.ts`'s `WORKFLOWS` array — each entry's `trigger` field should describe the workflow's single enrolment path, and its description should state explicitly which mechanism is authoritative (see the `WORKFLOW_ID_TRIAL_NURTURE` entry for the corrected wording after this incident).

---

## 13. Stage auto-move tails: every timer must be verified

`STAGE_TRANSITIONS` in `config/ghl-schema.ts` declares `auto_move_after` timers on many stage entries. **Nothing in code implements them** — there is no handler and no cron reading `STAGE_TRANSITIONS` at runtime. They exist only as hand-built `Wait` + `Update Opportunity Stage` steps inside the GHL campaign workflows themselves. A timer declared in the schema is therefore not an implemented timer — it is a spec that someone must have manually built correctly in the GHL UI, and that can silently drift out of sync with no error anywhere.

### What was found live vs. what the schema declares (audited 2026-07-31)

| Workflow | Terminal write | Configured | Spec (`CUSTOM_VALUES`) | Status |
|---|---|---|---|---|
| Trial Nurture Campaign | → Lead Acq / NURTURE CAMPAIGN | 23 d | 7 d (`trial_nurture_to_nurture_campaign_days`) | 3.3× too long |
| Last Chance Nurture Campaign | → Lead Acq / LOST / COLD | 51 d | 14 d (`nurture_campaign_to_lost_days`) | 3.6× too long |
| Another Trial Booking Campaign | → Credit Mon / REACTIVATION | 57 d | 14 d (`credit_active_to_reactivation_days`) | 4.1× too long |
| Trial Active Reactivation Campaign | → Credit Mon / LOST | 14 d | 21 d (`credit_reactivation_to_lost_days`) | 7 d too short |

**Consequence:** a lead took 1 + 23 + 51 = **75 days** to reach LOST/COLD instead of the specified 22 (1-day NEW LEAD → TRIAL NURTURE move + 7-day + 14-day spec), while being messaged in duplicate throughout that entire span (see §12).

### The build rule

Every `auto_move_after` entry in `STAGE_TRANSITIONS` must have a corresponding tail inside the named workflow, built as:

1. **`Wait`** — duration set from the custom value's merge tag (`{{custom_values.<afterCustomValueKey>}}`), **not a literal number**. A literal silently diverges from the schema the moment someone tunes the custom value, with nothing flagging the mismatch.
2. **A condition immediately before the stage-move step**, confirming the opportunity is still in the source stage. Without this, a lead who exits the stage early (e.g. books on day 3) still gets dragged into the terminal stage on day 14 or 21 by a timer that should have cancelled. (`config/ghl-schema.ts` documents this as the implicit semantics of every `auto_move_*` action — cancel automatically on stage exit — but that cancellation only happens if the workflow actually checks for it.)
3. **`Update Opportunity Stage`** → the declared `targetStage`, on the correct pipeline.

### Remaining declared timers not verified in this audit

The audit above only measured the four timers already in the table. These four `CUSTOM_VALUES`-backed timers are also declared in `STAGE_TRANSITIONS` but were **not checked live** — verify each has a correctly-timed, merge-tag-driven, exit-guarded tail before trusting it on any new build:

- `new_lead_to_trial_nurture_hours` (NEW LEAD → TRIAL NURTURE)
- `rebooking_to_inactive_days` (INTRO CLASS REBOOKING → TRIAL INACTIVE REACTIVATION)
- `inactive_reactivation_to_lost_days` (TRIAL INACTIVE REACTIVATION → LOST)
- `no_show_to_rebooking_minutes` (NO-SHOW → INTRO CLASS REBOOKING)

---

## 14. Known structural defects to check for

Five structural defects were found live in the audited account. None of them are hypothetical — verify a new build doesn't have them:

- **A published workflow with no trigger.** It can never fire, silently. Three were found in this account, including one (`Trial Inactive Reactivation Campaign`) whose absent trigger made an entire declared pipeline stage (TRIAL INACTIVE REACTIVATION) unreachable.
- **A campaign that skips a declared stage.** `Intro Class Rebooking Campaign` jumped NO-SHOW straight to LOST/COLD, bypassing TRIAL INACTIVE REACTIVATION entirely — compounding the missing-trigger defect above into a stage that could never hold an opportunity.
- **An opportunity-update step writing an `undefined` or stale stage id.** One workflow's stage-write step referenced a stage id that no longer resolves to any stage in any current pipeline (a deleted stage); another wrote an unresolvable `undefined` stage id outright.
- **An appointment-triggered workflow with `allowMultiple: true`.** An appointment trigger with re-entry allowed enrols once **per appointment booked**, not once per contact. Booking three sessions in one sitting (or two siblings booked together) produces three overlapping reminder/confirmation sequences for the same contact within minutes to hours of each other.
- **A leftover snapshot workflow still published alongside its replacement.** Old workflows that duplicate a newer purpose-built one (same trigger, same audience) keep firing even after everyone assumes they've been retired — check the full published-workflow list against what `config/ghl-schema.ts`'s `WORKFLOWS` array actually declares, and flag anything published-but-undeclared for review before assuming it's dead.

---

## Related docs

- [`ghl-api-access-methods.md`](./ghl-api-access-methods.md) — public-API auth, PIT scopes, Conversation AI agent endpoints
- [`ghl-api-integration-spec.md`](./ghl-api-integration-spec.md) — high-level integration design
- [`ghl-onboarding-runbook.md`](./ghl-onboarding-runbook.md) — runbook for setting up a new client location
- Memory: `~/.claude/projects/.../memory/reference_ghl_workflow_api.md` — running log of endpoint corrections + agent ids per location
