/**
 * GitLab provider + publisher tests (Phase 9).
 *
 * A `FakeHttpClient` simulates the GitLab REST API in-memory so the whole
 * integration is verified offline — every required capability plus the
 * publisher's issue → discussion mapping.
 */

import { describe, it, expect } from 'vitest';
import type {
  AdjudicatedIssue,
  AgentId,
  ChangeRequestRef,
  ContentHash,
  IssueId,
} from '@ai-review/core';
import type { HttpClient, HttpRequest, HttpResponse } from './http.js';
import { GitLabProvider } from './gitlab.js';
import { ReviewPublisher, renderSummaryComment } from './publisher.js';
import { parseGitLabMrUrl } from './url.js';
import type { AsyncResult } from '@ai-review/core';

const REF: ChangeRequestRef = { provider: 'gitlab', projectId: 'group/proj', id: '42' };

/** Records requests and replies with canned GitLab-shaped responses. */
class FakeHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly routes: (req: HttpRequest) => HttpResponse) {}
  async send(req: HttpRequest): AsyncResult<HttpResponse> {
    this.requests.push(req);
    return { ok: true, value: this.routes(req) };
  }
}

function makeIssue(over: Partial<AdjudicatedIssue> = {}): AdjudicatedIssue {
  return {
    id: 'issue.1' as IssueId,
    title: 'Hardcoded secret',
    description: 'A secret is committed.',
    severity: 'high',
    confidence: 0.9,
    reason: 'Secrets leak credentials.',
    location: { file: 'src/a.ts', line: 3 },
    references: [],
    category: 'security',
    producedBy: 'agent.security' as AgentId,
    fingerprint: 'abc' as ContentHash,
    accepted: true,
    adjudicationReason: 'high confidence',
    rankScore: 0.72,
    ...over,
  };
}

describe('parseGitLabMrUrl', () => {
  it('extracts namespace path and MR iid', () => {
    const ref = parseGitLabMrUrl('https://gitlab.example.com/group/sub/proj/-/merge_requests/42');
    expect(ref).toEqual({ provider: 'gitlab', projectId: 'group/sub/proj', id: '42' });
  });

  it('returns undefined for non-MR URLs', () => {
    expect(parseGitLabMrUrl('https://gitlab.example.com/group/proj')).toBeUndefined();
    expect(parseGitLabMrUrl('not a url')).toBeUndefined();
  });
});

describe('GitLabProvider', () => {
  it('reads an MR and maps state', async () => {
    const http = new FakeHttpClient(() => ({
      status: 200,
      body: {
        title: 'Add feature',
        description: 'desc',
        source_branch: 'feat',
        target_branch: 'main',
        state: 'opened',
        author: { username: 'alice' },
      },
    }));
    const provider = new GitLabProvider(http, { baseUrl: 'https://gl.test/', token: 't' });
    const res = await provider.getChangeRequest(REF);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.title).toBe('Add feature');
      expect(res.value.author).toBe('alice');
      expect(res.value.state).toBe('open');
    }
    // Token is sent as a private-token header, project id URL-encoded.
    expect(http.requests[0]?.headers?.['private-token']).toBe('t');
    expect(http.requests[0]?.url).toContain('group%2Fproj');
  });

  it('concatenates per-file diffs into a unified diff', async () => {
    const http = new FakeHttpClient(() => ({
      status: 200,
      body: [
        {
          old_path: 'src/a.ts',
          new_path: 'src/a.ts',
          new_file: false,
          diff: '@@ -1 +1,2 @@\n const a = 1;\n+const b = 2;\n',
        },
      ],
    }));
    const provider = new GitLabProvider(http, { baseUrl: 'https://gl.test', token: 't' });
    const res = await provider.getDiff(REF);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toContain('diff --git a/src/a.ts b/src/a.ts');
      expect(res.value).toContain('+const b = 2;');
    }
  });

  it('maps pipeline status from the latest pipeline', async () => {
    const http = new FakeHttpClient(() => ({ status: 200, body: [{ status: 'failed' }] }));
    const provider = new GitLabProvider(http, { baseUrl: 'https://gl.test', token: 't' });
    const res = await provider.getPipelineStatus(REF);
    expect(res.ok && res.value).toBe('failed');
  });

  it('surfaces HTTP errors as provider errors', async () => {
    const http = new FakeHttpClient(() => ({ status: 404, body: { message: '404 Not found' } }));
    const provider = new GitLabProvider(http, { baseUrl: 'https://gl.test', token: 't' });
    const res = await provider.getChangeRequest(REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('gitlab.http_error');
  });

  it('creates a reply and resolves a discussion (correct verbs/paths)', async () => {
    const http = new FakeHttpClient((req) => {
      if (req.method === 'POST' && req.url.endsWith('/notes')) {
        return { status: 201, body: { body: 'thanks' } };
      }
      return { status: 200, body: {} };
    });
    const provider = new GitLabProvider(http, { baseUrl: 'https://gl.test', token: 't' });

    const reply = await provider.replyDiscussion(REF, 'disc-1', 'thanks');
    expect(reply.ok).toBe(true);

    const resolve = await provider.resolveDiscussion(REF, 'disc-1');
    expect(resolve.ok).toBe(true);
    const resolveReq = http.requests.find((r) => r.url.includes('resolved=true'));
    expect(resolveReq?.method).toBe('PUT');
  });
});

describe('ReviewPublisher', () => {
  it('posts one inline discussion per accepted issue plus a summary', async () => {
    const created: string[] = [];
    const http = new FakeHttpClient((req) => {
      if (req.method === 'POST' && req.url.endsWith('/discussions')) {
        created.push(String((req.body as { body: string }).body));
        return { status: 201, body: { id: 'd1', notes: [{ body: 'x' }] } };
      }
      return { status: 200, body: { diff_refs: {} } };
    });
    const provider = new GitLabProvider(http, { baseUrl: 'https://gl.test', token: 't' });
    const publisher = new ReviewPublisher(provider);

    const issues = [makeIssue(), makeIssue({ accepted: false })]; // one accepted, one not
    const res = await publisher.publish(REF, issues);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.published).toBe(1); // only the accepted issue
      expect(res.value.blockingCount).toBe(1); // high severity
      expect(res.value.approved).toBe(false);
    }
    // 1 inline + 1 summary = 2 discussions.
    expect(created).toHaveLength(2);
    expect(created[created.length - 1]).toContain('AI Code Review');
  });

  it('approves when clean and asked to', async () => {
    let approved = false;
    const http = new FakeHttpClient((req) => {
      if (req.url.endsWith('/approve')) {
        approved = true;
        return { status: 201, body: {} };
      }
      return { status: 201, body: { id: 'd', notes: [] } };
    });
    const provider = new GitLabProvider(http, { baseUrl: 'https://gl.test', token: 't' });
    const publisher = new ReviewPublisher(provider);

    const res = await publisher.publish(REF, [makeIssue({ severity: 'low' })], {
      approveWhenClean: true,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.blockingCount).toBe(0);
      expect(res.value.approved).toBe(true);
    }
    expect(approved).toBe(true);
  });

  it('renders an empty summary when nothing is accepted', () => {
    expect(renderSummaryComment([])).toContain('No issues met the publish threshold');
  });
});
