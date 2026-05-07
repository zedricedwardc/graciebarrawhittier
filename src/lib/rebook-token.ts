/**
 * Rebook magic-link tokens.
 *
 * Server-only. Used by the /rebook page to skip the lookup form when a
 * customer arrives via the rebook reminder SMS/email.
 *
 * Token shape: HMAC-SHA256 of `${contactId}|${traineeKey}|${exp}` signed with
 * REBOOK_SIGNING_KEY. Encoded as a single base64url string with the payload
 * fields prepended so verification is self-contained.
 *
 *   payload   = `${contactId}|${traineeKey}|${exp}`
 *   signature = base64url(hmacSha256(payload, REBOOK_SIGNING_KEY))
 *   token     = base64url(payload) + "." + signature
 *
 * Generated at trial activation (handleAttendance — Phase 4) and stored on
 * the Trial Credit Monitoring opportunity's `rebook_link_token` custom field.
 * GHL reminder templates merge it into the URL: /rebook?t={{...}}.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_DAYS = 90;

export interface RebookTokenPayload {
  contactId: string;
  traineeKey: string;
  /** Unix seconds. */
  exp: number;
}

function readKey(): string {
  const fromVite = (import.meta.env as Record<string, string | undefined>).REBOOK_SIGNING_KEY;
  const k = fromVite ?? process.env.REBOOK_SIGNING_KEY;
  if (!k || k.length < 32) {
    throw new Error('REBOOK_SIGNING_KEY env var must be set to a string of length >= 32');
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

/** Mint a rebook token. Default expiry = 90 days from now. */
export function signRebookToken(args: {
  contactId: string;
  traineeKey: string;
  ttlDays?: number;
}): string {
  if (!args.contactId || !args.traineeKey) {
    throw new Error('signRebookToken: contactId and traineeKey are required');
  }
  const ttlDays = args.ttlDays ?? DEFAULT_TTL_DAYS;
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86_400;
  const payload = `${args.contactId}|${args.traineeKey}|${exp}`;
  const sig = createHmac('sha256', readKey()).update(payload).digest();
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

export type VerifyResult =
  | { ok: true; payload: RebookTokenPayload }
  | { ok: false; code: 'INVALID_FORMAT' | 'INVALID_SIGNATURE' | 'EXPIRED' };

/** Verify a rebook token. Constant-time signature compare; no leak on bad sig vs. bad payload. */
export function verifyRebookToken(token: string): VerifyResult {
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
  const [contactId, traineeKey, expStr] = fields as [string, string, string];
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, code: 'INVALID_FORMAT' };
  if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, code: 'EXPIRED' };

  return { ok: true, payload: { contactId, traineeKey, exp } };
}
