import { describe, it, expect } from 'vitest';
import type {
  AdjudicatedIssue,
  AgentId,
  ContentHash,
  IssueId,
  ReviewId,
  ReviewSnapshot,
  SnapshotId,
  SymbolFingerprint,
} from '@ai-review/core';
import { InMemorySnapshotStore } from './snapshots.js';

function fp(file: string, symbol: string, hash: string): SymbolFingerprint {
  return { file, symbol, hash: hash as ContentHash };
}

function issue(file: string, title: string): AdjudicatedIssue {
  return {
    id: `${file}:${title}` as IssueId,
    title,
    description: title,
    severity: 'medium',
    confidence: 0.8,
    reason: 'because',
    location: { file },
    references: [],
    category: 'code',
    producedBy: 'react' as AgentId,
    fingerprint: `${file}:${title}` as ContentHash,
    accepted: true,
    adjudicationReason: 'ok',
    rankScore: 1,
  };
}

function snapshot(
  id: string,
  reviewId: string,
  fingerprints: SymbolFingerprint[],
  issues: AdjudicatedIssue[],
): ReviewSnapshot {
  return {
    id: id as SnapshotId,
    reviewId: reviewId as ReviewId,
    createdAt: '2024-01-01T00:00:00.000Z' as ReviewSnapshot['createdAt'],
    contextVersion: 1,
    issues,
    fingerprints,
  };
}

describe('InMemorySnapshotStore', () => {
  it('treats everything as changed on the first review (no base)', async () => {
    const store = new InMemorySnapshotStore();
    const next = [fp('a.ts', 'foo', 'h1'), fp('b.ts', 'bar', 'h2')];
    const d = store.diffDetailed(undefined, next);
    expect(d.changed).toHaveLength(2);
    expect(d.unchanged).toHaveLength(0);
  });

  it('re-reviews only changed symbols and carries forward the rest', async () => {
    const store = new InMemorySnapshotStore();
    const base = snapshot(
      'snap-1',
      'repo:proj',
      [fp('a.ts', 'foo', 'h1'), fp('b.ts', 'bar', 'h2')],
      [issue('a.ts', 'issue in foo'), issue('b.ts', 'issue in bar')],
    );
    await store.save(base);

    // b.ts changed, a.ts unchanged.
    const next = [fp('a.ts', 'foo', 'h1'), fp('b.ts', 'bar', 'h2-modified')];
    const d = store.diffDetailed('snap-1' as SnapshotId, next);

    expect(d.changed.map((f) => f.file)).toEqual(['b.ts']);
    expect(d.unchanged.map((f) => f.file)).toEqual(['a.ts']);

    // Findings for the unchanged file are reused for free.
    const carried = store.carryForward('snap-1' as SnapshotId, d.unchanged);
    expect(carried).toHaveLength(1);
    expect(carried[0]!.location.file).toBe('a.ts');
  });

  it('detects removed symbols', async () => {
    const store = new InMemorySnapshotStore();
    await store.save(
      snapshot('snap-2', 'repo:proj2', [fp('a.ts', 'foo', 'h1'), fp('gone.ts', 'x', 'h9')], []),
    );
    const d = store.diffDetailed('snap-2' as SnapshotId, [fp('a.ts', 'foo', 'h1')]);
    expect(d.removed.map((f) => f.file)).toEqual(['gone.ts']);
  });

  it('exposes the contract diff() returning only changed fingerprints', async () => {
    const store = new InMemorySnapshotStore();
    await store.save(snapshot('snap-3', 'repo:p3', [fp('a.ts', 'foo', 'h1')], []));
    const res = await store.diff('snap-3' as SnapshotId, [fp('a.ts', 'foo', 'changed')]);
    expect(res.ok && res.value).toHaveLength(1);
  });

  it('getLatest returns the most recent snapshot for a scope', async () => {
    const store = new InMemorySnapshotStore();
    await store.save(snapshot('s1', 'repo:p', [], []));
    await store.save(snapshot('s2', 'repo:p', [], []));
    const latest = await store.getLatest('repo:p');
    expect(latest.ok && latest.value?.id).toBe('s2');
  });
});
