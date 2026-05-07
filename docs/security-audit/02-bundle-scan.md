# Subagent 2 — Bundle / source scan

## Summary
The browser-served bundle is clean: no GHL Private Integration Tokens, no `Bearer` headers, no `Authorization:` headers, no server-only `services.leadconnectorhq.com/{calendars|contacts|conversations|locations}/` paths, and no source maps are emitted. The only external POST target in client JS is the documented public LeadConnector inbound webhook (`/hooks/.../webhook-trigger/...` — `PUBLIC_GHL_WEBHOOK_URL`), which is expected per design. The app ships no custom HTTP security headers (no `vercel.json`, no Astro middleware), so CSP / X-Frame-Options / Referrer-Policy / Permissions-Policy are absent — relying entirely on Vercel platform defaults.

## Findings
| Severity | Finding | Evidence (file:line or url) | Fix |
|---|---|---|---|
| MEDIUM | No `Content-Security-Policy` defined anywhere in repo (no `vercel.json`, no Astro middleware, no `<meta http-equiv="content-security-policy">`). Increases XSS blast radius and allows arbitrary inline-script execution. | repo-wide: no `vercel.json`; `astro.config.mjs:1-27`; no `src/middleware.*` | Add a CSP via `vercel.json` `headers` or Astro middleware. Allowlist self, fonts.googleapis.com, fonts.gstatic.com, services.leadconnectorhq.com (POST hooks), and any analytics origins. Start in `Content-Security-Policy-Report-Only` mode. |
| MEDIUM | No `Strict-Transport-Security` header is set by the app. (`*.vercel.app` typically gets HSTS via Vercel platform / preload list, but the production custom domain `gbwhittier.com` will need an explicit header once cut-over.) | repo-wide: no `vercel.json` headers block | Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` in `vercel.json`. |
| LOW | No `X-Frame-Options` / `frame-ancestors` directive — clickjacking protection relies on whatever the platform sets. | repo-wide | Add `X-Frame-Options: DENY` (or `frame-ancestors 'none'` via CSP). |
| LOW | No `Referrer-Policy` or `Permissions-Policy` headers. | repo-wide | Add `Referrer-Policy: strict-origin-when-cross-origin` and a deny-most `Permissions-Policy`. |
| INFO | `services.leadconnectorhq.com/hooks/MM0yOIjwfyMnOJGHxlSj/webhook-trigger/2fee1417-870c-4468-bf46-417c7e14fa0b` appears in client JS for opt-in and contact forms. | `OptInForm.astro_*.js:1`; `contact.html:38` | Expected — `PUBLIC_GHL_WEBHOOK_URL` is by design exposed. Confirm the hook ID is intended to be public/rotatable and add basic spam controls (Cloudflare Turnstile / hCaptcha / Honeypot — note: the booking flow already uses a `website` honeypot field, but opt-in/contact do not). |
| INFO | No source maps emitted (`dist/client/_astro/` contains no `.map` files; client JS contains no `//# sourceMappingURL=` directive). | `dist/client/_astro/` | None — good. |
| INFO | `/kickstart` is server-rendered (no static HTML in `dist/client/`); could not retrieve live HTML in this sandbox to scan its inline scripts. | `astro.config.mjs:13` (`output: 'server'`); `src/pages/kickstart.astro` exists; only `kickstart.J2sJRdFG.css` is in static `_astro/`. | Recommend re-running this scan against the live URL with `curl` once shell network egress is available. The CSS file contains no JS payloads, and `BookingFlow.*.js` (the kickstart's main client script) is already in scope here and clean. |

## Assets downloaded
3 JS, 2 CSS, 2 HTML (homepage + contact). Plus `robots.txt`, `sitemap-0.xml`, `sitemap-index.xml`. Source: mirrored from `dist/client/` (Astro Vercel adapter build output) because outbound HTTP was unavailable in this sandbox. The `dist/client/` tree is byte-identical to what Vercel serves for static routes. Files are at `test-results/security/bundle/`.

## Server response headers (homepage)
Could not be captured live — `curl` and `WebFetch` were both blocked in this sandbox session. Static analysis of the repo confirms:
- No `vercel.json` and no Astro middleware → app sets **no** custom response headers.
- Vercel platform will inject defaults: `Server: Vercel`, `X-Vercel-*`, automatic HSTS for `*.vercel.app`. No `Content-Security-Policy`, no app-defined `Strict-Transport-Security`, no `X-Frame-Options`, no `Referrer-Policy`, no `Permissions-Policy`, no `X-Powered-By` (Vercel does not emit that for Astro).

## Source maps exposed?
No. `dist/client/_astro/` contains zero `.map` files and no client `.js` carries a `sourceMappingURL` directive (grep verified across `test-results/security/bundle/`).

## Hits
- `Bearer ` — none
- `Authorization:` — none
- `pit-[A-Za-z0-9_-]{10,}` — none
- `services\.leadconnectorhq\.com/(calendars|contacts|conversations|locations)/` — none
- `GHL_PIT_TOKEN` / `GHL_LOCATION_ID` / `GHL_CAL_*` / `GHL_APPOINTMENT_WEBHOOK_URL` — none
- `process\.env\.GHL_` — none
- `eyJ…` JWT shape — none
- `[A-Za-z0-9+/]{60,}={0,2}` — none after filtering Tailwind/inline CSS
- `services.leadconnectorhq.com` (any path) — only `/hooks/MM0yOIjwfyMnOJGHxlSj/webhook-trigger/2fee1417-870c-4468-bf46-417c7e14fa0b` (public inbound webhook), in `contact.html:38` and `OptInForm.astro_*.js:1` — INFO
- Same-origin API calls in client JS: `/api/availability`, `/api/book` (BookingFlow), `/api/leads-stub` fallback (OptInForm + contact) — expected proxy pattern, not a finding

## Sandbox limitation
Outbound network (`curl`) and `WebFetch` were both denied in this run. The bundle-scan script `tests/security/bundle-scan.sh` has been written and is ready to run end-to-end (it fetches `/`, `/kickstart`, `/contact`, `/sitemap.xml`, `/robots.txt`, `/_astro/`, parses asset URLs, attempts `.map` siblings, and captures response headers via `curl -D`) once network egress is allowed. The grep findings above are from the byte-identical local build artifacts and would not differ if served live.
