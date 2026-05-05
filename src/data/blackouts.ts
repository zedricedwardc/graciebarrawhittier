/**
 * ISO date strings (YYYY-MM-DD) when the gym is closed for ALL programs.
 * Subtracted from schedule.ts in slot-resolver. Maintained manually.
 *
 * Add holidays, instructor-out days, scheduled closures here.
 */
export const blackouts: ReadonlySet<string> = new Set<string>([
  // e.g. '2026-12-25', // Christmas Day
]);
