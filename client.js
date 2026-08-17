/**
 * DSH Side Chat — Client half
 * ============================
 * 平台：Client（浏览器）
 * 用法：粘贴为 DSH Cordis 插件的 code.client（一个 plain-JS 函数体，返回 Cordis Plugin）。
 *
 * 职责：
 *  - 右侧边缘悬停热区（shell.overlay）→ 打开 details 列
 *  - 右侧 details 列面板：项目/会话上下文条、消息流、输入卡片
 *  - 输入 `/` 弹出命令建议（前缀过滤、点击填入）
 *  - 输入卡片底部工具行：权限模式 / 模型（分组目录）/ 推理等级
 *  - markdown 渲染（纯 React.createElement，无第三方库）
 *  - 流式输出轮询（200ms）、Stop / 发送
 */
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const layout = ctx.get('layout')

    const store = { open: false }
    const subscribers = new Set()
    const setOpen = (value) => {
      store.open = value
      if (layout !== undefined) {
        try {
          if (value) layout.openDetails()
          else layout.closeDetails()
        } catch (_) { /* layout transition failed; keep local state */ }
      }
      subscribers.forEach((listener) => listener())
    }
    const useOpen = () => {
      const [open, setState] = React.useState(store.open)
      React.useEffect(() => {
        const listener = () => setState(store.open)
        subscribers.add(listener)
        return () => { subscribers.delete(listener) }
      }, [])
      return open
    }

    const MODES = [
      { id: 'read-only', label: 'Read-only' },
      { id: 'workspace-write', label: 'Workspace write' },
      { id: 'danger-full-access', label: 'Full access' },
    ]

    const isHr = (line) => /^-{3,}$/.test(line) || /^\*{3,}$/.test(line) || /^_{3,}$/.test(line)

    function renderInline(text) {
      const nodes = []
      const tokenRe = /(`+)([\s\S]*?)\1|(\*\*|__)([\s\S]*?)\3|(\*|_)([\s\S]*?)\5|\[([^\]]+)\]\(([^)\s]+)\)/g
      let last = 0
      let key = 0
      let match
      while ((match = tokenRe.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        if (match[1]) {
          nodes.push(React.createElement('code', { key: 'md-c' + (key++) }, match[2]))
        } else if (match[3]) {
          nodes.push(React.createElement('strong', { key: 'md-s' + (key++) }, ...renderInline(match[4])))
        } else if (match[5]) {
          nodes.push(React.createElement('em', { key: 'md-e' + (key++) }, ...renderInline(match[6])))
        } else if (match[7] && match[8]) {
          nodes.push(React.createElement('a', { key: 'md-a' + (key++), className: 'sc-md-link', href: match[8], target: '_blank', rel: 'noreferrer' }, match[7]))
        }
        last = tokenRe.lastIndex
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    function renderMarkdown(text) {
      const lines = String(text).replace(/\r\n/g, '\n').split('\n')
      const nodes = []
      let i = 0
      while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()
        const fence = /^```(\w*)\s*$/.exec(trimmed)
        if (fence !== null) {
          const body = []
          i++
          while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
            body.push(lines[i])
            i++
          }
          i++
          nodes.push(React.createElement('pre', { key: 'md-pre' + nodes.length, className: 'sc-md-pre' },
            React.createElement('code', { className: 'sc-md-codeblock' }, body.join('\n'))))
          continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
        if (heading !== null) {
          const level = heading[1].length
          nodes.push(React.createElement('h' + level, { key: 'md-h' + nodes.length, className: 'sc-md-h sc-md-h' + level }, ...renderInline(heading[2])))
          i++
          continue
        }
        if (isHr(trimmed)) {
          nodes.push(React.createElement('hr', { key: 'md-hr' + nodes.length, className: 'sc-md-hr' }))
          i++
          continue
        }
        if (/^>\s?/.test(trimmed)) {
          const quote = []
          while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
            quote.push(lines[i].trim().replace(/^>\s?/, ''))
            i++
          }
          nodes.push(React.createElement('blockquote', { key: 'md-q' + nodes.length, className: 'sc-md-quote' },
            React.createElement('p', null, ...renderInline(quote.join(' ')))))
          continue
        }
        const ulMatch = /^(\s*)[-*+]\s+(.*)$/.exec(line)
        const olMatch = /^(\s*)\d+[.)]\s+(.*)$/.exec(line)
        if (ulMatch !== null || olMatch !== null) {
          const ordered = olMatch !== null
          const items = []
          while (i < lines.length) {
            const m2 = /^(\s*)[-*+]\s+(.*)$/.exec(lines[i])
            const m3 = /^(\s*)\d+[.)]\s+(.*)$/.exec(lines[i])
            if (ordered ? m3 !== null : m2 !== null) {
              items.push(React.createElement('li', { key: 'md-li' + items.length }, ...renderInline((ordered ? m3[2] : m2[2]))))
              i++
            } else if (/^\s+/.test(lines[i]) && lines[i].trim() !== '') {
              i++
            } else {
              break
            }
          }
          nodes.push(React.createElement(ordered ? 'ol' : 'ul', { key: 'md-ul' + nodes.length, className: 'sc-md-list' }, items))
          continue
        }
        if (trimmed === '') {
          i++
          continue
        }
        const paragraph = [line]
        i++
        while (i < lines.length) {
          const t = lines[i].trim()
          if (t === '') break
          if (/^```/.test(t) || /^#{1,6}\s/.test(t) || /^>\s?/.test(t) || isHr(t) || /^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) break
          paragraph.push(lines[i])
          i++
        }
        nodes.push(React.createElement('p', { key: 'md-p' + nodes.length, className: 'sc-md-p' }, ...renderInline(paragraph.join(' '))))
      }
      return nodes
    }

    const disposeCss = styles.insert(`
.sc-hotzone { position: fixed; top: 0; right: 0; bottom: 0; width: 14px; pointer-events: auto; z-index: 1000; }
.sc-hotzone::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(to bottom, transparent, var(--dsw-alias-brand-primary), transparent); opacity: 0.35; }
.sc-panel { height: 100%; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; }
.sc-header { display: flex; align-items: center; gap: 6px; padding: 12px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.sc-header-title { font-weight: 600; font-size: 14px; margin-right: auto; }
.sc-icon-btn { border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; padding: 4px 8px; border-radius: 6px; }
.sc-icon-btn:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.sc-context { padding: 8px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-messages { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.sc-empty { margin: auto; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; padding: 0 24px; }
.sc-msg { display: flex; flex-direction: column; gap: 3px; max-width: 100%; }
.sc-msg-user { align-self: flex-end; align-items: flex-end; max-width: 92%; }
.sc-msg-assistant { align-self: flex-start; width: 100%; }
.sc-msg-role { font-size: 10px; color: var(--dsw-alias-label-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
.sc-msg-body { padding: 8px 10px; border-radius: 10px; white-space: pre-wrap; word-break: break-word; line-height: 1.55; }
.sc-msg-assistant .sc-msg-body { background: transparent; border: none; padding: 2px 2px; white-space: normal; }
.sc-msg-user .sc-msg-body { background: var(--dsw-alias-brand-primary); color: #fff; border-bottom-right-radius: 2px; max-width: 100%; }
.sc-md-p { margin: 5px 0; }
.sc-md-h { margin: 10px 0 5px; font-weight: 600; line-height: 1.3; }
.sc-md-h1 { font-size: 1.25em; }
.sc-md-h2 { font-size: 1.15em; }
.sc-md-h3 { font-size: 1.05em; }
.sc-md-h4 { font-size: 1em; }
.sc-md-h5 { font-size: 0.95em; }
.sc-md-h6 { font-size: 0.9em; }
.sc-md-code { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; padding: 0 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
.sc-md-pre { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; }
.sc-md-codeblock { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; white-space: pre; }
.sc-md-list { margin: 5px 0; padding-left: 20px; }
.sc-md-quote { margin: 5px 0; padding: 2px 10px; border-left: 3px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-secondary); }
.sc-md-hr { border: none; border-top: 1px solid var(--dsw-alias-border-l1); margin: 8px 0; }
.sc-md-link { color: var(--dsw-alias-brand-primary); text-decoration: underline; }
.sc-msg-error { font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.sc-error { padding: 8px 14px; font-size: 12px; color: var(--dsw-alias-state-error-primary); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.sc-composer { margin: 10px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.sc-composer:focus-within { border-color: var(--dsw-alias-brand-primary); }
.sc-composer-tools { display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.sc-select { flex: 1; min-width: 0; background: transparent; color: var(--dsw-alias-label-secondary); border: none; border-radius: 6px; padding: 3px 4px; font-size: 11px; cursor: pointer; }
.sc-select:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.sc-select:focus { outline: none; }
.sc-input-row { display: flex; gap: 8px; padding: 8px; align-items: flex-end; }
.sc-input { flex: 1; resize: none; border: none; background: transparent; color: var(--dsw-alias-label-primary); padding: 4px 6px; font: inherit; }
.sc-input:focus { outline: none; }
.sc-suggest { border-bottom: 1px solid var(--dsw-alias-border-l1); max-height: 168px; overflow-y: auto; }
.sc-suggest-item { display: flex; flex-direction: column; gap: 1px; width: 100%; text-align: left; background: transparent; border: none; color: var(--dsw-alias-label-primary); padding: 6px 10px; cursor: pointer; font-size: 12px; }
.sc-suggest-item:hover { background: var(--dsw-alias-bg-layer-2); }
.sc-suggest-name { font-weight: 600; }
.sc-suggest-desc { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-send { border: none; border-radius: 8px; padding: 8px 14px; background: var(--dsw-alias-brand-primary); color: #fff; cursor: pointer; font-weight: 600; }
.sc-send:disabled { opacity: 0.5; cursor: default; }
`)

    function HotZone() {
      const open = useOpen()
      let hoverTimer = null
      const arm = () => {
        if (hoverTimer !== null) { hoverTimer(); hoverTimer = null }
        hoverTimer = ctx.timeout(() => {
          hoverTimer = null
          setOpen(true)
        }, 300)
      }
      const disarm = () => {
        if (hoverTimer !== null) { hoverTimer(); hoverTimer = null }
      }
      React.useEffect(() => () => {
        if (hoverTimer !== null) { hoverTimer(); hoverTimer = null }
      }, [])
      if (open) return null
      return React.createElement('div', {
        className: 'sc-hotzone',
        onMouseEnter: arm,
        onMouseLeave: disarm,
        'aria-hidden': true,
      })
    }

    function Panel(props) {
      const open = useOpen()
      const [context, setContext] = React.useState(null)
      const [modelCatalog, setModelCatalog] = React.useState(null)
      const [modelKey, setModelKey] = React.useState('')
      const [effort, setEffort] = React.useState('')
      const [mode, setMode] = React.useState('workspace-write')
      const [commandsList, setCommandsList] = React.useState([])
      const [messages, setMessages] = React.useState([])
      const [input, setInput] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [jobId, setJobId] = React.useState(null)
      const [error, setError] = React.useState(null)
      let textareaEl = null

      const findModel = (key) => {
        if (key === '') return null
        const parts = key.split('/')
        if (parts.length !== 2) return null
        const groups = modelCatalog !== null && modelCatalog !== undefined && Array.isArray(modelCatalog.groups) ? modelCatalog.groups : []
        for (const group of groups) {
          if (group.id !== parts[0]) continue
          for (const m of (group.models || [])) {
            if (m.id === parts[1]) return m
          }
        }
        return null
      }

      const pickCommand = (name) => {
        setInput('/' + name + ' ')
        if (textareaEl !== null) textareaEl.focus()
      }

      const commandSuggestions = (() => {
        const text = input.trimStart()
        if (!text.startsWith('/')) return []
        const rest = text.slice(1).trim()
        const spaceIndex = rest.indexOf(' ')
        if (spaceIndex !== -1) return []
        const prefix = rest.toLowerCase()
        return commandsList.filter((c) => c.name.startsWith(prefix)).slice(0, 8)
      })()

      React.useEffect(() => {
        if (!open) return
        let cancelled = false
        setError(null)
        host.call('sidechat/context', { sessionId: props.sessionId }).then((res) => {
          if (!cancelled) setContext(res)
        }).catch((err) => {
          if (!cancelled) setError(String(err !== null && typeof err === 'object' && err.message !== undefined ? err.message : err))
        })
        host.call('sidechat/models').then((res) => {
          if (!cancelled && res !== null && typeof res === 'object') setModelCatalog(res)
        }).catch(() => {})
        host.call('sidechat/mode', { sessionId: props.sessionId }).then((res) => {
          if (!cancelled && res !== null && typeof res === 'object' && typeof res.mode === 'string') setMode(res.mode)
        }).catch(() => {})
        host.call('sidechat/commands', { sessionId: props.sessionId }).then((res) => {
          if (!cancelled && res !== null && typeof res === 'object' && Array.isArray(res.commands)) setCommandsList(res.commands)
        }).catch(() => {})
        return () => { cancelled = true }
      }, [open, props.sessionId])

      React.useEffect(() => {
        if (modelKey !== '') return
        if (modelCatalog === null || modelCatalog === undefined || modelCatalog.current === null || modelCatalog.current === undefined) return
        const current = modelCatalog.current
        if (typeof current.provider !== 'string' || typeof current.model !== 'string') return
        if (current.provider.length === 0 || current.model.length === 0) return
        const key = current.provider + '/' + current.model
        if (findModel(key) !== null) setModelKey(key)
      }, [modelCatalog])

      React.useEffect(() => {
        if (modelKey === '') {
          setEffort('')
          return
        }
        const info = findModel(modelKey)
        if (info !== null && info !== undefined && info.reasoning !== undefined && info.reasoning !== null) {
          const def = info.reasoning.defaultEffort
          setEffort(typeof def === 'string' && def.length > 0 ? def : '')
        } else {
          setEffort('')
        }
      }, [modelKey])

      React.useEffect(() => {
        if (jobId === null) return
        const dispose = ctx.interval(() => {
          host.call('sidechat/poll', { jobId }).then((res) => {
            if (res === null || typeof res !== 'object') return
            setMessages((prev) => prev.map((message) => (
              message.id === jobId ? { ...message, content: String(res.text || ''), error: res.error } : message
            )))
            if (res.done) {
              setJobId(null)
              setBusy(false)
              if (res.error) setError(String(res.error))
            }
          }).catch((err) => {
            setError(String(err !== null && typeof err === 'object' && err.message !== undefined ? err.message : err))
            setJobId(null)
            setBusy(false)
          })
        }, 200)
        return dispose
      }, [jobId])

      const sendChat = () => {
        const text = input.trim()
        if (text === '' || busy) return
        const userMessage = { id: 'user-' + String(Date.now()), role: 'user', content: text }
        const history = messages.concat([userMessage])
          .filter((message) => message.content !== '')
          .map((message) => ({ role: message.role, content: message.content }))
        setMessages((prev) => prev.concat([userMessage]))
        setInput('')
        setBusy(true)
        setError(null)
        const startArgs = { messages: history, sessionId: props.sessionId }
        if (modelKey !== '') {
          const parts = modelKey.split('/')
          if (parts.length === 2) {
            startArgs.provider = parts[0]
            startArgs.model = parts[1]
            if (effort !== '') startArgs.reasoningEffort = effort
          }
        }
        host.call('sidechat/start', startArgs).then((res) => {
          const id = res !== null && typeof res === 'object' ? String(res.jobId) : ''
          if (id === '') throw new Error('侧边聊天：未返回 job id')
          setJobId(id)
          setMessages((prev) => prev.concat([{ id, role: 'assistant', content: '', error: null }]))
        }).catch((err) => {
          setError(String(err !== null && typeof err === 'object' && err.message !== undefined ? err.message : err))
          setBusy(false)
        })
      }

      const runCommand = () => {
        const line = input.trim()
        if (line === '' || busy) return
        setMessages((prev) => prev.concat([{ id: 'cmd-' + String(Date.now()), role: 'user', content: line }]))
        setInput('')
        setBusy(true)
        setError(null)
        host.call('sidechat/command', { sessionId: props.sessionId, line }).then((res) => {
          let text
          if (res !== null && typeof res === 'object' && res.unknown) {
            text = '未知命令：' + line + '\n\n可用的命令见输入框内的 / 建议列表。'
          } else if (res !== null && typeof res === 'object' && res.result !== undefined && res.result !== null) {
            if (res.result.kind === 'error') text = '命令执行失败：' + String(res.result.text || '未知错误')
            else text = String(res.result.text || '命令已执行。')
          } else {
            text = '无结果：' + line
          }
          setMessages((prev) => prev.concat([{ id: 'cmdres-' + String(Date.now()), role: 'assistant', content: text, error: null }]))
          setBusy(false)
        }).catch((err) => {
          setError(String(err !== null && typeof err === 'object' && err.message !== undefined ? err.message : err))
          setBusy(false)
        })
      }

      const send = () => {
        if (input.trim().startsWith('/')) runCommand()
        else sendChat()
      }

      const stop = () => {
        if (jobId !== null) {
          host.call('sidechat/stop', { jobId }).catch(() => {})
          setJobId(null)
          setBusy(false)
        }
      }

      const scrollToBottom = (el) => { if (el !== null) el.scrollTop = el.scrollHeight }

      const header = React.createElement('div', { className: 'sc-header' },
        React.createElement('span', { className: 'sc-header-title' }, '侧边聊天'),
        React.createElement('button', { className: 'sc-icon-btn', onClick: () => setOpen(false), title: '关闭', type: 'button' }, '\u2715'),
      )

      let contextRow
      if (context === null) {
        contextRow = React.createElement('div', { className: 'sc-context' }, '正在加载项目上下文\u2026')
      } else {
        const pieces = []
        if (context.branch) pieces.push('\u2387 ' + context.branch)
        const conversation = context.conversation
        if (conversation !== undefined && conversation !== null && conversation.messages.length > 0) {
          pieces.push((conversation.title || '当前对话') + ' \u00b7 ' + conversation.messages.length + ' 条')
        }
        contextRow = React.createElement('div', { className: 'sc-context' }, pieces.join('  \u00b7  ') || '无项目上下文')
      }

      const messageNodes = messages.map((message) => {
        const isUser = message.role === 'user'
        let bodyChild
        if (isUser) {
          bodyChild = message.content
        } else if (message.content === '' && busy) {
          bodyChild = '\u2026'
        } else {
          bodyChild = renderMarkdown(String(message.content || ''))
        }
        return React.createElement('div', { key: message.id, className: isUser ? 'sc-msg sc-msg-user' : 'sc-msg sc-msg-assistant' },
          React.createElement('div', { className: 'sc-msg-role' }, isUser ? '你' : '助手'),
          React.createElement('div', { className: 'sc-msg-body' }, bodyChild),
          message.error ? React.createElement('div', { className: 'sc-msg-error' }, String(message.error)) : null,
        )
      })

      let messagesArea
      if (messages.length === 0) {
        messagesArea = React.createElement('div', { className: 'sc-messages' },
          React.createElement('div', { className: 'sc-empty' },
            React.createElement('div', null, '可以问项目或旁边对话相关的问题。'),
            React.createElement('div', null, '输入 / 可查看可执行的命令。'),
          ),
        )
      } else {
        messagesArea = React.createElement('div', { className: 'sc-messages', ref: scrollToBottom }, messageNodes)
      }

      const modelOptions = []
      if (modelCatalog !== null && modelCatalog !== undefined && Array.isArray(modelCatalog.groups)) {
        for (const group of modelCatalog.groups) {
          const optionNodes = (group.models || []).map((m) =>
            React.createElement('option', { key: group.id + '/' + m.id, value: group.id + '/' + m.id }, m.name))
          modelOptions.push(React.createElement('optgroup', { key: 'g-' + group.id, label: group.name }, optionNodes))
        }
      }
      const modeOptions = MODES.map((m) =>
        React.createElement('option', { key: m.id, value: m.id }, m.label))

      const selectedModelInfo = findModel(modelKey)
      const efforts = selectedModelInfo !== null && selectedModelInfo !== undefined
        && selectedModelInfo.reasoning !== undefined && selectedModelInfo.reasoning !== null
        && Array.isArray(selectedModelInfo.reasoning.efforts)
        ? selectedModelInfo.reasoning.efforts
        : []
      const effortSelect = efforts.length > 0
        ? React.createElement('select', {
            className: 'sc-select',
            value: effort,
            title: '推理等级',
            onChange: (event) => setEffort(event.target.value),
          }, efforts.map((ef) => React.createElement('option', { key: ef.id, value: ef.id }, ef.name)))
        : null

      const suggestNodes = commandSuggestions.length > 0
        ? React.createElement('div', { className: 'sc-suggest' },
            commandSuggestions.map((c) => React.createElement('button', {
              key: c.name,
              className: 'sc-suggest-item',
              type: 'button',
              onClick: () => pickCommand(c.name),
            },
              React.createElement('span', { className: 'sc-suggest-name' }, '/' + c.name),
              React.createElement('span', { className: 'sc-suggest-desc' }, c.description || ''),
            )),
          )
        : null

      const composer = React.createElement('div', { className: 'sc-composer' },
        suggestNodes,
        React.createElement('div', { className: 'sc-input-row' },
          React.createElement('textarea', {
            className: 'sc-input',
            value: input,
            placeholder: '提问，或输入 / 执行命令\u2026',
            rows: 2,
            disabled: busy,
            ref: (el) => { textareaEl = el },
            onChange: (event) => setInput(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            },
          }),
          React.createElement('button', {
            className: 'sc-send',
            onClick: busy ? stop : send,
            disabled: !busy && input.trim() === '',
            type: 'button',
          }, busy ? '停止' : '发送'),
        ),
        React.createElement('div', { className: 'sc-composer-tools' },
          React.createElement('select', {
            className: 'sc-select',
            value: mode,
            title: '本会话的沙箱权限模式',
            onChange: (event) => {
              const next = event.target.value
              setMode(next)
              host.call('sidechat/mode', { sessionId: props.sessionId, mode: next }).then((res) => {
                if (res !== null && typeof res === 'object') {
                  if (typeof res.mode === 'string') setMode(res.mode)
                  if (res.error) setError(String(res.error))
                }
              }).catch((err) => {
                setError(String(err !== null && typeof err === 'object' && err.message !== undefined ? err.message : err))
              })
            },
          }, modeOptions),
          React.createElement('select', {
            className: 'sc-select',
            value: modelKey,
            title: '侧边聊天的回复模型',
            onChange: (event) => setModelKey(event.target.value),
          }, modelOptions),
          effortSelect,
        ),
      )

      return React.createElement('div', { className: 'sc-panel', role: 'dialog', 'aria-label': '侧边聊天' },
        header,
        contextRow,
        error !== null ? React.createElement('div', { className: 'sc-error' }, String(error)) : null,
        messagesArea,
        composer,
      )
    }

    const disposeHotZone = slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'sidechat-hotzone', order: 5, label: '侧边聊天' },
      () => React.createElement(HotZone),
    ))
    const disposePanel = slots.inject('details', () => slots.register(
      { name: 'details' },
      (props) => React.createElement(Panel, props),
    ))

    ctx.effect(() => () => {
      disposeCss()
      disposeHotZone()
      disposePanel()
    })
  },
}
