/**
 * Pipeline + stage ID cache.
 *
 * Resolves SCHEMA NAMES (from config/ghl-schema.ts) → live GHL IDs at runtime.
 * Code never references stage names as string literals — it always goes through
 * getStageId(pipelineKey, stageName) so renaming a stage in the schema flows
 * through to behavior with one edit.
 *
 * Source of truth at boot: GET /opportunities/pipelines?locationId=… (per-instance cache).
 * Cache lives on a warm Fluid Compute instance; cold starts re-fetch on first use.
 */

import { ghlFetch, GhlError } from './ghl-rate-limit';
import { PIPELINES, type PipelineKey } from '../../config/ghl-schema';

interface RawPipeline {
  id: string;
  name: string;
  stages: { id: string; name: string; position: number }[];
}

interface ResolvedPipeline {
  id: string;
  name: string;
  /** Map of stageName → stageId, lowercase-keyed for case-insensitive lookup. */
  stagesByName: Map<string, string>;
}

interface PipelineCache {
  byKey: Map<PipelineKey, ResolvedPipeline>;
  loadedAt: number;
}

let cache: PipelineCache | null = null;

function locationId(): string {
  const l =
    (import.meta.env as Record<string, string | undefined>).GHL_LOCATION_ID ??
    process.env.GHL_LOCATION_ID;
  if (!l) throw new Error('GHL_LOCATION_ID env var not set');
  return l;
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Fetch live pipelines from GHL and resolve them against the schema by name.
 * Replaces any existing cache.
 */
export async function refreshPipelines(): Promise<{ resolved: PipelineKey[]; missing: PipelineKey[] }> {
  const data = await ghlFetch<{ pipelines: RawPipeline[] }>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId())}`,
  );
  const live = data.pipelines ?? [];
  const liveByName = new Map<string, RawPipeline>();
  for (const p of live) liveByName.set(normalizeName(p.name), p);

  const byKey = new Map<PipelineKey, ResolvedPipeline>();
  const resolved: PipelineKey[] = [];
  const missing: PipelineKey[] = [];

  for (const def of Object.values(PIPELINES)) {
    const livePipeline = liveByName.get(normalizeName(def.name));
    if (!livePipeline) {
      missing.push(def.key);
      continue;
    }
    const stagesByName = new Map<string, string>();
    for (const stage of livePipeline.stages ?? []) {
      stagesByName.set(normalizeName(stage.name), stage.id);
    }
    byKey.set(def.key, {
      id: livePipeline.id,
      name: livePipeline.name,
      stagesByName,
    });
    resolved.push(def.key);
  }

  cache = { byKey, loadedAt: Date.now() };
  return { resolved, missing };
}

async function ensureLoaded(): Promise<PipelineCache> {
  if (cache) return cache;
  await refreshPipelines();
  if (!cache) throw new Error('ghl-pipelines: cache failed to load after refresh');
  return cache;
}

/** Resolve a schema PipelineKey to its live GHL pipeline ID. */
export async function getPipelineId(key: PipelineKey): Promise<string> {
  const c = await ensureLoaded();
  const p = c.byKey.get(key);
  if (!p) {
    throw new GhlError(
      0,
      '',
      '/opportunities/pipelines',
      `Pipeline "${PIPELINES[key].name}" not found in live GHL — run /api/health/ghl to diagnose drift.`,
    );
  }
  return p.id;
}

/** Resolve a stage NAME within a schema PipelineKey to its live GHL stage ID. */
export async function getStageId(key: PipelineKey, stageName: string): Promise<string> {
  const c = await ensureLoaded();
  const p = c.byKey.get(key);
  if (!p) {
    throw new GhlError(
      0,
      '',
      '/opportunities/pipelines',
      `Pipeline "${PIPELINES[key].name}" not found in live GHL.`,
    );
  }
  const id = p.stagesByName.get(normalizeName(stageName));
  if (!id) {
    throw new GhlError(
      0,
      '',
      '/opportunities/pipelines',
      `Stage "${stageName}" not found in live "${p.name}" pipeline — drift detected.`,
    );
  }
  return id;
}

/**
 * Diagnostic snapshot of the resolved cache. Used by /api/health/ghl.
 */
export interface PipelineCacheSnapshot {
  loadedAt: number;
  pipelines: {
    key: PipelineKey;
    name: string;
    id: string;
    stages: { name: string; id: string }[];
  }[];
}

export async function snapshotPipelines(): Promise<PipelineCacheSnapshot> {
  const c = await ensureLoaded();
  const pipelines: PipelineCacheSnapshot['pipelines'] = [];
  for (const [key, p] of c.byKey.entries()) {
    pipelines.push({
      key,
      name: p.name,
      id: p.id,
      stages: Array.from(p.stagesByName.entries()).map(([name, id]) => ({ name, id })),
    });
  }
  return { loadedAt: c.loadedAt, pipelines };
}

/** Forget the cache (for tests). */
export function _resetCache(): void {
  cache = null;
}
