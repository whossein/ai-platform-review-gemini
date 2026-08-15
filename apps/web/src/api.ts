/**
 * Typed client for the @ai-review/api server. The Web and Desktop UIs share this
 * module so both speak to the exact same review pipeline. All calls go through
 * the `/api` prefix, which Vite proxies to the API server in dev (see
 * vite.config.ts) and which a reverse proxy handles in production.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReviewIssue {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: Severity;
  readonly confidence: number;
  readonly reason: string;
  readonly suggestion?: { readonly description: string };
  readonly location: { readonly file: string; readonly line?: number };
  readonly category: string;
  readonly accepted: boolean;
  readonly rankScore: number;
}

export interface ReviewResponse {
  readonly markdown: string;
  readonly json: unknown;
  readonly accepted: number;
  readonly total: number;
  readonly issues: readonly ReviewIssue[];
}

export interface EstimateResponse {
  readonly agents: readonly string[];
  readonly skipped: readonly string[];
  readonly totalAgents: number;
  readonly estimatedTokens: number;
  readonly estimatedCostUsd: number;
}

export async function requestEstimate(diff: string, env?: Record<string, string>): Promise<EstimateResponse> {
  const res = await fetch('/api/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ diff, ...(env ? { env } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `estimate failed (${res.status})`);
  }
  return (await res.json()) as EstimateResponse;
}

export async function requestReview(diff: string, threshold?: number, env?: Record<string, string>): Promise<ReviewResponse> {
  const res = await fetch('/api/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ diff, ...(threshold !== undefined ? { threshold } : {}), ...(env ? { env } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `review failed (${res.status})`);
  }
  return (await res.json()) as ReviewResponse;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch('/api/health');
    return res.ok;
  } catch {
    return false;
  }
}

export async function requestPublish(diff: string, issues: readonly ReviewIssue[], env?: Record<string, string>): Promise<unknown> {
  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ diff, issues, ...(env ? { env } : {}) }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `publish failed (${res.status})`);
  }
  return await res.json();
}

export async function requestApplyLocal(localPath: string, issues: readonly ReviewIssue[]): Promise<unknown> {
  const res = await fetch('/api/apply-local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localPath, issues }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `apply failed (${res.status})`);
  }
  return await res.json();
}
