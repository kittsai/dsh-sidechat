/**
 * DSH Side Chat — Host half（动态插件版，pkg-25）
 * 用法：粘贴为 DSH Cordis 插件的 code.host（plain-JS 函数体，返回 Cordis Plugin）。
 * 功能：项目/会话上下文采集、模型目录、llm.stream 流式生成（job + poll，含思考过程）。
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
      const context = { root: root || null, branch: null, model: null }
      if (context.root === null) return context
      const fs = ctx.get('fs')
      if (fs !== undefined) {
        try {
          const head = await fs.resolve('.git/HEAD', { cwd: context.root })
          const text = await fs.readText(head)
          const match = /ref:\s*refs\/heads\/([^\s]+)/.exec(text)
          if (match !== null) context.branch = match[1]
        } catch (_) { /* not a git repository */ }
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
      const job = { id, text: '', reasoning: '', done: false, error: null, provider, model }
      jobs.set(id, job)
      ;(async () => {
        try {
          for await (const chunk of llm.stream(options)) {
            if (jobs.get(id) !== job) return
            if (chunk.type === 'text-delta') {
              job.text += chunk.text
            } else if (chunk.type === 'reasoning-delta') {
              job.reasoning += chunk.text
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
      if (job === undefined) return { done: true, text: '', reasoning: '', error: 'side chat: job not found' }
      return { done: job.done, text: job.text, reasoning: job.reasoning, error: job.error }
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
