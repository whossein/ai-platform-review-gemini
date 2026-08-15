/**
 * @ai-review/shared
 *
 * Cross-cutting utilities implementing `core` contracts (ADR-0002 keeps these
 * out of core):
 *  - Result helpers (`ok`/`err`/`map`/…)
 *  - content hashing + cache-key / fingerprint / id builders
 *  - `InMemoryCache` + `CacheSet` (content-addressed, TTL, invalidation)
 *  - `InMemoryTelemetrySink`
 */

export { ok, err, error, isOk, isErr, map, unwrapOr } from './result.js';
export {
  sha256,
  hashObject,
  stableStringify,
  buildCacheKey,
  fingerprintIssue,
  issueId,
  nowIso,
} from './hash.js';
export { InMemoryCache, CacheSet } from './cache.js';
export { InMemoryTelemetrySink } from './telemetry.js';
export { loadDotEnv } from './env.js';
