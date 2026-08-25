/**
 * Parser for AnySearch's markdown search payload. The API deliberately
 * returns "structured Markdown for Agents" (per the official interface spec),
 * shaped as `## Search Results (N results, Xms)` followed by one block per
 * result: `### <n>. <title>`, `- **URL**: <url>`, then snippet lines. Entries
 * without a parseable URL are dropped; when the format drifts so far that no
 * entry parses, callers fall back to passing the whole markdown through as
 * `content` so results still reach the model.
 * @module @aiwayds/dsh-web-search-anysearch/markdown
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'

/** Matches `### 1. Title text` (the ordinal is optional). */
const ENTRY_PATTERN = /^#{3}\s+(?:\d+\.\s+)?(.+)$/
/** Matches the `- **URL**: https://...` line inside an entry. */
const URL_PATTERN = /^-\s+\*\*URL\*\*:\s*(\S+)\s*$/

/**
 * Parse an AnySearch markdown payload into citeable sources, deduped by URL
 * (first occurrence wins). Snippet lines are joined in order; the provider's
 * relative `date:`/`sitelinks:` annotations stay inside the snippet text
 * (they are not ISO-8601 timestamps, so `publishedAt` is never set).
 *
 * @param markdown - the raw `text` payload of a `search` tool result.
 * @returns the parsed sources; empty when nothing parseable remains.
 */
export function parseSearchMarkdown(markdown: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  let title: string | undefined
  let url: string | undefined
  const snippetLines: string[] = []

  const flush = (): void => {
    if (url !== undefined && !seen.has(url)) {
      seen.add(url)
      const snippet = snippetLines.join(' ').trim()
      sources.push({
        url,
        ...title !== undefined && title.length > 0 ? { title } : {},
        ...snippet.length > 0 ? { snippet } : {},
      })
    }
    title = undefined
    url = undefined
    snippetLines.length = 0
  }

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trimEnd()
    const entry = ENTRY_PATTERN.exec(line)
    if (entry !== null) {
      flush()
      title = entry[1].trim()
      continue
    }
    const urlMatch = URL_PATTERN.exec(line)
    if (urlMatch !== null && url === undefined) {
      url = urlMatch[1]
      continue
    }
    if (url !== undefined && !line.startsWith('#') && line.trim().length > 0) {
      snippetLines.push(line.replace(/^-\s+/, '').trim())
    }
  }
  flush()
  return sources
}
