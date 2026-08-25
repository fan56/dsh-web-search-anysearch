/**
 * `AnysearchSearchProvider`: a `WebSearchProvider` backed by the AnySearch
 * API for agents (`POST /mcp`, stateless JSON-RPC `tools/call`). The API
 * answers in structured markdown, which is parsed into citeable sources; if
 * the format drifts past parsing, the whole payload passes through as
 * `content` so results still reach the model. Authentication is optional —
 * anonymous access works with lower rate limits.
 * @module @aiwayds/dsh-web-search-anysearch/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { callAnysearchTool } from './transport.ts'
import type { AnysearchCallOptions } from './transport.ts'
import { parseSearchMarkdown } from './markdown.ts'

/** Stable id this provider registers under. */
export const ANYSEARCH_PROVIDER_ID = 'anysearch'

/** Default AnySearch endpoint (the MCP JSON-RPC surface the official CLI uses). */
export const ANYSEARCH_DEFAULT_ENDPOINT = 'https://api.anysearch.com/mcp'

/** AnySearch's hard cap on `max_results`. */
export const ANYSEARCH_API_MAX_RESULTS = 10

/** Default result count when a request carries no `maxResults`; matches dsh-tool-web's bound. */
export const ANYSEARCH_DEFAULT_MAX_RESULTS = 8

/** Default per-request timeout, aligned with the official CLI. */
export const ANYSEARCH_DEFAULT_TIMEOUT_MS = 30_000

/** Vertical routing domains accepted by the API's `search` tool. */
export const ANYSEARCH_DOMAINS = [
  'general', 'resource', 'social_media', 'finance', 'academic', 'legal',
  'health', 'business', 'security', 'ip', 'code', 'energy',
  'environment', 'agriculture', 'travel', 'film', 'gaming',
] as const

/** Vertical routing domain. */
export type AnysearchDomain = typeof ANYSEARCH_DOMAINS[number]

/** Signature of the transport this provider calls through (injectable for tests). */
export type AnysearchTransport = (tool: string, args: Readonly<Record<string, unknown>>, options: AnysearchCallOptions) => Promise<string>

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface AnysearchSearchProviderOptions {
  /** Literal AnySearch API key; when present it wins over {@link resolveApiKey}. */
  readonly apiKey?: string
  /** Resolve the current API key for one search; `undefined` means anonymous. */
  readonly resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by rate-limit diagnostics. */
  readonly apiKeyEnv?: CredentialRef
  /** JSON-RPC endpoint. */
  readonly endpoint: string
  /** Per-request timeout. */
  readonly timeoutMs: number
  /** Vertical routing domain; `general`/omitted means general web search. */
  readonly domain?: AnysearchDomain
  /** Default result count when a request carries no `maxResults`. */
  readonly maxResults?: number
  /** Transport function; defaults to the raw-HTTPS JSON-RPC client. */
  readonly transport?: AnysearchTransport
}

/** Clamp a result count to the API's accepted range. */
function clampMaxResults(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return Math.max(1, Math.min(ANYSEARCH_API_MAX_RESULTS, Math.trunc(value)))
}

/** The AnySearch-backed search provider. */
export class AnysearchSearchProvider implements WebSearchProvider {
  readonly id = ANYSEARCH_PROVIDER_ID

  /**
   * Options for the NEXT operation, snapshotted once at each operation's
   * entry so one search never mixes two credential/endpoint sections.
   */
  private readonly resolveOptions: () => AnysearchSearchProviderOptions

  constructor(resolveOptions: () => AnysearchSearchProviderOptions) {
    this.resolveOptions = resolveOptions
  }

  /**
   * Anonymous access is valid AnySearch usage, so availability depends only
   * on a parseable endpoint — a local check that never touches the network.
   */
  available(): boolean {
    return URL.canParse(this.resolveOptions().endpoint)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    if (signal?.aborted === true) throw aborted(signal)
    const apiKey = await this.resolveApiKey(options, signal)
    const args: Record<string, unknown> = {
      query: request.query,
      ...clampMaxResults(request.maxResults ?? options.maxResults) !== undefined
        ? { max_results: clampMaxResults(request.maxResults ?? options.maxResults) }
        : {},
      ...options.domain !== undefined && options.domain !== 'general' ? { domain: options.domain } : {},
    }
    const transport = options.transport ?? callAnysearchTool
    let markdown: string
    try {
      markdown = await transport('search', args, {
        endpoint: options.endpoint,
        ...apiKey !== undefined ? { apiKey } : {},
        timeoutMs: options.timeoutMs,
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error) {
      if (error instanceof WebError) {
        // Anonymous users hitting the quota get a pointer to the credential.
        if (apiKey === undefined && looksLikeRateLimit(error.message)) {
          const ref = options.apiKeyEnv ?? 'ANYSEARCH_API_KEY'
          throw new WebError(
            `${error.message} (anonymous access is rate-limited; store "${ref}" through the credentials service for higher limits)`,
            error.code,
            { cause: error },
          )
        }
        throw error
      }
      throw new WebError(`AnySearch search failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    const sources = parseSearchMarkdown(markdown)
    if (sources.length > 0) return { sources, truncated: false }
    // Format drift: nothing parseable — hand the whole payload to the model
    // instead of failing the search.
    return { content: markdown, sources: [], truncated: false }
  }

  /**
   * Resolve one operation's credential. AnySearch allows anonymous access,
   * so an unresolvable reference degrades to anonymous instead of failing.
   */
  private async resolveApiKey(options: AnysearchSearchProviderOptions, signal?: AbortSignal): Promise<string | undefined> {
    if (signal?.aborted === true) throw aborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    try {
      return await (options.resolveApiKey?.() ?? Promise.resolve(undefined))
    } catch (error: unknown) {
      if (signal?.aborted || isAbortError(error)) throw aborted(signal, error)
      // A broken credential plane must not take down anonymous search.
      return undefined
    }
  }
}

/** True when an error message reads like a rate/quota limit. */
function looksLikeRateLimit(message: string): boolean {
  return /rate.?limit|quota|too many requests/i.test(message)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function aborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('AnySearch search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
