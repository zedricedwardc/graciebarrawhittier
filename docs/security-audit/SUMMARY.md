# Security Audit Summary — graciebarrawebsite.vercel.app

**Date:** 2026-05-07
**Scope:** POST/API/fetch security, HTTP link leaks, API key leaks
**Method:** Static code audit (main thread) + 3 parallel Playwright subagents
**Subagent reports:** [01-network-leak](./01-network-leak.md), [02-bundle-scan](./02-bundle-scan.md), [03-forms-adversarial](./03-forms-adversarial.md)

---

## TL;DR

**No critical key/secret leaks found.** No `Bearer`, no `pit-*` PIT, no server-only GHL paths, no source maps in the browser bundle. The PIT is correctly server-only. Server-side Zod + 4-layer anti-abuse on `/api/book` all work.

**Three real concerns:**
1. `PUBLIC_GHL_WEBHOOK_URL` is intentionally public in the bundle and the opt-in + contact forms have **zero anti-abuse** on it → lead-spam vector.
2. **You leaked a PIT into chat** earlier (`pit-ae5e6035-...`). Revoke it immediately if you haven't.
3. `npm audit` shows 3 HIGH vulnerabilities in `@astrojs/vercel` chain (ReDoS).

Everything else is hardening (CSP, headers, log hygiene, scope minimization).

---

## Findings ranked by severity

### 🔴 CRITICAL (1)

| # | Finding | Where | Fix |
|---|---|---|---|
| C1 | **Leaked GHL PIT in chat history.** Token `pit-ae5e6035-...` was pasted directly into the conversation log earlier. Conversation history is stored on disk in `.claude/projects/` and may be retained by Anthropic. Treat as compromised. | This conversation | **GHL → Settings → Private Integrations → delete that integration NOW.** Don't reuse the token anywhere. Create a fresh one only when needed. |

### 🟠 HIGH (3)

| # | Finding | Where | Fix |
|---|---|---|---|
| H1 | **Lead-spam vector via public webhook.** Both [OptInForm.astro:326](src/components/form/OptInForm.astro#L326) and [contact.astro:252](src/pages/contact.astro#L252) POST directly from the browser to `PUBLIC_GHL_WEBHOOK_URL`. The URL is visible in the JS bundle (Subagent 2 confirmed, INFO entry). Forms have no honeypot, no dwell-time check, no rate limit, no CAPTCHA. Anyone can `curl` the webhook to flood your GHL CRM with junk leads. | `OptInForm.astro`, `contact.astro` | **Proxy through a server route.** Add `/api/lead` mirroring the 4 anti-abuse layers from `/api/book` (Zod + honeypot + dwell + rate limit), then have the server forward to GHL. Drop the `PUBLIC_` prefix from the webhook URL — the browser never sees it again. |
| H2 | **Rate limiter is in-memory, per Fluid Compute instance.** [book.ts:16](src/pages/api/book.ts#L16) — `Map` lives in module scope. Survives warm invocations (Subagent 3 confirmed it triggers as designed) but resets on cold start, doesn't share across regions / Fluid instances. Determined attacker can wait or rotate IPs. | `src/pages/api/book.ts` | Use a durable store: install Upstash/Redis from Vercel Marketplace, or add **Vercel BotID** (GA, drop-in for bot detection). |
| H3 | **3 HIGH npm advisories** in `@astrojs/vercel` chain — `path-to-regexp` ReDoS (CVSS 7.5, [GHSA-9wv6-86v2-598j](https://github.com/advisories/GHSA-9wv6-86v2-598j)). Direct dep `@astrojs/vercel@10.x` pulls vulnerable `@vercel/routing-utils` → vulnerable `path-to-regexp`. | `package.json` direct dep | `npm install @astrojs/vercel@8.0.4` (semver-major; verify build still works). Or wait for `@astrojs/vercel@10.x` patch — track the advisory. |

### 🟡 MEDIUM (4)

| # | Finding | Where | Fix |
|---|---|---|---|
| M1 | **PII in Vercel runtime logs.** `console.error('[book] upsertContact failed', ..., { ..., payload: body })` logs the full booking body including parent name/email/phone. | [book.ts:77](src/pages/api/book.ts#L77), [book.ts:95](src/pages/api/book.ts#L95) | Strip PII before logging — log only `{ code, status, emailHash, hasPhone: !!body.parent.phone }`. Keep enough to debug, not enough to identify. |
| M2 | **No Content-Security-Policy.** Site has zero CSP. XSS blast radius is wide (allows arbitrary inline scripts). Subagent 3 confirmed the existing `/kickstart?name=` reflection IS sanitized — but defense in depth still wants a CSP. | No `vercel.json`, no Astro middleware | Add `vercel.json` with `headers` block, or Astro middleware. Allowlist `'self'`, GTM/GA, Google Fonts/Maps, GHL chat. Start in `Content-Security-Policy-Report-Only`. |
| M3 | **Over-scoped GHL PIT** for the live website. Granted 7 scopes; code uses 3. Violates least-privilege. | GHL Settings → Private Integrations → Website Calendar Integration | Drop these unused scopes: `calendars.readonly`, `calendars.write`, `contacts.readonly`, `opportunities.readonly`. Keep only `calendars/events.readonly`, `calendars/events.write`, `contacts.write`. |
| M4 | **No CSRF defense on `/api/book`.** Public, unauthenticated, accepts any Origin (`Access-Control-Allow-Origin: *`). Submissions from any origin succeed. Mostly a non-issue (no auth context to forge), but a malicious site can submit on behalf of users without their interaction beyond visiting it. | `src/pages/api/book.ts`, response | Origin allowlist check on the server: reject POST if `Origin` header isn't `https://graciebarrawebsite.vercel.app` (or the prod custom domain). Cheap and effective. |

### 🟢 LOW (5)

| # | Finding | Where | Fix |
|---|---|---|---|
| L1 | Missing `X-Content-Type-Options: nosniff` | All HTML responses | Add via `vercel.json` |
| L2 | Missing `X-Frame-Options` / CSP `frame-ancestors` | All HTML responses | Add `X-Frame-Options: DENY` |
| L3 | Missing `Referrer-Policy` | All HTML responses | Add `Referrer-Policy: strict-origin-when-cross-origin` |
| L4 | Missing `Permissions-Policy` | All HTML responses | Add `Permissions-Policy: camera=(), microphone=(), geolocation=()` |
| L5 | Browser `console.warn('[booking] /api/book response', data)` exposes the appointment payload in user's DevTools after booking. Only the booking user sees it, but worth removing in production. | [BookingFlow.astro:315](src/components/booking/BookingFlow.astro#L315) | Delete the line, or gate behind `import.meta.env.DEV`. |

### ℹ️ INFO / POSITIVE (well-done)

| ✓ | Item |
|---|---|
| ✅ | **HSTS** present and strong on the live deploy: `max-age=63072000; includeSubDomains; preload` |
| ✅ | **No source maps** exposed (`/_astro/*.map` returns 404) |
| ✅ | **No GHL credentials, Bearer tokens, or PIT** in any client-served file (Subagent 2 grep confirmed) |
| ✅ | Server-only env vars correctly **NOT prefixed `PUBLIC_`** ([ghl.ts](src/lib/ghl.ts)) |
| ✅ | All 4 anti-abuse layers on `/api/book` work as designed (Subagent 3 confirmed) |
| ✅ | XSS reflection on `/kickstart?name=` is sanitized via [BookingFlow.astro:99-102](src/components/booking/BookingFlow.astro#L99-L102) regex + `textContent` |
| ✅ | No mixed-content (`http://`) requests |
| ✅ | `.gitignore` correctly excludes `.env`, `.env.local`, `.env.production` |
| ✅ | No secrets in git history (grep'd for `pit-`, `Bearer`, `GHL_PIT_TOKEN=`) |
| ✅ | TLS on every GHL API call ([ghl.ts:14](src/lib/ghl.ts#L14)) |
| ✅ | Zod schema on `/api/book` rejects all 14 adversarial payloads cleanly |

---

## Inventory: every outbound HTTP destination from this codebase

| # | From | To | Direction | Auth | Risk |
|---|---|---|---|---|---|
| 1 | `src/lib/ghl.ts:50` (server) | `services.leadconnectorhq.com/calendars/{id}/free-slots` | server → GHL | Bearer (server-side token) | ✅ secure |
| 2 | `src/lib/ghl.ts:50` (server) | `services.leadconnectorhq.com/contacts/upsert` | server → GHL | Bearer | ✅ secure |
| 3 | `src/lib/ghl.ts:50` (server) | `services.leadconnectorhq.com/calendars/events/appointments` | server → GHL | Bearer | ✅ secure |
| 4 | `src/pages/api/book.ts:101` (server) | `GHL_APPOINTMENT_WEBHOOK_URL` | server → GHL workflow | none (URL secret) | ⚠️ no signature header (L-tier) |
| 5 | `src/components/form/OptInForm.astro:326` (browser) | `PUBLIC_GHL_WEBHOOK_URL` | **browser** → GHL | none | 🔴 H1 — spam vector |
| 6 | `src/pages/contact.astro:252` (browser) | `PUBLIC_GHL_WEBHOOK_URL` | **browser** → GHL | none | 🔴 H1 — same |
| 7 | `src/components/booking/BookingFlow.astro:230` (browser) | `/api/availability` (same-origin) | browser → own server | none (public read) | ✅ |
| 8 | `src/components/booking/BookingFlow.astro:276` (browser) | `/api/book` (same-origin) | browser → own server | none (anti-abused) | ✅ |

---

## Test data created

**None.** All 3 subagents ran without creating real GHL contacts or appointments:
- Subagent 1 (network leak): read-only browse only
- Subagent 2 (bundle scan): pure HTTP fetches of static assets
- Subagent 3 (forms adversarial): all booking calls failed at Zod / honeypot / rate-limit before reaching GHL writes; opt-in browser tests only navigated `/kickstart?name=...` without form submit

The only real GHL data created in this entire session is from **earlier** test runs (the original E2E that confirmed booking works). Those test contacts have email `qa-test-*@example.com` — clean those up in GHL → Contacts → search `qa-test-`.

---

## Recommended fix order

1. **NOW (before anything else)** — Revoke leaked PIT (`pit-ae5e6035-...`) in GHL settings (C1)
2. **Soon (this week)** — `npm install @astrojs/vercel@8.0.4` to fix HIGH advisories (H3) + verify build
3. **Soon (this week)** — Implement `/api/lead` server proxy and migrate opt-in + contact forms (H1) — biggest real-world threat
4. **Soon** — Strip PII from `console.error` calls in `book.ts` (M1) — one-line changes
5. **Soon** — Drop unused PIT scopes in GHL (M3) — 30-second fix
6. **Eventual hardening** — `vercel.json` with CSP + L1-L4 headers; durable rate limit (H2); origin allowlist on `/api/book` (M4)

---

## Files added by this audit

- [docs/security-audit/SUMMARY.md](./SUMMARY.md) — this report
- [docs/security-audit/01-network-leak.md](./01-network-leak.md) — Subagent 1 raw findings
- [docs/security-audit/02-bundle-scan.md](./02-bundle-scan.md) — Subagent 2 raw findings
- [docs/security-audit/03-forms-adversarial.md](./03-forms-adversarial.md) — Subagent 3 raw findings
- [tests/security/](../../tests/security/) — Playwright specs + scan scripts (re-runnable)
- [test-results/security/](../../test-results/security/) — raw network captures + downloaded bundles
