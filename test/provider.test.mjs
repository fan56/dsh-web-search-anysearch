/**
 * Provider tests with an injected fake transport: argument shaping, anonymous
 * vs keyed access, markdown mapping with content fallback, rate-limit hints,
 * and the cancellation contract.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { WebError } from '@deepseek-ai/dsh-web'
import { AnysearchSearchProvider } from '../lib/provider.js'

const MARKDOWN = [
  '## Search Results (2 results, 100ms)',
  '',
  '### 1. First',
  '- **URL**: https://first.example/',
  '- first snippet',
  '',
  '### 2. Second',
  '- **URL**: https://second.example/',
  '- second snippet',
].join('\n')

const OPTIONS = {
  endpoint: 'https://api.anysearch.com/mcp',
  timeoutMs: 30_000,
  maxResults: 8,
}

/** Build a provider whose transport records calls and replies with `reply`. */
function newProvider({ reply = MARKDOWN, transportError, options = {} } = {}) {
  const calls = []
  const transport = async (tool, args, callOptions) => {
    calls.push({ tool, args, callOptions })
    if (transportError !== undefined) throw transportError
    return reply
  }
  const provider = new AnysearchSearchProvider(() => ({ ...OPTIONS, transport, ...options }))
  return { provider, calls }
}

test('available() depends only on the endpoint (anonymous is valid usage)', () => {
  assert.equal(newProvider().provider.available(), true)
  assert.equal(
    new AnysearchSearchProvider(() => ({ ...OPTIONS, transport: async () => '' })).available(),
    true,
  )
  assert.equal(
    new AnysearchSearchProvider(() => ({ ...OPTIONS, endpoint: 'not a url', transport: async () => '' })).available(),
    false,
  )
})

test('search() parses the markdown payload into sources', async () => {
  const { provider, calls } = newProvider()
  const result = await provider.search({ query: 'q', maxResults: 5 })
  assert.deepEqual(result.sources.map(s => s.url), ['https://first.example/', 'https://second.example/'])
  assert.equal(result.sources[0].title, 'First')
  assert.equal(result.sources[0].snippet, 'first snippet')
  assert.equal(result.truncated, false)
  assert.equal(calls[0].tool, 'search')
  assert.deepEqual(calls[0].args, { query: 'q', max_results: 5 })
})

test('search() clamps max_results to 10 and defaults from config', async () => {
  const a = newProvider()
  await a.provider.search({ query: 'q', maxResults: 99 })
  const b = newProvider()
  await b.provider.search({ query: 'q' })
  assert.equal(a.calls[0].args.max_results, 10)
  assert.equal(b.calls[0].args.max_results, 8)
})

test('search() routes vertical domains and omits general', async () => {
  const general = newProvider()
  await general.provider.search({ query: 'q' })
  assert.equal('domain' in general.calls[0].args, false)

  const vertical = newProvider({ options: { domain: 'academic' } })
  await vertical.provider.search({ query: 'q' })
  assert.equal(vertical.calls[0].args.domain, 'academic')
})

test('search() passes the resolved key through, or none when anonymous', async () => {
  const keyed = newProvider({ options: { resolveApiKey: async () => 'k' } })
  await keyed.provider.search({ query: 'q' })
  assert.equal(keyed.calls[0].callOptions.apiKey, 'k')
  assert.equal(keyed.calls[0].callOptions.endpoint, OPTIONS.endpoint)

  const literal = newProvider({ options: { apiKey: 'literal' } })
  await literal.provider.search({ query: 'q' })
  assert.equal(literal.calls[0].callOptions.apiKey, 'literal')

  const anonymous = newProvider()
  await anonymous.provider.search({ query: 'q' })
  assert.equal('apiKey' in anonymous.calls[0].callOptions, false)
})

test('search() degrades unparseable payloads to content passthrough', async () => {
  const { provider } = newProvider({ reply: 'totally unstructured prose' })
  const result = await provider.search({ query: 'q' })
  assert.equal(result.content, 'totally unstructured prose')
  assert.deepEqual(result.sources, [])
  assert.equal(result.truncated, false)
})

test('search() appends a credential hint only for anonymous rate-limit errors', async () => {
  const limited = new WebError('AnySearch API error (HTTP 429): rate limited', 'WEB_PROVIDER_ERROR')
  const anonymous = newProvider({ transportError: limited })
  await assert.rejects(
    anonymous.provider.search({ query: 'q' }),
    (e) => e.message.includes('ANYSEARCH_API_KEY') && e.message.includes('anonymous'),
  )

  const keyed = newProvider({ transportError: limited, options: { resolveApiKey: async () => 'k' } })
  await assert.rejects(
    keyed.provider.search({ query: 'q' }),
    (e) => !e.message.includes('ANYSEARCH_API_KEY') && e.code === 'WEB_PROVIDER_ERROR',
  )
})

test('search() wraps non-WebError transport failures', async () => {
  const { provider } = newProvider({ transportError: new Error('ECONNRESET') })
  await assert.rejects(
    provider.search({ query: 'q' }),
    (e) => e instanceof WebError && e.code === 'WEB_PROVIDER_ERROR' && e.message.includes('ECONNRESET'),
  )
})

test('search() throws WEB_ABORTED on a pre-aborted signal without calling the transport', async () => {
  const { provider, calls } = newProvider()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    provider.search({ query: 'q' }, controller.signal),
    (e) => e instanceof WebError && e.code === 'WEB_ABORTED',
  )
  assert.equal(calls.length, 0)
})

test('search() survives a broken credential resolver by going anonymous', async () => {
  const { provider, calls } = newProvider({ options: { resolveApiKey: async () => { throw new Error('resolver down') } } })
  const result = await provider.search({ query: 'q' })
  assert.equal(result.sources.length, 2)
  assert.equal('apiKey' in calls[0].callOptions, false)
})
