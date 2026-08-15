/**
 * @ai-review/context-engine
 *
 * The most important module (ADR-0004). Build shared context once, share it by
 * handle, and serve minimal, budget-trimmed slices:
 *  - `DefaultContextEngine` — build/get/slice over an in-memory Context Store.
 *  - `extractFile`          — TypeScript/TSX AST extraction (imports, exports,
 *                             symbols with signatures + changed flags).
 *
 * A production Context Store (Redis/DB) implements the same access pattern
 * behind the handle without changing any caller.
 */

export { DefaultContextEngine } from './engine.js';
export type { BuildInput, SourceFile } from './engine.js';
export { extractFile } from './ast.js';
export type { ExtractedFile } from './ast.js';
