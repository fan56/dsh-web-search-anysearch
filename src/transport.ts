/**
 * Stateless JSON-RPC transport for the AnySearch MCP endpoint. This mirrors
 * the official `anysearch_cli.js` reference (github.com/anysearch-ai/
 * anysearch-skill): one `POST` carrying a `tools/call` request per call — no
 * `initialize`, no session, one fresh connection per request. Raw
 * `node:http(s)` is deliberate: the official CLI uses it, and Node's undici
 * pool is known to hang on this endpoint when an SSE stream occupies a pooled
 * connection. `http:` is supported alongside `https:` so tests can run
 * against a local server.
 * @module @aiwayds/dsh-web-search-anysearch/transport
 */

import http from 'node:http'
import https from 'node:https'
import { WebError } from '@deepseek-ai/dsh-web'
import type { JsonRpcResponse } from './types.ts'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'dsh-web-search-anysearch/0.1.0'

/** Call options: endpoint, optional Bearer key, and lifecycle bounds. */
export interface AnysearchCallOptions {
  readonly endpoint: string
  /** Optional API key; omitted means anonymous access (lower rate limits). */
  readonly apiKey?: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

/**
 * Invoke one AnySearch tool and return its markdown text payload.
 *
 * @param tool - the tool name, e.g. `search`.
 * @param args - the tool arguments object.
 * @param options - endpoint, key, and cancellation/timeout bounds.
 * @returns the `text` item of the tool-result content.
 * @throws {@link WebError} `WEB_ABORTED` on cancellation, `WEB_PROVIDER_ERROR`
 *   on transport failure, non-2xx status, JSON-RPC error, or `isError` results.
 */
export async function callAnysearchTool(
  tool: string,
  args: Readonly<Record<string, unknown>>,
  options: AnysearchCallOptions,
): Promise<string> {
  const url = new URL(options.endpoint)
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  })
  const headers: Record<string, string | number> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'content-length': Buffer.byteLength(body),
    'user-agent': USER_AGENT,
    ...options.apiKey !== undefined && options.apiKey.length > 0
      ? { authorization: `Bearer ${options.apiKey}` }
      : {},
  }
  return new Promise<string>((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(aborted(options.signal))
      return
    }
    const lib = url.protocol === 'http:' ? http : https
    const request = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: options.timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolveResponse(text, response.statusCode ?? 0, resolve, reject, options.signal)
        })
      },
    )
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`AnySearch request timed out after ${options.timeoutMs}ms`))
    })
    if (options.signal !== undefined) {
      options.signal.addEventListener(
        'abort',
        () => request.destroy(new DOMException('The operation was aborted.', 'AbortError')),
        { once: true },
      )
    }
    request.on('error', (error) => {
      if (options.signal?.aborted === true || isAbortError(error)) reject(aborted(options.signal, error))
      else reject(new WebError(`AnySearch request failed: ${String(error.message ?? error)}`, 'WEB_PROVIDER_ERROR', { cause: error }))
    })
    request.end(body)
  })
}

/** Classify one completed HTTP response into a payload or a {@link WebError}. */
function resolveResponse(
  text: string,
  status: number,
  resolve: (value: string) => void,
  reject: (error: WebError) => void,
  signal?: AbortSignal,
): void {
  if (status >= 400) {
    reject(new WebError(`AnySearch API error (HTTP ${status}): ${excerpt(text)}`, 'WEB_PROVIDER_ERROR'))
    return
  }
  let parsed: JsonRpcResponse
  try {
    parsed = JSON.parse(text) as JsonRpcResponse
  } catch (error) {
    if (signal?.aborted === true) reject(aborted(signal, error))
    else reject(new WebError(`AnySearch returned an unprocessable response body: ${excerpt(text)}`, 'WEB_PROVIDER_ERROR', { cause: error }))
    return
  }
  if (parsed.error !== undefined) {
    const message = parsed.error.message ?? JSON.stringify(parsed.error)
    reject(new WebError(`AnySearch error: ${message}`, 'WEB_PROVIDER_ERROR'))
    return
  }
  const textItem = parsed.result?.content?.find((item) => item.type === 'text')
  if (textItem?.text !== undefined) {
    if (parsed.result?.isError === true) {
      reject(new WebError(`AnySearch error: ${excerpt(textItem.text)}`, 'WEB_PROVIDER_ERROR'))
      return
    }
    resolve(textItem.text)
    return
  }
  reject(new WebError('AnySearch returned no text content in the tool result', 'WEB_PROVIDER_ERROR'))
}

/** First ~300 chars of a payload, for error context only. */
function excerpt(text: string): string {
  return text.length > 300 ? text.slice(0, 300) : text
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function aborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('AnySearch search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for an abort-style failure. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
