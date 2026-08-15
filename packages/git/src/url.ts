/**
 * Merge/Pull request URL parsing.
 *
 * Resolves the `merge_request_url` / `pull_request_url` input methods into a
 * provider-agnostic `ChangeRequestRef`. GitLab today; the same function grows
 * GitHub/Azure/Bitbucket branches without changing callers.
 */

import type { ChangeRequestRef } from '@ai-review/core';

/**
 * Parses a GitLab MR URL into a `ChangeRequestRef`.
 *
 * Example:
 *   https://gitlab.example.com/group/sub/project/-/merge_requests/42
 *   → { provider: 'gitlab', projectId: 'group/sub/project', id: '42' }
 *
 * GitLab project ids are the full namespace path (URL-encoded when calling the
 * API), so we keep the path as-is here.
 */
export function parseGitLabMrUrl(url: string): ChangeRequestRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // Path looks like: /<namespace/path>/-/merge_requests/<iid>
  const marker = '/-/merge_requests/';
  const idx = parsed.pathname.indexOf(marker);
  if (idx === -1) return undefined;

  const projectId = parsed.pathname.slice(1, idx);
  const rest = parsed.pathname.slice(idx + marker.length);
  const id = rest.split('/')[0] ?? '';
  if (!projectId || !id) return undefined;

  return { provider: 'gitlab', projectId, id };
}

/**
 * Extracts the GitLab instance base URL (origin) from an MR URL.
 *
 * This is what makes **self-hosted** GitLab work with zero extra configuration:
 * given any internal URL (any host, port, or scheme), the API base is derived
 * automatically, so the caller only needs to supply an access token.
 *
 * Example:
 *   https://git.company.internal:8443/team/app/-/merge_requests/7
 *   → https://git.company.internal:8443
 */
export function gitlabBaseUrlFromMrUrl(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Parses a GitHub pull-request URL into a `ChangeRequestRef`.
 *
 * Example:
 *   https://github.com/owner/repo/pull/123
 *   → { provider: 'github', projectId: 'owner/repo', id: '123' }
 *
 * Also works for GitHub Enterprise (any host) since we only match on the
 * `/pull/<number>` path segment, not the origin.
 */
export function parseGitHubPrUrl(url: string): ChangeRequestRef | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // Path looks like: /<owner>/<repo>/pull/<number>
  const match = /^\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(parsed.pathname);
  if (!match) return undefined;
  const [, projectId, id] = match;
  if (!projectId || !id) return undefined;
  return { provider: 'github', projectId, id };
}

/**
 * Resolves any supported change-request URL (GitLab MR or GitHub PR) into a
 * provider-agnostic `ChangeRequestRef`, so callers accept one flag for both.
 * Azure DevOps / Bitbucket branches slot in here without changing callers.
 */
export function parseChangeRequestUrl(url: string): ChangeRequestRef | undefined {
  return parseGitLabMrUrl(url) ?? parseGitHubPrUrl(url);
}

/** Extracts the instance base URL (origin) from any change-request URL. */
export function baseUrlFromChangeRequestUrl(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
