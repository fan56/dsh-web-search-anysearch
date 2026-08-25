/**
 * `@aiwayds/dsh-web-search-anysearch`: registers an AnySearch-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): a search provider does not own the `ctx.web` key —
 * it registers INTO the seam's provider registry, exactly as
 * `@deepseek-ai/dsh-web-search-exa` does. The key is owned by
 * `@deepseek-ai/dsh-web`.
 *
 * @module @aiwayds/dsh-web-search-anysearch
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-web'
import {
  ANYSEARCH_DEFAULT_ENDPOINT,
  ANYSEARCH_DEFAULT_MAX_RESULTS,
  ANYSEARCH_DEFAULT_TIMEOUT_MS,
  ANYSEARCH_DOMAINS,
  AnysearchSearchProvider,
} from './provider.ts'
import type { AnysearchDomain, AnysearchSearchProviderOptions } from './provider.ts'

export {
  ANYSEARCH_API_MAX_RESULTS,
  ANYSEARCH_DEFAULT_ENDPOINT,
  ANYSEARCH_DEFAULT_MAX_RESULTS,
  ANYSEARCH_DEFAULT_TIMEOUT_MS,
  ANYSEARCH_DOMAINS,
  ANYSEARCH_PROVIDER_ID,
  AnysearchSearchProvider,
} from './provider.ts'
export type { AnysearchDomain, AnysearchSearchProviderOptions, AnysearchTransport } from './provider.ts'
export { parseSearchMarkdown } from './markdown.ts'
export { callAnysearchTool } from './transport.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-anysearch'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'ANYSEARCH_API_KEY'

/** Environment variable overriding the JSON-RPC endpoint. */
const ENDPOINT_ENV = 'ANYSEARCH_ENDPOINT'

/** Plugin config (all optional — `apply` fills credential, env-var, and constant defaults). */
export interface Config {
  /** Literal AnySearch API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `ANYSEARCH_API_KEY`. */
  apiKeyEnv?: string
  /** JSON-RPC endpoint. Defaults to the public API. */
  endpoint?: string
  /** Per-request timeout (ms). Defaults to 30000. */
  timeoutMs?: number
  /** Vertical routing domain. Defaults to general web search. */
  domain?: AnysearchDomain
  /** Default result count when a request carries no `maxResults`. Defaults to 8. */
  maxResults?: number
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  endpoint: z.string(),
  timeoutMs: z.number().step(1).min(1000),
  domain: z.union(ANYSEARCH_DOMAINS),
  maxResults: z.number().step(1).min(1).max(10),
})

/**
 * Project one resolved config into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 */
function resolveOptions(ctx: Context, config: Config): AnysearchSearchProviderOptions {
  const ref = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv: ref,
    endpoint: config.endpoint
      ?? launchEnvironmentOf(ctx).get(ENDPOINT_ENV)?.value
      ?? ANYSEARCH_DEFAULT_ENDPOINT,
    timeoutMs: config.timeoutMs ?? ANYSEARCH_DEFAULT_TIMEOUT_MS,
    ...config.domain !== undefined ? { domain: config.domain } : {},
    maxResults: config.maxResults ?? ANYSEARCH_DEFAULT_MAX_RESULTS,
  }
}

/** Register the AnySearch search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new AnysearchSearchProvider(() => resolveOptions(ctx, config)))
}
