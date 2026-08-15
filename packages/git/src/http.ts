/**
 * Minimal HTTP transport abstraction for git providers.
 *
 * Providers depend on this interface, never on `fetch` directly, so they are
 * fully testable offline with a fake transport (ADR-0002 dependency-inversion
 * style). `FetchHttpClient` is the production implementation backed by the
 * global `fetch`.
 */

import type { AsyncResult, PlatformError } from '@ai-review/core';

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** JSON body; serialized by the client. */
  readonly body?: unknown;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface HttpClient {
  send(req: HttpRequest): AsyncResult<HttpResponse>;
}

function httpError(code: string, message: string, cause?: unknown): PlatformError {
  return { category: 'provider', code, message, ...(cause !== undefined ? { cause } : {}) };
}

/** Production HTTP client backed by the global `fetch`. */
export class FetchHttpClient implements HttpClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(req: HttpRequest): AsyncResult<HttpResponse> {
    try {
      const res = await this.fetchImpl(req.url, {
        method: req.method,
        headers: {
          'content-type': 'application/json',
          ...req.headers,
        },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      });
      const text = await res.text();
      let body: unknown = undefined;
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text; // non-JSON response; pass through as text
        }
      }
      return { ok: true, value: { status: res.status, body } };
    } catch (cause) {
      return {
        ok: false,
        error: httpError('http.request_failed', `request to ${req.url} failed`, cause),
      };
    }
  }
}
