import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the aggregator so the handler never makes real GHL calls.
vi.mock('../../../../lib/dashboard-data', () => ({
  getUpcomingAppointments: vi.fn(async () => ({ appointments: [{ id: 'a1' }], warnings: ['w1'] })),
}));

import { getUpcomingAppointments } from '../../../../lib/dashboard-data';
import { signAdminToken } from '../../../../lib/admin-token';
import { GET } from './appointments';

const getApptsMock = vi.mocked(getUpcomingAppointments);
const KEY = 'test-admin-signing-key-at-least-32-chars-long';

function makeCtx(opts: { token?: string; header?: string } = {}) {
  const u = new URL('https://site.test/api/admin/dashboard/appointments');
  if (opts.token) u.searchParams.set('t', opts.token);
  const headers = new Headers();
  if (opts.header) headers.set('x-admin-token', opts.header);
  const request = new Request(u, { method: 'GET', headers });
  return { request, url: u } as Parameters<typeof GET>[0];
}

beforeEach(() => {
  getApptsMock.mockClear();
  vi.stubEnv('ADMIN_SIGNING_KEY', KEY);
});

describe('GET /api/admin/dashboard/appointments', () => {
  it('returns 401 INVALID_TOKEN with no token', async () => {
    const res = await GET(makeCtx());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, code: 'INVALID_TOKEN' });
    expect(getApptsMock).not.toHaveBeenCalled();
  });

  it('returns 401 with a bad token', async () => {
    const res = await GET(makeCtx({ token: 'garbage' }));
    expect(res.status).toBe(401);
    expect(getApptsMock).not.toHaveBeenCalled();
  });

  it('happy path returns { ok, appointments, warnings }', async () => {
    const token = signAdminToken({});
    const res = await GET(makeCtx({ token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, appointments: [{ id: 'a1' }], warnings: ['w1'] });
  });
});
