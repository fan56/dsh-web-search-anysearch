# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- **The GUI row and the provider now share one credential reference.** `apiKeyEnv` is a volatile field, so the entry has a settings section and the Plugins row page receives the row's own configuration: the page reads the reference named there (`apiKeyEnv`, default `ANYSEARCH_API_KEY`) instead of assuming the default, and the field hint names the reference it writes. A re-pointed `apiKeyEnv` therefore moves the page and the provider together — previously the page kept writing `ANYSEARCH_API_KEY` while the provider read the configured reference, and only a hand-edited credentials file avoided the split. `apply` projects the value through the live reference, so the next search uses what the field currently holds, and the page falls back to the documented default when an owner delivers no form. A key staged on the page is tagged with the reference it was typed under, so text entered for one reference is never saved into another — and a save with nothing staged writes nothing at all. A blank or whitespace-only `apiKeyEnv` names no reference: both halves fall back to the documented default rather than the GUI and the provider disagreeing about a name that cannot resolve, and a read that arrives after the reference changed under it is dropped instead of painting the previous reference's badge — including the re-read a save or clear triggers when the reference moved while the write was in flight. The schema is annotated `z<Config, RunningConfig>`, so it must keep accepting what a configuration layer states and keep emitting what `apply` receives: drift between the schema and either declared shape is a typecheck failure rather than a silent divergence, and a test pins the one literal the two halves each carry (the default reference) so they cannot drift apart. The badge resets to "reading" the moment the reference changes, and a save/clear notice is skipped once its reference is no longer in force — the reset clears the phase, the failure and any armed confirmation too, so a save or clear that is still in flight when the reference moves cannot leave the page permanently busy. 49 tests (39 before).

## [0.7.0] - 2026-10-12

### Added
- **API-key row on the plugin's own page in the Plugins section.** The package now ships a Client half (`src/client.ts` → `lib/client.js`): it claims the keyed `plugins.row.config` slot on this package's own row, so the row gains a **Configure** page — one write-only field that stores the `ANYSEARCH_API_KEY` credential through dsh's credentials service, a badge reporting whether a key is configured, and **Clear key** (confirmed once) that removes the reference again and returns searches to the anonymous limits. A key supplied by the launching environment or a `.env` fallback reads as read-only, and the page says so instead of offering a write. Nothing is written into a configuration file, and the provider already re-resolves the reference on every search, so no restart is involved. `package.json` declares the `dsh.client` half and the `exports` map the browser module table resolves (`"."`, `"./client"`, `"./package.json"`, `"./cordis.patch.yml"`, `"./locale/*.json"`).
- **Build and test cover the Client half.** `npm run build` now runs `scripts/build-client.mjs` after `tsc`: a Client artifact is evaluated as a classic script, while TypeScript always marks a `.ts` file in a `"type": "module"` package as a module, so the step strips the `export {}` marker tsc appends and fails the build if the artifact carries module syntax or never reaches `window.__ModuleLoader__.load`. `test/client.test.mjs` pins the artifact shape, the manifest, the row claim, both dictionaries, and every credential call (39 tests total, 26 before).

### Changed
- **Raise dsh host floor to 0.2.0-rc.2** (peer floors on `dsh-web` / `dsh-credentials` / `dsh-launch-environment`; devDependencies pinned to `0.2.0-rc.2` exactly; lockfile regenerated against registry.npmjs.org; README updated). cordis 4.0.4 / schemastery 3.18.4 pins unchanged. Zero source changes — 0.2.0 is a digestion wave (tests 26 pass / 0 fail).
- **dsh support floor raised to `>= 0.1.7-rc.1`** (peer floors on `dsh-web` / `dsh-credentials` / `dsh-launch-environment`; devDependencies pinned to `0.1.7-rc.1` exactly; README updated). The dev closure rides the 0.1.7-rc.1 line, whose peers force cordis 4.0.4 / schemastery 3.18.4 in devDependencies (peer ranges unchanged). No source changes were needed — typecheck and the full test suite pass against the new closure.
- **Plugin Manager metadata.** Added `icon.svg` and `locale/{en,zh}.json` (`meta.title`/`meta.description` per the official `readPluginMeta` contract); `package.json` now declares the `icon` and ships both in the tarball.

## [0.4.0] - 2026-09-11

### Changed
- **dsh support floor raised to `>= 0.1.5-rc.2`** (peer floors on `dsh-web` / `dsh-credentials` / `dsh-launch-environment`; READMEs updated). The dev closure rides the 0.1.5-rc.2 line.
- Release: the publish-verify loop polls `npm view` for ~2 min instead of 30s — packument propagation measured ~50s on dsh-dcp v0.11.0 outran the old window and falsely failed a landed publish.

## [0.3.1] - 2026-09-05

### Changed
- Clean-uninstall story, documented and tested: the README gains an Uninstall section (the removal command, the host auto-clean including the patch's `searchProvider: anysearch` claim on the host `web` row — selection reverts to the host default — the no-on-disk-state statement, and the `WEB_PROVIDER_UNAVAILABLE` caveat for hand-copied claims), and the boot smoke gains an uninstall leg: after the boot proof it runs `dsh plugin --profile smoke remove` against the scratch profile and asserts the second `--dump-config` no longer contains the plugin entry nor the `searchProvider: anysearch` claim — removal must reconcile the composed tree back to stock.

## [0.3.0] - 2026-09-03

### Changed
- CI retires the alpha line: the dsh CLI is installed from the rolling rc/stable line — the newest of the `latest`/`next` dist-tags, resolved at runtime (never hand-pinned, never alpha)
- deps: peer floors move to `>=0.1.2-rc.1` and devDependencies pin `0.1.2-rc.1` exactly (cordis/schemastery unchanged)
- README announces RC/stable-only support: the alpha line is no longer supported
- **BREAKING — dsh host floor `>= 0.1.2-alpha.3`, rc-line support dropped**: all `@deepseek-ai` pins move to the 0.1.2-alpha.3 host closure (peers cordis ^4.0.2, schemastery ^3.18.2, dsh-web / dsh-credentials / dsh-launch-environment >=0.1.2-alpha.3; devDependencies exact). No source changes were needed — every import (`credentialRef`, `CredentialRef`, `launchEnvironmentOf`, `WebError`, `WebSearchSource`) is unchanged in alpha.3, proven by typecheck against the closure.

### Added
- Boot smoke (`npm run smoke`, `scripts/smoke-boot.mjs`): mounts the packed plugin into a scratch dsh profile and boots it with the real dsh CLI; CI installs the host from the rolling rc/stable line (newest of the `latest`/`next` dist-tags), links the closure types, and gains a daily schedule

## [0.1.2] - 2026-08-29

### Changed
- npm metadata-only release: add keywords (dsh, dsh-plugin, deepseek-harness, web-search, search, anysearch) for registry discoverability; no code changes
