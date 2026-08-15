/**
 * Shared utilities tests: hashing determinism, cache behavior (TTL, hit/miss,
 * invalidation), and Result helpers.
 */

import { describe, it, expect } from 'vitest';
import { buildCacheKey, hashObject, sha256, stableStringify } from './hash.js';
import { InMemoryCache, CacheSet } from './cache.js';
import { ok, err, map, unwrapOr } from './result.js';

describe('hashing', () => {
  it('sha256 is stable and order-independent for objects', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(hashObject({ a: 1, b: 2 })).toBe(hashObject({ b: 2, a: 1 }));
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });

  it('stableStringify sorts keys recursively', () => {
    expect(stableStringify({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('cache keys are tier-prefixed and content-addressed', () => {
    const k1 = buildCacheKey('ast', ['file.ts', 'v1']);
    const k2 = buildCacheKey('ast', ['file.ts', 'v1']);
    expect(k1).toBe(k2);
    expect(k1.startsWith('ast:')).toBe(true);
  });
});

describe('InMemoryCache', () => {
  it('records hits and misses and stores/retrieves values', async () => {
    const cache = new InMemoryCache<number>('llm_response');
    const key = buildCacheKey('llm_response', ['prompt-1']);

    const miss = await cache.get(key);
    expect(miss.ok && miss.value).toBeUndefined();

    await cache.set(key, 42);
    const hit = await cache.get(key);
    expect(hit.ok && hit.value?.value).toBe(42);

    expect(cache.stats()).toEqual({ hits: 1, misses: 1 });
  });

  it('expires entries past their TTL using an injectable clock', async () => {
    let now = 1000;
    const cache = new InMemoryCache<string>('prompt', () => now);
    const key = buildCacheKey('prompt', ['p']);
    await cache.set(key, 'v', { ttlMs: 100 });

    now = 1050;
    const stillThere = await cache.has(key);
    expect(stillThere.ok && stillThere.value).toBe(true);
    now = 2000;
    const expired = await cache.get(key);
    expect(expired.ok && expired.value).toBeUndefined();
  });

  it('supports explicit and prefix invalidation', async () => {
    const cache = new InMemoryCache<number>('repository');
    const a = buildCacheKey('repository', ['commit-abc', 'a']);
    const b = buildCacheKey('repository', ['commit-abc', 'b']);
    await cache.set(a, 1);
    await cache.set(b, 2);

    await cache.invalidate(a);
    const hasA = await cache.has(a);
    expect(hasA.ok && hasA.value).toBe(false);

    await cache.invalidatePrefix('repository:');
    const hasB = await cache.has(b);
    expect(hasB.ok && hasB.value).toBe(false);
  });
});

describe('CacheSet', () => {
  it('provides one cache per tier and aggregates totals', async () => {
    const set = new CacheSet();
    const ast = set.tier<number>('ast');
    const ctx = set.tier<string>('context');
    await ast.get(buildCacheKey('ast', ['x'])); // miss
    await ast.set(buildCacheKey('ast', ['x']), 1);
    await ast.get(buildCacheKey('ast', ['x'])); // hit
    await ctx.get(buildCacheKey('context', ['y'])); // miss
    expect(set.totals()).toEqual({ hits: 1, misses: 2 });
  });
});

describe('Result helpers', () => {
  it('map transforms ok and passes through err', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    const e = err({ category: 'io', code: 'x', message: 'm' } as const);
    expect(map(e, (n: number) => n)).toBe(e);
  });

  it('unwrapOr returns fallback on error', () => {
    const e = err({ category: 'io', code: 'x', message: 'm' } as const);
    expect(unwrapOr(e, 99)).toBe(99);
  });
});
