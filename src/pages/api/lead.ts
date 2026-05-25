/**
 * POST /api/lead
 *
 * Single endpoint for all opt-in form submissions:
 *   - Homepage opt-in (source: homepage-optin)
 *   - Kids page opt-in (source: kids-optin)
 *   - Adults page opt-in (source: adults-optin)
 *   - Contact form (source: contact-form)
 *
 * Phase 2: replaces the legacy direct-to-GHL webhook fired from the browser.
 * The endpoint now upserts the contact + creates the Lead Acquisition opp via
 * the GHL REST API directly, by calling ghl-adapter.handleOptIn.
 *
 * Spam mitigations (mirrors /api/book):
 *   - Honeypot field (`website`) — silent 200 if filled (applies to all callers)
 *   - Min dwell time (3s) — silent 200 if too fast (browser callers only; bypassed when X-GBW-Secret matches GHL_WEBHOOK_SECRET)
 *   - Per-IP rate limit (10 / 10min) (browser callers only; bypassed when X-GBW-Secret matches GHL_WEBHOOK_SECRET)
 *   - Idempotency: sha1(email|trainee_key|source|YYYYMMDD) for 24h
 */

import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { LeadRequest, type LeadResponse } from '../../lib/lead-types';
import { handleOptIn } from '../../lib/ghl-adapter';
import { idempotency, computeIdempotencyKey } from '../../lib/idempotency';
import { GhlError } from '../../lib/ghl-rate-limit';
import { deriveTraineeKey } from '../../lib/trainee-key';
import { verifyGhlWebhook } from '../../lib/webhook-secrets';

export const prerender = false;

const MIN_DWELL_MS = 2000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 10;

const buckets = new Map<string, { count: number; firstSeen: number }>();

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, code: 'INVALID_INPUT' });
  }

  const parsed = LeadRequest.safeParse(payload);
  if (!parsed.success) return json({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  // Honeypot — silent 200 so bots don't learn
  if (body.website && body.website.length > 0) {
    return json({ ok: true, contactId: 'spam-discarded', opportunityId: null, isReplay: false });
  }

  // Trusted-caller short-circuit: a server-to-server call from a GHL
  // workflow can present X-GBW-Secret to skip the browser-targeted abuse
  // checks (per-IP rate limit + min-dwell). Honeypot, schema validation,
  // and idempotency still apply to everyone.
  const trustedCaller = verifyGhlWebhook(request);

  if (!trustedCaller) {
    // Min dwell time
    if (Date.now() - body.ts < MIN_DWELL_MS) {
      return json({ ok: true, contactId: 'spam-discarded', opportunityId: null, isReplay: false });
    }

    // Per-IP rate limit
    const ip = clientAddress || 'unknown';
    if (!checkRate(ip)) return json({ ok: false, code: 'RATE_LIMITED' });
  }

  // Idempotency
  const traineeKey = body.trainee
    ? deriveTraineeKey({
        isSelf: body.trainee.isSelf ?? false,
        firstName: body.trainee.firstName,
        lastName: body.trainee.lastName ?? body.lastName,
        dob: body.trainee.dob,
      })
    : '';
  const dayBucket = new Date().toISOString().slice(0, 10);
  const idemKey = sha1(
    computeIdempotencyKey([body.email.toLowerCase(), traineeKey, body.source, dayBucket]),
  );
  const replay = idempotency.check<{ contactId: string; opportunityId: string | null }>(idemKey);
  if (replay) {
    return json({ ok: true, ...replay, isReplay: true });
  }

  // Normalize name: prefer explicit firstName/lastName; fall back to splitting `name`.
  let firstName = body.firstName ?? '';
  let lastName = body.lastName ?? '';
  if ((!firstName || !lastName) && body.name) {
    const parts = body.name.trim().split(/\s+/);
    if (!firstName) firstName = parts[0] ?? '';
    if (!lastName) lastName = parts.slice(1).join(' ') || firstName; // single-name → repeat
  }

  // Dispatch to adapter
  try {
    const result = await handleOptIn({
      firstName,
      lastName,
      email: body.email,
      phone: body.phone,
      source: body.source,
      message: body.message,
      trainee: body.trainee,
      page: body.page,
    });

    idempotency.set(
      idemKey,
      { contactId: result.contactId, opportunityId: result.opportunityId },
      24 * 3600,
    );

    return json({
      ok: true,
      contactId: result.contactId,
      opportunityId: result.opportunityId,
      isReplay: false,
    });
  } catch (err) {
    const log =
      err instanceof GhlError
        ? { status: err.status, body: err.bodyText.slice(0, 200), path: err.path, ctx: redactLeadForLog(body) }
        : { err: String(err), ctx: redactLeadForLog(body) };
    console.error('[lead] handleOptIn failed', log);
    return json({
      ok: false,
      code: 'GHL_FAILED',
      message: err instanceof GhlError ? `GHL ${err.status}` : 'Unexpected error',
    });
  }
};

function checkRate(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.firstSeen > RATE_WINDOW_MS) {
    buckets.set(ip, { count: 1, firstSeen: now });
    return true;
  }
  if (b.count >= RATE_MAX_PER_WINDOW) return false;
  b.count++;
  return true;
}

function redactLeadForLog(b: ReturnType<typeof LeadRequest.parse>): Record<string, unknown> {
  return {
    source: b.source,
    page: b.page,
    emailHash: createHash('sha256').update(b.email).digest('hex').slice(0, 12),
    hasPhone: Boolean(b.phone),
    hasTrainee: Boolean(b.trainee),
  };
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function json(body: LeadResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
