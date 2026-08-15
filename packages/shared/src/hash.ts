/**
 * Content hashing + ID/cache-key builders.
 *
 * Content-addressing is central to the platform's caching and incremental
 * review (ADR-0004, ADR-0010). We use Node's crypto for a real sha256 so hashes
 * are stable across processes and suitable as cache keys / issue fingerprints.
 */

import { createHash } from 'node:crypto';
import type { CacheKey, CacheTier, ContentHash, IssueId, IsoTimestamp } from '@ai-review/core';

/** Stable sha256 hex of arbitrary text. */
export function sha256(text: string): ContentHash {
  return createHash('sha256').update(text).digest('hex') as ContentHash;
}

/** Hashes a structured value by stable-stringifying it first. */
export function hashObject(value: unknown): ContentHash {
  return sha256(stableStringify(value));
}

/**
 * Deterministic JSON: object keys are sorted recursively so equal values always
 * produce equal strings (and therefore equal hashes / cache keys).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Builds a deterministic, content-addressed cache key for a tier. The tier is a
 * prefix so `invalidatePrefix(tier)` can clear a whole tier, and the parts are
 * hashed so keys are fixed-length and collision-resistant.
 */
export function buildCacheKey(tier: CacheTier, parts: readonly (string | number)[]): CacheKey {
  return `${tier}:${sha256(parts.join('\u0000'))}` as CacheKey;
}

/** A stable issue fingerprint from its semantic parts (not raw formatting). */
export function fingerprintIssue(parts: {
  readonly category: string;
  readonly ruleId: string;
  readonly file: string;
  readonly symbol?: string;
}): ContentHash {
  return hashObject(parts);
}

/** A deterministic issue id derived from its fingerprint. */
export function issueId(fingerprint: ContentHash): IssueId {
  return `issue.${fingerprint.slice(0, 16)}` as IssueId;
}

/** Current time as a branded ISO-8601 timestamp. */
export function nowIso(): IsoTimestamp {
  return new Date().toISOString() as IsoTimestamp;
}
