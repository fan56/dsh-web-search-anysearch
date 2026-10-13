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

/** The credential reference the GUI row and the provider share when config names none. */
const DEFAULT_API_KEY_ENV = 'ANYSEARCH_API_KEY'

/** Environment variable overriding the JSON-RPC endpoint. */
const ENDPOINT_ENV = 'ANYSEARCH_ENDPOINT'

/**
 * A configuration field the loader hands over as a live reference. A `volatile`
 * field is read through `get()` so a settings write applies to the next read;
 * a plain object (a unit test, a direct caller) carries the value itself.
 */
export interface LiveConfigField<T> {
  get(): T
}

/**
 * Plugin config as a configuration layer states it (all optional — the schema fills the rest).
 * `apiKeyEnv` is volatile, so `apply` receives it as a live reference: that shape
 * is {@link RunningConfig}, which is what the loader hands over and what the
 * tests construct through the schema.
 */
export interface Config {
  /**
   * Literal AnySearch API key; prefer {@link apiKeyEnv} so no secret enters
   * configuration files. Not volatile on purpose: a literal key is the fallback
   * for deployments without a credentials service, it is read once when the
   * plugin activates, and the credential *reference* is the route a settings
   * edit is meant to move.
   */
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

/**
 * The config `apply` receives. `apiKeyEnv` is volatile — it rides the entry's
 * settings form, which is how the Plugins row page reads the accepted reference
 * back — so the loader hands that one field over as a live reference
 * ({@link LiveConfigField}) rather than the plain string a configuration file
 * states.
 */
export interface RunningConfig extends Omit<Config, 'apiKeyEnv'> {
  apiKeyEnv?: string | LiveConfigField<string>
}

/**
 * The plugin's Config schema: `z<Input, Output>` — schemastery's first parameter
 * is what the schema accepts, the second what it emits (`Schema<S, T, Mode>`,
 * whose call signature is `(data?: S) => SchemaOutput<T, Mode>`). So this pins
 * the schema to accepting what a configuration layer states and emitting what
 * `apply` receives.
 *
 * The order is not assumed, it is forced: a volatile field's output is
 * `Volatile<string>`, which is assignable to `RunningConfig.apiKeyEnv` but not to
 * `Config.apiKeyEnv`, so a reversed binding would not compile at all. The pin
 * bites in the other direction too — dropping the live-reference union from
 * `RunningConfig` (or adding a field the schema does not emit) is a type error.
 */
export const Config: z<Config, RunningConfig> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  endpoint: z.string(),
  timeoutMs: z.number().step(1).min(1000),
  domain: z.union(ANYSEARCH_DOMAINS),
  maxResults: z.number().step(1).min(1).max(10),
})

/**
 * Read the credential-reference field. The loader hands a volatile field over as
 * a live reference, whose value a settings write can change between searches; a
 * plain string (a direct caller, a configuration layer read outside the loader)
 * passes through. Deliberately not generic: the structural read is sound for
 * this one field, and the schema rejects every other type before `apply` sees it.
 * `null` is tolerated for untyped callers even though the schema never emits it.
 */
function liveValue(field: string | LiveConfigField<string> | null | undefined): string | undefined {
  if (field === undefined || field === null) return undefined
  return typeof field === 'string' ? field : field.get()
}

/**
 * Project one resolved config into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 */
function resolveOptions(ctx: Context, config: RunningConfig): AnysearchSearchProviderOptions {
  // A blank or whitespace-only reference is not a name the provider could
  // resolve. The row page treats such a value as absent, so this half does too —
  // otherwise the GUI would manage the default while every search threw.
  const named = liveValue(config.apiKeyEnv)?.trim() ?? ''
  const ref = credentialRef(named.length > 0 ? named : DEFAULT_API_KEY_ENV)
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

/**
 * Register the AnySearch search provider with `ctx.web`. Options are projected
 * through a thunk, so a re-pointed `apiKeyEnv` (the reference is volatile) is
 * picked up by the next search without re-registering the provider.
 */
export function apply(ctx: Context, config: RunningConfig): void {
  ctx.web.registerSearchProvider(new AnysearchSearchProvider(() => resolveOptions(ctx, config)))
}
