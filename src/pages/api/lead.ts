import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { LeadRequest, type LeadResponse } from '../../lib/lead-types';
import { readEnv } from '../../lib/ghl';

export const prerender = false;

const MIN_DWELL_MS = 2000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_PER_WINDOW = 10;

const buckets = new Map<string, { count: number; firstSeen: number }>();

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let payload: unknown;
  try { payload = await request.json(); } catch { return json({ ok: false, code: 'INVALID_INPUT' }); }

  const parsed = LeadRequest.safeParse(payload);
  if (!parsed.success) return json({ ok: false, code: 'INVALID_INPUT' });
  const body = parsed.data;

  // Layer 1 — Honeypot. Silent OK so bots don't learn.
  if (body.website && body.website.length > 0) {
    return json({ ok: true });
  }

  // Layer 2 — Min dwell time.
  if (Date.now() - body.ts < MIN_DWELL_MS) {
    return json({ ok: true });
  }

  // Layer 3 — Per-IP token bucket.
  const ip = clientAddress || 'unknown';
  if (!checkRate(ip)) {
    return json({ ok: false, code: 'RATE_LIMITED' });
  }

  // Resolve webhook URL — server-only env preferred; PUBLIC_ retained as transitional fallback.
  const webhookUrl = readEnv('GHL_WEBHOOK_URL') || readEnv('PUBLIC_GHL_WEBHOOK_URL');
  if (!webhookUrl) {
    console.error('[lead] no webhook configured (GHL_WEBHOOK_URL / PUBLIC_GHL_WEBHOOK_URL)');
    return json({ ok: false, code: 'NOT_CONFIGURED' });
  }

  try {
    const r = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: body.name,
        firstName: body.firstName ?? body.name.split(/\s+/)[0] ?? '',
        lastName: body.lastName ?? body.name.split(/\s+/).slice(1).join(' ') ?? '',
        email: body.email,
        phone: body.phone,
        message: body.message ?? '',
        source: body.source,
        page: body.page,
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error('[lead] webhook non-2xx', { status: r.status, body: text.slice(0, 200), ctx: redactLeadForLog(body) });
      return json({ ok: false, code: 'WEBHOOK_FAILED' });
    }
  } catch (err) {
    console.error('[lead] webhook fetch failed', { err: String(err), ctx: redactLeadForLog(body) });
    return json({ ok: false, code: 'WEBHOOK_FAILED' });
  }

  return json({ ok: true });
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

function redactLeadForLog(b: LeadRequest): Record<string, unknown> {
  return {
    source: b.source,
    page: b.page,
    emailHash: createHash('sha256').update(b.email).digest('hex').slice(0, 12),
    hasPhone: Boolean(b.phone),
  };
}

function json(body: LeadResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
