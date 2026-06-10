import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signAdminToken, verifyAdminToken } from './admin-token';

const KEY = 'test-admin-signing-key-at-least-32-chars-long';

describe('admin-token', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_SIGNING_KEY', KEY);
  });

  it('sign -> verify round-trips with scope blog', () => {
    const token = signAdminToken({});
    const res = verifyAdminToken(token);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.scope).toBe('blog');
      expect(res.payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    }
  });

  it('defaults to a ~365 day TTL', () => {
    const token = signAdminToken();
    const res = verifyAdminToken(token);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const days = (res.payload.exp - Math.floor(Date.now() / 1000)) / 86_400;
      expect(days).toBeGreaterThan(364);
      expect(days).toBeLessThanOrEqual(365.01);
    }
  });

  it('rejects a tampered signature', () => {
    const token = signAdminToken({});
    const [payload] = token.split('.');
    const tampered = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const res = verifyAdminToken(tampered);
    expect(res).toEqual({ ok: false, code: 'INVALID_SIGNATURE' });
  });

  it('rejects a token signed with a different key', () => {
    const token = signAdminToken({});
    vi.stubEnv('ADMIN_SIGNING_KEY', 'a-totally-different-key-also-32-chars-long!!');
    const res = verifyAdminToken(token);
    expect(res).toEqual({ ok: false, code: 'INVALID_SIGNATURE' });
  });

  it('rejects an expired token', () => {
    const token = signAdminToken({ ttlDays: -1 });
    const res = verifyAdminToken(token);
    expect(res).toEqual({ ok: false, code: 'EXPIRED' });
  });

  it('rejects malformed tokens', () => {
    expect(verifyAdminToken('')).toEqual({ ok: false, code: 'INVALID_FORMAT' });
    expect(verifyAdminToken('no-dot-here')).toEqual({ ok: false, code: 'INVALID_FORMAT' });
    expect(verifyAdminToken('a.b.c')).toEqual({ ok: false, code: 'INVALID_FORMAT' });
  });

  it('rejects a token with a non-blog scope in the payload', () => {
    // Hand-craft a payload with a bad scope but a valid signature for it.
    // verifyAdminToken must reject on scope, not pass it through.
    const badPayload = 'admin|9999999999';
    const { createHmac } = require('node:crypto') as typeof import('node:crypto');
    const b64url = (b: Buffer | string) =>
      (typeof b === 'string' ? Buffer.from(b) : b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const sig = createHmac('sha256', KEY).update(badPayload).digest();
    const token = `${b64url(badPayload)}.${b64url(sig)}`;
    expect(verifyAdminToken(token)).toEqual({ ok: false, code: 'INVALID_FORMAT' });
  });

  it('throws if the signing key is missing or too short', () => {
    vi.stubEnv('ADMIN_SIGNING_KEY', 'too-short');
    expect(() => signAdminToken({})).toThrow(/ADMIN_SIGNING_KEY/);
  });
});
