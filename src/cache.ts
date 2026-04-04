/**
 * Response cache — keyed by model + string.
 * Config changes produce different cache keys automatically.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const CACHE_DIR = join(process.cwd(), 'results', 'cache');

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheFileFor(modelId: string): string {
  return join(CACHE_DIR, modelId.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json');
}

type CacheValue = {
  responseText: string;
  totalResponseTimeMs: number;
  error?: string;
  outputTokens?: number;
};

type ModelCache = Record<string, CacheValue>;

/** Hash config input for stable cache key derivation */
export function hashConfig(value: any): string {
  const json = JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  return createHash('sha256').update(json).digest('hex').slice(0, 8);
}

/** Build a stable cache key from benchmark + config + sample + question type */
export function buildCacheKey(
  benchmark: string,
  config: any,
  sampleId: string,
  questionType: string,
): string {
  const v = 'v1'; // input version — bump on breaking changes
  const h = hashConfig(config);
  return `${v}/${benchmark}/${h}/${sampleId}/${questionType}`;
}

export function cacheLookup(modelId: string, cacheKey: string): CacheValue | null {
  const cache = loadCache(modelId);
  return cache[cacheKey] ?? null;
}

export function cacheStore(modelId: string, cacheKey: string, data: Pick<CacheValue, 'responseText' | 'totalResponseTimeMs' | 'error' | 'outputTokens'>) {
  const cache = loadCache(modelId);
  cache[cacheKey] = data as CacheValue;
  saveCache(modelId, cache);
}

function loadCache(modelId: string): ModelCache {
  const path = cacheFileFor(modelId);
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return {}; }
}

function saveCache(modelId: string, cache: ModelCache) {
  ensureCacheDir();
  writeFileSync(cacheFileFor(modelId), JSON.stringify(cache, null, 2));
}

export function cacheStats(): Array<{ modelId: string; entries: number }> {
  ensureCacheDir();
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const cache: ModelCache = JSON.parse(readFileSync(join(CACHE_DIR, f), 'utf-8'));
    return { modelId: f.replace('.json', '').replace(/_/g, '/'), entries: Object.keys(cache).length };
  });
}

export function cacheClear(modelId?: string) {
  ensureCacheDir();
  if (modelId) {
    const f = cacheFileFor(modelId);
    if (existsSync(f)) unlinkSync(f);
  } else {
    readdirSync(CACHE_DIR).forEach(f => unlinkSync(join(CACHE_DIR, f)));
  }
}
