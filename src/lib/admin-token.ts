/**
 * Admin (blog) access tokens.
 *
 * Server-only. Gates the custom blog editor surfaced as a GHL custom menu link
 * and the `/api/admin/blog/*` write routes. Mirrors `rebook-token.ts` exactly
 * (HMAC-SHA256, base64url, constant-time compare).
 *
 * Token shape: HMAC-SHA256 of `${scope}|${exp}` signed with ADMIN_SIGNING_KEY.
 * Encoded as a single base64url string with the payload prepended so
 * verification is self-contained.
 *
 *   payload   = `${scope}|${exp}`
 *   signature = base64url(hmacSha256(payload, ADMIN_SIGNING_KEY))
 *   token     = base64url(payload) + "." + signature
 *
 * Payload deliberately carries no user data — possession of the signed link is
 * the credential (low-stakes blog admin; the GHL menu's `userRole: 'admin'`
 * limits who sees it). Default TTL is long (365 days) since the token is
 * embedded once into a GHL menu link. Can be hardened later with GHL SSO
 * postMessage. Rotating ADMIN_SIGNING_KEY invalidates all issued tokens.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_DAYS = 365;

export interface AdminTokenPayload {
  scope: 'blog';
  /** Unix seconds. */
  exp: number;
}

function readKey(): string {
  const fromVite = (import.meta.env as Record<string, string | undefined>).ADMIN_SIGNING_KEY;
  const k = fromVite ?? process.env.ADMIN_SIGNING_KEY;
  if (!k || k.length < 32) {
    throw new Error('ADMIN_SIGNING_KEY env var must be set to a string of length >= 32');
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

/** Mint an admin token. Default scope 'blog', default expiry = 365 days from now. */
export function signAdminToken(args: { scope?: 'blog'; ttlDays?: number } = {}): string {
  const scope = args.scope ?? 'blog';
  const ttlDays = args.ttlDays ?? DEFAULT_TTL_DAYS;
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86_400;
  const payload = `${scope}|${exp}`;
  const sig = createHmac('sha256', readKey()).update(payload).digest();
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

export type VerifyResult =
  | { ok: true; payload: AdminTokenPayload }
  | { ok: false; code: 'INVALID_FORMAT' | 'INVALID_SIGNATURE' | 'EXPIRED' };

/** Verify an admin token. Constant-time signature compare; no leak on bad sig vs. bad payload. */
export function verifyAdminToken(token: string): VerifyResult {
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
  if (fields.length !== 2) return { ok: false, code: 'INVALID_FORMAT' };
  const [scope, expStr] = fields as [string, string];
  if (scope !== 'blog') return { ok: false, code: 'INVALID_FORMAT' };
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, code: 'INVALID_FORMAT' };
  if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, code: 'EXPIRED' };

  return { ok: true, payload: { scope: 'blog', exp } };
}
