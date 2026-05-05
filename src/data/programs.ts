/**
 * The 5 age-tiered programs offered for the free trial pass,
 * each mapped to its GHL calendar ID env var (resolved server-side only).
 */
export type ProgramKey = 'tiny' | 'lc1' | 'lc2' | 'juniors' | 'adults';

export interface Program {
  key: ProgramKey;
  name: string;
  ageRange: string;
  calendarIdEnvVar: string;
}

export const programs: Program[] = [
  { key: 'tiny',    name: 'Tiny Champions',             ageRange: 'Ages 3–4',   calendarIdEnvVar: 'GHL_CAL_TINY' },
  { key: 'lc1',     name: 'Little Champions 1',         ageRange: 'Ages 5–6',   calendarIdEnvVar: 'GHL_CAL_LC1' },
  { key: 'lc2',     name: 'Little Champions 2',         ageRange: 'Ages 7–9',   calendarIdEnvVar: 'GHL_CAL_LC2' },
  { key: 'juniors', name: 'Juniors Jiu-Jitsu',          ageRange: 'Ages 10–15', calendarIdEnvVar: 'GHL_CAL_JUNIORS' },
  { key: 'adults',  name: 'Adults Brazilian Jiu-Jitsu', ageRange: 'Ages 16+',   calendarIdEnvVar: 'GHL_CAL_ADULTS' },
];

export function getProgram(key: ProgramKey): Program {
  const p = programs.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown program key: ${key}`);
  return p;
}
