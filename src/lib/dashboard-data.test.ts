import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CalendarEventRecord, ContactRecord } from './ghl';

// Mock the GHL client so the aggregators never make real calls. `readEnv` is
// passed through to process.env so the calendar map resolves from stubbed vars.
vi.mock('./ghl', () => ({
  getCalendarEvents: vi.fn(),
  getContact: vi.fn(),
  searchContactsByDateRange: vi.fn(),
  readEnv: (key: string) => process.env[key],
}));

import { getCalendarEvents, getContact, searchContactsByDateRange } from './ghl';
import { getUpcomingAppointments, getLeadBreakdown } from './dashboard-data';

const getCalendarEventsMock = vi.mocked(getCalendarEvents);
const getContactMock = vi.mocked(getContact);
const searchContactsMock = vi.mocked(searchContactsByDateRange);

// Calendar IDs wired to env so the program/flow map resolves deterministically.
const TRIAL_TINY = 'cal_trial_tiny';
const TRIAL_ADULTS = 'cal_trial_adults';
const BTM_ADULTS = 'cal_btm_adults';

function event(overrides: Partial<CalendarEventRecord> = {}): CalendarEventRecord {
  return {
    id: 'apt_' + Math.random().toString(36).slice(2),
    startTime: '2026-06-20T16:00:00-07:00',
    endTime: '2026-06-20T16:45:00-07:00',
    contactId: 'c_1',
    appointmentStatus: 'confirmed',
    ...overrides,
  };
}

function contact(overrides: Partial<ContactRecord> = {}): ContactRecord {
  return { id: 'c_1', firstName: 'Jane', lastName: 'Doe', ...overrides };
}

beforeEach(() => {
  getCalendarEventsMock.mockReset();
  getContactMock.mockReset();
  searchContactsMock.mockReset();
  // Only the trial calendars + the Adults BTM calendar are configured.
  vi.stubEnv('GHL_CAL_TINY', TRIAL_TINY);
  vi.stubEnv('GHL_CAL_LC1', '');
  vi.stubEnv('GHL_CAL_LC2', '');
  vi.stubEnv('GHL_CAL_JUNIORS', '');
  vi.stubEnv('GHL_CAL_ADULTS', TRIAL_ADULTS);
  vi.stubEnv('GHL_CAL_BTM_TINY', '');
  vi.stubEnv('GHL_CAL_BTM_LC1', '');
  vi.stubEnv('GHL_CAL_BTM_LC2', '');
  vi.stubEnv('GHL_CAL_BTM_JUNIORS', '');
  vi.stubEnv('GHL_CAL_BTM_ADULTS', BTM_ADULTS);
});

describe('getLeadBreakdown — range → since', () => {
  const now = new Date('2026-06-19T12:00:00-07:00');

  beforeEach(() => {
    searchContactsMock.mockResolvedValue({ contacts: [], total: 0 });
  });

  it('7d → now − 7 days', async () => {
    const r = await getLeadBreakdown('7d', { now });
    expect(r.range).toBe('7d');
    expect(r.sinceISO).toBe(new Date(now.getTime() - 7 * 86_400_000).toISOString());
  });

  it('30d → now − 30 days', async () => {
    const r = await getLeadBreakdown('30d', { now });
    expect(r.sinceISO).toBe(new Date(now.getTime() - 30 * 86_400_000).toISOString());
  });

  it('90d → now − 90 days', async () => {
    const r = await getLeadBreakdown('90d', { now });
    expect(r.sinceISO).toBe(new Date(now.getTime() - 90 * 86_400_000).toISOString());
  });

  it('mtd → first of the current month (local)', async () => {
    const r = await getLeadBreakdown('mtd', { now });
    const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    expect(r.sinceISO).toBe(first.toISOString());
  });
});

describe('getLeadBreakdown — bucketing + pct math', () => {
  const now = new Date('2026-06-19T12:00:00-07:00');

  it('buckets native source into the 6 channels + Other and computes pct', async () => {
    searchContactsMock.mockResolvedValue({
      contacts: [
        contact({ id: 'a', source: 'Website Leads' }),
        contact({ id: 'b', source: 'Website Leads' }),
        contact({ id: 'c', source: 'Meta Ads' }),
        contact({ id: 'd', source: 'Random Thing' }), // → Other
        contact({ id: 'e', source: '' }),             // empty → Other
        contact({ id: 'f' }),                          // missing → Other
      ],
      total: 6,
    });

    const r = await getLeadBreakdown('30d', { now });
    expect(r.total).toBe(6);

    const byChannel = Object.fromEntries(r.channels.map((c) => [c.channel, c]));
    expect(byChannel['Website Leads']!.count).toBe(2);
    expect(byChannel['Website Leads']!.pct).toBe(33); // 2/6 → 33%
    expect(byChannel['Meta Ads']!.count).toBe(1);
    expect(byChannel['Other']!.count).toBe(3);

    // All 6 channels + Other are present.
    expect(r.channels).toHaveLength(7);
    // Sorted descending by count.
    const counts = r.channels.map((c) => c.count);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));
  });

  it('falls back to the lead_source CF when native source is absent', async () => {
    searchContactsMock.mockResolvedValue({
      contacts: [
        contact({ id: 'a', source: undefined, customFields: [{ id: 'cf1', key: 'lead_source', value: 'Referral' }] }),
      ],
      total: 1,
    });
    const r = await getLeadBreakdown('7d', { now });
    expect(r.channels.find((c) => c.channel === 'Referral')!.count).toBe(1);
  });

  it('handles total 0 without divide-by-zero (all pct = 0)', async () => {
    searchContactsMock.mockResolvedValue({ contacts: [], total: 0 });
    const r = await getLeadBreakdown('7d', { now });
    expect(r.total).toBe(0);
    expect(r.channels.every((c) => c.count === 0 && c.pct === 0)).toBe(true);
    expect(r.channels).toHaveLength(7);
  });
});

describe('getUpcomingAppointments', () => {
  const now = new Date('2026-06-19T12:00:00-07:00');

  it('merges + sorts across calendars and labels program/flow/source', async () => {
    getCalendarEventsMock.mockImplementation(async ({ calendarId }) => {
      if (calendarId === TRIAL_TINY) {
        return [event({ id: 'a', startTime: '2026-06-21T10:00:00-07:00', contactId: 'c_a' })];
      }
      if (calendarId === TRIAL_ADULTS) {
        return [event({ id: 'b', startTime: '2026-06-20T09:00:00-07:00', contactId: 'c_b' })];
      }
      if (calendarId === BTM_ADULTS) {
        return [event({ id: 'c', startTime: '2026-06-22T08:00:00-07:00', contactId: 'c_c' })];
      }
      return [];
    });
    getContactMock.mockImplementation(async (id) => {
      if (id === 'c_a') return contact({ id: 'c_a', firstName: 'Amy', lastName: 'A', source: 'Walk-In' });
      if (id === 'c_b') return contact({ id: 'c_b', firstName: 'Bob', lastName: 'B', source: 'Meta Ads' });
      if (id === 'c_c') return contact({ id: 'c_c', firstName: 'Cy', lastName: 'C', source: 'Unmatched' });
      return null;
    });

    const { appointments, warnings } = await getUpcomingAppointments({ now });

    expect(warnings).toEqual([]);
    // Sorted ascending by startTime: b (20th) → a (21st) → c (22nd).
    expect(appointments.map((a) => a.id)).toEqual(['b', 'a', 'c']);

    const a = appointments.find((x) => x.id === 'a')!;
    expect(a.program).toBe('Tiny Champions');
    expect(a.flow).toBe('trial');
    expect(a.contactName).toBe('Amy A');
    expect(a.source).toBe('Walk-In');

    const c = appointments.find((x) => x.id === 'c')!;
    expect(c.flow).toBe('btm');
    expect(c.program).toBe('Adults Brazilian Jiu-Jitsu');
    expect(c.source).toBe('Unknown'); // unmatched native source → Unknown
  });

  it('dedupes contact lookups — one getContact per distinct contactId', async () => {
    getCalendarEventsMock.mockImplementation(async ({ calendarId }) => {
      if (calendarId === TRIAL_TINY) {
        return [
          event({ id: 'a', contactId: 'shared' }),
          event({ id: 'b', contactId: 'shared' }),
        ];
      }
      if (calendarId === TRIAL_ADULTS) return [event({ id: 'c', contactId: 'shared' })];
      return [];
    });
    getContactMock.mockResolvedValue(contact({ id: 'shared', source: 'Referral' }));

    const { appointments } = await getUpcomingAppointments({ now });
    expect(appointments).toHaveLength(3);
    // Three events, one distinct contact → exactly one getContact call.
    expect(getContactMock).toHaveBeenCalledTimes(1);
    expect(appointments.every((a) => a.source === 'Referral')).toBe(true);
  });

  it('skips BTM calendars whose env var is unset (no fetch, no warning)', async () => {
    vi.stubEnv('GHL_CAL_BTM_ADULTS', ''); // now NO btm calendar configured
    getCalendarEventsMock.mockResolvedValue([]);

    const { warnings } = await getUpcomingAppointments({ now });
    expect(warnings).toEqual([]);
    // Only the two configured trial calendars are fetched.
    const fetched = getCalendarEventsMock.mock.calls.map((c) => c[0].calendarId);
    expect(fetched.sort()).toEqual([TRIAL_ADULTS, TRIAL_TINY].sort());
    expect(fetched).not.toContain(BTM_ADULTS);
  });

  it('a single calendar failure → warning + partial result from the rest', async () => {
    getCalendarEventsMock.mockImplementation(async ({ calendarId }) => {
      if (calendarId === TRIAL_ADULTS) throw new Error('boom');
      if (calendarId === TRIAL_TINY) return [event({ id: 'ok', contactId: 'c_a' })];
      return [];
    });
    getContactMock.mockResolvedValue(contact({ id: 'c_a', source: 'Walk-In' }));

    const { appointments, warnings } = await getUpcomingAppointments({ now });
    expect(appointments.map((a) => a.id)).toEqual(['ok']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Adults Brazilian Jiu-Jitsu');
  });

  it('contact fetch failure → source Unknown, appointment still rendered', async () => {
    getCalendarEventsMock.mockImplementation(async ({ calendarId }) =>
      calendarId === TRIAL_TINY ? [event({ id: 'ok', contactId: 'c_x' })] : [],
    );
    getContactMock.mockRejectedValue(new Error('contact boom'));

    const { appointments, warnings } = await getUpcomingAppointments({ now });
    expect(appointments).toHaveLength(1);
    expect(appointments[0]!.source).toBe('Unknown');
    expect(appointments[0]!.contactName).toBe(''); // unknown contact → blank name
    expect(warnings).toEqual([]);
  });
});
