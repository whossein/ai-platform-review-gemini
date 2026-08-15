/**
 * Memory store tests: scope isolation and scope-bound handles.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryMemoryStore } from './store.js';

describe('InMemoryMemoryStore', () => {
  it('stores and retrieves values within a scope', async () => {
    const store = new InMemoryMemoryStore();
    await store.set('review', 'k', { hello: 'world' });
    const got = await store.get<{ hello: string }>('review', 'k');
    expect(got.ok && got.value?.value.hello).toBe('world');
  });

  it('isolates scopes: the same key does not leak across scopes', async () => {
    const store = new InMemoryMemoryStore();
    await store.set('review', 'shared', 1);
    const org = await store.get('organization', 'shared');
    expect(org.ok && org.value).toBeUndefined();
  });

  it('lists keys by prefix in deterministic order', async () => {
    const store = new InMemoryMemoryStore();
    await store.set('repository', 'a.2', 1);
    await store.set('repository', 'a.1', 1);
    await store.set('repository', 'b.1', 1);
    const listed = await store.list('repository', 'a.');
    expect(listed.ok && listed.value).toEqual(['a.1', 'a.2']);
  });

  it('bindScope produces a handle confined to one scope', async () => {
    const store = new InMemoryMemoryStore();
    const handle = store.bindScope('session');
    expect(handle.scope).toBe('session');

    await handle.set('token', 'abc');
    const viaHandle = await handle.get<string>('token');
    expect(viaHandle.ok && viaHandle.value?.value).toBe('abc');

    // Written only into the session scope, not others.
    const other = await store.get('global', 'token');
    expect(other.ok && other.value).toBeUndefined();

    await handle.delete('token');
    const after = await handle.get('token');
    expect(after.ok && after.value).toBeUndefined();
  });
});
