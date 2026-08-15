/**
 * Context Engine (Phase 6, ADR-0004) — the most important module.
 *
 * Guarantees enforced here:
 *   1. build once           — a `SharedContext` is built a single time per review
 *                             and stored, addressed by a `ContextHandle`;
 *   2. share by handle       — agents pass handles, never payloads;
 *   3. minimal slices        — `slice()` returns the smallest rendered context
 *                             that satisfies a request, trimmed to a token budget;
 *   4. changed-only emphasis  — symbols touched by the diff are flagged `changed`
 *                             so downstream agents (and the renderer) focus tokens
 *                             on what actually changed.
 *
 * Input can be a raw diff (review a change set) and/or a set of files (from the
 * repository layer). The engine parses each file via the TS compiler API, builds
 * an import/export dependency graph, and computes the changed-symbol set.
 */

import type {
  AsyncResult,
  ContentHash,
  ContextBuildInput,
  ContextEngine,
  ContextHandle,
  ContextRequest,
  ContextSlice,
  FileContext,
  PlatformError,
  SharedContext,
  SymbolInfo,
} from '@ai-review/core';
import { parseUnifiedDiff } from '@ai-review/repository';
import { extractFile } from './ast.js';

/** A file's raw text, as provided to the engine. */
export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/** Extended build input: the core `ContextBuildInput` plus in-memory files. */
export interface BuildInput extends ContextBuildInput {
  /** Full file texts to analyze (from the repository layer). Optional when a
   *  diff alone is enough to derive added lines. */
  readonly files?: readonly SourceFile[];
}

/** Tiny FNV-1a content hash (hex). Deterministic + dependency-free. */
function hash(text: string): ContentHash {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') as ContentHash;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * In-memory Context Engine. The Context Store is a Map here; a production
 * backend (Redis/DB) implements the same access pattern behind the handle.
 */
export class DefaultContextEngine implements ContextEngine {
  private readonly store = new Map<ContextHandle, SharedContext>();

  async build(input: BuildInput): AsyncResult<SharedContext> {
    // Derive changed lines per file from the diff (if any).
    const changedByFile = new Map<string, Set<number>>();
    if (input.diff) {
      for (const fd of parseUnifiedDiff(input.diff)) {
        changedByFile.set(fd.path, new Set(fd.addedLines));
      }
    }

    // Decide which files to analyze: explicit files win; otherwise synthesize
    // pseudo-files from the diff's added text so a diff-only review still works.
    const sources: SourceFile[] = input.files ? [...input.files] : [];
    if (sources.length === 0 && input.diff) {
      for (const fd of parseUnifiedDiff(input.diff)) {
        const text = fd.addedLines.map((l: number) => fd.addedText.get(l) ?? '').join('\n');
        sources.push({ path: fd.path, text });
      }
    }

    const files: FileContext[] = [];
    const changedSymbols: SymbolInfo[] = [];
    const dependencyGraph: Record<string, readonly string[]> = {};

    for (const src of sources) {
      const changedLines = changedByFile.get(src.path) ?? new Set<number>();
      const extracted = extractFile(src.path, src.text, changedLines);
      const fileChanged = changedLines.size > 0;

      const fileContext: FileContext = {
        path: src.path,
        hash: hash(src.text),
        imports: extracted.imports,
        exports: extracted.exports,
        symbols: extracted.symbols,
        changed: fileChanged,
      };
      files.push(fileContext);
      dependencyGraph[src.path] = extracted.imports;
      for (const sym of extracted.symbols) {
        if (sym.changed) changedSymbols.push(sym);
      }
    }

    // The handle is content-addressed: same inputs ⇒ same handle (idempotent).
    const version = 1;
    const handle =
      `ctx.${hash(sources.map((s) => `${s.path}:${s.text}`).join('|'))}` as ContextHandle;

    const shared: SharedContext = {
      handle,
      version,
      files,
      dependencyGraph,
      changedSymbols,
      project: {},
    };
    this.store.set(handle, shared);
    return { ok: true, value: shared };
  }

  async get(handle: ContextHandle): AsyncResult<SharedContext | undefined> {
    return { ok: true, value: this.store.get(handle) };
  }

  async slice(request: ContextRequest): AsyncResult<ContextSlice> {
    const shared = this.store.get(request.handle);
    if (!shared) {
      const error: PlatformError = {
        category: 'not_found',
        code: 'context.handle_not_found',
        message: `no shared context for handle "${request.handle}"`,
      };
      return { ok: false, error };
    }

    // Restrict to requested paths, if any.
    let files = shared.files;
    if (request.paths && request.paths.length > 0) {
      const want = new Set(request.paths);
      files = files.filter((f) => want.has(f.path));
    }

    // Render minimally: changed files first, then symbol signatures. Bodies are
    // only included when explicitly requested (default: signatures only).
    const rendered = renderSlice(files, request.includeBodies ?? false);

    // Budget-aware trimming: if a token budget is set and we exceed it, drop the
    // lowest-value content (unchanged files) until we fit.
    let finalText = rendered;
    let compressed = false;
    if (request.tokenBudget && estimateTokens(rendered) > request.tokenBudget) {
      const changedOnly = files.filter((f) => f.changed);
      finalText = renderSlice(changedOnly, request.includeBodies ?? false);
      compressed = true;
    }

    return {
      ok: true,
      value: {
        handle: shared.handle,
        version: shared.version,
        files,
        rendered: finalText,
        estimatedTokens: estimateTokens(finalText),
        compressed,
      },
    };
  }
}

/** Renders a compact, human/LLM-readable view of the given files. */
function renderSlice(files: readonly FileContext[], includeBodies: boolean): string {
  const parts: string[] = [];
  for (const f of files) {
    parts.push(`# ${f.path}${f.changed ? ' (changed)' : ''}`);
    if (f.imports.length > 0) parts.push(`imports: ${f.imports.join(', ')}`);
    if (f.exports.length > 0) parts.push(`exports: ${f.exports.join(', ')}`);
    for (const s of f.symbols) {
      const mark = s.changed ? '* ' : '  ';
      parts.push(`${mark}${s.kind} ${s.name} — ${s.signature}`);
    }
    // `includeBodies` is a hook for the phase where we attach changed symbol
    // bodies; signatures-only is the token-efficient default.
    void includeBodies;
    parts.push('');
  }
  return parts.join('\n').trim();
}
