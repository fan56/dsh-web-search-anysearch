/**
 * Markdown parser tests. The fixture is a real AnySearch payload captured
 * from the live API (2026-08-26, abridged to three entries).
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { parseSearchMarkdown } from '../lib/markdown.js'

const FIXTURE = `## Search Results (9 results, 938ms)

### 1. DeepSeek Harness developer preview: Everything is a ...
- **URL**: https://deepseek.com/harness/en/
- DeepSeek Harness is built on Cordis's plugin system. Plugins provide every agent capability, including models, tools, skills, sessions, sandboxes, storage, ...

### 2. DeepSeek Harness: Everything is a Plugin.
- **URL**: https://github.com/deepseek-ai/deepseek-harness
- DeepSeek Harness ( dsh ) is an open-source agent harness developed by DeepSeek AI. date: 4 days ago

### 3. DeepSeek Harness is Insanely Good : r/LocalLLaMA
- **URL**: https://www.reddit.com/r/LocalLLaMA/comments/1vw10m3/deepseek_harness_is_insanely_good/
- Deep-seek harness is insane. date: 2 days ago sitelinks: Best harness for DeepSeek V4?: https://www.reddit.com/r/DeepSeek/comments/1v1h58q/ what harnesses do y'all use?
`

test('parses titles, urls, and snippets from a real payload', () => {
  const sources = parseSearchMarkdown(FIXTURE)
  assert.equal(sources.length, 3)
  assert.deepEqual(
    sources.map(s => s.url),
    [
      'https://deepseek.com/harness/en/',
      'https://github.com/deepseek-ai/deepseek-harness',
      'https://www.reddit.com/r/LocalLLaMA/comments/1vw10m3/deepseek_harness_is_insanely_good/',
    ],
  )
  assert.equal(sources[0].title, 'DeepSeek Harness developer preview: Everything is a ...')
  assert.ok(sources[0].snippet.startsWith('DeepSeek Harness is built on Cordis'))
  // Relative dates/sitelinks stay inside the snippet; publishedAt is never set.
  assert.ok(sources[1].snippet.includes('date: 4 days ago'))
  assert.equal('publishedAt' in sources[1], false)
})

test('drops entries without a URL and dedupes repeated URLs', () => {
  const sources = parseSearchMarkdown(`
### 1. No URL here
- just a snippet line

### 2. Real entry
- **URL**: https://dup.example/
- first snippet

### 3. Duplicate URL
- **URL**: https://dup.example/
- second snippet
`)
  assert.equal(sources.length, 1)
  assert.equal(sources[0].title, 'Real entry')
  assert.ok(sources[0].snippet.includes('first snippet'))
})

test('returns empty for payloads without parseable entries', () => {
  assert.deepEqual(parseSearchMarkdown(''), [])
  assert.deepEqual(parseSearchMarkdown('Some plain prose without structure.'), [])
  assert.deepEqual(parseSearchMarkdown('## Search Results (0 results, 5ms)\n'), [])
})

test('tolerates entries whose title line carries no ordinal', () => {
  const sources = parseSearchMarkdown('### Title only no number\n- **URL**: https://x.example\n- snippet\n')
  assert.equal(sources.length, 1)
  assert.equal(sources[0].title, 'Title only no number')
})
