/**
 * Result cache: persist model responses to disk so we never pay for the same
 * sample × question × model twice.
 *
 * Cache key = <model_id>__<question_id>
 * Stored in results/cache/ as one file per model.
 *
 * Each file: { "sampleId": { "questionId": { responseText, totalResponseTimeMs, error? } } }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelResponse } from './types.js';

const CACHE_DIR = join(process.cwd(), 'results', 'cache');

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheFileFor(modelId: string): string {
  return join(CACHE_DIR, `${modelId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
}

type CacheEntry = {
  responseText: string;
  totalResponseTimeMs: number;
  error?: string;
  outputTokens?: number;
};

type ModelCache = Record<string, Record<string, CacheEntry>>;

/**
 * Load an existing model cache (or return empty).
 */
function loadCache(modelId: string): ModelCache {
  const path = cacheFileFor(modelId);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Save a model cache to disk.
 */
function saveCache(modelId: string, cache: ModelCache) {
  ensureCacheDir();
  writeFileSync(cacheFileFor(modelId), JSON.stringify(cache, null, 2));
}

/**
 * Look up a cached response. Returns null if not cached.
 */
export function cacheLookup(
  modelId: string,
  sampleId: string,
  questionId: string
): CacheEntry | null {
  const cache = loadCache(modelId);
  return cache[sampleId]?.[questionId] ?? null;
}

/**
 * Store a response in the cache and persist immediately.
 */
export function cacheStore(
  modelId: string,
  sampleId: string,
  questionId: string,
  response: Pick<ModelResponse, 'responseText' | 'totalResponseTimeMs' | 'error' | 'outputTokens'>
) {
  const cache = loadCache(modelId);
  if (!cache[sampleId]) cache[sampleId] = {};
  cache[sampleId][questionId] = {
    responseText: response.responseText,
    totalResponseTimeMs: response.totalResponseTimeMs,
    error: response.error,
    outputTokens: response.outputTokens,
  };
  saveCache(modelId, cache);
}

/**
 * Get statistics for all cached models.
 */
export function cacheStats(): Array<{ modelId: string; samples: number; questions: number }> {
  ensureCacheDir();
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const cache: ModelCache = JSON.parse(readFileSync(join(CACHE_DIR, f), 'utf-8'));
    let samples = 0, questions = 0;
    for (const [, qs] of Object.entries(cache)) {
      samples++;
      questions += Object.keys(qs).length;
    }
    return { modelId: f.replace('.json', '').replace(/_/g, '/'), samples, questions };
  });
}
