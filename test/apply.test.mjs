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
  assert.equal(config.apiKeyEnv.get(), 'ANYSEARCH_API_KEY')
  assert.equal('maxResults' in config, false)
  assert.equal('timeoutMs' in config, false)
  assert.equal('endpoint' in config, false)
})

test('apiKeyEnv is volatile, so the row page and the provider share one reference', () => {
  // The Plugins row page only ever receives an entry's volatile fields. Without
  // this flag the GUI row would manage the default reference while a re-pointed
  // provider reads another one.
  assert.equal(Config.dict.apiKeyEnv.meta.volatile, true)
  assert.equal(Config({ apiKeyEnv: 'ANYSEARCH_ALT' }).apiKeyEnv.get(), 'ANYSEARCH_ALT')
})

test('apply() registers an anysearch provider wired to the resolved config', async () => {
  let registered
  const ctx = {
    get: () => undefined,
    web: { registerSearchProvider: (provider) => { registered = provider } },
  }
  // The loader hands the volatile field over as a live reference; reading the
  // reference through it is what keeps option projection working.
  apply(ctx, Config({ endpoint: 'https://api.anysearch.com/mcp' }))
  assert.equal(registered.id, ANYSEARCH_PROVIDER_ID)
  // Anonymous access is valid, so a parseable endpoint alone makes it usable
  // without touching any ctx service or credential.
  assert.equal(registered.available(), true)

  // A plain object (a direct caller, a unit test) carries the value itself.
  apply(ctx, { endpoint: 'https://api.anysearch.com/mcp' })
  assert.equal(registered.available(), true)
})

test('apply() reads the reference per operation, so a re-pointed apiKeyEnv is picked up', () => {
  let registered
  const ctx = {
    get: () => undefined,
    web: { registerSearchProvider: (provider) => { registered = provider } },
  }
  // A live reference, as the loader hands a volatile field over: the value it
  // carries can change between operations.
  const field = { value: 'ANYSEARCH_API_KEY', get() { return this.value } }
  apply(ctx, { endpoint: 'https://api.anysearch.com/mcp', apiKeyEnv: field })
  assert.equal(registered.available(), true)

  // Every operation projects the options again, so the field is read again — and
  // a reference the seam rejects fails loudly instead of quietly searching under
  // whichever reference the plugin started with.
  field.value = 'not a ref!!'
  // Only that it throws: the wording comes from `credentialRef` in the
  // credentials package, where a reword would break this test with no behaviour
  // change here.
  assert.throws(() => registered.available())
  field.value = 'ANYSEARCH_AGAIN'
  assert.equal(registered.available(), true)
})

test('a blank reference falls back to the default instead of failing every search', () => {
  let registered
  const ctx = {
    get: () => undefined,
    web: { registerSearchProvider: (provider) => { registered = provider } },
  }
  // The row page reads a blank or whitespace-only `apiKeyEnv` as absent, so this
  // half must agree: otherwise the GUI would manage the default reference while
  // every projection threw on the name the config actually carries.
  const field = { value: '   ', get() { return this.value } }
  apply(ctx, { endpoint: 'https://api.anysearch.com/mcp', apiKeyEnv: field })
  assert.equal(registered.available(), true, 'a whitespace-only name is not handed to the seam')

  field.value = ''
  assert.equal(registered.available(), true, 'nor is an empty one')
})
