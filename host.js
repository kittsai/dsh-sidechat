/**
 * DSH Side Chat — Host half
 * ==========================
 * 平台：Host（Node 进程）
 * 用法：粘贴为 DSH Cordis 插件的 code.host（一个 plain-JS 函数体，返回 Cordis Plugin）。
 *
 * 职责：
 *  - 采集项目上下文（根目录 / Git 分支 / 顶层条目 / 当前模型）
 *  - 采集当前主会话上下文（标题 + 最近 12 条文本消息）
 *  - 模型目录（provider 分组 + 每模型的 reasoning efforts / defaultEffort）
 *  - 权限模式读写（sandbox/mode，带多层回退，session 不可用不抛错）
 *  - 斜杠命令列表与执行（commands 注册表 + 最小 AbortSignal 兼容对象）
 *  - llm.stream 流式生成（job + poll），并把实际生效的模型 ID 注入系统提示词
 */
return {
  apply(ctx) {
    const jobs = new Map()
    let seq = 0

    async function readProjectContext() {
      let root
      const agents = ctx.get('agents')
      if (agents !== undefined) {
        try {
          const initiator = agents.currentInitiator()
          const header = initiator !== undefined && initiator.session !== undefined ? initiator.session.header : undefined
          const cwd = header !== undefined ? header.cwd : undefined
          if (typeof cwd === 'string' && cwd.length > 0) root = cwd
        } catch (_) { /* initiator read failed; fall through to workspace root */ }
      }
      if (root === undefined) {
        const sp = ctx.get('sandboxPolicy')
        if (sp !== undefined) {
          try { root = sp.workspaceRoot } catch (_) { /* ignore */ }
        }
      }
      const context = { root: root || null, branch: null, entries: [], model: null }
      if (context.root === null) return context
      const fs = ctx.get('fs')
      if (fs !== undefined) {
        try {
          const head = await fs.resolve('.git/HEAD', { cwd: context.root })
          const text = await fs.readText(head)
          const match = /ref:\s*refs\/heads\/([^\s]+)/.exec(text)
          if (match !== null) context.branch = match[1]
        } catch (_) { /* not a git repository */ }
        try {
          const dir = await fs.resolve('.', { cwd: context.root })
          const list = await fs.listDir(dir)
          context.entries = list.slice(0, 40).map((entry) => ({ name: entry.name, type: entry.type }))
        } catch (_) { /* directory listing failed */ }
      }
      const adm = ctx.get('agentDefaultModel')
      if (adm !== undefined) {
        try {
          const selection = adm.currentSelection()
          if (selection !== undefined && selection !== null) {
            context.model = { provider: selection.provider, model: selection.model }
          }
        } catch (_) { /* model selection read failed */ }
      }
      return context
    }

    async function readConversationContext(sessionId) {
      const out = { title: null, messages: [] }
      if (typeof sessionId !== 'string' || sessionId.length === 0) return out
      const sessions = ctx.get('sessions')
      const session = sessions === undefined ? undefined : sessions.get(sessionId)
      if (session === undefined) return out
      const titleService = ctx.get('sessionTitle')
      if (titleService !== undefined) {
        try {
          const snapshot = titleService.get(session)
          if (snapshot !== undefined && snapshot !== null && typeof snapshot.title === 'string' && snapshot.title.length > 0) {
            out.title = snapshot.title
          }
        } catch (_) { /* title read failed */ }
      }
      try {
        const derived = session.deriveMessages()
        const picked = []
        for (let i = derived.length - 1; i >= 0 && picked.length < 12; i--) {
          const message = derived[i]
          const role = message.role === 'assistant' ? 'assistant' : 'user'
          const text = message.content
            .filter((block) => block !== null && block !== undefined && block.type === 'text')
            .map((block) => block.text)
            .join('')
            .slice(0, 2000)
          if (text === '') continue
          picked.push({ role, text })
        }
        out.messages = picked.reverse()
      } catch (_) { /* message derivation failed */ }
      return out
    }

    function foldSandboxMode(events) {
      let mode
      if (Array.isArray(events)) {
        for (const event of events) {
          if (event !== null && typeof event === 'object' && event.type === 'sandbox/mode'
            && event.data !== null && event.data !== undefined && typeof event.data.mode === 'string') {
            mode = event.data.mode
          }
        }
      }
      return mode
    }

    async function readEffectiveMode(sessionId) {
      const sp = ctx.get('sandboxPolicy')
      if (sp !== undefined) {
        const sessions = ctx.get('sessions')
        const session = sessions === undefined || sessionId === '' ? undefined : sessions.get(sessionId)
        if (session !== undefined) {
          let mode = sp.overrideOf(session)
          if (mode === undefined) mode = sp.defaultMode
          if (mode !== undefined) return mode
        }
      }
      if (sessionId !== '') {
        const sq = ctx.get('sessionQuery')
        if (sq !== undefined) {
          try {
            const snapshot = await sq.readSession(sessionId)
            const folded = foldSandboxMode(snapshot.events)
            if (folded !== undefined) return folded
          } catch (_) { /* session unreadable; fall through to default */ }
        }
      }
      if (sp !== undefined) return sp.defaultMode
      return 'workspace-write'
    }

    function buildSystemPrompt(context, provider, model, reasoningEffort) {
      const lines = [
        'You are a coding assistant embedded in the DeepSeek Harness side-chat panel.',
        'You are currently running as model "' + model + '" from provider "' + provider + '"'
          + (reasoningEffort !== undefined && reasoningEffort !== null ? ' with reasoning effort "' + reasoningEffort + '"' : '') + '.',
        'When the user asks which model you are, answer with exactly this model id.',
        'The user is working inside the project below. Use this context to answer their questions.',
      ]
      if (context.root !== null) lines.push('- Project root: ' + context.root)
      if (context.branch !== null) lines.push('- Git branch: ' + context.branch)
      if (context.entries.length > 0) {
        lines.push('- Top-level entries: ' + context.entries.map((entry) => entry.name + ' (' + entry.type + ')').join(', '))
      }
      const conversation = context.conversation
      if (conversation !== undefined && conversation !== null && conversation.messages.length > 0) {
        lines.push('')
        lines.push('The main conversation in progress (most recent last) is below; keep your answer consistent with it:')
        for (const message of conversation.messages) {
          lines.push(message.role + ': ' + message.text)
        }
      }
      lines.push('Answer in the same language the user writes in. Be concise and accurate; say clearly when you are not sure.')
      return lines.join('\n')
    }

    ctx.effect(() => harness.handle('sidechat/context', async (args) => {
      const sessionId = args !== null && typeof args === 'object' ? String(args.sessionId || '') : ''
      const context = await readProjectContext()
      context.conversation = await readConversationContext(sessionId)
      return context
    }))

    ctx.effect(() => harness.handle('sidechat/models', async () => {
      const llm = ctx.get('llm')
      const adm = ctx.get('agentDefaultModel')
      let current = null
      if (adm !== undefined) {
        try {
          const selection = adm.currentSelection()
          if (selection !== undefined && selection !== null) {
            current = { provider: selection.provider, model: selection.model }
          }
        } catch (_) { /* ignore */ }
      }
      const groups = []
      if (llm !== undefined) {
        for (const provider of llm.listProviders()) {
          try {
            const models = await llm.listModels(provider.id)
            const entries = []
            for (const m of models) {
              const entry = { id: m.id, name: m.name }
              try {
                const resolved = await llm.resolveModelInfo(provider.id, m.id)
                if (resolved !== undefined && resolved !== null && resolved.reasoning !== undefined && resolved.reasoning !== null) {
                  entry.reasoning = {
                    efforts: (resolved.reasoning.efforts || []).map((e) => ({ id: e.id, name: e.name })),
                    defaultEffort: resolved.reasoning.defaultEffort === undefined ? null : resolved.reasoning.defaultEffort,
                  }
                }
              } catch (_) { /* metadata lookup failed; keep id/name only */ }
              entries.push(entry)
            }
            groups.push({ id: provider.id, name: provider.name, models: entries })
          } catch (_) { /* provider catalog read failed; skip group */ }
        }
      }
      return { groups, current }
    }))

    ctx.effect(() => harness.handle('sidechat/mode', async (args) => {
      const sessionId = args !== null && typeof args === 'object' ? String(args.sessionId || '') : ''
      if (args !== null && typeof args === 'object' && typeof args.mode === 'string') {
        const next = args.mode
        if (next !== 'read-only' && next !== 'workspace-write' && next !== 'danger-full-access') {
          throw new Error('side chat: invalid sandbox mode ' + next)
        }
        const sessions = ctx.get('sessions')
        const session = sessions === undefined || sessionId === '' ? undefined : sessions.get(sessionId)
        if (session === undefined) {
          const current = await readEffectiveMode(sessionId)
          return { mode: current, error: '当前会话不可用，权限模式未修改' }
        }
        session.append('sandbox/mode', { mode: next })
        return { mode: next }
      }
      const mode = await readEffectiveMode(sessionId)
      return { mode }
    }))

    ctx.effect(() => harness.handle('sidechat/commands', (args) => {
      const sessionId = args !== null && typeof args === 'object' ? String(args.sessionId || '') : ''
      const agents = ctx.get('agents')
      const commands = ctx.get('commands')
      const agent = agents === undefined ? undefined : agents.get(sessionId)
      if (commands === undefined || agent === undefined) return { commands: [] }
      try {
        const list = commands.list(agent)
        return {
          commands: list.map((c) => ({
            name: c.name,
            description: c.description,
            input: c.input !== undefined && c.input !== null ? String(c.input.hint || '') : null,
          })),
        }
      } catch (_) {
        return { commands: [] }
      }
    }))

    ctx.effect(() => harness.handle('sidechat/command', async (args) => {
      const sessionId = args !== null && typeof args === 'object' ? String(args.sessionId || '') : ''
      const line = args !== null && typeof args === 'object' && typeof args.line === 'string' ? args.line : ''
      if (line.length === 0) throw new Error('side chat: empty command line')
      const agents = ctx.get('agents')
      const commands = ctx.get('commands')
      const agent = agents === undefined ? undefined : agents.get(sessionId)
      if (commands === undefined) throw new Error('side chat: command registry unavailable')
      if (agent === undefined) throw new Error('side chat: current session has no active agent')
      const signal = {
        aborted: false,
        reason: undefined,
        listeners: new Set(),
        addEventListener(type, fn) { if (type === 'abort') signal.listeners.add(fn) },
        removeEventListener(type, fn) { if (type === 'abort') signal.listeners.delete(fn) },
        dispatchEvent() { return true },
        throwIfAborted() {
          if (signal.aborted) {
            const error = new Error(signal.reason || 'command aborted')
            error.name = 'AbortError'
            throw error
          }
        },
      }
      try {
        const execution = await commands.execute(agent, line, signal)
        if (execution === undefined || execution === null) return { unknown: true }
        return { commandId: String(execution.commandId), result: execution.result }
      } catch (error) {
        return {
          commandId: null,
          result: {
            kind: 'error',
            text: String(error !== null && typeof error === 'object' && error.message !== undefined ? error.message : error),
          },
        }
      }
    }))

    ctx.effect(() => harness.handle('sidechat/start', async (args) => {
      const raw = args !== null && typeof args === 'object' && Array.isArray(args.messages) ? args.messages : []
      const sessionId = args !== null && typeof args === 'object' ? String(args.sessionId || '') : ''
      const customProvider = args !== null && typeof args === 'object' && typeof args.provider === 'string' && args.provider.length > 0 ? args.provider : null
      const customModel = args !== null && typeof args === 'object' && typeof args.model === 'string' && args.model.length > 0 ? args.model : null
      const customEffort = args !== null && typeof args === 'object' && typeof args.reasoningEffort === 'string' && args.reasoningEffort.length > 0 ? args.reasoningEffort : null
      const history = raw.slice(-20).map((message) => {
        const role = message !== null && typeof message === 'object' && message.role === 'assistant' ? 'assistant' : 'user'
        const text = message !== null && typeof message === 'object' ? String(message.content || '') : ''
        return {
          role,
          content: [{ type: 'text', text }],
          source: role === 'assistant' ? { kind: 'plugin', plugin: 'sidechat' } : { kind: 'user' },
        }
      })
      if (history.length === 0) throw new Error('side chat: no messages to send')
      const context = await readProjectContext()
      context.conversation = await readConversationContext(sessionId)
      const adm = ctx.get('agentDefaultModel')
      const selection = adm === undefined ? undefined : adm.currentSelection()
      const llm = ctx.get('llm')
      if (selection === undefined || selection === null || llm === undefined) {
        throw new Error('side chat: no model route is available')
      }
      const provider = customProvider !== null ? customProvider : selection.provider
      const model = customModel !== null ? customModel : selection.model
      const reasoningEffort = customProvider !== null
        ? (customEffort !== null ? customEffort : undefined)
        : selection.reasoningEffort
      const options = {
        provider,
        model,
        messages: history,
        system: buildSystemPrompt(context, provider, model, reasoningEffort),
        temperature: 0.7,
        maxTokens: 4096,
      }
      if (reasoningEffort !== undefined) options.reasoningEffort = reasoningEffort
      const id = 'sidechat-' + String(++seq)
      const job = { id, text: '', done: false, error: null, provider, model }
      jobs.set(id, job)
      ;(async () => {
        try {
          for await (const chunk of llm.stream(options)) {
            if (jobs.get(id) !== job) return
            if (chunk.type === 'text-delta') {
              job.text += chunk.text
            } else if (chunk.type === 'finish') {
              if (chunk.reason.kind === 'error') {
                const failure = chunk.reason.failure
                job.error = failure !== null && typeof failure === 'object' && failure.message !== undefined ? String(failure.message) : String(failure)
              } else if (chunk.reason.kind === 'aborted') {
                job.error = 'generation aborted'
              }
            }
          }
        } catch (err) {
          if (jobs.get(id) === job) job.error = String(err !== null && typeof err === 'object' && err.message !== undefined ? err.message : err)
        } finally {
          if (jobs.get(id) === job) job.done = true
        }
      })()
      return { jobId: id }
    }))

    ctx.effect(() => harness.handle('sidechat/poll', (args) => {
      const id = args !== null && typeof args === 'object' ? String(args.jobId) : ''
      const job = jobs.get(id)
      if (job === undefined) return { done: true, text: '', error: 'side chat: job not found' }
      return { done: job.done, text: job.text, error: job.error }
    }))

    ctx.effect(() => harness.handle('sidechat/stop', (args) => {
      const id = args !== null && typeof args === 'object' ? String(args.jobId) : ''
      const job = jobs.get(id)
      if (job !== undefined) {
        job.done = true
        jobs.delete(id)
      }
      return { stopped: true }
    }))

    ctx.effect(() => () => { jobs.clear() })
  },
}
