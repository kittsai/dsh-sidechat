/**
 * Side chat plugin, browser half: hover-to-open hot zone over `shell.overlay`
 * and the chat panel in the right `details` column. All panel capabilities are
 * driven through the host `sidechat` Remote (see @deepseek-ai/dsh-sidechat).
 * @module @deepseek-ai/dsh-client-sidechat/client
 */

import * as React from 'react'
import { useEffect, useState, type ReactElement } from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (shell.overlay / details seats).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the generated Host Remote merge (ctx.remote.sidechat).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import css from './sidechat.module.css'

/** Required services: slot registry, layout transitions, and the Host Remote. */
export const inject = ['slots', 'layout', 'remote']

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

/** Panel open state shared by the hot zone and the panel (transient UI state). */
const store = { open: false }
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

const MODES = [
  { id: 'read-only', label: '只读' },
  { id: 'workspace-write', label: '工作区写入' },
  { id: 'danger-full-access', label: '完全访问' },
]

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

interface PanelContext {
  branch: string | null
  conversation: { title: string | null; messages: { role: string; text: string }[] }
}

const isHr = (line: string): boolean => /^-{3,}$/.test(line) || /^\*{3,}$/.test(line) || /^_{3,}$/.test(line)

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

/** Full panel props: the details runtime share plus the plugin context. */
interface PanelProps {
  ctx: ClientContext
  sessionId: SessionId
}

/** The side-chat panel occupying the right details column. */
function Panel(props: PanelProps): ReactElement {
  const { ctx, sessionId } = props
  const [context, setContext] = useState<PanelContext | null>(null)
  const [modelCatalog, setModelCatalog] = useState<{ groups: ModelGroup[]; current: { provider: string; model: string } | null } | null>(null)
  const [modelKey, setModelKey] = useState('')
  const [effort, setEffort] = useState('')
  const [mode, setMode] = useState('workspace-write')
  const [commandsList, setCommandsList] = useState<{ name: string; description: string }[]>([])
  const [messages, setMessages] = useState<{ id: string; role: string; content: string; error: string | null }[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    void callRemote(() => ctx.remote.sidechat.getContext({ sessionId: String(sessionId) })).then(value => {
      if (!cancelled) setContext(value)
    }, (reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    void callRemote(() => ctx.remote.sidechat.models()).then(value => {
      if (!cancelled) setModelCatalog(value)
    }, () => { /* catalog load failure is non-fatal */ })
    void callRemote(() => ctx.remote.sidechat.mode({ sessionId: String(sessionId) })).then(value => {
      if (!cancelled) setMode(value.mode)
    }, () => { /* mode read failure is non-fatal */ })
    void callRemote(() => ctx.remote.sidechat.commands({ sessionId: String(sessionId) })).then(value => {
      if (!cancelled) setCommandsList(value.commands)
    }, () => { /* command list failure is non-fatal */ })
    return () => { cancelled = true }
  }, [ctx, sessionId])

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
      void callRemote(() => ctx.remote.sidechat.poll({ jobId })).then(value => {
        setMessages(prev => prev.map(message => (
          message.id === jobId ? { ...message, content: value.text, error: value.error } : message
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

  const sendChat = (): void => {
    const text = input.trim()
    if (text === '' || busy) return
    const userMessage = { id: `user-${Date.now()}`, role: 'user', content: text, error: null }
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
    void callRemote(() => ctx.remote.sidechat.start(args)).then(value => {
      setJobId(value.jobId)
      setMessages(prev => prev.concat([{ id: value.jobId, role: 'assistant', content: '', error: null }]))
    }, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    })
  }

  const runCommand = (): void => {
    const line = input.trim()
    if (line === '' || busy) return
    setMessages(prev => prev.concat([{ id: `cmd-${Date.now()}`, role: 'user', content: line, error: null }]))
    setInput('')
    setBusy(true)
    setError(null)
    void callRemote(() => ctx.remote.sidechat.command({ sessionId: String(sessionId), line })).then(value => {
      const record = value as { unknown?: boolean; result?: { kind: string; text?: string } }
      let text: string
      if (record.unknown === true) text = `未知命令：${line}\n\n可用的命令见输入框内的 / 建议列表。`
      else if (record.result !== undefined) {
        text = record.result.kind === 'error'
          ? `命令执行失败：${record.result.text ?? '未知错误'}`
          : (record.result.text ?? '命令已执行。')
      } else text = `无结果：${line}`
      setMessages(prev => prev.concat([{ id: `cmdres-${Date.now()}`, role: 'assistant', content: text, error: null }]))
      setBusy(false)
    }, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    })
  }

  const send = (): void => {
    if (input.trim().startsWith('/')) runCommand()
    else sendChat()
  }

  const stop = (): void => {
    if (jobId !== null) {
      void ctx.remote.sidechat.stop({ jobId }).then(() => {}, () => {})
      setJobId(null)
      setBusy(false)
    }
  }

  const commandSuggestions = ((): { name: string; description: string }[] => {
    const text = input.trimStart()
    if (!text.startsWith('/')) return []
    const rest = text.slice(1).trim()
    if (rest.indexOf(' ') !== -1) return []
    const prefix = rest.toLowerCase()
    return commandsList.filter(command => command.name.startsWith(prefix)).slice(0, 8)
  })()

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

  const suggestNodes = commandSuggestions.length > 0 ? (
    <div className={css.suggest}>
      {commandSuggestions.map(command => (
        <button key={command.name} className={css.suggestItem} type="button" onClick={() => { setInput(`/${command.name} `) }}>
          <span className={css.suggestName}>{`/${command.name}`}</span>
          <span className={css.suggestDesc}>{command.description}</span>
        </button>
      ))}
    </div>
  ) : null

  const messageNodes = messages.map(message => {
    const isUser = message.role === 'user'
    const body = isUser
      ? message.content
      : (message.content === '' && busy ? '…' : renderMarkdown(message.content))
    return (
      <div key={message.id} className={isUser ? `${css.msg} ${css.msgUser}` : `${css.msg} ${css.msgAssistant}`}>
        <div className={css.msgRole}>{isUser ? '你' : '助手'}</div>
        <div className={css.msgBody}>{body}</div>
        {message.error !== null ? <div className={css.msgError}>{message.error}</div> : null}
      </div>
    )
  })

  const contextPieces: string[] = []
  if (context !== null) {
    if (context.branch !== null) contextPieces.push(`⎇ ${context.branch}`)
    if (context.conversation.messages.length > 0) {
      contextPieces.push(`${context.conversation.title ?? '当前对话'} · ${context.conversation.messages.length} 条`)
    }
  }

  return (
    <div className={css.panel} role="dialog" aria-label="侧边聊天">
      <div className={css.header}>
        <span className={css.headerTitle}>侧边聊天</span>
        <button className={css.iconBtn} type="button" title="关闭" onClick={() => setOpenShared(false, ctx.get('layout') as LayoutFace | undefined)}>✕</button>
      </div>
      <div className={css.context}>{context === null ? '正在加载项目上下文…' : (contextPieces.join('  ·  ') || '无项目上下文')}</div>
      {error !== null ? <div className={css.error}>{error}</div> : null}
      <div className={css.messages}>
        {messageNodes.length === 0 ? (
          <div className={css.empty}>
            <div>可以问项目或旁边对话相关的问题。</div>
            <div>输入 / 可查看可执行的命令。</div>
          </div>
        ) : messageNodes}
      </div>
      <div className={css.composer}>
        {suggestNodes}
        <div className={css.inputRow}>
          <textarea
            className={css.input}
            value={input}
            placeholder="提问，或输入 / 执行命令…"
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
            onClick={busy ? stop : send}
          >{busy ? '停止' : '发送'}</button>
        </div>
        <div className={css.composerTools}>
          <select
            className={css.select}
            value={mode}
            title="本会话的沙箱权限模式"
            onChange={event => {
              const next = event.target.value
              setMode(next)
              void callRemote(() => ctx.remote.sidechat.mode({ sessionId: String(sessionId), mode: next })).then(value => {
                setMode(value.mode)
              }, (reason: unknown) => {
                setError(reason instanceof Error ? reason.message : String(reason))
              })
            }}
          >
            {MODES.map(modeOption => <option key={modeOption.id} value={modeOption.id}>{modeOption.label}</option>)}
          </select>
          <select className={css.select} value={modelKey} title="侧边聊天的回复模型" onChange={event => setModelKey(event.target.value)}>
            {modelOptions}
          </select>
          {effortSelect}
        </div>
      </div>
    </div>
  )
}

/**
 * Browser plugin body: mount the hover hot zone and the details-column panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'sidechat-hotzone', order: 5 },
    () => {
      const layout = ctx.get('layout') as LayoutFace | undefined
      return (
        <div
          className={css.hotzone}
          onMouseEnter={() => { setOpenShared(true, layout) }}
          aria-hidden="true"
        />
      )
    },
  ))
  ctx.slots.inject('details', () => ctx.slots.register(
    { name: 'details' },
    (props: PropsRuntime<'details'>) => <Panel ctx={ctx} sessionId={props.sessionId} />,
  ))
}
