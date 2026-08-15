import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createReviewServer } from './server.js';

let baseUrl: string;
let server: ReturnType<typeof createReviewServer>;

beforeAll(async () => {
  server = createReviewServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

const DIFF = `diff --git a/src/UserList.tsx b/src/UserList.tsx
--- a/src/UserList.tsx
+++ b/src/UserList.tsx
@@ -1,1 +1,2 @@
+const API_KEY = "sk-live-abcdef123456";
`;

describe('review API', () => {
  it('reports healthy', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('rejects a request with no diff', async () => {
    const res = await fetch(`${baseUrl}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('runs a review and returns structured issues', async () => {
    const res = await fetch(`${baseUrl}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ diff: DIFF }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      markdown: string;
      total: number;
      issues: unknown[];
    };
    expect(typeof body.markdown).toBe('string');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(0);
  });

  it('404s unknown routes', async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
  });
});
