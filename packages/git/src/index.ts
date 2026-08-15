/**
 * @ai-review/git
 *
 * Provider-agnostic git integration (Phase 9, ADR-0005):
 *  - `GitLabProvider` — first concrete provider (self-hosted REST v4),
 *    implementing read MR/diff/discussions, create/reply/resolve discussion,
 *    approve, and pipeline status.
 *  - `MapGitProviderRegistry` — dynamic provider registration by kind.
 *  - `ReviewPublisher` — maps adjudicated issues → inline discussions + summary.
 *  - `FetchHttpClient` — production HTTP transport (injectable for tests).
 *  - `parseGitLabMrUrl` — resolves an MR URL into a `ChangeRequestRef`.
 */

export type { HttpClient, HttpRequest, HttpResponse } from './http.js';
export { FetchHttpClient } from './http.js';
export { GitLabProvider, type GitLabOptions } from './gitlab.js';
export { MapGitProviderRegistry } from './registry.js';
export {
  ReviewPublisher,
  renderIssueComment,
  renderSummaryComment,
  type PublishOptions,
  type PublishResult,
} from './publisher.js';
export {
  parseGitLabMrUrl,
  gitlabBaseUrlFromMrUrl,
  parseGitHubPrUrl,
  parseChangeRequestUrl,
  baseUrlFromChangeRequestUrl,
} from './url.js';
