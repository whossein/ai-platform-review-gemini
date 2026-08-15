/**
 * @ai-review/api — HTTP review server.
 *
 * A thin, dependency-free HTTP surface over the shared `@ai-review/orchestrator`
 * so the Web and Desktop UIs (and any external caller) can run the exact same
 * pipeline the CLI runs. Built on Node's `http` module to keep the platform
 * free of a web-framework dependency at this stage (ADR-0002: apps stay thin).
 *
 * Endpoints:
 *   GET  /health           → { status: 'ok' }
 *   POST /review           → run a review over a diff
 *        body: { diff: string, threshold?: number }
 *        200:  { markdown, json, accepted, total, issues, metrics }

 *
 * CORS is permissive by default so the local Web UI (a different origin/port)
 * can call it during development; lock this down behind a gateway in production.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runReview, plan, SPECIALISTS } from '@ai-review/orchestrator';

interface ReviewRequestBody {
  readonly diff?: string;
  readonly threshold?: number;
  readonly env?: Record<string, string>;
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    ...CORS_HEADERS,
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function handleEstimate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: ReviewRequestBody;
  try {
    body = JSON.parse((await readBody(req)) || '{}') as ReviewRequestBody;
  } catch {
    send(res, 400, { error: 'invalid JSON body' });
    return;
  }

  if (!body.diff || body.diff.trim().length === 0) {
    send(res, 400, { error: 'field "diff" is required' });
    return;
  }

  // Run the planner without LLM calls to see which agents will activate
  const reviewPlan = plan({
    diff: body.diff,
    specialists: SPECIALISTS,
    coveredCategories: [],
  });

  const selectedAgents = reviewPlan.selected.map(s => s.name);
  const skippedAgents = reviewPlan.skipped.map(s => s.spec.name);
  const agentCount = reviewPlan.selected.length;

  // Very rough heuristic for context tokens: characters / 4
  const inputTokensPerAgent = Math.ceil(body.diff.length / 4); 
  const totalInputTokens = inputTokensPerAgent * agentCount;
  
  // Generic average LLM cost assumption (e.g. $0.50 / 1M tokens)
  let estimatedCostUsd = (totalInputTokens / 1000000) * 0.50; 
  
  const envOverrides = body.env ?? {};
  const provider = envOverrides.AI_REVIEW_LLM_PROVIDER ?? 'gemini';
  
  if (provider === 'mock' || provider === 'ollama') {
    estimatedCostUsd = 0;
  }

  send(res, 200, {
    agents: selectedAgents,
    skipped: skippedAgents,
    totalAgents: agentCount,
    estimatedTokens: totalInputTokens,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(5)),
  });
}

async function handleReview(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: ReviewRequestBody;
  try {
    body = JSON.parse((await readBody(req)) || '{}') as ReviewRequestBody;
  } catch {
    send(res, 400, { error: 'invalid JSON body' });
    return;
  }

  if (!body.diff || body.diff.trim().length === 0) {
    send(res, 400, { error: 'field "diff" is required' });
    return;
  }

  const result = await runReview({
    diff: body.diff,
    ...(body.threshold !== undefined ? { confidenceThreshold: body.threshold } : {}),
  });

  send(res, 200, {
    markdown: result.markdown,
    json: JSON.parse(result.json),
    accepted: result.accepted,
    total: result.total,
    issues: result.issues,
    // Includes cacheHits/cacheMisses so callers can observe the LLM response
    // cache at work (re-post the same diff and watch cacheHits climb).
    metrics: result.metrics,
  });
}

export function createReviewServer(): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        send(res, 200, { status: 'ok' });
        return;
      }
      if (req.method === 'POST' && req.url === '/estimate') {
        await handleEstimate(req, res);
        return;
      }
      if (req.method === 'POST' && req.url === '/review') {
        await handleReview(req, res);
        return;
      }
      send(res, 404, { error: 'not found' });
    })().catch((err: unknown) => {
      send(res, 500, { error: err instanceof Error ? err.message : 'internal error' });
    });
  });
}
