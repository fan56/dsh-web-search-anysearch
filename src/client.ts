/**
 * Client (browser) half of `@aiwayds/dsh-web-search-anysearch`.
 *
 * The provider is a Host-plane plugin; the one thing a browser can add for it is
 * the API-key row on the plugin's own page in the Plugins section. DSH gives a
 * bundle row a "Configure" control only while some Client half claims the keyed
 * `plugins.row.config` slot under `<package name>#<row id>`, so this file claims
 * this package's own row — the id `cordis.patch.yml` declares.
 *
 * The key never enters a configuration file: it is written through the official
 * `ctx.remote.credentials` namespace into the Host's managed credentials
 * document, under the same reference the provider resolves (`apiKeyEnv`,
 * default `ANYSEARCH_API_KEY`). The provider re-resolves that reference on every
 * search, so a saved (or cleared) key applies to the next search with no
 * restart.
 *
 * Artifact form: the browser module table loads a classic script that registers a
 * lazy factory with `window.__ModuleLoader__.load`. This source is therefore a
 * global script — no imports, no exports — which the existing `tsc` build emits
 * verbatim, so no Client bundler is added to this repository. The IIFE keeps
 * every name out of the page's global namespace and out of the generated
 * declaration file.
 */
void (function anysearchApiKeyRow() {
  /** Package name; also the id this Client artifact must register its factory under. */
  const PACKAGE = '@aiwayds/dsh-web-search-anysearch'

  /** Row id this package's bundle patch declares — the row whose page this registers. */
  const ROW_ID = 'web-search-anysearch'

  /** `plugins.row.config` key: `<package name>#<row id>`. */
  const ROW_KEY = `${PACKAGE}#${ROW_ID}`

  /**
   * Credential reference this row writes. Spelled out rather than imported: a
   * Client half must not depend on a Host package, and this is the provider's
   * documented `apiKeyEnv` default (`src/index.ts`).
   */
  const API_KEY_REF = 'ANYSEARCH_API_KEY'

  /** Dictionary namespace owned by this page. */
  const NS = 'settings.anysearchApiKey'

  /** One credential reference as the Host reports it. */
  interface CredentialView {
    configured: boolean
    writable: boolean
  }

  /** What the row learns about the reference it writes. */
  interface CredentialState {
    configured: boolean
    writable: boolean
  }

  /** A Remote call's envelope: a value, or a refusal the page shows verbatim. */
  interface RemoteResult<T> {
    ok?: boolean
    value?: T
    error?: unknown
  }

  /** The credentials namespace this row writes through. */
  interface CredentialsSeam {
    describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialView>>>
    set(ref: string, value: string): Promise<RemoteResult<unknown>>
    unset(ref: string): Promise<RemoteResult<unknown>>
  }

  /** The slice of the Client context this page uses. */
  interface ClientContext {
    effect(callback: () => (() => void) | void, label?: string): void
    locale: {
      bind(ns: string): (key: string) => string
      register(ns: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
    }
    slots: {
      inject(name: string, callback: () => unknown): () => void
      register(
        options: { name: string; key: string; locale: string; inject: () => Record<string, unknown> },
        component: unknown,
      ): unknown
    }
    remote?: { credentials?: CredentialsSeam }
  }

  /** The slot's own props plus this page's inject face. */
  interface CardProps {
    /** `summary` asks for the row's one-liner; `page` for the form. */
    view: 'summary' | 'page'
    t(key: string): string
    describe(): Promise<CredentialState>
    setKey(value: string): Promise<void>
    clearKey(): Promise<void>
  }

  /** The pieces of `@deepseek-ai/dsh-client-ui-primitives` this page renders with. */
  interface Primitives {
    SettingsForm: unknown
    SettingsSecretField: unknown
    Button: unknown
  }

  /**
   * Resolve the shared primitives module, or `undefined` when the host's web
   * client no longer serves the id. `require` throws inside the module-loader
   * factory when the specifier is absent from the client bundle's registry —
   * that throw must never escape the factory (it would break the whole page
   * at materialization), so every call site gets an explicit degrade path.
   */
  function tryRequirePrimitives(
    require: (specifier: string) => unknown,
  ): Primitives | undefined {
    try {
      const mod = require('@deepseek-ai/dsh-client-ui-primitives') as
        | Partial<Primitives>
        | undefined
      if (
        mod === undefined ||
        mod.SettingsForm === undefined ||
        mod.SettingsSecretField === undefined ||
        mod.Button === undefined
      ) {
        return undefined
      }
      return mod as Primitives
    } catch {
      return undefined
    }
  }

  /** Which credential action is in flight, and what the last one settled as. */
  type Phase = 'idle' | 'saving' | 'clearing' | 'saved' | 'cleared' | 'failed'

  /** Simplified Chinese copy. */
  const zh: Record<string, string> = {
    summary: '用你自己的 AnySearch 凭据驱动 web_search（匿名也能搜，配的是限额）。',
    apiKey: 'API Key',
    apiKeyHint: '写入凭据文件的 ANYSEARCH_API_KEY；留空表示保持当前密钥。',
    keySet: '已配置密钥',
    keyUnset: '未配置（匿名限额）',
    loading: '正在读取凭据状态…',
    loadFailed: '读取凭据状态失败。',
    unavailable: '本部署没有提供凭据服务，无法在这里写入密钥。',
    readOnly: '凭据来源是只读的，无法在这里写入。',
    uiUnavailable: '当前 dsh web 前端不提供本页依赖的界面组件（client-ui-primitives），请升级 dsh 后重试。',
    save: '保存',
    saving: '保存中…',
    saved: '已保存，下一次搜索即生效。',
    saveFailed: '操作未成功；没有写入任何东西。',
    clear: '清除密钥',
    clearConfirm: '确认清除',
    clearCancel: '取消',
    cleared: '已清除密钥；搜索回到匿名限额。',
    clearFailed: '清除失败：',
  }

  /** English copy; keys must match `zh` exactly. */
  const en: Record<string, string> = {
    summary: 'Drives web_search with your own AnySearch credential (anonymous works too, at lower limits).',
    apiKey: 'API key',
    apiKeyHint: 'Stores the ANYSEARCH_API_KEY credential; leave blank to keep the current key.',
    keySet: 'A key is configured',
    keyUnset: 'No key (anonymous limits)',
    loading: 'Reading credential state…',
    loadFailed: 'Could not read the credential state.',
    unavailable: 'This deployment serves no credential service, so a key cannot be written here.',
    readOnly: 'The credential source is read-only, so a key cannot be written here.',
    uiUnavailable: 'This dsh web frontend does not serve the UI components (client-ui-primitives) this page renders with; upgrade dsh and retry.',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved; it applies to the next search.',
    saveFailed: 'The deployment refused it; nothing was written.',
    clear: 'Clear key',
    clearConfirm: 'Clear it',
    clearCancel: 'Cancel',
    cleared: 'Key cleared; searches are back to the anonymous limits.',
    clearFailed: 'Clear failed: ',
  }

  /** Flatten anything thrown — an Error, a Remote refusal, or a bare object — into one line of copy. */
  function messageOf(error: unknown): string {
    if (error === undefined || error === null) return ''
    if (typeof error === 'string') return error
    if (typeof error === 'object') {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) return message
    }
    return String(error)
  }

  /** Resolve the credentials namespace, or fail with something a reader can act on. */
  function credentialsSeam(ctx: ClientContext): CredentialsSeam {
    const seam = ctx.remote === undefined ? undefined : ctx.remote.credentials
    if (
      seam === undefined ||
      typeof seam.describe !== 'function' ||
      typeof seam.set !== 'function' ||
      typeof seam.unset !== 'function'
    ) {
      throw new Error('ctx.remote.credentials is unavailable in this deployment')
    }
    return seam
  }

  /**
   * A Remote refusal arrives either as a `{ok: false}` envelope or as a throw;
   * both become one exception the page turns into its failure copy.
   */
  function unwrap<T>(result: RemoteResult<T> | undefined, method: string): RemoteResult<T> | undefined {
    if (result === undefined || result === null || result.ok === undefined || result.ok === true) return result
    throw new Error(messageOf(result.error) || `${method} was refused`)
  }

  /** Read whether the reference this row writes currently holds a key, and whether it is writable. */
  async function readCredential(ctx: ClientContext): Promise<CredentialState> {
    const response = unwrap(await credentialsSeam(ctx).describe([API_KEY_REF]), 'credentials.describe')
    const view = response === undefined || response.value === undefined ? undefined : response.value[API_KEY_REF]
    return {
      configured: view !== undefined && view.configured === true,
      writable: !(view !== undefined && view.writable === false),
    }
  }

  const loader = (globalThis as unknown as {
    __ModuleLoader__?: { load(entry: { id: string; factory: (require: (specifier: string) => any) => unknown }): void }
  }).__ModuleLoader__

  if (loader === undefined) return

  loader.load({
    id: PACKAGE,
    factory(require) {
      const React = require('react')
      const h = React.createElement
      // The shared primitives specifier is resolved try-style, on purpose.
      // The npm package left the host's dependency graph in dsh 0.2.1 (the
      // web client UI rework folded it into the core bundle), but the module
      // id itself lives on in the deployed web client's specifier table —
      // every official settings page, including rc.2's own web-search
      // settings page, requires the exact same specifier inside the same
      // `__ModuleLoader__` factory pattern. Should a future host drop the id
      // after all, a throwing factory would take this whole plugin page down
      // at materialization; the catch keeps the row alive and the card
      // degrades to a readable notice below.
      const primitives = tryRequirePrimitives(require)
      const SettingsForm = primitives?.SettingsForm
      const SettingsSecretField = primitives?.SettingsSecretField
      const Button = primitives?.Button

      // `require` hands back untyped modules; these four bindings are the only
      // React surface this page uses, typed so the component body stays checked.
      const useState = React.useState as <T>(initial: T) => [T, (next: T) => void]
      const useEffect = React.useEffect as (effect: () => (() => void) | void, deps?: unknown[]) => void
      const useRef = React.useRef as <T>(initial: T) => { current: T }
      const useCallback = React.useCallback as <T extends (...args: never[]) => unknown>(callback: T, deps: unknown[]) => T

      /** The row's configuration page: one write-only key field, plus the clear that removes it. */
      function ApiKeyCard(props: CardProps) {
        const t = props.t
        const [draft, setDraft] = useState('')
        const [credential, setCredential] = useState<{
          loaded: boolean
          configured: boolean
          writable: boolean
          error: string
        }>({ loaded: false, configured: false, writable: true, error: '' })
        const [phase, setPhase] = useState<Phase>('idle')
        const [failure, setFailure] = useState('')
        const [confirming, setConfirming] = useState(false)
        const alive = useRef(true)

        useEffect(() => {
          // Set inside the effect body (not just cleared in the cleanup) so a
          // StrictMode double-mount re-arms the sentinel instead of leaving
          // the page permanently in the loading state.
          alive.current = true
          return () => {
            alive.current = false
          }
        }, [])

        const load = useCallback(async () => {
          try {
            const next = await props.describe()
            if (!alive.current) return
            setCredential({ loaded: true, configured: next.configured, writable: next.writable, error: '' })
          } catch (error) {
            if (!alive.current) return
            setCredential({ loaded: false, configured: false, writable: false, error: messageOf(error) })
          }
        }, [props.describe])

        useEffect(() => {
          void load()
        }, [load])

        /** Run one credential action, then re-read the state it changed. */
        const settle = useCallback(
          async (run: () => Promise<void>, kind: 'save' | 'clear') => {
            setPhase(kind === 'save' ? 'saving' : 'clearing')
            setFailure('')
            try {
              await run()
              if (!alive.current) return
              setDraft('')
              setConfirming(false)
              setPhase(kind === 'save' ? 'saved' : 'cleared')
              await load()
            } catch (error) {
              if (!alive.current) return
              setPhase('failed')
              setFailure(messageOf(error))
            }
          },
          [load],
        )

        // The row's detail page asks for `summary` only when the package ships no
        // description of its own; either way it is one line, not the form.
        if (props.view === 'summary') return t('summary')

        // Degraded host: the web client no longer serves the primitives id
        // (defensive — verified present in every shipped core bundle through
        // dsh 0.2.1-rc.2). One readable line instead of a broken form.
        if (primitives === undefined) {
          return h(
            'p',
            { role: 'status', style: { margin: '0', fontSize: '13px', lineHeight: '20px' } },
            t('uiUnavailable'),
          )
        }

        const busy = phase === 'saving' || phase === 'clearing'
        const labels = {
          unavailable: credential.error === '' ? t('loading') : `${t('loadFailed')} ${credential.error}`,
          readOnly: t('readOnly'),
          saveFailed: t('saveFailed'),
          save: t('save'),
          saving: t('saving'),
        }
        const state = {
          available: credential.loaded,
          writable: credential.writable,
          dirty: draft.trim().length > 0,
          invalid: false,
          saving: busy,
          failed: phase === 'failed',
        }

        const controls: unknown[] = [
          h(SettingsSecretField, {
            key: 'key',
            id: 'anysearch-api-key',
            label: t('apiKey'),
            hint: t('apiKeyHint'),
            disabled: !credential.writable || busy,
            text: draft,
            configured: credential.configured,
            stateLabel: credential.configured ? t('keySet') : t('keyUnset'),
            onEdit: (text: string) => {
              setDraft(text)
              if (!busy) {
                setPhase('idle')
                setFailure('')
              }
            },
          }),
        ]

        // Clearing is destructive and immediate, so it takes a second click. It is
        // offered only where a write is possible at all: a key supplied by the
        // launching environment cannot be removed from here.
        if (credential.configured && credential.writable) {
          controls.push(
            h(
              'div',
              { key: 'clear', style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              confirming
                ? [
                    h(
                      Button,
                      {
                        key: 'confirm',
                        variant: 'primary',
                        size: 'sm',
                        disabled: busy,
                        onClick: () => {
                          void settle(() => props.clearKey(), 'clear')
                        },
                      },
                      t('clearConfirm'),
                    ),
                    h(
                      Button,
                      {
                        key: 'cancel',
                        variant: 'ghost',
                        size: 'sm',
                        disabled: busy,
                        onClick: () => {
                          setConfirming(false)
                        },
                      },
                      t('clearCancel'),
                    ),
                  ]
                : h(
                    Button,
                    {
                      key: 'ask',
                      variant: 'outline',
                      size: 'sm',
                      disabled: busy,
                      onClick: () => {
                        setConfirming(true)
                      },
                    },
                    t('clear'),
                  ),
            ),
          )
        }

        const notice =
          credential.loaded && phase === 'saved'
            ? t('saved')
            : credential.loaded && phase === 'cleared'
              ? t('cleared')
              : phase === 'failed' && failure !== ''
                ? failure
                : ''

        return h('div', { style: { display: 'flex', flexDirection: 'column' } }, [
          h(
            SettingsForm,
            {
              key: 'form',
              labels,
              state,
              onSave: () => {
                void settle(() => props.setKey(draft.trim()), 'save')
              },
              onDiscard: () => {
                setDraft('')
                setPhase('idle')
                setFailure('')
                setConfirming(false)
              },
            },
            controls,
          ),
          notice === ''
            ? null
            : h(
                'p',
                {
                  key: 'notice',
                  role: 'status',
                  style: {
                    margin: '8px 0 0',
                    fontSize: '13px',
                    lineHeight: '20px',
                    color:
                      phase === 'failed'
                        ? 'var(--dsw-alias-state-error-primary)'
                        : 'var(--dsw-alias-label-tertiary)',
                  },
                },
                notice,
              ),
        ])
      }

      /**
       * Required Client services. `remote` and `remote.credentials` must be
       * declared: reading `ctx.remote` without them throws, and this page has
       * nothing to show if that happens.
       */
      const inject = ['slots', 'locale', 'remote', 'remote.credentials']

      /** Register the row page and the copy it renders. */
      function apply(ctx: ClientContext): void {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${PACKAGE}: dictionaries`)
        const actions = {
          t,
          describe: () => readCredential(ctx),
          setKey: async (value: string) => {
            unwrap(await credentialsSeam(ctx).set(API_KEY_REF, value), 'credentials.set')
          },
          clearKey: async () => {
            unwrap(await credentialsSeam(ctx).unset(API_KEY_REF), 'credentials.unset')
          },
        }
        // `slots.inject` rather than a bare `register`: the Plugins page declares
        // `plugins.row.config` when it mounts, which can follow this activation.
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: ROW_KEY,
              locale: NS,
              inject: () => actions,
            },
            ApiKeyCard,
          ),
        )
      }

      return { inject, apply }
    },
  })
})()
