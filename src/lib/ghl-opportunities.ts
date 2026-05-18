/**
 * Opportunity helpers — high-level operations that translate schema names
 * (PipelineKey + stage name) to live GHL IDs and call the underlying ghl.ts
 * primitives.
 *
 * The handler code (ghl-adapter.ts) only calls these helpers; it never touches
 * pipeline/stage UUIDs directly. That's the reproducibility contract.
 */

import {
  createOpportunity as _createOpportunity,
  searchOpportunities,
  updateOpportunity,
  type OpportunityRecord,
  type UpdateOpportunityArgs,
} from './ghl';
import { getPipelineId, getStageId } from './ghl-pipelines';
import { cacheOpportunityCustomFields, getCfId } from './ghl-custom-fields';
import { getCustomValue } from './ghl-custom-values';
import type { PipelineKey } from '../../config/ghl-schema';

/**
 * Fallback used when the `enrolled_student_value` GHL custom value is missing
 * or unparseable. Mirrors the schema's declared defaultValue in
 * config/ghl-schema.ts — keep the two in sync.
 */
const ENROLLED_STUDENT_VALUE_FALLBACK = 160;

/**
 * Search a contact's opportunities in a specific pipeline.
 * Side effect: caches discovered opportunity custom field IDs as it goes.
 */
export async function findOpps(args: {
  contactId: string;
  pipelineKey: PipelineKey;
  status?: 'open' | 'won' | 'lost' | 'abandoned' | 'all';
  limit?: number;
}): Promise<OpportunityRecord[]> {
  const pipelineId = await getPipelineId(args.pipelineKey);
  const opps = await searchOpportunities({
    contactId: args.contactId,
    pipelineId,
    status: args.status ?? 'open',
    limit: args.limit,
  });
  // Opp records carry their CFs — cache the IDs we see.
  for (const opp of opps) cacheOpportunityCustomFields(opp.customFields);
  return opps;
}

/**
 * Filter a list of opportunities to ones matching a given trainee_key
 * (read from the opp's `trainee_key` custom field).
 *
 * GHL's /opportunities/search doesn't support filtering by custom field
 * server-side, so we fetch by contact + pipeline first and filter client-side.
 *
 * Async because /opportunities/search responses strip key/fieldKey — we have to
 * resolve the field id via the CF cache to match.
 */
export async function findByTraineeKey(opps: OpportunityRecord[], traineeKey: string): Promise<OpportunityRecord | null> {
  const wanted = traineeKey.toLowerCase();
  for (const opp of opps) {
    const v = await getOppCfValueByKey<string>(opp, 'trainee_key');
    if (typeof v === 'string' && v.toLowerCase() === wanted) return opp;
  }
  return null;
}

/**
 * Read a single custom-field value off an opportunity record (sync, no cache).
 *
 * Works only for response shapes that include `key`/`fieldKey` on each CF —
 * mostly POST/PUT request responses. For GET / search responses (which only
 * include `id` + `fieldValue*`), use {@link getOppCfValueByKey} which looks
 * up the field ID via the CF cache.
 */
export function getOppCfValue<T = unknown>(opp: OpportunityRecord, fieldKey: string): T | undefined {
  for (const cf of opp.customFields ?? []) {
    if (cf.key === fieldKey || (cf as { fieldKey?: string }).fieldKey === fieldKey) {
      return readCfValue<T>(cf);
    }
  }
  return undefined;
}

/**
 * Pick the populated value off a CF entry, regardless of the GHL response
 * shape variant. GHL has at least four shapes in the wild:
 *   - POST/PUT response:        { key, field_value }
 *   - GET /opportunities/:id:   { id, fieldValue }
 *   - GET /opportunities/search:{ id, type, fieldValueString | fieldValueNumber | fieldValueDate | fieldValueArray }
 *   - older contact CF:         { id, value }
 */
function readCfValue<T>(cf: Record<string, unknown>): T | undefined {
  const v =
    cf.field_value ??
    cf.fieldValue ??
    cf.fieldValueString ??
    cf.fieldValueNumber ??
    cf.fieldValueDate ??
    cf.fieldValueArray ??
    cf.value;
  return v as T | undefined;
}

/**
 * Async, cache-backed CF reader. Resolves the field's ID via the CF cache
 * (loading it if needed) then matches by `id` in the opp's customFields.
 *
 * Use this when reading from GET /opportunities/:id or /opportunities/search
 * responses, which strip key/fieldKey and only include id + fieldValue.
 */
export async function getOppCfValueByKey<T = unknown>(
  opp: OpportunityRecord,
  fieldKey: string,
): Promise<T | undefined> {
  // Try the sync path first — covers write-response shapes.
  const sync = getOppCfValue<T>(opp, fieldKey);
  if (sync !== undefined) return sync;

  // Fall back to ID-based lookup via the CF cache.
  let id: string;
  try {
    id = await getCfId('opportunity', fieldKey);
  } catch {
    return undefined;
  }
  for (const cf of opp.customFields ?? []) {
    if (cf.id === id) {
      return readCfValue<T>(cf as unknown as Record<string, unknown>);
    }
  }
  return undefined;
}

/** Create an opportunity in a schema-named pipeline + stage. */
export async function createOpp(args: {
  pipelineKey: PipelineKey;
  stageName: string;
  contactId: string;
  name: string;
  status?: 'open' | 'won' | 'lost' | 'abandoned';
  monetaryValue?: number;
  source?: string;
  customFields?: Array<{ id: string; field_value: string | number | boolean | null }>;
}): Promise<OpportunityRecord> {
  const [pipelineId, pipelineStageId] = await Promise.all([
    getPipelineId(args.pipelineKey),
    getStageId(args.pipelineKey, args.stageName),
  ]);
  const opp = await _createOpportunity({
    pipelineId,
    pipelineStageId,
    contactId: args.contactId,
    name: args.name,
    status: args.status,
    monetaryValue: args.monetaryValue,
    source: args.source,
    customFields: args.customFields,
  });
  cacheOpportunityCustomFields(opp.customFields);
  return opp;
}

/** Move an opportunity to a stage (within or across pipelines). */
export async function moveStage(args: {
  oppId: string;
  pipelineKey: PipelineKey;
  stageName: string;
  customFields?: Array<{ id: string; field_value: string | number | boolean | null }>;
}): Promise<OpportunityRecord> {
  const [pipelineId, pipelineStageId] = await Promise.all([
    getPipelineId(args.pipelineKey),
    getStageId(args.pipelineKey, args.stageName),
  ]);
  return updateOpportunity(args.oppId, {
    pipelineId,
    pipelineStageId,
    customFields: args.customFields,
  });
}

/** Set an opportunity's status (open/won/lost/abandoned). */
export async function setOppStatus(
  oppId: string,
  status: 'open' | 'won' | 'lost' | 'abandoned',
): Promise<OpportunityRecord> {
  return updateOpportunity(oppId, { status });
}

/** Set an opportunity's monetary value (dashboard revenue reporting). */
export async function setOppValue(oppId: string, monetaryValue: number): Promise<OpportunityRecord> {
  return updateOpportunity(oppId, { monetaryValue });
}

/**
 * Resolve the dollar value to stamp on a WON enrollment opportunity.
 *
 * Reads the studio-editable `enrolled_student_value` GHL custom value; falls
 * back to {@link ENROLLED_STUDENT_VALUE_FALLBACK} when it is missing, empty, or
 * not a positive number. Used by the `set_opp_value` transition action.
 */
export async function enrolledStudentValue(): Promise<number> {
  const raw = await getCustomValue('enrolled_student_value');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : ENROLLED_STUDENT_VALUE_FALLBACK;
}

/** Update opportunity custom fields. */
export async function updateOppFields(
  oppId: string,
  customFields: Array<{ id: string; field_value: string | number | boolean | null }>,
): Promise<OpportunityRecord> {
  return updateOpportunity(oppId, { customFields });
}

export type { OpportunityRecord, UpdateOpportunityArgs };
