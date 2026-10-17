/**
 * Client-half guard. The Host half has its own wiring tests; this file pins the
 * browser half, which nothing else in the suite can see: the artifact must be a
 * classic script, register its factory under the package name, claim THIS
 * package's own row page (`plugins.row.config`, key `<package name>#<row id>`),
 * and drive the credentials namespace with the reference the provider resolves.
 *
 * The component is exercised through the shallow render harness below: a stub
 * `react` hands the component a prepared hook state and `createElement` returns
 * a plain tree, so one call pins the copy and the controls a given credential
 * state produces without pulling a renderer into this dependency-light suite.
 * Hook scheduling, effects, real re-renders, and the live Plugins page are not
 * covered here — those need a browser.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const PACKAGE = '@aiwayds/dsh-web-search-anysearch'
const ROW_ID = 'web-search-anysearch'
const ROW_KEY = `${PACKAGE}#${ROW_ID}`
const API_KEY_REF = 'ANYSEARCH_API_KEY'
const NS = 'settings.anysearchApiKey'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const artifact = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

/**
 * The row id the bundle patch inserts — the source of truth for the key's second
 * half. Anchored on the insert block: the patch's own comment quotes the host
 * override (`- id: web`) as an example, so a bare `- id:` search would read that.
 */
const patchRowId = /^- insert:[\s\S]*?- id: (\S+)/m.exec(patch)?.[1]

/**
 * Evaluate the built artifact the way the browser module table does: a page
 * global carrying `__ModuleLoader__`, then the script's own `load` call. Inside
 * a page `globalThis` IS `window`, which is why the artifact reads it that way.
 * @returns the entry the artifact registered.
 */
async function captureArtifact() {
  let entry
  const previous = Object.getOwnPropertyDescriptor(globalThis, '__ModuleLoader__')
  globalThis.__ModuleLoader__ = { load: (value) => { entry = value } }
  try {
    await import(new URL('../lib/client.js', import.meta.url).href)
  } finally {
    if (previous === undefined) delete globalThis.__ModuleLoader__
    else Object.defineProperty(globalThis, '__ModuleLoader__', previous)
  }
  assert.ok(entry !== undefined, 'lib/client.js must register with window.__ModuleLoader__.load')
  return entry
}

const entry = await captureArtifact()

/** Primitive stand-ins: the component renders them, so marker values are enough. */
const PRIMITIVES = { SettingsForm: 'SettingsForm', SettingsSecretField: 'SettingsSecretField', Button: 'Button' }

/**
 * One-shot React stub. `useState` walks a prepared state list in call order, so
 * a single component call produces exactly the render that state would produce.
 * @param states - the hook states the component reads, in call order.
 * @returns the stub module the artifact's factory requires.
 */
function createReact(states) {
  let index = 0
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: () => [states[index++], () => {}],
    useRef: (initial) => ({ current: initial }),
    useEffect: () => {},
    useCallback: (callback) => callback,
  }
}

/**
 * Boot the Client half against a fake context.
 * @param options - the credentials namespace replies, or `undefined` for a deployment that serves none.
 * @returns the plugin, the context record, and the factory's require stub.
 */
async function boot(options = {}) {
  const record = { dictionaries: undefined, namespace: undefined, injected: [], registrations: [] }
  const credentials = options.credentials === undefined
    ? undefined
    : {
        describe: async () => options.credentials.describe?.(),
        set: async (ref, value) => options.credentials.set?.(ref, value),
        unset: async (ref) => options.credentials.unset?.(ref),
      }
  const ctx = {
    effect: (callback) => { record.cleanup = callback() },
    locale: {
      bind: (namespace) => (key) => `${namespace}.${key}`,
      register: (namespace, dictionaries) => {
        record.namespace = namespace
        record.dictionaries = dictionaries
        return () => {}
      },
    },
    slots: {
      inject: (name, callback) => {
        record.injected.push(name)
        record.effect = callback()
        return () => {}
      },
      register: (registration, component) => {
        record.registrations.push({ registration, component })
        return () => {}
      },
    },
    ...options.credentials === undefined ? {} : { remote: { credentials } },
  }
  const client = entry.factory((specifier) => {
    if (specifier === 'react') return createReact(options.states ?? [])
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
      if (options.primitivesMissing) throw new Error(`Cannot find module '${specifier}' supplied`)
      return PRIMITIVES
    }
    throw new Error(`unexpected require: ${specifier}`)
  })
  client.apply(ctx)
  return { client, record }
}

/** The credentials namespace replies for a deployment that serves one. */
function credentialService({ configured, writable = true, refusal } = {}) {
  const calls = { describe: [], set: [], unset: [] }
  return {
    calls,
    credentials: {
      describe: () => {
        calls.describe.push([API_KEY_REF])
        if (refusal !== undefined) return { ok: false, error: { message: refusal } }
        return { ok: true, value: { [API_KEY_REF]: { configured, writable } } }
      },
      set: (ref, value) => { calls.set.push([ref, value]); return { ok: true } },
      unset: (ref) => { calls.unset.push([ref]); return { ok: true } },
    },
  }
}

/** Render the card once with the given credential state. */
async function renderCard({ credential, phase = 'idle', failure = '', confirming = false, states } = {}) {
  const { record } = await boot({ states: states ?? ['', credential, phase, failure, confirming] })
  const { component } = record.registrations[0]
  const requested = new Set()
  const t = (key) => {
    requested.add(key)
    return record.dictionaries.zh[key] ?? `!!missing:${key}`
  }
  const tree = component({ view: 'page', t, describe: async () => credential, setKey: async () => {}, clearKey: async () => {} })
  return { tree, record, requested, dictionaries: record.dictionaries }
}

/** The form element the card renders around its controls. */
function form(tree) {
  const element = elements(tree).find((child) => child.type === 'SettingsForm')
  assert.ok(element !== undefined, 'the card must render a SettingsForm')
  return element
}

/** One element's children, flattened one level: `createElement(type, props, [..])` keeps that array nested. */
function childrenOf(element) {
  return element.children.flat()
}

/** Every element in a tree, depth first; children may nest as arrays. */
function elements(node, found = []) {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found)
    return found
  }
  if (typeof node.type === 'string') found.push(node)
  for (const child of node.children ?? []) elements(child, found)
  return found
}

test('client artifact is a classic script registered under the package name', () => {
  assert.equal(entry.id, PACKAGE, 'the loader id must be the package name, or the browser half silently never mounts')
  assert.equal(typeof entry.factory, 'function')
  assert.doesNotMatch(artifact, /^\s*(?:import|export)\s/m, 'a Client artifact is evaluated as a classic script')
})

test('manifest declares the Client half and the shipped paths it resolves', () => {
  assert.equal(patchRowId, ROW_ID, 'the Client half keys its page on the row id the bundle patch declares')
  assert.equal(packageJson.dsh.client.platform, 'web')
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'), 'ctx.locale')
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-plugin-manager'), 'plugins.row.config')
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'), 'remote.credentials')
  assert.equal(packageJson.exports['./client'], './lib/client.js')
  assert.equal(packageJson.exports['.'].default, './lib/index.js')
  assert.ok(packageJson.files.includes('lib'), 'the built Client artifact must ship')
  assert.ok(packageJson.scripts.test.includes('test/client.test.mjs'), 'this file must run in npm test')
})

test('Client half requires the services it reads', async () => {
  const { client } = await boot({ states: [] })
  assert.deepEqual(client.inject, ['slots', 'locale', 'remote', 'remote.credentials'])
})

test('row page is claimed on this package own row, with both dictionaries', async () => {
  const { record } = await boot({ states: [] })
  assert.deepEqual(record.injected, ['plugins.row.config'], 'registration must survive the slot being declared later')
  assert.equal(record.registrations.length, 1)
  assert.equal(record.registrations[0].registration.name, 'plugins.row.config')
  assert.equal(record.registrations[0].registration.key, ROW_KEY)
  assert.equal(record.registrations[0].registration.locale, NS)
  assert.equal(typeof record.registrations[0].component, 'function')
  assert.equal(record.namespace, NS)
  assert.deepEqual(
    Object.keys(record.dictionaries.zh).sort(),
    Object.keys(record.dictionaries.en).sort(),
    'zh and en must carry exactly the same keys',
  )
})

test('summary view is the one-liner the row shows when the package has no description', async () => {
  const { record } = await boot({ states: [] })
  const { component } = record.registrations[0]
  const line = component({ view: 'summary', t: (key) => record.dictionaries.zh[key], describe: async () => ({}), setKey: async () => {}, clearKey: async () => {} })
  assert.equal(typeof line, 'string')
  assert.ok(line.length > 0)
})

test('the inject face reads, writes, and clears the provider credential reference', async () => {
  const service = credentialService({ configured: true })
  const { record } = await boot({ credentials: service.credentials, states: [] })
  const face = record.registrations[0].registration.inject()

  assert.deepEqual(await face.describe(), { configured: true, writable: true })
  assert.deepEqual(service.calls.describe, [[API_KEY_REF]], 'describe must ask for the reference the provider resolves')

  await face.setKey('as_sk_test')
  assert.deepEqual(service.calls.set, [[API_KEY_REF, 'as_sk_test']])

  await face.clearKey()
  assert.deepEqual(service.calls.unset, [[API_KEY_REF]], 'clearing removes the reference, never writes an empty value')
})

test('an unconfigured reference reads as anonymous, and a read-only source stays writable: false', async () => {
  const absent = credentialService({ configured: false })
  const { record } = await boot({ credentials: absent.credentials, states: [] })
  const face = record.registrations[0].registration.inject()
  assert.deepEqual(await face.describe(), { configured: false, writable: true })

  const readOnly = credentialService({ configured: true, writable: false })
  const second = await boot({ credentials: readOnly.credentials, states: [] })
  assert.deepEqual(await second.record.registrations[0].registration.inject().describe(), {
    configured: true,
    writable: false,
  })
})

test('a refused remote call rejects with the host message, and a missing namespace says what is missing', async () => {
  const refused = credentialService({ configured: false, refusal: 'credential/rejected: read-only' })
  const { record } = await boot({ credentials: refused.credentials, states: [] })
  const face = record.registrations[0].registration.inject()
  await assert.rejects(() => face.describe(), /read-only/)

  const missing = await boot({ states: [] })
  const withoutSeam = missing.record.registrations[0].registration.inject()
  await assert.rejects(() => withoutSeam.describe(), /ctx\.remote\.credentials is unavailable/)
  await assert.rejects(() => withoutSeam.setKey('as_sk_test'), /ctx\.remote\.credentials is unavailable/)
  await assert.rejects(() => withoutSeam.clearKey(), /ctx\.remote\.credentials is unavailable/)
})

test('an unconfigured key renders the write-only field and no clear control', async () => {
  const { tree, requested, dictionaries } = await renderCard({ credential: { loaded: true, configured: false, writable: true, error: '' } })
  const controls = childrenOf(form(tree))
  const field = controls.find((child) => child !== null && child.type === 'SettingsSecretField')
  assert.ok(field !== undefined, 'the key field must render')
  assert.equal(field.props.configured, false)
  assert.equal(field.props.stateLabel, dictionaries.zh.keyUnset)
  assert.equal(field.props.disabled, false)
  assert.equal(controls.some((child) => elements(child).some((element) => element.type === 'Button')), false, 'nothing to clear yet')
  for (const key of requested) assert.ok(dictionaries.zh[key] !== undefined && dictionaries.en[key] !== undefined, `missing copy: ${key}`)
})

test('a configured key offers the clear control, in two steps', async () => {
  const { tree, dictionaries } = await renderCard({ credential: { loaded: true, configured: true, writable: true, error: '' } })
  const controls = childrenOf(form(tree))
  const field = controls.find((child) => child !== null && child.type === 'SettingsSecretField')
  assert.equal(field.props.stateLabel, dictionaries.zh.keySet)

  const ask = elements(controls.find((child) => child !== null && child.type === 'div')).find((element) => element.type === 'Button')
  assert.equal(ask.children[0], dictionaries.zh.clear)
  assert.equal(ask.props.variant, 'outline')

  const confirming = await renderCard({
    credential: { loaded: true, configured: true, writable: true, error: '' },
    confirming: true,
  })
  const buttons = elements(form(confirming.tree)).filter((element) => element.type === 'Button')
  const copy = buttons.map((button) => button.children[0])
  assert.ok(copy.includes(dictionaries.zh.clearConfirm), 'the second click confirms')
  assert.ok(copy.includes(dictionaries.zh.clearCancel), 'and can be abandoned')
})

test('a read-only credential source disables the field and hides the clear control', async () => {
  const { tree, dictionaries } = await renderCard({ credential: { loaded: true, configured: true, writable: false, error: '' } })
  const element = form(tree)
  assert.equal(element.props.state.writable, false)
  assert.equal(element.props.labels.readOnly, dictionaries.zh.readOnly)
  const field = childrenOf(element).find((child) => child !== null && child.type === 'SettingsSecretField')
  assert.equal(field.props.disabled, true)
  assert.equal(elements(element).some((child) => child.type === 'Button'), false)
})

test('a failed read shows the reason instead of the field', async () => {
  const { tree, dictionaries } = await renderCard({ credential: { loaded: false, configured: false, writable: false, error: 'gateway/internal: no credential provider' } })
  const element = form(tree)
  assert.equal(element.props.state.available, false)
  assert.ok(element.props.labels.unavailable.includes('gateway/internal: no credential provider'))
  assert.ok(element.props.labels.unavailable.includes(dictionaries.zh.loadFailed))
})

test('a settled action reports itself, and a refusal keeps its detail', async () => {
  const credential = { loaded: true, configured: true, writable: true, error: '' }
  const saved = await renderCard({ credential, phase: 'saved' })
  const cleared = await renderCard({ credential, phase: 'cleared' })
  const failed = await renderCard({ credential, phase: 'failed', failure: 'credential/rejected: nope' })
  const idle = await renderCard({ credential, phase: 'idle' })

  const noticeOf = (tree) => elements(tree).find((child) => child.type === 'p')?.children[0]
  const { dictionaries } = saved
  assert.equal(noticeOf(saved.tree), dictionaries.zh.saved)
  assert.equal(noticeOf(cleared.tree), dictionaries.zh.cleared)
  assert.equal(noticeOf(failed.tree), 'credential/rejected: nope')
  assert.equal(form(failed.tree).props.state.failed, true)
  assert.equal(noticeOf(idle.tree), undefined, 'a quiet page says nothing')
})

// ---------------------------------------------------------------------------
// dsh 0.2.1: the web client UI rework removed the npm packages
// (dsh-client-store / dsh-client-ui-primitives / dsh-client-ui-slots) from the
// host's dependency graph, but the module ids live on in the deployed web
// client's core bundle. Evidence, taken from the 0.2.1-rc.2 install closure:
// `@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js` carries the core
// specifier table that backs every `__ModuleLoader__` factory `require` —
// `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
// `@deepseek-ai/dsh-client-ui-primitives` (and dockkit) are all still served —
// and rc.2's own `dsh-client-ui-settings-web-search/lib/client.js` requires the
// exact same primitives specifier inside the same factory pattern. The tests
// below pin that contract: every specifier this artifact requires must be one
// the rc.2 web client registry serves, and a host that ever drops the id must
// degrade to a readable notice instead of taking the row down.
// ---------------------------------------------------------------------------

/** The specifier table the rc.2 web client core bundle serves (see block comment). */
const RC2_CORE_REGISTRY = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

test('every specifier the artifact requires is one the dsh 0.2.1 web client registry serves', () => {
  const specifiers = [...artifact.matchAll(/require\((["'])(.+?)\1\)/g)].map((match) => match[2])
  assert.ok(specifiers.includes('@deepseek-ai/dsh-client-ui-primitives'),
    'the settings page still rides the shared primitives id (same one the official rc.2 pages require)')
  const unknown = [...new Set(specifiers)].filter((specifier) => !RC2_CORE_REGISTRY.has(specifier))
  assert.deepEqual(unknown, [],
    'specifiers outside the rc.2 core registry would break the page at materialization')
})

test('a host that stops serving the primitives id degrades to the uiUnavailable notice, not a dead row', async () => {
  const states = ['', { loaded: false, configured: false, writable: true, error: '' }, 'idle', '', false]
  const page = await boot({ primitivesMissing: true, states })
  const t = (key) => page.record.dictionaries.zh[key] ?? `!!missing:${key}`
  const { component } = page.record.registrations[0]
  const tree = component({
    view: 'page',
    t,
    describe: async () => ({ loaded: true, configured: false, writable: true }),
    setKey: async () => {},
    clearKey: async () => {},
  })
  assert.equal(tree.type, 'p', 'the degraded page renders one status line')
  assert.equal(tree.children[0], page.record.dictionaries.zh.uiUnavailable,
    'the line tells the reader the web frontend lacks the UI components')
  assert.ok(!JSON.stringify(tree).includes('SettingsForm'), 'no form is rendered from undefined primitives')

  // The summary view never needed primitives and must keep working.
  const summary = await boot({ primitivesMissing: true, states: [''] })
  const oneLiner = summary.record.registrations[0].component({
    view: 'summary',
    t: (key) => summary.record.dictionaries.zh[key] ?? `!!missing:${key}`,
    describe: async () => ({ loaded: true, configured: false, writable: true }),
    setKey: async () => {},
    clearKey: async () => {},
  })
  assert.equal(oneLiner, summary.record.dictionaries.zh.summary, 'summary stays the one-liner')
})
