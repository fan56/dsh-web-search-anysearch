#!/usr/bin/env node
// Client-artifact post-step for the browser half.
//
// `src/client.ts` is compiled by the same `tsc` run as the Host half, which is
// what keeps the Client half type-checked. But a `.ts` file inside a
// `"type": "module"` package is ALWAYS a module under `module: NodeNext`, even
// when its source declares neither imports nor exports, so `tsc` appends the
// `export {}` module marker to `lib/client.js`.
//
// The browser module table evaluates a Client artifact as a CLASSIC script
// (`window.__ModuleLoader__.load({ id, factory })`), where a top-level
// `export {}` is a SyntaxError — the page would lose the whole artifact, and
// with it the plugin row's Configure control. This step removes exactly that
// marker and then proves the result is free of module syntax, so the failure it
// guards against is loud at build time instead of silent in the browser.
//
// The removal happens on the last lines, after every statement the source
// declares, so the source map's line mappings for the body stay valid.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifact = path.join(repoRoot, 'lib', 'client.js')

const source = await readFile(artifact, 'utf8')
const stripped = source.replace(/\nexport \{\};\n/, '\n')

if (moduleSyntax(stripped) !== undefined) {
  console.error(`build-client: FAIL — lib/client.js still carries module syntax (${moduleSyntax(stripped)})`)
  console.error('build-client: a Client artifact must be a classic script; see this script\'s header')
  process.exit(1)
}
if (!stripped.includes('__ModuleLoader__')) {
  console.error('build-client: FAIL — lib/client.js never reaches window.__ModuleLoader__.load')
  process.exit(1)
}
if (stripped !== source) await writeFile(artifact, stripped)

console.log(
  `build-client: OK — lib/client.js is a classic script${stripped === source ? ' (no module marker to strip)' : ' (module marker stripped)'}`,
)

/** The first top-level `import`/`export` statement, or `undefined` when the script has none. */
function moduleSyntax(text) {
  return text.match(/^\s*(?:import|export)\s.*$/m)?.[0].trim()
}
