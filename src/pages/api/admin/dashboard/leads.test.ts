import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeadBreakdown } from '../../../../lib/dashboard-data';

// Mock the aggregator so the handler never makes real GHL calls.
vi.mock('../../../../lib/dashboard-data', () => ({
  getLeadBreakdown: vi.fn(async (range: string): Promise<LeadBreakdown> => ({
    range: range as LeadBreakdown['range'],
    sinceISO: '2026-06-12T00:00:00.000Z',
    total: 3,
    channels: [{ channel: 'Website Leads', count: 3, pct: 100 }],
  })),
}));

import { getLeadBreakdown } from '../../../../lib/dashboard-data';
import { signAdminToken } from '../../../../lib/admin-token';
import { GET } from './leads';

const getLeadsMock = vi.mocked(getLeadBreakdown);
const KEY = 'test-admin-signing-key-at-least-32-chars-long';

function makeCtx(opts: { token?: string; range?: string } = {}) {
  const u = new URL('https://site.test/api/admin/dashboard/leads');
  if (opts.token) u.searchParams.set('t', opts.token);
  if (opts.range !== undefined) u.searchParams.set('range', opts.range);
  const request = new Request(u, { method: 'GET' });
  return { request, url: u } as Parameters<typeof GET>[0];
}

beforeEach(() => {
  getLeadsMock.mockClear();
  vi.stubEnv('ADMIN_SIGNING_KEY', KEY);
});

describe('GET /api/admin/dashboard/leads', () => {
  it('returns 401 INVALID_TOKEN with no token', async () => {
    const res = await GET(makeCtx({ range: '7d' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, code: 'INVALID_TOKEN' });
    expect(getLeadsMock).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_INPUT for a bad range', async () => {
    const token = signAdminToken({});
    const res = await GET(makeCtx({ token, range: 'yesterday' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(getLeadsMock).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_INPUT when range is missing', async () => {
    const token = signAdminToken({});
    const res = await GET(makeCtx({ token }));
    expect(res.status).toBe(400);
    expect(getLeadsMock).not.toHaveBeenCalled();
  });

  it('happy path returns { ok, breakdown } for a valid range', async () => {
    const token = signAdminToken({});
    const res = await GET(makeCtx({ token, range: '90d' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.breakdown.range).toBe('90d');
    expect(body.breakdown.total).toBe(3);
    expect(getLeadsMock).toHaveBeenCalledWith('90d');
  });
});
