/**
 * Trainee key — deterministic slug used to disambiguate siblings and detect
 * rebookings.
 *
 * Format:
 *   isSelf=true  → `${slug(firstName)}-${slug(lastName)}-self`
 *   isSelf=false → `${slug(firstName)}-${dobYYYYMMDD || 'nodob'}`
 *
 * Why DOB and not age: ages roll over annually; DOB is stable. For the rare
 * case where DOB isn't collected, we fall back to "nodob" — collisions for
 * same-first-name siblings without DOB are accepted (rare; flagged in spec).
 *
 * Side effect: code references trainee identity exclusively through this slug.
 * Never compare on firstName + lastName directly.
 */

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

function slug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface TraineeKeyArgs {
  isSelf: boolean;
  firstName: string;
  lastName?: string;
  /** YYYY-MM-DD. Required for child bookings; ignored for self. */
  dob?: string;
}

export function deriveTraineeKey(args: TraineeKeyArgs): string {
  const first = slug(args.firstName);
  if (!first) throw new Error('deriveTraineeKey: firstName required');

  if (args.isSelf) {
    const last = slug(args.lastName ?? '');
    return last ? `${first}-${last}-self` : `${first}-self`;
  }

  if (args.dob && DOB_RE.test(args.dob)) {
    const compact = args.dob.replace(/-/g, '');
    return `${first}-${compact}`;
  }

  return `${first}-nodob`;
}
