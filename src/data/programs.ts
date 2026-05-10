/**
 * The 5 age-tiered programs, each mapped to GHL calendar ID env vars per
 * booking flow. The trial flow (/kickstart) and BTM flow (/back-to-the-mats)
 * use distinct GHL calendars so admin sees the two booking types separately.
 */
export type ProgramKey = 'tiny' | 'lc1' | 'lc2' | 'juniors' | 'adults';
export type BookingFlow = 'trial' | 'btm';

export interface Program {
  key: ProgramKey;
  name: string;
  ageRange: string;
  /** Trial-flow calendar (free 3-class pass via /kickstart). */
  calendarIdEnvVar: string;
  /** Back to the Mats calendar (re-enrollment via /back-to-the-mats). */
  btmCalendarIdEnvVar: string;
}

export const programs: Program[] = [
  { key: 'tiny',    name: 'Tiny Champions',             ageRange: 'Ages 3–4',   calendarIdEnvVar: 'GHL_CAL_TINY',    btmCalendarIdEnvVar: 'GHL_CAL_BTM_TINY' },
  { key: 'lc1',     name: 'Little Champions 1',         ageRange: 'Ages 5–6',   calendarIdEnvVar: 'GHL_CAL_LC1',     btmCalendarIdEnvVar: 'GHL_CAL_BTM_LC1' },
  { key: 'lc2',     name: 'Little Champions 2',         ageRange: 'Ages 7–9',   calendarIdEnvVar: 'GHL_CAL_LC2',     btmCalendarIdEnvVar: 'GHL_CAL_BTM_LC2' },
  { key: 'juniors', name: 'Juniors Jiu-Jitsu',          ageRange: 'Ages 10–15', calendarIdEnvVar: 'GHL_CAL_JUNIORS', btmCalendarIdEnvVar: 'GHL_CAL_BTM_JUNIORS' },
  { key: 'adults',  name: 'Adults Brazilian Jiu-Jitsu', ageRange: 'Ages 16+',   calendarIdEnvVar: 'GHL_CAL_ADULTS',  btmCalendarIdEnvVar: 'GHL_CAL_BTM_ADULTS' },
];

export function getProgram(key: ProgramKey): Program {
  const p = programs.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown program key: ${key}`);
  return p;
}

/** Resolve the GHL calendar ID env-var name for a (program, flow) pair. */
export function getCalendarIdEnvVar(key: ProgramKey, flow: BookingFlow): string {
  const p = getProgram(key);
  return flow === 'btm' ? p.btmCalendarIdEnvVar : p.calendarIdEnvVar;
}
