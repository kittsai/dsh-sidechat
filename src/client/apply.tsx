/**
 * Side chat plugin, browser half: hover-to-open hot zone over `shell.overlay`,
 * the chat panel in the right `details` column, and a selection-triggered
 * "add to side chat" button. The panel is a focused project Q&A surface:
 * model/effort selection, streaming replies with collapsible reasoning, table
 * markdown, and a confirm-guarded clear — driven through the host `sidechat`
 * Remote (see dsh-sidechat).
 * @module dsh-sidechat/client
 */

import * as React from 'react'
import { useEffect, useState, type ReactElement } from 'react'
import type { ClientContext, SessionId, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the ui-layout SlotMap merge (shell.overlay / details seats).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the ui-settings slot map (settings.section) and the
// ctx.settingsScope service declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the Host Remote merge (ctx.remote.sidechat).
import type {} from './typert.d.ts'
import { TYPERT_REMOTE } from './remote.ts'
import { SIDECHAT_SETTINGS_DEFAULT, SIDECHAT_SETTINGS_NAMESPACE, type SidechatSettings } from './settings.ts'
import css from './sidechat.module.css'

/** Required services: slot registry, layout transitions, the Host Remote, and the settings scope binder. */
export const inject = ['slots', 'layout', 'remote', 'settingsScope']

/** One mounted `sidechat` namespace, obtained via ctx.get after $mount. */
type SidechatNamespace = TypertRemoteNamespaceMap['sidechat']

/** Local face of the layout service (ui-layout provides it). */
interface LayoutFace {
  openDetails(): void
  closeDetails(): void
}

/** Structural remote-result face shared by every generated Remote method. */
type RemoteResultLike<T> = { ok: true; value: T } | { ok: false; error: { message: string; code: string } }

/** Unwrap one remote result into its value, throwing the wire error. */
async function callRemote<T>(call: () => Promise<RemoteResultLike<T>>): Promise<T> {
  const result = await call()
  if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
  return result.value
}

/** One rendered side-chat message (owned plain copy, never a live handle). */
interface SidechatMessage {
  id: string
  role: string
  content: string
  reasoning: string
  error: string | null
}

/** One session's side-chat state; each conversation owns an independent entry. */
interface SessionChatState {
  modelKey: string
  effort: string
  messages: SidechatMessage[]
  input: string
  busy: boolean
  jobId: string | null
  error: string | null
}

function emptySessionChatState(): SessionChatState {
  return {
    modelKey: '',
    effort: '',
    messages: [],
    input: '',
    busy: false,
    jobId: null,
    error: null,
  }
}

/**
 * Per-session chat state, keyed by session id and kept OUTSIDE the panel
 * component so it survives remounts. The `details` slot is session-scoped and
 * the web renderer remounts its occupant whenever the current session changes
 * (StrictSessionEntry keys by sessionId), which would wipe component-local
 * state; keeping one entry per session here and seeding it back on mount gives
 * every conversation its own side chat instead of one panel shared by all
 * sessions.
 */
const sessionStores = new Map<string, SessionChatState>()
function getSessionStore(sessionId: string): SessionChatState {
  let entry = sessionStores.get(sessionId)
  if (entry === undefined) {
    entry = emptySessionChatState()
    sessionStores.set(sessionId, entry)
  }
  return entry
}

/**
 * Panel-level state shared across sessions: open/closed visibility, the
 * selection-send one-shot trigger, the mounted panel's send hook, and the
 * durable enabled master switch. Chat content lives per session in
 * `sessionStores`.
 */
const store: {
  open: boolean
  pendingSend: string | null
  sendHook: ((text: string) => void) | null
  enabled: boolean
} = {
  open: false,
  pendingSend: null,
  sendHook: null,
  enabled: SIDECHAT_SETTINGS_DEFAULT.enabled,
}
const subscribers = new Set<() => void>()
const setOpenShared = (value: boolean, layout?: LayoutFace): void => {
  store.open = value
  if (layout !== undefined) {
    try {
      if (value) layout.openDetails()
      else layout.closeDetails()
    } catch { /* layout transition failed; keep local state */ }
  }
  subscribers.forEach(listener => listener())
}

/** Live settings-scope handle, bound in apply; drives the enabled master switch. */
let settingsScopeHandle: SettingsScope<SidechatSettings> | undefined

/** Publish one enabled-state change through the settings scope (persisted). */
const setEnabledShared = (value: boolean): void => {
  store.enabled = value
  subscribers.forEach(listener => listener())
  void settingsScopeHandle?.set('enabled', value)
}

/** Subscribe a component to the enabled master switch. */
function useEnabled(): boolean {
  const [enabled, setState] = useState(store.enabled)
  useEffect(() => {
    const listener = () => setState(store.enabled)
    subscribers.add(listener)
    return () => { subscribers.delete(listener) }
  }, [])
  return enabled
}

interface ModelOption {
  id: string
  name: string
  reasoning?: { efforts: { id: string; name: string }[]; defaultEffort: string | null }
}

interface ModelGroup {
  id: string
  name: string
  models: ModelOption[]
}

const isHr = (line: string): boolean => /^-{3,}$/.test(line) || /^\*{3,}$/.test(line) || /^_{3,}$/.test(line)

/** Split one markdown table row into cells, or null when the line is not a row. */
function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null
  return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

/** Inline markdown spans: code, bold, italic, links. */
function renderInline(text: string): (string | ReactElement)[] {
  const nodes: (string | ReactElement)[] = []
  const tokenRe = /(`+)([\s\S]*?)\1|(\*\*|__)([\s\S]*?)\3|(\*|_)([\s\S]*?)\5|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const codeDelim = match[1]
    if (codeDelim !== undefined) {
      nodes.push(<code key={`md-c-${key++}`}>{match[2] ?? ''}</code>)
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={`md-s-${key++}`}>{...renderInline(match[4] ?? '')}</strong>)
    } else if (match[5] !== undefined) {
      nodes.push(<em key={`md-e-${key++}`}>{...renderInline(match[6] ?? '')}</em>)
    } else if (match[7] !== undefined && match[8] !== undefined) {
      nodes.push(<a key={`md-a-${key++}`} className={css.mdLink} href={match[8]} target="_blank" rel="noreferrer">{match[7]}</a>)
    }
    last = tokenRe.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Lightweight markdown → React renderer (text-only output; never raw HTML). */
function renderMarkdown(text: string): (string | ReactElement)[] {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const nodes: (string | ReactElement)[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()
    const fence = /^```(\w*)\s*$/.exec(trimmed)
    if (fence !== null) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test((lines[i] ?? '').trim())) { body.push(lines[i] ?? ''); i += 1 }
      i += 1
      nodes.push(<pre key={`md-pre-${nodes.length}`} className={css.mdPre}><code className={css.mdCodeblock}>{body.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      const level = heading[1]?.length ?? 1
      nodes.push(React.createElement(`h${level}`, { key: `md-h-${nodes.length}`, className: `${css.mdH} ${css[`mdH${level}`]}` }, ...renderInline(heading[2] ?? '')))
      i += 1
      continue
    }
    const headerCells = splitTableRow(line)
    const nextCells = i + 1 < lines.length ? splitTableRow(lines[i + 1] ?? '') : null
    if (headerCells !== null && nextCells !== null
      && nextCells.length >= 2 && nextCells.every(cell => /^:?-+:?$/.test(cell))) {
      const bodyRows: string[][] = []
      i += 2
      while (i < lines.length) {
        const cells = splitTableRow(lines[i] ?? '')
        if (cells === null || (lines[i] ?? '').trim() === '') break
        bodyRows.push(cells)
        i += 1
      }
      nodes.push(React.createElement('table', { key: `md-table-${nodes.length}`, className: css.mdTable },
        React.createElement('thead', null,
          React.createElement('tr', null, headerCells.map((cell, idx) =>
            React.createElement('th', { key: idx }, ...renderInline(cell)))),
        ),
        React.createElement('tbody', null,
          bodyRows.map((row, ri) =>
            React.createElement('tr', { key: ri },
              row.map((cell, ci) =>
                React.createElement('td', { key: ci }, ...renderInline(cell))))),
        ),
      ))
      continue
    }
    if (isHr(trimmed)) {
      nodes.push(<hr key={`md-hr-${nodes.length}`} className={css.mdHr} />)
      i += 1
      continue
    }
    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test((lines[i] ?? '').trim())) { quote.push((lines[i] ?? '').trim().replace(/^>\s?/, '')); i += 1 }
      nodes.push(<blockquote key={`md-q-${nodes.length}`} className={css.mdQuote}><p>{...renderInline(quote.join(' '))}</p></blockquote>)
      continue
    }
    const ulMatch = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    const olMatch = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
    if (ulMatch !== null || olMatch !== null) {
      const ordered = olMatch !== null
      const items: ReactElement[] = []
      while (i < lines.length) {
        const m2 = /^(\s*)[-*+]\s+(.*)$/.exec(lines[i] ?? '')
        const m3 = /^(\s*)\d+[.)]\s+(.*)$/.exec(lines[i] ?? '')
        if (ordered ? m3 !== null : m2 !== null) {
          items.push(<li key={`md-li-${items.length}`}>{...renderInline((ordered ? m3![2] : m2![2]) ?? '')}</li>)
          i += 1
        } else if (/^\s+/.test(lines[i] ?? '') && (lines[i] ?? '').trim() !== '') {
          i += 1
        } else break
      }
      nodes.push(React.createElement(ordered ? 'ol' : 'ul', { key: `md-ul-${nodes.length}`, className: css.mdList }, items))
      continue
    }
    if (trimmed === '') { i += 1; continue }
    const paragraph = [line]
    i += 1
    while (i < lines.length) {
      const t = (lines[i] ?? '').trim()
      if (t === '') break
      if (/^```/.test(t) || /^#{1,6}\s/.test(t) || /^>\s?/.test(t) || isHr(t) || /^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) break
      paragraph.push(lines[i] ?? '')
      i += 1
    }
    nodes.push(<p key={`md-p-${nodes.length}`} className={css.mdP}>{...renderInline(paragraph.join(' '))}</p>)
  }
  return nodes
}

/** Hover hot zone over the right edge; hidden while the panel is disabled. */
function HotZone({ layout }: { layout: LayoutFace | undefined }): ReactElement | null {
  const enabled = useEnabled()
  if (!enabled) return null
  return (
    <div
      className={css.hotzone}
      onMouseEnter={() => { setOpenShared(true, layout) }}
      aria-hidden="true"
    />
  )
}

/** Selection-triggered button: sends the main-chat selection into the side chat. */
function SelectionSendButton(): ReactElement | null {
  const enabled = useEnabled()
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [selectedText, setSelectedText] = useState('')
  useEffect(() => {
    const onSelectionChange = (): void => {
      try {
        const selection = window.getSelection()
        const value = selection?.toString().trim() ?? ''
        if (value === '') {
          setPosition(null)
          setSelectedText('')
          return
        }
        const node = selection?.anchorNode
        const el = node !== null && node !== undefined && node.nodeType === 1 ? node : (node !== null && node !== undefined ? node.parentElement : null)
        if (el instanceof Element && el.closest('.sidechatPanel') !== null) {
          setPosition(null)
          setSelectedText('')
          return
        }
        const range = selection?.getRangeAt(0)
        if (range === undefined) { setPosition(null); return }
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) { setPosition(null); return }
        setSelectedText(value.slice(0, 2000))
        setPosition({ x: Math.max(0, rect.left), y: Math.max(0, rect.top) })
      } catch { setPosition(null) }
    }
    window.document.addEventListener('selectionchange', onSelectionChange)
    window.document.addEventListener('mouseup', onSelectionChange)
    return () => {
      window.document.removeEventListener('selectionchange', onSelectionChange)
      window.document.removeEventListener('mouseup', onSelectionChange)
    }
  }, [])
  if (position === null || selectedText === '' || !enabled) return null
  return React.createElement('button', {
    className: css.sendsel,
    type: 'button',
    style: { left: `${position.x}px`, top: `${position.y}px` },
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onClick: () => {
      store.pendingSend = selectedText
      setOpenShared(true, undefined)
      setPosition(null)
      setSelectedText('')
    },
  }, '添加到侧边聊天')
}

/** Full panel props: the details runtime share plus the plugin context. */
interface PanelProps {
  ctx: ClientContext
  sidechat: SidechatNamespace
  sessionId: SessionId
}

/** The side-chat panel occupying the right details column. */
function Panel(props: PanelProps): ReactElement | null {
  const { ctx, sidechat, sessionId } = props
  const enabled = useEnabled()
  // Seed every panel field from THIS session's own store so a session-switch
  // remount restores exactly that conversation's side chat (messages,
  // in-flight job, model choice, draft); the sync lines below mirror every
  // change back into the session entry.
  const chat = getSessionStore(String(sessionId))
  const [modelCatalog, setModelCatalog] = useState<{ groups: ModelGroup[]; current: { provider: string; model: string } | null } | null>(null)
  const [modelKey, setModelKey] = useState(chat.modelKey)
  const [effort, setEffort] = useState(chat.effort)
  const [messages, setMessages] = useState<SidechatMessage[]>(chat.messages)
  const [input, setInput] = useState(chat.input)
  const [busy, setBusy] = useState(chat.busy)
  const [jobId, setJobId] = useState<string | null>(chat.jobId)
  const [error, setError] = useState<string | null>(chat.error)
  const [confirmClear, setConfirmClear] = useState(false)

  chat.modelKey = modelKey
  chat.effort = effort
  chat.messages = messages
  chat.input = input
  chat.busy = busy
  chat.jobId = jobId
  chat.error = error

  const findModel = (key: string): ModelOption | null => {
    if (key === '') return null
    const parts = key.split('/')
    if (parts.length !== 2) return null
    for (const group of modelCatalog?.groups ?? []) {
      if (group.id !== parts[0]) continue
      for (const model of group.models) if (model.id === parts[1]) return model
    }
    return null
  }

  useEffect(() => {
    let cancelled = false
    setError(null)
    void callRemote(() => sidechat.models()).then(value => {
      if (!cancelled) setModelCatalog(value)
    }, () => { /* catalog load failure is non-fatal */ })
    return () => { cancelled = true }
  }, [ctx])

  useEffect(() => {
    if (modelKey !== '' || modelCatalog?.current == null) return
    const { provider, model } = modelCatalog.current
    if (provider === '' || model === '') return
    if (findModel(`${provider}/${model}`) !== null) setModelKey(`${provider}/${model}`)
  }, [modelCatalog])

  useEffect(() => {
    if (modelKey === '') { setEffort(''); return }
    const info = findModel(modelKey)
    const def = info?.reasoning?.defaultEffort
    setEffort(typeof def === 'string' && def.length > 0 ? def : '')
  }, [modelKey])

  useEffect(() => {
    if (jobId === null) return
    const timer = window.setInterval(() => {
      void callRemote(() => sidechat.poll({ jobId })).then(value => {
        setMessages(prev => prev.map(message => (
          message.id === jobId
            ? { ...message, content: value.text, reasoning: value.reasoning, error: value.error }
            : message
        )))
        if (value.done) {
          setJobId(null)
          setBusy(false)
          if (value.error !== null) setError(value.error)
        }
      }, (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
        setJobId(null)
        setBusy(false)
      })
    }, 200)
    return () => { window.clearInterval(timer) }
  }, [ctx, jobId])

  const send = (externalText?: string): void => {
    const text = (externalText !== undefined && externalText !== null ? externalText : input).trim()
    if (text === '' || busy) return
    const userMessage = { id: `user-${Date.now()}`, role: 'user', content: text, reasoning: '', error: null }
    const history = messages.concat([userMessage])
      .filter(message => message.content !== '')
      .map(message => ({ role: message.role, content: message.content }))
    setMessages(prev => prev.concat([userMessage]))
    setInput('')
    setBusy(true)
    setError(null)
    const args: { sessionId: string; messages: { role: string; content: string }[]; provider?: string; model?: string; reasoningEffort?: string } = {
      sessionId: String(sessionId),
      messages: history,
    }
    if (modelKey !== '') {
      const parts = modelKey.split('/')
      const provider = parts[0]
      const model = parts[1]
      if (provider !== undefined && model !== undefined) {
        args.provider = provider
        args.model = model
        if (effort !== '') args.reasoningEffort = effort
      }
    }
    void callRemote(() => sidechat.start(args)).then(value => {
      setJobId(value.jobId)
      setMessages(prev => prev.concat([{ id: value.jobId, role: 'assistant', content: '', reasoning: '', error: null }]))
    }, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    })
  }
  store.sendHook = send

  useEffect(() => {
    if (!store.open) return
    const timer = window.setInterval(() => {
      if (store.pendingSend !== null && store.pendingSend !== undefined && store.pendingSend !== '') {
        const value = store.pendingSend
        store.pendingSend = null
        const hook = store.sendHook
        if (typeof hook === 'function') hook(value)
      }
    }, 200)
    return () => { window.clearInterval(timer) }
  }, [])

  const stop = (): void => {
    if (jobId !== null) {
      void sidechat.stop({ jobId }).then(() => {}, () => {})
      setJobId(null)
      setBusy(false)
    }
  }

  const clear = (): void => {
    stop()
    setMessages([])
    setError(null)
    setConfirmClear(false)
  }

  const modelOptions: ReactElement[] = []
  for (const group of modelCatalog?.groups ?? []) {
    const options = group.models.map(model => (
      <option key={`${group.id}/${model.id}`} value={`${group.id}/${model.id}`}>{model.name}</option>
    ))
    modelOptions.push(<optgroup key={`g-${group.id}`} label={group.name}>{options}</optgroup>)
  }
  const selectedModel = findModel(modelKey)
  const efforts = selectedModel?.reasoning?.efforts ?? []
  const effortSelect = efforts.length > 0 ? (
    <select className={css.select} value={effort} title="推理等级" onChange={event => setEffort(event.target.value)}>
      {efforts.map(effortOption => <option key={effortOption.id} value={effortOption.id}>{effortOption.name}</option>)}
    </select>
  ) : null

  const messageNodes = messages.map(message => {
    const isUser = message.role === 'user'
    const body = isUser
      ? message.content
      : (message.content === '' && busy ? '…' : renderMarkdown(message.content))
    const reasoningBlock = !isUser && message.reasoning !== ''
      ? (
        <details className={css.reasoning} open={busy}>
          <summary>💭 思考过程</summary>
          <div className={css.reasoningBody}>{message.reasoning}</div>
        </details>
      )
      : null
    return (
      <div key={message.id} className={isUser ? `${css.msg} ${css.msgUser}` : `${css.msg} ${css.msgAssistant}`}>
        <div className={css.msgRole}>{isUser ? '你' : '助手'}</div>
        {reasoningBlock}
        <div className={css.msgBody}>{body}</div>
        {message.error !== null ? <div className={css.msgError}>{message.error}</div> : null}
      </div>
    )
  })

  return (
    <div className={`${css.panel} sidechatPanel`} role="dialog" aria-label="侧边聊天">
      <div className={css.header}>
        <span className={css.headerTitle}>侧边聊天</span>
        <button className={css.iconBtn} type="button" title="清空对话，开始新的侧边聊天" onClick={() => setConfirmClear(true)}>清空</button>
        <button className={css.iconBtn} type="button" title="关闭" onClick={() => setOpenShared(false, ctx.get('layout') as LayoutFace | undefined)}>✕</button>
      </div>
      {confirmClear ? (
        <div className={css.confirm}>
          <span>清空后内容不可恢复，确认清空？</span>
          <button className={`${css.confirmBtn} ${css.confirmBtnDanger}`} type="button" onClick={clear}>确认清空</button>
          <button className={css.confirmBtn} type="button" onClick={() => setConfirmClear(false)}>取消</button>
        </div>
      ) : null}
      {error !== null ? <div className={css.error}>{error}</div> : null}
      <div className={css.messages}>
        {messageNodes.length === 0 ? (
          <div className={css.empty}>可以问项目或旁边对话相关的问题。</div>
        ) : messageNodes}
      </div>
      <div className={css.composer}>
        <div className={css.inputRow}>
          <textarea
            className={css.input}
            value={input}
            placeholder="提问…"
            rows={2}
            disabled={busy}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
          />
          <button
            className={css.send}
            type="button"
            disabled={!busy && input.trim() === ''}
            onClick={busy ? stop : () => send()}
          >{busy ? '停止' : '发送'}</button>
        </div>
        <div className={css.composerTools}>
          <select className={css.select} value={modelKey} title="侧边聊天的回复模型" onChange={event => setModelKey(event.target.value)}>
            {modelOptions}
          </select>
          {effortSelect}
        </div>
      </div>
      <div className={css.tip}>侧边聊天只是临时聊天</div>
    </div>
  )
}

/** Settings-panel section: the side-chat master switch. */
function SidechatSettingsSection(): ReactElement {
  const enabled = useEnabled()
  return (
    <div className={css.settingsSection}>
      <div className={css.settingsRow}>
        <div className={css.settingsText}>
          <div className={css.settingsTitle}>侧边聊天</div>
          <div className={css.settingsDesc}>开启后，鼠标悬停浏览器右边缘可打开侧边聊天面板。</div>
        </div>
        <label className={css.switch}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={event => setEnabledShared(event.target.checked)}
          />
          <span className={css.switchTrack} aria-hidden="true" />
        </label>
      </div>
      <div className={css.settingsTip}>侧边聊天只是临时聊天，不会写入主会话，也不会执行工具。</div>
    </div>
  )
}

/**
 * Browser plugin body: mount the Host Remote contribution, then the hover hot
 * zone, the selection-send button, and the details-column panel.
 * @param ctx - client root context.
 * @returns disposer that unmounts the Remote and every slot registration.
 */
export async function apply(ctx: ClientContext): Promise<() => void> {
  const disposers: (() => void)[] = []
  disposers.push(await ctx.remote.$mount(TYPERT_REMOTE))
  // The namespace service key is `remote.sidechat`; read it explicitly rather
  // than declaring it in `inject`, which would deadlock this self-mounting
  // plugin (the service only appears after $mount runs inside apply).
  const sidechat = ctx.get('remote.sidechat') as SidechatNamespace | undefined
  if (sidechat === undefined) throw new Error('side chat: remote.sidechat not mounted')
  // Bind the durable enabled switch: seed local state and keep it in sync
  // with the user-settings document for the lifetime of this fiber.
  settingsScopeHandle = ctx.settingsScope.bind<SidechatSettings>({ namespace: SIDECHAT_SETTINGS_NAMESPACE })
  const seedEnabled = (): boolean => {
    const snapshot = settingsScopeHandle?.getSnapshot()
    return snapshot?.status === 'ready' ? (snapshot.value?.enabled ?? SIDECHAT_SETTINGS_DEFAULT.enabled) : store.enabled
  }
  store.enabled = seedEnabled()
  disposers.push(settingsScopeHandle.subscribe(() => {
    const next = seedEnabled()
    if (next !== store.enabled) {
      store.enabled = next
      subscribers.forEach(listener => listener())
    }
  }))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'sidechat-hotzone', order: 5 },
    () => {
      const layout = ctx.get('layout') as LayoutFace | undefined
      return <HotZone layout={layout} />
    },
  ))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'sidechat-sendsel', order: 6 },
    () => <SelectionSendButton />,
  ))
  ctx.slots.inject('details', () => ctx.slots.register(
    // `details` is a single slot also occupied by ui-conversation's
    // DetailsPanel at priority 0; a lower priority shadows it (lowest renders).
    { name: 'details', priority: -100 },
    (props: PropsRuntime<'details'>) => <Panel ctx={ctx} sidechat={sidechat} sessionId={props.sessionId} />,
  ))
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'sidechat', order: 40, label: () => '侧边聊天' },
    () => <SidechatSettingsSection />,
  ))
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
