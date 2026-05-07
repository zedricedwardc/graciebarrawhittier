/**
 * Custom field ID cache.
 *
 * GHL custom fields have a stable `fieldKey` (string) and a per-location ID (uuid).
 * Code references fields by fieldKey via the schema; this module resolves
 * fieldKey → ID at runtime.
 *
 * GHL exposes Contact custom fields via:
 *   GET /locations/:locationId/customFields
 *
 * Opportunity custom fields don't have a public list endpoint that works for
 * standard objects (only Custom Objects + Company per docs as of 2026-05). We
 * discover Opportunity CF IDs lazily by reading them off any opportunity
 * payload we fetch — opportunity records include `customFields[{ id, key, value }]`.
 *
 * Cache lives on a warm Fluid Compute instance.
 */

import { ghlFetch, GhlError } from './ghl-rate-limit';
import {
  CONTACT_CUSTOM_FIELDS,
  OPPORTUNITY_CUSTOM_FIELDS,
  type CustomFieldDef,
} from '../../config/ghl-schema';

export type CfObject = 'contact' | 'opportunity';

interface RawContactField {
  id: string;
  fieldKey?: string;
  name?: string;
  dataType?: string;
}

interface CfCache {
  contact: Map<string, string>; // fieldKey → id
  opportunity: Map<string, string>;
  loadedAt: number;
}

let cache: CfCache = {
  contact: new Map(),
  opportunity: new Map(),
  loadedAt: 0,
};

function locationId(): string {
  const l =
    (import.meta.env as Record<string, string | undefined>).GHL_LOCATION_ID ??
    process.env.GHL_LOCATION_ID;
  if (!l) throw new Error('GHL_LOCATION_ID env var not set');
  return l;
}

/**
 * Refresh the contact custom-field cache from GHL.
 * Opportunity CFs aren't refreshable via a list endpoint — they accumulate
 * in the cache as opportunities flow through `cacheOpportunityCustomFields`.
 */
export async function refreshContactCustomFields(): Promise<{
  resolved: string[];
  missing: string[];
}> {
  const data = await ghlFetch<{ customFields: RawContactField[] }>(
    `/locations/${encodeURIComponent(locationId())}/customFields`,
    { version: '2021-07-28' },
  );
  const live = data.customFields ?? [];
  const byKey = new Map<string, string>();
  for (const f of live) {
    if (f.fieldKey) byKey.set(f.fieldKey, f.id);
    else if (f.name) byKey.set(f.name, f.id); // fallback
  }

  cache = { ...cache, contact: byKey, loadedAt: Date.now() };

  const resolved: string[] = [];
  const missing: string[] = [];
  for (const def of CONTACT_CUSTOM_FIELDS) {
    if (byKey.has(def.fieldKey)) resolved.push(def.fieldKey);
    else missing.push(def.fieldKey);
  }
  return { resolved, missing };
}

/**
 * Opportunity CFs come back inside opportunity records. Call this whenever
 * we fetch one to keep the cache populated.
 */
export function cacheOpportunityCustomFields(
  fields: Array<{ id?: string; key?: string; fieldKey?: string }> | undefined,
): void {
  if (!fields) return;
  for (const f of fields) {
    const id = f.id;
    const key = f.fieldKey ?? f.key;
    if (id && key) cache.opportunity.set(key, id);
  }
}

/** Get a custom-field ID by object + fieldKey. Throws on miss. */
export async function getCfId(object: CfObject, fieldKey: string): Promise<string> {
  const map = object === 'contact' ? cache.contact : cache.opportunity;
  let id = map.get(fieldKey);
  if (id) return id;

  // Lazy refresh for contact CFs (auto-discover on first use).
  if (object === 'contact' && cache.loadedAt === 0) {
    await refreshContactCustomFields();
    id = cache.contact.get(fieldKey);
    if (id) return id;
  }

  throw new GhlError(
    0,
    '',
    '/locations/:id/customFields',
    `Custom field "${fieldKey}" (${object}) not found — verify it exists in GHL with this exact fieldKey.`,
  );
}

/**
 * Build the GHL `customFields` array shape from a fieldKey → value map.
 * Used by upsert/update calls.
 */
export async function cfPayload(
  object: CfObject,
  values: Record<string, string | number | boolean | null>,
): Promise<Array<{ id: string; field_value: string | number | boolean | null }>> {
  const out: Array<{ id: string; field_value: string | number | boolean | null }> = [];
  for (const [key, value] of Object.entries(values)) {
    const id = await getCfId(object, key);
    out.push({ id, field_value: value });
  }
  return out;
}

/** Diagnostic snapshot for /api/health/ghl. */
export interface CfCacheSnapshot {
  loadedAt: number;
  contact: { resolved: string[]; missing: string[] };
  opportunity: { discovered: string[]; expected: string[]; missing: string[] };
}

export function snapshotCustomFields(): CfCacheSnapshot {
  const contactResolved: string[] = [];
  const contactMissing: string[] = [];
  for (const def of CONTACT_CUSTOM_FIELDS) {
    (cache.contact.has(def.fieldKey) ? contactResolved : contactMissing).push(def.fieldKey);
  }

  const oppExpected = OPPORTUNITY_CUSTOM_FIELDS.map((d: CustomFieldDef) => d.fieldKey);
  const oppDiscovered = Array.from(cache.opportunity.keys());
  const oppMissing = oppExpected.filter((k) => !cache.opportunity.has(k));

  return {
    loadedAt: cache.loadedAt,
    contact: { resolved: contactResolved, missing: contactMissing },
    opportunity: { discovered: oppDiscovered, expected: oppExpected, missing: oppMissing },
  };
}

/** Reset for tests. */
export function _resetCache(): void {
  cache = { contact: new Map(), opportunity: new Map(), loadedAt: 0 };
}
