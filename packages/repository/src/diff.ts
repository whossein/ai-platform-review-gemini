/**
 * Unified-diff parser (Phase 7).
 *
 * A small, dependency-free parser for the subset of unified diff the platform
 * needs: per-file added/removed line sets with new-file line numbers. This is
 * the bridge between a raw diff and the Context Engine's "changed symbols"
 * detection — we only pay LLM tokens for what actually changed (ADR-0004).
 */

/** A single changed file within a diff. */
export interface ParsedFileDiff {
  /** New-side path (b/…), normalized without the `b/` prefix. */
  readonly path: string;
  /** Whether the file is newly added. */
  readonly added: boolean;
  /** Whether the file is deleted. */
  readonly deleted: boolean;
  /** New-file line numbers that were added (1-based). */
  readonly addedLines: readonly number[];
  /** The added lines' text, keyed by new-file line number. */
  readonly addedText: ReadonlyMap<number, string>;
}

/** Parses a unified diff into per-file change sets. */
export function parseUnifiedDiff(diff: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  let path = 'unknown';
  let added = false;
  let deleted = false;
  let addedLines: number[] = [];
  let addedText = new Map<number, string>();
  let newLineNo = 0;
  let started = false;

  const flush = (): void => {
    if (started) {
      files.push({ path, added, deleted, addedLines, addedText });
    }
  };

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git')) {
      flush();
      started = true;
      path = 'unknown';
      added = false;
      deleted = false;
      addedLines = [];
      addedText = new Map();
      newLineNo = 0;
      continue;
    }
    if (raw.startsWith('new file mode')) {
      added = true;
      continue;
    }
    if (raw.startsWith('deleted file mode')) {
      deleted = true;
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw
        .replace(/^\+\+\+\s+b\//, '')
        .replace(/^\+\+\+\s+/, '')
        .trim();
      if (p !== '/dev/null') path = p;
      // A `+++` without a preceding `diff --git` (bare diff) still starts a file.
      if (!started) {
        started = true;
        addedLines = [];
        addedText = new Map();
      }
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLineNo = Number(hunk[1]);
      continue;
    }
    if (!started) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      addedLines.push(newLineNo);
      addedText.set(newLineNo, raw.slice(1));
      newLineNo++;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // Removed line: does not advance the new-file counter.
    } else {
      // Context line advances the new-file counter.
      newLineNo++;
    }
  }
  flush();
  return files;
}
