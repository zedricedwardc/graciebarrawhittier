import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ghl from './ghl';

describe('ghl client', () => {
  beforeEach(() => {
    vi.stubEnv('GHL_PIT_TOKEN', 'test-token');
    vi.stubEnv('GHL_LOCATION_ID', 'loc_123');
    vi.stubGlobal('fetch', vi.fn());
  });

  it('getFreeSlots issues GET to free-slots endpoint with auth + version headers', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ '_dates_': {} }), { status: 200 }),
    );
    await ghl.getFreeSlots({ calendarId: 'cal_x', startDate: 1700000000000, endDate: 1701000000000 });

    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toMatch(/services\.leadconnectorhq\.com\/calendars\/cal_x\/free-slots/);
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(init.headers.Version).toBe('2021-04-15');
    expect(init.headers.Accept).toBe('application/json');
  });

  it('upsertContact POSTs JSON with locationId injected', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ contact: { id: 'c_1' } }), { status: 200 }),
    );
    const id = await ghl.upsertContact({
      firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com', phone: '+15551234567',
    });
    expect(id).toBe('c_1');
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toMatch(/contacts\/upsert/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.locationId).toBe('loc_123');
    expect(body.email).toBe('jane@x.com');
  });

  it('upsertContact includes the native source attribute when provided', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ contact: { id: 'c_2' } }), { status: 200 }),
    );
    await ghl.upsertContact({
      firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com', phone: '+15551234567',
      source: 'Website',
    });
    const [, init] = (fetch as any).mock.calls[0];
    expect(JSON.parse(init.body as string).source).toBe('Website');
  });

  it('upsertContact omits source when not provided', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ contact: { id: 'c_3' } }), { status: 200 }),
    );
    await ghl.upsertContact({
      firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com', phone: '+15551234567',
    });
    const [, init] = (fetch as any).mock.calls[0];
    expect('source' in JSON.parse(init.body as string)).toBe(false);
  });

  it('createAppointment POSTs with calendarId, contactId, startTime', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'apt_42' }), { status: 200 }),
    );
    const id = await ghl.createAppointment({
      calendarId: 'cal_x',
      contactId: 'c_1',
      startISO: '2026-05-06T15:00:00-07:00',
      endISO:   '2026-05-06T15:45:00-07:00',
      title: 'Tiny Champions trial — Emma (6)',
    });
    expect(id).toBe('apt_42');
    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.calendarId).toBe('cal_x');
    expect(body.contactId).toBe('c_1');
    expect(body.startTime).toBe('2026-05-06T15:00:00-07:00');
  });

  it('createAppointment can bypass free-slot validation for partially booked class capacity', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'apt_43' }), { status: 200 }),
    );

    await ghl.createAppointment({
      calendarId: 'cal_x',
      contactId: 'c_1',
      startISO: '2026-05-06T15:00:00-07:00',
      endISO: '2026-05-06T15:45:00-07:00',
      title: 'Tiny Champions trial - Emma (6)',
      ignoreFreeSlotValidation: true,
    });

    const [, init] = (fetch as any).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.ignoreFreeSlotValidation).toBe(true);
  });

  it('getCalendar reads appointmentPerSlot for capacity checks', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ calendar: { id: 'cal_x', appointmentPerSlot: 3 } }), { status: 200 }),
    );

    const calendar = await ghl.getCalendar('cal_x');

    expect(calendar?.appointmentPerSlot).toBe(3);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toMatch(/calendars\/cal_x/);
    expect(init.headers.Version).toBe('2021-04-15');
  });

  it('getCalendarEvents queries calendar events for a date window', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ events: [{ id: 'apt_1', startTime: '2026-06-03T16:00:00-07:00' }] }), { status: 200 }),
    );

    const events = await ghl.getCalendarEvents({
      calendarId: 'cal_x',
      startTime: 1780470000000,
      endTime: 1781161199000,
    });

    expect(events).toHaveLength(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toContain('/calendars/events?');
    expect(url).toContain('locationId=loc_123');
    expect(url).toContain('calendarId=cal_x');
    expect(init.headers.Version).toBe('2021-04-15');
  });

  it('throws GhlError on non-2xx with status + body context', async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response('{"message":"bad token"}', { status: 401 }),
    );
    await expect(
      ghl.getFreeSlots({ calendarId: 'cal_x', startDate: 1, endDate: 2 }),
    ).rejects.toMatchObject({ name: 'GhlError', status: 401 });
  });
});
