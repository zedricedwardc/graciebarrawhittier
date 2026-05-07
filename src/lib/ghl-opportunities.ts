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
import { cacheOpportunityCustomFields } from './ghl-custom-fields';
import type { PipelineKey } from '../../config/ghl-schema';

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
 */
export function findByTraineeKey(opps: OpportunityRecord[], traineeKey: string): OpportunityRecord | null {
  for (const opp of opps) {
    const cfs = opp.customFields ?? [];
    for (const cf of cfs) {
      if (cf.key === 'trainee_key' || (cf as { fieldKey?: string }).fieldKey === 'trainee_key') {
        const v = (cf.field_value ?? cf.value) as string | undefined;
        if (typeof v === 'string' && v.toLowerCase() === traineeKey.toLowerCase()) return opp;
      }
    }
  }
  return null;
}

/** Read a single custom-field value off an opportunity record. */
export function getOppCfValue<T = unknown>(opp: OpportunityRecord, fieldKey: string): T | undefined {
  for (const cf of opp.customFields ?? []) {
    if (cf.key === fieldKey || (cf as { fieldKey?: string }).fieldKey === fieldKey) {
      return (cf.field_value ?? cf.value) as T;
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

/** Update opportunity custom fields. */
export async function updateOppFields(
  oppId: string,
  customFields: Array<{ id: string; field_value: string | number | boolean | null }>,
): Promise<OpportunityRecord> {
  return updateOpportunity(oppId, { customFields });
}

export type { OpportunityRecord, UpdateOpportunityArgs };
