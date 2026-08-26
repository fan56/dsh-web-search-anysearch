/**
 * Bundle patch guard: the plugin must stay out-of-the-box — mounting the
 * provider AND claiming the web_search default (anonymous AnySearch needs no
 * key). If this test fails, a fresh install would register the provider
 * without selecting it and web_search would keep running on the base
 * bundle's deepseek-official.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('bundle patch mounts the plugin', () => {
  assert.ok(patch.includes('- id: web-search-anysearch'), 'insert entry missing')
  assert.ok(patch.includes("'@aiwayds/dsh-web-search-anysearch'"), 'package name missing')
})

test('bundle patch claims the web_search default (out-of-the-box selection)', () => {
  assert.ok(/searchProvider:\s*anysearch\b/.test(patch), 'web.searchProvider override missing')
})

test('bundle patch documents the user-override path', () => {
  assert.ok(/searchProvider:\s*<id>/.test(patch), 'override hint missing — users need to know how to keep another engine')
})
