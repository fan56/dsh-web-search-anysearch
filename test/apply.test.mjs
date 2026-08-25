/**
 * Plugin wiring tests: apply() registration, schema defaults, and option
 * projection (with ctx.get absent so the launch-environment fallback path is
 * exercised through process.env only).
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { apply, Config, inject, name } from '../lib/index.js'
import { ANYSEARCH_PROVIDER_ID } from '../lib/index.js'

test('plugin metadata targets the web seam', () => {
  assert.equal(name, 'web-search-anysearch')
  assert.deepEqual(inject, ['web'])
})

test('Config resolves documented defaults', () => {
  const config = Config({})
  assert.equal(config.apiKeyEnv, 'ANYSEARCH_API_KEY')
  assert.equal('maxResults' in config, false)
  assert.equal('timeoutMs' in config, false)
  assert.equal('endpoint' in config, false)
})

test('apply() registers an anysearch provider wired to the resolved config', async () => {
  let registered
  const ctx = {
    get: () => undefined,
    web: { registerSearchProvider: (provider) => { registered = provider } },
  }
  apply(ctx, { endpoint: 'https://api.anysearch.com/mcp' })
  assert.equal(registered.id, ANYSEARCH_PROVIDER_ID)
  // Anonymous access is valid, so a parseable endpoint alone makes it usable
  // without touching any ctx service or credential.
  assert.equal(registered.available(), true)
})
