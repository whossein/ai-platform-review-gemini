/**
 * Local filesystem repository (Phase 7).
 *
 * A `Repository` backed by a directory on disk. Reads files, lists files with
 * simple glob-ish filtering, and exposes an optional diff. This is the concrete
 * backing for the `local_folder` input method; git-clone and provider-API
 * backings implement the same contract and drop in without caller changes.
 *
 * Safety: all paths are resolved and confined to the repository root — a read
 * that escapes the root (via `..` or an absolute path) is refused.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type {
  AsyncResult,
  Repository,
  RepositoryFile,
  RepositoryId,
  PlatformError,
} from '@ai-review/core';

/** Directories never worth scanning for a review. */
const DEFAULT_IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

/** Extensions the platform currently understands (React/Next/TS focus). */
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

function ioError(code: string, message: string, cause?: unknown): PlatformError {
  return { category: 'io', code, message, ...(cause !== undefined ? { cause } : {}) };
}

export interface LocalRepositoryOptions {
  /** Extensions to include when listing (defaults to the JS/TS family). */
  readonly extensions?: readonly string[];
  /** Directory names to skip. */
  readonly ignore?: ReadonlySet<string>;
  /** Optional precomputed diff to expose via `getDiff()`. */
  readonly diff?: string;
}

export class LocalFolderRepository implements Repository {
  readonly id: RepositoryId;
  private readonly root: string;
  private readonly extensions: readonly string[];
  private readonly ignore: ReadonlySet<string>;
  private readonly diff: string | undefined;

  constructor(root: string, id?: RepositoryId, opts: LocalRepositoryOptions = {}) {
    this.root = resolve(root);
    this.id = id ?? (this.root as RepositoryId);
    this.extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
    this.ignore = opts.ignore ?? DEFAULT_IGNORE;
    this.diff = opts.diff;
  }

  /** Resolves a repo-relative path and refuses anything outside the root. */
  private safeResolve(path: string): string | undefined {
    const abs = resolve(this.root, path);
    const rel = relative(this.root, abs);
    // Refuse the root itself and any path that climbs above it.
    if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) return undefined;
    return abs;
  }

  async readFile(path: string): AsyncResult<string> {
    const abs = this.safeResolve(path);
    if (!abs) {
      return {
        ok: false,
        error: ioError('repo.path_escape', `path escapes repository root: "${path}"`),
      };
    }
    try {
      const content = await readFile(abs, 'utf8');
      return { ok: true, value: content };
    } catch (cause) {
      return { ok: false, error: ioError('repo.read_failed', `failed to read "${path}"`, cause) };
    }
  }

  async listFiles(globs?: readonly string[]): AsyncResult<readonly RepositoryFile[]> {
    try {
      const files: RepositoryFile[] = [];
      await this.walk(this.root, files);
      const filtered =
        globs && globs.length > 0 ? files.filter((f) => matchesAny(f.path, globs)) : files;
      // Deterministic order for stable snapshots/tests.
      filtered.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return { ok: true, value: filtered };
    } catch (cause) {
      return {
        ok: false,
        error: ioError('repo.list_failed', 'failed to list repository files', cause),
      };
    }
  }

  private async walk(dir: string, out: RepositoryFile[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (this.ignore.has(entry.name)) continue;
        await this.walk(join(dir, entry.name), out);
      } else if (entry.isFile()) {
        if (!this.extensions.some((ext) => entry.name.endsWith(ext))) continue;
        const abs = join(dir, entry.name);
        const info = await stat(abs);
        out.push({ path: relative(this.root, abs), size: info.size });
      }
    }
  }

  async getDiff(): AsyncResult<string | undefined> {
    return { ok: true, value: this.diff };
  }
}

/** Very small glob matcher: supports `*` and `**` segment wildcards. */
function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // `**/` matches zero or more leading path segments (so `**/*.ts` also
    // matches a top-level `foo.ts`); a bare `**` matches anything.
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${escaped}$`);
}
