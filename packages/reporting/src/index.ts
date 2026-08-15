/**
 * @ai-review/reporting
 *
 * Pluggable report renderers (ADR-0002):
 *  - `MapReporterRegistry` — id/format-addressed renderer registry.
 *  - `MarkdownReporter`     — human-readable Markdown.
 *  - `JsonReporter`         — machine-readable JSON.
 *
 * GitLab-discussion and HTML renderers implement the same `Reporter` contract
 * and register without touching the pipeline.
 */

export { MapReporterRegistry, MarkdownReporter, JsonReporter } from './renderers.js';
