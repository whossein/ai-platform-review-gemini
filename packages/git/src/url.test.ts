/**
 * Change-request URL parsing tests.
 *
 * Covers the provider-agnostic `--pr`/`--mr` resolution: GitLab MR URLs and
 * GitHub PR URLs (including Enterprise hosts and subgroup namespaces).
 */

import { describe, it, expect } from 'vitest';
import {
  parseGitLabMrUrl,
  parseGitHubPrUrl,
  parseChangeRequestUrl,
  baseUrlFromChangeRequestUrl,
} from './url.js';

describe('parseGitLabMrUrl', () => {
  it('parses a self-hosted MR URL with a subgroup namespace', () => {
    const ref = parseGitLabMrUrl(
      'https://git.acme.internal:8443/group/sub/app/-/merge_requests/42',
    );
    expect(ref).toEqual({ provider: 'gitlab', projectId: 'group/sub/app', id: '42' });
  });

  it('returns undefined for a non-MR URL', () => {
    expect(parseGitLabMrUrl('https://gitlab.com/group/app/-/issues/1')).toBeUndefined();
  });
});

describe('parseGitHubPrUrl', () => {
  it('parses a github.com PR URL', () => {
    const ref = parseGitHubPrUrl('https://github.com/owner/repo/pull/123');
    expect(ref).toEqual({ provider: 'github', projectId: 'owner/repo', id: '123' });
  });

  it('parses a GitHub Enterprise PR URL (any host)', () => {
    const ref = parseGitHubPrUrl('https://github.enterprise.corp/team/service/pull/7/files');
    expect(ref).toEqual({ provider: 'github', projectId: 'team/service', id: '7' });
  });

  it('returns undefined for a non-PR URL', () => {
    expect(parseGitHubPrUrl('https://github.com/owner/repo/issues/9')).toBeUndefined();
  });
});

describe('parseChangeRequestUrl', () => {
  it('dispatches GitLab MR URLs to the GitLab parser', () => {
    expect(parseChangeRequestUrl('https://gitlab.com/g/p/-/merge_requests/5')?.provider).toBe(
      'gitlab',
    );
  });

  it('dispatches GitHub PR URLs to the GitHub parser', () => {
    expect(parseChangeRequestUrl('https://github.com/o/r/pull/5')?.provider).toBe('github');
  });

  it('returns undefined for an unrecognized URL', () => {
    expect(parseChangeRequestUrl('https://example.com/whatever')).toBeUndefined();
  });
});

describe('baseUrlFromChangeRequestUrl', () => {
  it('extracts the origin including a non-default port', () => {
    expect(
      baseUrlFromChangeRequestUrl('https://git.acme.internal:8443/g/p/-/merge_requests/1'),
    ).toBe('https://git.acme.internal:8443');
  });
});
