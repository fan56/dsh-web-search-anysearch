# dsh-web-search-anysearch

A [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) plugin that
provides web search through [AnySearch](https://anysearch.com) — "AI Search Infrastructure
for Agents".

The plugin registers a `WebSearchProvider` (`id: "anysearch"`) with the official
[`ctx.web` capability seam](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/web/web),
so the model keeps calling the same `web_search` tool with the same citation formatting
and bounds. No third-party SDK is used: the transport follows AnySearch's own reference
CLI ([anysearch-ai/anysearch-skill](https://github.com/anysearch-ai/anysearch-skill)).

## How it talks to AnySearch

Per the official interface spec (`scripts/shared/doc_spec.md` in the skill repo):

- `POST https://api.anysearch.com/mcp` — JSON-RPC 2.0 `tools/call`, **stateless** (no
  `initialize`, no session, one connection per request).
- `Authorization: Bearer <API_KEY>` is **optional** — anonymous access works with lower
  rate limits. A free key is available at [anysearch.com/console/api-keys](https://anysearch.com/console/api-keys).
- `max_results` is capped at 10 by the API.
- Responses are *structured Markdown for agents*; the provider parses result blocks into
  citeable sources, and degrades to passing the whole payload through as `content` if the
  format ever drifts — a search never fails just because the parser did.
- Raw `node:https` per request (not `fetch`/undici), matching the official CLI and
  avoiding a known undici connection-pool hang on this endpoint.

Vertical routing (`domain`/`sub_domain` via `get_sub_domains`), `batch_search`, and
`extract` remain richer MCP/skill-layer features; this provider deliberately exposes the
general `search` tool to dsh's model-facing `web_search` (a `domain` can be pinned in
config). Point an MCP client at AnySearch for the full toolset.

## Install

Add the package to a dsh profile — `~/.dsh/profiles/<name>/package.json`:

```json
{
  "dependencies": {
    "@aiwayds/dsh-web-search-anysearch": "github:fan56/dsh-web-search-anysearch"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@aiwayds/dsh-web-search-anysearch"]
    }
  }
}
```

then `pnpm install` in the profile directory and restart dsh. **That is the whole
install** — the plugin mounts itself AND claims the `web_search` default at the bundle
layer, so with zero configuration the model's `web_search` tool runs on AnySearch
(anonymous access needs no key). For local development use
`"link:/path/to/dsh-web-search-anysearch"`.

> `@deepseek-ai/*` packages are **peer dependencies by design**: they must resolve to
> the profile's single shared dsh closure. Putting them in `dependencies` installs a
> second cordis instance and crashes the loader.

## Configure (all optional)

**API key — only needed for higher rate limits.** Anonymous access is valid AnySearch
usage; when the anonymous quota runs out, the search error names the credential to
configure. Store the key in dsh's managed credentials document
(`~/.dsh/.credentials.yaml`):

```yaml
version: 1
refs:
  ANYSEARCH_API_KEY: <your_key>
```

**Keep another engine as the default?** Your own patch layer always outranks the
plugin's bundle patch — one entry, no need to touch the plugin:

```yaml
# profile cordis.patch.yml or ~/.dsh/cordis.patch.yml
- id: web
  config:
    searchProvider: tavily   # or deepseek-official, exa, ...
```

**Verify** which engine owns `web_search`:

```sh
dsh --profile <name> --dump-config | grep -A3 'id: web$'
```

**Plugin config** (all optional; via a patch layer, read at startup):

| Field | Default | Notes |
|---|---|---|
| `apiKeyEnv` | `ANYSEARCH_API_KEY` | Credential reference resolved per search |
| `apiKey` | — | Literal key; wins over the reference |
| `endpoint` | `https://api.anysearch.com/mcp` | Env override: `ANYSEARCH_ENDPOINT` |
| `timeoutMs` | `30000` | Per-request budget |
| `domain` | — (general) | Pin a vertical: `finance`, `academic`, `code`, … (17 total) |
| `maxResults` | `8` | Default when the tool sends no bound; API caps at 10 |

## Behavior

- Markdown result blocks map to sources: `title`, `url`, snippet text; relative
  `date:`/`sitelinks:` annotations stay inside the snippet (no ISO dates → `publishedAt`
  is never set); duplicate URLs dedupe.
- Seam error contract: cancellation as `WEB_ABORTED`; transport failures, non-2xx
  statuses, JSON-RPC errors, and `isError` tool results as `WEB_PROVIDER_ERROR` with the
  provider's message surfaced.
- `available()` is a local check only (parseable endpoint) — anonymous access means no
  key is required to be usable.

## Develop

```sh
npm install
npm run check   # tsc --noEmit
npm test        # build + node --test (transport runs against a local HTTP server;
                #  markdown fixtures come from real API payloads)
```

After editing `src/`, run `npm run build` and restart dsh.

## License

MIT
