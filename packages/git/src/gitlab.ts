/**
 * GitLab provider (Phase 9) — first concrete `GitProvider`.
 *
 * Targets GitLab self-hosted via the REST v4 API. Implements every capability
 * the platform requires:
 *   Read MR · Read Diff · Read Discussions · Create/Reply/Resolve Discussion ·
 *   Approve MR · Pipeline Status.
 *
 * It depends only on the injectable `HttpClient`, so it is fully unit-tested
 * offline and swaps to real HTTP (`FetchHttpClient`) in production without any
 * change. Other providers (GitHub/Azure/Bitbucket) implement the same
 * `GitProvider` contract and register alongside it (ADR-0005).
 */

import type {
  AsyncResult,
  ChangeRequest,
  ChangeRequestRef,
  Discussion,
  GitProvider,
  GitProviderKind,
  PipelineStatus,
  PlatformError,
} from '@ai-review/core';
import type { HttpClient, HttpRequest } from './http.js';

export interface GitLabOptions {
  /** Base URL of the GitLab instance, e.g. https://gitlab.example.com */
  readonly baseUrl: string;
  /** Personal/project access token with `api` scope. */
  readonly token: string;
}

function providerError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): PlatformError {
  return { category: 'provider', code, message, ...(details ? { details } : {}) };
}

/** GitLab maps its own pipeline statuses onto our provider-agnostic enum. */
function mapPipelineStatus(raw: unknown): PipelineStatus {
  switch (raw) {
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'running':
      return 'running';
    case 'pending':
    case 'created':
    case 'scheduled':
      return 'pending';
    case 'canceled':
      return 'canceled';
    default:
      return 'unknown';
  }
}

export class GitLabProvider implements GitProvider {
  readonly kind: GitProviderKind = 'gitlab';
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    private readonly http: HttpClient,
    opts: GitLabOptions,
  ) {
    // Normalize: strip any trailing slash so path joins are predictable.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
  }

  /** Builds the project-scoped MR API prefix (project id is URL-encoded). */
  private mrPath(ref: ChangeRequestRef): string {
    const project = encodeURIComponent(ref.projectId);
    return `${this.baseUrl}/api/v4/projects/${project}/merge_requests/${encodeURIComponent(ref.id)}`;
  }

  private async call(
    method: HttpRequest['method'],
    url: string,
    body?: unknown,
  ): AsyncResult<unknown> {
    const res = await this.http.send({
      method,
      url,
      headers: { 'private-token': this.token },
      ...(body !== undefined ? { body } : {}),
    });
    if (!res.ok) return res;
    const { status, body: payload } = res.value;
    if (status < 200 || status >= 300) {
      return {
        ok: false,
        error: providerError('gitlab.http_error', `GitLab returned HTTP ${status}`, {
          status,
          url,
        }),
      };
    }
    return { ok: true, value: payload };
  }

  async getChangeRequest(ref: ChangeRequestRef): AsyncResult<ChangeRequest> {
    const res = await this.call('GET', this.mrPath(ref));
    if (!res.ok) return res;
    const mr = res.value as Record<string, unknown>;
    const state =
      mr['state'] === 'merged' ? 'merged' : mr['state'] === 'closed' ? 'closed' : 'open';
    return {
      ok: true,
      value: {
        ref,
        title: String(mr['title'] ?? ''),
        description: String(mr['description'] ?? ''),
        sourceBranch: String(mr['source_branch'] ?? ''),
        targetBranch: String(mr['target_branch'] ?? ''),
        author: String((mr['author'] as Record<string, unknown> | undefined)?.['username'] ?? ''),
        state,
      },
    };
  }

  async getDiff(ref: ChangeRequestRef): AsyncResult<string> {
    // GitLab returns per-file diffs; concatenate into one unified-diff string
    // that the platform's diff parser already understands.
    const res = await this.call('GET', `${this.mrPath(ref)}/diffs`);
    if (!res.ok) return res;
    const changes = Array.isArray(res.value) ? (res.value as Record<string, unknown>[]) : [];
    const parts: string[] = [];
    for (const change of changes) {
      const oldPath = String(change['old_path'] ?? '');
      const newPath = String(change['new_path'] ?? '');
      const diff = String(change['diff'] ?? '');
      parts.push(`diff --git a/${oldPath} b/${newPath}`);
      if (change['new_file']) parts.push('new file mode 100644');
      if (change['deleted_file']) parts.push('deleted file mode 100644');
      parts.push(`--- a/${oldPath}`, `+++ b/${newPath}`, diff.replace(/\n$/, ''));
    }
    return { ok: true, value: parts.join('\n') };
  }

  async listDiscussions(ref: ChangeRequestRef): AsyncResult<readonly Discussion[]> {
    // per_page=100 (GitLab's max) so a normal-sized MR's discussions come back
    // in one call — callers that dedupe against this list (the Publisher)
    // would otherwise silently miss earlier comments past the default ~20.
    const res = await this.call('GET', `${this.mrPath(ref)}/discussions?per_page=100`);
    if (!res.ok) return res;
    const raw = Array.isArray(res.value) ? (res.value as Record<string, unknown>[]) : [];
    const discussions: Discussion[] = raw.map((d) => {
      const notes = Array.isArray(d['notes']) ? (d['notes'] as Record<string, unknown>[]) : [];
      const first = notes[0] ?? {};
      const position = first['position'] as Record<string, unknown> | undefined;
      const resolved = notes.some((n) => n['resolvable'] === true && n['resolved'] === true);
      const location = position
        ? {
            file: String(position['new_path'] ?? position['old_path'] ?? ''),
            ...(position['new_line'] !== undefined ? { line: Number(position['new_line']) } : {}),
          }
        : undefined;
      return {
        id: String(d['id'] ?? ''),
        resolved,
        body: String(first['body'] ?? ''),
        ...(location ? { location } : {}),
      };
    });
    return { ok: true, value: discussions };
  }

  async createDiscussion(
    ref: ChangeRequestRef,
    body: string,
    location?: { readonly file: string; readonly line?: number },
  ): AsyncResult<Discussion> {
    // Inline (positioned) discussions require the MR diff refs; a plain
    // discussion just needs the body. We keep the positioned path optional so a
    // missing SHA cleanly degrades to an MR-level comment.
    const payload: Record<string, unknown> = { body };
    let positioned = false;
    if (location) {
      const mr = await this.getChangeRequest(ref);
      if (mr.ok) {
        // Diff refs live on the raw MR; fetch them for an accurate position.
        const rawMr = await this.call('GET', this.mrPath(ref));
        if (rawMr.ok) {
          const refs = (rawMr.value as Record<string, unknown>)['diff_refs'] as
            Record<string, unknown> | undefined;
          if (refs) {
            payload['position'] = {
              position_type: 'text',
              base_sha: refs['base_sha'],
              head_sha: refs['head_sha'],
              start_sha: refs['start_sha'],
              new_path: location.file,
              old_path: location.file,
              ...(location.line !== undefined ? { new_line: location.line } : {}),
            };
            positioned = true;
          }
        }
      }
    }
    let res = await this.call('POST', `${this.mrPath(ref)}/discussions`, payload);
    if (!res.ok && positioned) {
      // The line/position an LLM reports is frequently outside the actual diff
      // hunk (GitLab rejects that with 400). Rather than losing the finding
      // entirely, degrade to a plain (unpositioned) comment that still names
      // the file/line in the body.
      const where = `${location!.file}${location!.line !== undefined ? `:${location!.line}` : ''}`;
      res = await this.call('POST', `${this.mrPath(ref)}/discussions`, {
        body: `📍 \`${where}\`\n\n${body}`,
      });
    }
    if (!res.ok) return res;
    const d = res.value as Record<string, unknown>;
    const notes = Array.isArray(d['notes']) ? (d['notes'] as Record<string, unknown>[]) : [];
    return {
      ok: true,
      value: {
        id: String(d['id'] ?? ''),
        resolved: false,
        body: String(notes[0]?.['body'] ?? body),
        ...(location ? { location } : {}),
      },
    };
  }

  async replyDiscussion(
    ref: ChangeRequestRef,
    discussionId: string,
    body: string,
  ): AsyncResult<Discussion> {
    const res = await this.call(
      'POST',
      `${this.mrPath(ref)}/discussions/${encodeURIComponent(discussionId)}/notes`,
      { body },
    );
    if (!res.ok) return res;
    const note = res.value as Record<string, unknown>;
    return {
      ok: true,
      value: { id: discussionId, resolved: false, body: String(note['body'] ?? body) },
    };
  }

  async resolveDiscussion(ref: ChangeRequestRef, discussionId: string): AsyncResult<void> {
    const res = await this.call(
      'PUT',
      `${this.mrPath(ref)}/discussions/${encodeURIComponent(discussionId)}?resolved=true`,
    );
    if (!res.ok) return res;
    return { ok: true, value: undefined };
  }

  async approve(ref: ChangeRequestRef): AsyncResult<void> {
    const res = await this.call('POST', `${this.mrPath(ref)}/approve`);
    if (!res.ok) return res;
    return { ok: true, value: undefined };
  }

  async getPipelineStatus(ref: ChangeRequestRef): AsyncResult<PipelineStatus> {
    const res = await this.call('GET', `${this.mrPath(ref)}/pipelines`);
    if (!res.ok) return res;
    const pipelines = Array.isArray(res.value) ? (res.value as Record<string, unknown>[]) : [];
    // The first entry is the most recent pipeline for the MR.
    const latest = pipelines[0];
    return { ok: true, value: latest ? mapPipelineStatus(latest['status']) : 'unknown' };
  }
}
