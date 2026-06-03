import type { APIRoute } from 'astro';
import { AvailabilityRequest, type AvailabilitySlot } from '../../lib/booking-types';
import { generateSlots } from '../../lib/slot-resolver';
import { getCalendarIdEnvVar } from '../../data/programs';
import { blackouts } from '../../data/blackouts';
import { getCalendar, getCalendarEvents, GhlError, readEnv } from '../../lib/ghl';
import { appointmentPerSlot, filterSlotsByCapacity } from '../../lib/slot-capacity';

export const prerender = false;

const MAX_RANGE_DAYS = 35;
const MIN_LEAD_MINUTES = 60;

export const GET: APIRoute = async ({ url }) => {
  const parsed = AvailabilityRequest.safeParse({
    program: url.searchParams.get('program'),
    flow:    url.searchParams.get('flow') ?? undefined,
    from:    url.searchParams.get('from'),
    to:      url.searchParams.get('to'),
  });
  if (!parsed.success) return json({ ok: false, code: 'INVALID_RANGE' });

  const { program, flow, from, to } = parsed.data;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs   = Date.parse(`${to}T23:59:59Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs ||
      (toMs - fromMs) / 86_400_000 > MAX_RANGE_DAYS) {
    return json({ ok: false, code: 'INVALID_RANGE' });
  }

  const calendarEnvVar = getCalendarIdEnvVar(program, flow);
  const calendarId = readEnv(calendarEnvVar);
  if (!calendarId) {
    console.error('[availability] missing calendar env var', calendarEnvVar);
    return json({ ok: false, code: 'GHL_UNAVAILABLE' });
  }

  let capacity = 1;
  let events: Awaited<ReturnType<typeof getCalendarEvents>> = [];
  try {
    const [calendar, calendarEvents] = await Promise.all([
      getCalendar(calendarId),
      getCalendarEvents({ calendarId, startTime: fromMs, endTime: toMs }),
    ]);
    capacity = appointmentPerSlot(calendar?.appointmentPerSlot);
    events = calendarEvents;
  } catch (err) {
    console.error('[availability] GHL calendar capacity/events failed',
      err instanceof GhlError ? { status: err.status, body: err.bodyText } : err);
    return json({ ok: false, code: 'GHL_UNAVAILABLE' });
  }

  // Build the template slots, then keep slots whose active appointment count is
  // below the calendar's class capacity.
  const templateSlots: AvailabilitySlot[] = generateSlots({
    programKey: program,
    fromISODate: from,
    toISODate: to,
    bookedStartISOs: new Set(),
    blackoutDates: new Set(blackouts),
    now: new Date(),
    minLeadMinutes: MIN_LEAD_MINUTES,
  });
  const slots = filterSlotsByCapacity({
    slots: templateSlots,
    events,
    appointmentPerSlot: capacity,
  });

  return json(
    { ok: true, slots },
    { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
  );
};

function json(body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
