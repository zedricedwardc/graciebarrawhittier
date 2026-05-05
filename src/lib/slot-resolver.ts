/**
 * Pure function: given the recurring weekly schedule, blackout dates,
 * and which slot startISOs are already booked, returns the list of
 * available AvailabilitySlot entries within the requested date range.
 *
 * No I/O. No GHL. No Astro. Trivially testable.
 */
import { schedule, TZ } from '../data/schedule';
import type { ProgramKey } from '../data/programs';
import type { AvailabilitySlot } from './booking-types';

export interface GenerateSlotsArgs {
  programKey: ProgramKey;
  fromISODate: string;        // 'YYYY-MM-DD' inclusive
  toISODate: string;          // 'YYYY-MM-DD' inclusive
  bookedStartISOs: Set<string>;
  blackoutDates: Set<string>; // 'YYYY-MM-DD'
  now: Date;
  minLeadMinutes: number;     // exclude slots starting within this many minutes of `now`
}

export function generateSlots(args: GenerateSlotsArgs): AvailabilitySlot[] {
  const { programKey, fromISODate, toISODate, bookedStartISOs, blackoutDates, now, minLeadMinutes } = args;
  const template = schedule[programKey];
  if (!template || template.length === 0) return [];

  const out: AvailabilitySlot[] = [];
  const minLeadMs = minLeadMinutes * 60_000;

  for (const dateISO of iterateDates(fromISODate, toISODate)) {
    if (blackoutDates.has(dateISO)) continue;
    const weekday = weekdayInTZ(dateISO);
    for (const tmpl of template) {
      if (tmpl.weekday !== weekday) continue;
      const startISO = composeISO(dateISO, tmpl.hour, tmpl.minute);
      const startMs = Date.parse(startISO);
      if (startMs - now.getTime() < minLeadMs) continue;
      if (bookedStartISOs.has(startISO)) continue;
      const endISO = composeISO(dateISO, tmpl.hour, tmpl.minute, tmpl.durationMin);
      out.push({
        startISO,
        endISO,
        label: formatLabel(startISO),
      });
    }
  }
  out.sort((a, b) => a.startISO.localeCompare(b.startISO));
  return out;
}

/** Inclusive date iteration, YYYY-MM-DD strings. */
function* iterateDates(fromISO: string, toISO: string): Generator<string> {
  let cursor = new Date(`${fromISO}T00:00:00Z`);
  const end = new Date(`${toISO}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    yield cursor.toISOString().slice(0, 10);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
}

/** Returns 0=Sun..6=Sat for a YYYY-MM-DD interpreted in TZ. */
function weekdayInTZ(dateISO: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  // Use Intl to get the weekday in our target tz (date-only — noon avoids DST edge confusion).
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
  const wd = fmt.format(new Date(`${dateISO}T12:00:00Z`));
  const map: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const result = map[wd];
  if (result === undefined) throw new Error(`Unexpected weekday abbreviation: ${wd}`);
  return result;
}

/** Returns a TZ-aware ISO like "2026-05-04T15:00:00-07:00". */
function composeISO(dateISO: string, hour: number, minute: number, addMinutes = 0): string {
  // Compute the UTC instant for {dateISO, hour, minute} interpreted in TZ.
  // Then format with the TZ offset suffix that matches that instant.
  const naive = new Date(`${dateISO}T${pad(hour)}:${pad(minute)}:00Z`); // wrong by tz offset
  const offsetMin = tzOffsetMinutesAt(naive, TZ);
  const corrected = new Date(naive.getTime() - offsetMin * 60_000 + addMinutes * 60_000);
  const finalOffset = tzOffsetMinutesAt(corrected, TZ);
  return formatISOWithOffset(corrected, finalOffset);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function tzOffsetMinutesAt(when: Date, timeZone: string): number {
  // Standard trick: ask Intl what local time is in the target tz, diff with UTC.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(when).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUTC - when.getTime()) / 60_000);
}

function formatISOWithOffset(d: Date, offsetMin: number): string {
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = pad(Math.floor(abs / 60));
  const om = pad(abs % 60);
  // Format the date in that offset (not UTC).
  const local = new Date(d.getTime() + offsetMin * 60_000);
  const y = local.getUTCFullYear();
  const mo = pad(local.getUTCMonth() + 1);
  const da = pad(local.getUTCDate());
  const h = pad(local.getUTCHours());
  const mi = pad(local.getUTCMinutes());
  const se = pad(local.getUTCSeconds());
  return `${y}-${mo}-${da}T${h}:${mi}:${se}${sign}${oh}:${om}`;
}

function formatLabel(startISO: string): string {
  const d = new Date(startISO);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  // "Tue, May 6, 3:00 PM" → reformat to "Tue, May 6 · 3:00 PM"
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const date = `${get('weekday')}, ${get('month')} ${get('day')}`;
  const time = `${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
  return `${date} · ${time}`;
}
