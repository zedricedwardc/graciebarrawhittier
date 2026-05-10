/**
 * Read GHL custom values at request time, with a short in-memory cache so we
 * don't hammer GHL on every page render.
 *
 * Custom values are studio-admin-editable globals (e.g. `back_to_mats_deadline`,
 * `back_to_mats_offer_name`). Storing campaign-tunable settings in GHL — instead
 * of Vercel env vars — lets the studio admin change them via Settings → Custom
 * Values without coordinating with a developer or triggering a redeploy.
 *
 * Cache is module-level so it survives across requests on a warm Fluid Compute
 * instance. On a cold start the first request pays the GHL fetch latency
 * (~150-300ms); subsequent requests hit the cache.
 */

import { ghlFetch } from './ghl-rate-limit';
import { readEnv } from './ghl';

interface RawCustomValue {
  id: string;
  name: string;
  fieldKey?: string;
  value?: string;
}

interface CustomValuesResponse {
  customValues?: RawCustomValue[];
}

/** Cache TTL: 5 minutes. Studio admin edits propagate within that window. */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  /** Map of bare fieldKey → value. */
  values: Map<string, string>;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

function locationId(): string {
  const id = readEnv('GHL_LOCATION_ID');
  if (!id) throw new Error('GHL_LOCATION_ID env var not set');
  return id;
}

/**
 * Extract the bare custom-value key from GHL's wrapped fieldKey format.
 * GHL returns fieldKey as a template-merge string:
 *   "{{ custom_values.back_to_mats_deadline }}" → "back_to_mats_deadline"
 * Also handles the unwrapped form "custom_values.back_to_mats_deadline"
 * just in case GHL ever changes the response shape.
 */
function bareKey(fieldKey: string | undefined): string | null {
  if (!fieldKey) return null;
  const m = fieldKey.match(/custom_values\.([A-Za-z0-9_]+)/);
  return m ? m[1]! : null;
}

async function refreshCache(): Promise<CacheEntry> {
  const data = await ghlFetch<CustomValuesResponse>(
    `/locations/${encodeURIComponent(locationId())}/customValues`,
  );
  const values = new Map<string, string>();
  for (const cv of data.customValues ?? []) {
    const k = bareKey(cv.fieldKey);
    if (k && typeof cv.value === 'string') values.set(k, cv.value);
  }
  const entry = { values, fetchedAt: Date.now() };
  cache = entry;
  return entry;
}

/**
 * Look up a single custom value by bare fieldKey (no `custom_values.` prefix).
 *
 * Returns the value string, or null if missing/empty/cache-fetch-failed.
 * Errors during cache refresh are swallowed (returns null) so the caller can
 * fall back to a default — campaign-tunable settings shouldn't crash the page.
 */
export async function getCustomValue(fieldKey: string): Promise<string | null> {
  const now = Date.now();
  if (!cache || now - cache.fetchedAt > CACHE_TTL_MS) {
    try {
      await refreshCache();
    } catch (err) {
      console.warn('[ghl-custom-values] refresh failed', err);
      // Fall back to last-known cache if we have one, else null.
      if (!cache) return null;
    }
  }
  const v = cache!.values.get(fieldKey);
  return v && v.length > 0 ? v : null;
}

/** For tests: clear the cache so the next call refetches. */
export function _resetCache(): void {
  cache = null;
}
