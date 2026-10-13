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
import { Config as HostConfig } from '../lib/index.js'

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
 * Effects run once, inline, and their cleanups are collected, so a test can play
 * the part React plays when a dependency changes or the page unmounts. State
 * writes are recorded rather than applied, which is how a test observes what a
 * late response would have painted.
 * @param states - the hook states the component reads, in call order.
 * @param hooks - the cleanup and state-write log to fill.
 * @returns the stub module the artifact's factory requires.
 */
function createReact(states, hooks = { cleanups: [], sets: [] }) {
  let index = 0
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: () => {
      const slot = index++
      return [states[slot], (next) => { hooks.sets.push([slot, next]) }]
    },
    useRef: (initial) => ({ current: initial }),
    useEffect: (effect) => {
      const cleanup = effect()
      if (typeof cleanup === 'function') hooks.cleanups.push(cleanup)
    },
    useCallback: (callback) => callback,
  }
}

/**
 * Boot the Client half against a fake context.
 * @param options - the credentials namespace replies, or `undefined` for a deployment that serves none.
 * @returns the plugin, the context record, and the factory's require stub.
 */
async function boot(options = {}) {
  const hooks = options.hooks ?? { cleanups: [], sets: [] }
  const record = { dictionaries: undefined, namespace: undefined, injected: [], registrations: [] }
  const credentials = options.credentials === undefined
    ? undefined
    : {
        describe: async (refs) => options.credentials.describe?.(refs),
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
    if (specifier === 'react') return createReact(options.states ?? [], hooks)
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return PRIMITIVES
    throw new Error(`unexpected require: ${specifier}`)
  })
  client.apply(ctx)
  return { client, record }
}

/** The credentials namespace replies for a deployment that serves one, per requested reference. */
function credentialService({ configured, writable = true, refusal } = {}) {
  const calls = { describe: [], set: [], unset: [] }
  return {
    calls,
    credentials: {
      describe: (refs) => {
        calls.describe.push(refs)
        if (refusal !== undefined) return { ok: false, error: { message: refusal } }
        return { ok: true, value: Object.fromEntries(refs.map((ref) => [ref, { configured, writable }])) }
      },
      set: (ref, value) => { calls.set.push([ref, value]); return { ok: true } },
      unset: (ref) => { calls.unset.push([ref]); return { ok: true } },
    },
  }
}

/**
 * Render the card once with the given credential state.
 * @param options - the credential state, the hook states to prepare, the row config the owner hands the page, and the actions to record.
 * @returns the rendered tree, the boot record, the copy keys requested, the reference each credential action was called with, and both dictionaries.
 */
async function renderCard({ credential, phase = 'idle', failure = '', confirming = false, states, form } = {}) {
  const { record } = await boot({ states: states ?? [{ ref: API_KEY_REF, text: '' }, credential, phase, failure, confirming] })
  const { component } = record.registrations[0]
  const requested = new Set()
  // Mirrors the runtime binder: a template plus the params it interpolates.
  const t = (key, params) => {
    requested.add(key)
    const template = record.dictionaries.zh[key] ?? `!!missing:${key}`
    return params === undefined
      ? template
      : template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
  }
  const refs = { describe: [], set: [], clear: [] }
  const tree = component({
    view: 'page',
    ...form === undefined ? {} : { form },
    t,
    describe: async (ref) => {
      refs.describe.push(ref)
      return credential
    },
    setKey: async (ref, value) => {
      refs.set.push([ref, value])
    },
    clearKey: async (ref) => {
      refs.clear.push(ref)
    },
  })
  return { tree, record, requested, refs, dictionaries: record.dictionaries }
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

test('the client fallback reference is the default the host schema resolves', () => {
  // The two halves cannot share a constant (a Client half must not import host
  // code), so this pins them together: re-pointing the host default without
  // moving the client's literal — or the other way round — fails here.
  assert.equal(HostConfig({}).apiKeyEnv.get(), API_KEY_REF)
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
  for (const locale of ['zh', 'en']) {
    assert.ok(
      record.dictionaries[locale].apiKeyHint.includes('{ref}'),
      `${locale}: the hint must stay a template, or the page names a reference it may not write`,
    )
  }
})

test('summary view is the one-liner the row shows when the package has no description', async () => {
  const { record } = await boot({ states: [] })
  const { component } = record.registrations[0]
  const line = component({ view: 'summary', t: (key) => record.dictionaries.zh[key], describe: async () => ({}), setKey: async () => {}, clearKey: async () => {} })
  assert.equal(typeof line, 'string')
  assert.ok(line.length > 0)
})

test('the inject face reads, writes, and clears the reference it is handed', async () => {
  const service = credentialService({ configured: true })
  const { record } = await boot({ credentials: service.credentials, states: [] })
  const face = record.registrations[0].registration.inject()

  assert.deepEqual(await face.describe(API_KEY_REF), { configured: true, writable: true })
  assert.deepEqual(service.calls.describe, [[API_KEY_REF]], 'describe must ask for the reference the provider resolves')

  await face.setKey(API_KEY_REF, 'as_sk_test')
  assert.deepEqual(service.calls.set, [[API_KEY_REF, 'as_sk_test']])

  // The reference is a parameter, never a constant: a re-pointed `apiKeyEnv`
  // must move every write with it.
  await face.setKey('ANYSEARCH_ALT', 'as_sk_other')
  await face.describe('ANYSEARCH_ALT')
  assert.deepEqual(service.calls.set, [[API_KEY_REF, 'as_sk_test'], ['ANYSEARCH_ALT', 'as_sk_other']])
  assert.deepEqual(service.calls.describe, [[API_KEY_REF], ['ANYSEARCH_ALT']])

  await face.clearKey(API_KEY_REF)
  assert.deepEqual(service.calls.unset, [[API_KEY_REF]], 'clearing removes the reference, never writes an empty value')
})

test('an unconfigured reference reads as anonymous, and a read-only source stays writable: false', async () => {
  const absent = credentialService({ configured: false })
  const { record } = await boot({ credentials: absent.credentials, states: [] })
  const face = record.registrations[0].registration.inject()
  assert.deepEqual(await face.describe(API_KEY_REF), { configured: false, writable: true })

  const readOnly = credentialService({ configured: true, writable: false })
  const second = await boot({ credentials: readOnly.credentials, states: [] })
  assert.deepEqual(await second.record.registrations[0].registration.inject().describe(API_KEY_REF), {
    configured: true,
    writable: false,
  })
})

test('a refused remote call rejects with the host message, and a missing namespace says what is missing', async () => {
  const refused = credentialService({ configured: false, refusal: 'credential/rejected: read-only' })
  const { record } = await boot({ credentials: refused.credentials, states: [] })
  const face = record.registrations[0].registration.inject()
  await assert.rejects(() => face.describe(API_KEY_REF), /read-only/)

  const missing = await boot({ states: [] })
  const withoutSeam = missing.record.registrations[0].registration.inject()
  await assert.rejects(() => withoutSeam.describe(API_KEY_REF), /ctx\.remote\.credentials is unavailable/)
  await assert.rejects(() => withoutSeam.setKey(API_KEY_REF, 'as_sk_test'), /ctx\.remote\.credentials is unavailable/)
  await assert.rejects(() => withoutSeam.clearKey(API_KEY_REF), /ctx\.remote\.credentials is unavailable/)
})

test('the card manages the reference the row config names, and says which one', async () => {
  const rowConfig = { state: { value: { apiKeyEnv: 'ANYSEARCH_ALT' } } }
  const credential = { loaded: true, configured: true, writable: true, error: '' }
  const typed = { ref: 'ANYSEARCH_ALT', text: 'as_sk_typed' }
  const configured = await renderCard({
    credential,
    form: rowConfig,
    states: [typed, credential, 'idle', '', false],
  })
  const element = form(configured.tree)
  const field = childrenOf(element).find((child) => child !== null && child.type === 'SettingsSecretField')
  assert.equal(field.props.hint, configured.dictionaries.zh.apiKeyHint.replace('{ref}', 'ANYSEARCH_ALT'))
  assert.deepEqual(configured.refs.describe, ['ANYSEARCH_ALT'], 'the mount-time read must ask for the configured reference')

  // The write follows the same reference, not a constant.
  element.props.onSave()
  assert.deepEqual(
    configured.refs.set,
    [['ANYSEARCH_ALT', 'as_sk_typed']],
    'a save must write the reference the row config names',
  )

  const confirming = await renderCard({
    credential,
    confirming: true,
    form: rowConfig,
  })
  const confirm = elements(form(confirming.tree))
    .find((child) => child.type === 'Button' && child.children[0] === confirming.dictionaries.zh.clearConfirm)
  confirm.props.onClick()
  assert.deepEqual(confirming.refs.clear, ['ANYSEARCH_ALT'], 'a clear must remove that same reference')
})

test('without a row config the card falls back to the provider default reference', async () => {
  const pages = {
    'no form at all': undefined,
    'an empty value': { state: { value: {} } },
    'a blank name': { state: { value: { apiKeyEnv: '' } } },
    'a whitespace-only name': { state: { value: { apiKeyEnv: '   ' } } },
    'a name of the wrong type': { state: { value: { apiKeyEnv: 42 } } },
  }
  const credential = { loaded: true, configured: false, writable: true, error: '' }
  // Staged under the reference the page falls back to, so the save is a real one.
  const typed = { ref: API_KEY_REF, text: 'as_sk_typed' }
  for (const [label, rowConfig] of Object.entries(pages)) {
    const page = await renderCard({
      credential,
      states: [typed, credential, 'idle', '', false],
      ...rowConfig === undefined ? {} : { form: rowConfig },
    })
    const element = form(page.tree)
    const field = childrenOf(element).find((child) => child !== null && child.type === 'SettingsSecretField')
    assert.equal(
      field.props.hint,
      page.dictionaries.zh.apiKeyHint.replace('{ref}', API_KEY_REF),
      `${label}: the page must name the reference it actually writes`,
    )
    assert.deepEqual(
      page.refs.describe,
      [API_KEY_REF],
      `${label}: the read must ask for that same reference`,
    )
    element.props.onSave()
    assert.deepEqual(
      page.refs.set,
      [[API_KEY_REF, 'as_sk_typed']],
      `${label}: the provider's documented default is the reference the provider resolves`,
    )
  }
})

test('an empty field never reaches the credentials service', async () => {
  const credential = { loaded: true, configured: true, writable: true, error: '' }
  const page = await renderCard({
    credential,
    form: { state: { value: { apiKeyEnv: 'ANYSEARCH_ALT' } } },
  })
  form(page.tree).props.onSave()
  assert.deepEqual(page.refs.set, [], 'a save with nothing staged must write nothing at all')
  assert.deepEqual(page.refs.clear, [], 'and it is certainly not a clear')
})

test('a staged key does not follow a re-pointed reference', async () => {
  const credential = { loaded: true, configured: true, writable: true, error: '' }
  const staged = { ref: 'ANYSEARCH_ALT', text: 'as_sk_half_typed' }
  const field = (page) => childrenOf(form(page.tree)).find((child) => child !== null && child.type === 'SettingsSecretField')

  const same = await renderCard({
    credential,
    form: { state: { value: { apiKeyEnv: 'ANYSEARCH_ALT' } } },
    states: [staged, credential, 'idle', '', false],
  })
  assert.equal(field(same).props.text, 'as_sk_half_typed', 'text typed for this reference stays staged')

  const rePointed = await renderCard({
    credential,
    form: { state: { value: { apiKeyEnv: 'ANYSEARCH_OTHER' } } },
    states: [staged, credential, 'idle', '', false],
  })
  assert.equal(field(rePointed).props.text, '', 'text typed for another reference must not ride a save into this one')
  form(rePointed.tree).props.onSave()
  assert.deepEqual(
    rePointed.refs.set,
    [],
    'a save after a re-point writes nothing, because nothing is staged for the reference now in force',
  )
})

test('a read that loses its reference paints nothing', async () => {
  /**
   * Render the page against a read that never resolves until the test says so.
   * @param options - whether React runs the effect's cleanup first, as it does
   * when the dependency (the reference) changes under a pending read.
   * @returns the state writes the component attempted.
   */
  const settleRead = async ({ cancel }) => {
    const hooks = { cleanups: [], sets: [] }
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const { record } = await boot({
      hooks,
      states: [
        { ref: API_KEY_REF, text: '' },
        { loaded: false, configured: false, writable: false, error: '' },
        'idle',
        '',
        false,
      ],
    })
    let cleanupsAtReadStart = -1
    record.registrations[0].component({
      view: 'page',
      form: { state: { value: { apiKeyEnv: API_KEY_REF } } },
      t: (key) => key,
      describe: async () => {
        // Effects register in declaration order, and this call is the read
        // effect's first act — so exactly one cleanup (the alive sentinel's) is
        // on record by now. That is what makes the cleanup captured below the
        // read's own rather than the sentinel's, which would suppress the paint
        // for the wrong reason and leave the cancellation untested.
        cleanupsAtReadStart = hooks.cleanups.length
        await gate
        return { configured: true, writable: true }
      },
      setKey: async () => {},
      clearKey: async () => {},
    })
    assert.equal(cleanupsAtReadStart, 1, 'the read effect must be the effect whose cleanup lands last')
    assert.equal(hooks.cleanups.length, 2, 'a new cleanup-registering effect must update this test')
    const readCleanup = hooks.cleanups[1]
    if (cancel) readCleanup()
    release()
    await new Promise((resolve) => setImmediate(resolve))
    return hooks.sets
  }

  /** The writes that painted a loaded badge, as opposed to the pre-read reset. */
  const paints = (sets) => sets.filter(([, next]) => next !== null && typeof next === 'object' && next.loaded === true)

  assert.deepEqual(
    paints(await settleRead({ cancel: true })),
    [],
    'a response that lost its reference must not paint the badge',
  )
  assert.ok(
    paints(await settleRead({ cancel: false })).length > 0,
    'a response that still owns the reference does paint it',
  )
})

test('a reference change starts the page over, phase included', async () => {
  // The reset runs on every reference change (`[ref]`), so one render is enough
  // to pin what it must clear. Clearing only the badge was a real bug: a save or
  // clear still in flight had its own `setPhase` skipped by the liveness guard,
  // and `busy` then stayed true forever — every control on the page disabled.
  const hooks = { cleanups: [], sets: [] }
  const { record } = await boot({
    hooks,
    states: [
      { ref: API_KEY_REF, text: '' },
      { loaded: true, configured: true, writable: true, error: '' },
      'saved',
      'boom',
      true,
    ],
  })
  record.registrations[0].component({
    view: 'page',
    form: { state: { value: { apiKeyEnv: API_KEY_REF } } },
    t: (key) => key,
    describe: async () => ({ configured: true, writable: true }),
    setKey: async () => {},
    clearKey: async () => {},
  })
  const slot = { credential: 1, phase: 2, failure: 3, confirming: 4 }
  const wrote = (index, matches) => hooks.sets.some(([at, next]) => at === index && matches(next))
  assert.ok(wrote(slot.credential, (v) => v !== null && v.loaded === false), 'the badge goes back to "reading"')
  assert.ok(wrote(slot.phase, (v) => v === 'idle'), 'an in-flight or settled phase is cleared, so `busy` cannot stick')
  assert.ok(wrote(slot.failure, (v) => v === ''), 'no stale failure stays on screen')
  assert.ok(wrote(slot.confirming, (v) => v === false), 'no stale clear-confirmation stays armed')
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
