/**
 * Cancellation magic-link tokens (mirrors rebook-token.ts).
 *
 * Used by /api/cancel to authenticate customer-initiated cancellations from
 * the confirmation page or signed email link without requiring login.
 *
 * Token shape: payload + "." + signature, base64url encoded.
 *   payload   = `${appointmentId}|${contactId}|${exp}`
 *   signature = hmacSha256(payload, CANCEL_SIGNING_KEY)
 *
 * Default expiry: 30 days (long enough to cover most cancellation windows).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_DAYS = 30;

export interface CancelTokenPayload {
  appointmentId: string;
  contactId: string;
  exp: number;
}

function readKey(): string {
  const fromVite = (import.meta.env as Record<string, string | undefined>).CANCEL_SIGNING_KEY;
  const k = fromVite ?? process.env.CANCEL_SIGNING_KEY;
  if (!k || k.length < 32) {
    throw new Error('CANCEL_SIGNING_KEY env var must be set to a string of length >= 32');
  }
  return k;
}

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

export function signCancelToken(args: {
  appointmentId: string;
  contactId: string;
  ttlDays?: number;
}): string {
  if (!args.appointmentId || !args.contactId) {
    throw new Error('signCancelToken: appointmentId and contactId required');
  }
  const ttlDays = args.ttlDays ?? DEFAULT_TTL_DAYS;
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86_400;
  const payload = `${args.appointmentId}|${args.contactId}|${exp}`;
  const sig = createHmac('sha256', readKey()).update(payload).digest();
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

export type VerifyResult =
  | { ok: true; payload: CancelTokenPayload }
  | { ok: false; code: 'INVALID_FORMAT' | 'INVALID_SIGNATURE' | 'EXPIRED' };

export function verifyCancelToken(token: string): VerifyResult {
  if (!token || typeof token !== 'string') return { ok: false, code: 'INVALID_FORMAT' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, code: 'INVALID_FORMAT' };
  const [payloadPart, sigPart] = parts as [string, string];

  let payload: string;
  let providedSig: Buffer;
  try {
    payload = b64urlDecode(payloadPart).toString('utf8');
    providedSig = b64urlDecode(sigPart);
  } catch {
    return { ok: false, code: 'INVALID_FORMAT' };
  }

  const expectedSig = createHmac('sha256', readKey()).update(payload).digest();
  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    return { ok: false, code: 'INVALID_SIGNATURE' };
  }

  const fields = payload.split('|');
  if (fields.length !== 3) return { ok: false, code: 'INVALID_FORMAT' };
  const [appointmentId, contactId, expStr] = fields as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, code: 'INVALID_FORMAT' };
  if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, code: 'EXPIRED' };

  return { ok: true, payload: { appointmentId, contactId, exp } };
}
