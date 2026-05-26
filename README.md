# Gracie Barra Whittier — template repo

Astro 6 + Vercel + GoHighLevel marketing/CRM template for martial arts studios.

## What this is

A lead-capture and class-booking site for a Gracie Barra location, with deep CRM
integration: opt-in flows, trial booking, rebook flows, Back-to-the-Mats reactivation,
SMS bot, and GHL workflow orchestration.

## Architecture

Layered: Astro pages → API routes (Zod-validated) → single domain orchestrator
(`src/lib/ghl-adapter.ts`) → GHL HTTP client. GHL itself is the system of record.
See `docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md` for the full
architecture writeup.

## Running locally

```bash
npm install
cp .env.example .env       # fill in PIT, location ID, signing keys
npm run dev                # http://localhost:4321
```

Tests:

```bash
npm test                   # vitest unit
npx playwright test        # e2e (requires running dev server)
```

## Replicating this for a new client

This repo is built as a template. To stand up a new client:

1. Operator: fill `docs/replication/CLIENT_INTAKE.template.md` → save as `CLIENT_INTAKE.md`
2. Operator: `npm run validate:intake CLIENT_INTAKE.md`
3. Hand the filled intake + this repo to a Claude (or equivalent) session with:
   "Execute `docs/replication/REPLICATE.md`"
4. AI runs 9 phases (intake validation → brand swap → content drafting → content
   swap → GHL provisioning → env wiring → preview deploy → verification → handoff)
5. AI generates `HANDOFF.md` in the new repo listing remaining operator work
   (GHL UI clicks, real photos, real testimonials, DNS swap, production promote)

See [docs/replication/README.md](docs/replication/README.md) for the orientation.

## Key references

| Topic | File |
|---|---|
| Architecture & design | `docs/superpowers/specs/2026-05-27-ai-replication-spec-design.md` |
| GHL schema (source of truth) | `config/ghl-schema.ts` |
| GHL API contract | `docs/ghl-api-integration-spec.md` |
| GHL onboarding runbook | `docs/ghl-onboarding-runbook.md` |
| GHL dashboard build guide | `docs/ghl-dashboard-build-guide.md` |
| Launch checklist | `docs/launch-checklist.md` |
| Replication procedure | `docs/replication/REPLICATE.md` |
| Intake template | `docs/replication/CLIENT_INTAKE.template.md` |
