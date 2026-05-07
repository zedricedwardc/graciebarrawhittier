# Subagent 1 — Network leak scan

## Summary
Headlessly browsed 7 top-level pages on https://graciebarrawebsite.vercel.app and captured 78 outbound requests across 6 origins. **No HIGH-severity leaks found**: no `Authorization`/`Bearer`/`pit-`/`X-Api-Key` headers from the browser, no direct calls to GHL server-only API paths (`services.leadconnectorhq.com/calendars|contacts|conversations`), no mixed-content (`http://`) requests, and no PII observed in third-party query strings or paths. All findings are LOW-severity (missing hardening response headers on Astro/Vercel-served HTML).

## Findings
| Severity | Finding | URL/Header/Evidence | Fix |
|---|---|---|---|
| LOW | Missing `X-Content-Type-Options: nosniff` on every HTML page | `/`, `/kickstart`, `/contact`, `/adults-jiu-jitsu`, `/kids-martial-arts`, `/reviews`, `/privacy` (all 200, Vercel) | Add `X-Content-Type-Options: nosniff` via `vercel.json` `headers` or Astro middleware |
| LOW | Missing `Referrer-Policy` on every HTML page | same 7 pages | Add `Referrer-Policy: strict-origin-when-cross-origin` |
| LOW | Missing `Content-Security-Policy` on every HTML page | same 7 pages | Define CSP allowing `self`, GTM/GA, Google Fonts/Maps, GHL chat domains |
| LOW | Missing `X-Frame-Options` (or CSP `frame-ancestors`) on every HTML page | same 7 pages | Add `X-Frame-Options: SAMEORIGIN` |
| LOW | Missing `Permissions-Policy` on every HTML page | same 7 pages | Add a minimal `Permissions-Policy` (camera=(), microphone=(), geolocation=()) |
| INFO | `Strict-Transport-Security` is correctly present (`max-age=63072000; includeSubDomains; preload`) on Vercel responses | n/a | n/a — already secure |

No HIGH or MEDIUM findings.

## Pages tested
- https://graciebarrawebsite.vercel.app/
- https://graciebarrawebsite.vercel.app/kickstart
- https://graciebarrawebsite.vercel.app/contact
- https://graciebarrawebsite.vercel.app/adults-jiu-jitsu
- https://graciebarrawebsite.vercel.app/kids-martial-arts
- https://graciebarrawebsite.vercel.app/reviews
- https://graciebarrawebsite.vercel.app/privacy

Raw captures: `test-results/security/network-<page>.json` (7 files). Aggregated analysis: `test-results/security/analysis.json`.

## Total requests captured
78

## Notable third-party origins
All observed origins are on the expected allowlist (Google Fonts/Maps + Vercel-hosted site). Notably absent on this scan: GTM/GA, Meta Pixel, GHL chat widget, Vercel Analytics — the live deploy currently does not load any tag-manager / pixel / chat-widget script from these pages, so there is no third-party leak surface to flag.

- `https://graciebarrawebsite.vercel.app` (first-party, Vercel)
- `https://fonts.googleapis.com` (Google Fonts CSS)
- `https://fonts.gstatic.com` (Google Fonts files)
- `https://maps.googleapis.com` (Google Maps JS API — used on `/contact`)
- `https://maps.gstatic.com` (Maps tiles/static assets)
- `https://www.google.com` (Maps embed)

## Test artifacts
- `tests/security/network-leak.spec.ts` — capture spec
- `tests/security/analyze.spec.ts` — finding generator
- `playwright.security.config.ts` — isolated config (so Playwright does not wipe `test-results/security/`)
