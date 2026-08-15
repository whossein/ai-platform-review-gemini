#!/usr/bin/env node
/**
 * @ai-review/api — entry point.
 *
 * Boots the HTTP review server. Port is configurable via AI_REVIEW_API_PORT
 * (default 8787). The server exposes the shared review pipeline over HTTP so the
 * Web and Desktop UIs can consume it.
 */

import { loadDotEnv } from '@ai-review/shared';
import { createReviewServer } from './server.js';

// Load a nearby .env into process.env before reading any config (LLM provider,
// GitLab, port). No-op when absent; real env vars always win.
loadDotEnv();

const port = Number(process.env['AI_REVIEW_API_PORT'] ?? 8787);

createReviewServer().listen(port, () => {
  process.stdout.write(`ai-review API listening on http://localhost:${port}\n`);
  process.stdout.write(`  GET  /health\n  POST /review  { "diff": "..." }\n`);
});

export { createReviewServer };
