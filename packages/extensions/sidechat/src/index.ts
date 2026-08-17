/**
 * DSH Side Chat — host plugin.
 *
 * Provides the `sidechat` Typert Remote service backing the browser side-chat
 * panel: project/session context gathering, the model catalog, sandbox-mode
 * read/write, slash-command listing and execution, and streaming generation
 * through `llm.stream` (job + poll). Every Remote method crosses the wire as
 * plain JSON — session identity travels as a string, never as an Agent or
 * Session object.
 * @module @deepseek-ai/dsh-sidechat
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmRuntime, Message, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SidechatCommandArgs,
  SidechatCommandResult,
  SidechatCommandsArgs,
  SidechatCommandsResult,
  SidechatContextArgs,
  SidechatJobIdResult,
  SidechatModeArgs,
  SidechatModeResult,
  SidechatModelGroup,
  SidechatModelsResult,
  SidechatPollArgs,
  SidechatPollResult,
  SidechatProjectContext,
  SidechatStartArgs,
  SidechatStopArgs,
  SidechatStopResult,
} from './types.ts'

export type * from './types.ts'

/** Minimal duck-typed faces for optional services read through `ctx.get`. */
interface AgentFace { session?: { header?: { cwd?: string } } }
interface AgentsFace {
  currentInitiator(): AgentFace | undefined
  get(id: string): unknown
}
interface SandboxPolicyFace {
  workspaceRoot: string
  defaultMode: string
  overrideOf(session: Session): string | undefined
}
interface SessionTitleFace { get(session: Session): { title: string } | undefined }
interface SessionQueryFace { readSession(id: string): Promise<{ events: unknown[] }> }
interface FsFace {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  readText(target: unknown, signal?: AbortSignal): Promise<string>
  listDir(target: unknown, signal?: AbortSignal): Promise<{ name: string; type: string }[]>
}
interface CommandFace {
  list(agent: unknown): { name: string; description: string; input?: { hint: string } }[]
  execute(agent: unknown, line: string, signal: unknown): Promise<{ commandId: string; result: { kind: string; text?: string } } | undefined>
}
interface DefaultModelFace { currentSelection(): { provider: string; model: string; reasoningEffort?: string } | undefined }

/** One in-flight generation job; polled by the browser until `done`. */
interface Job {
  id: string
  text: string
  done: boolean
  error: string | null
}

/** Minimal AbortSignal-compatible object (the commands registry only duck-types it). */
function inertSignal(): Record<string, unknown> {
  const signal: {
    aborted: boolean
    reason: unknown
    listeners: Set<() => void>
    addEventListener(type: string, fn: () => void): void
    removeEventListener(type: string, fn: () => void): void
    dispatchEvent(): boolean
    throwIfAborted(): void
  } = {
    aborted: false,
    reason: undefined,
    listeners: new Set(),
    addEventListener(type, fn) { if (type === 'abort') signal.listeners.add(fn) },
    removeEventListener(type, fn) { if (type === 'abort') signal.listeners.delete(fn) },
    dispatchEvent() { return true },
    throwIfAborted() {
      if (signal.aborted) {
        const error = new Error(signal.reason === undefined ? 'command aborted' : String(signal.reason))
        error.name = 'AbortError'
        throw error
      }
    },
  }
  return signal
}

/** Last `sandbox/mode` value folded from raw session events. */
function foldSandboxMode(events: readonly unknown[]): string | undefined {
  let mode: string | undefined
  for (const event of events) {
    if (event !== null && typeof event === 'object') {
      const record = event as { type?: unknown; data?: unknown }
      if (record.type === 'sandbox/mode' && record.data !== null && record.data !== undefined) {
        const data = record.data as { mode?: unknown }
        if (typeof data.mode === 'string') mode = data.mode
      }
    }
  }
  return mode
}

/**
 * The `sidechat` service: one Remote endpoint per panel capability.
 * @module @deepseek-ai/dsh-sidechat
 */
export default class SidechatService extends TypertRemoteService {
  private readonly jobs = new Map<string, Job>()
  private seq = 0

  constructor(ctx: Context) {
    super(ctx, 'sidechat')
    ctx.effect(() => () => { this.jobs.clear() }, 'sidechat: generation jobs')
  }

  private session(sessionId: string): Session | undefined {
    if (sessionId === '') return undefined
    return (this.ctx.get('sessions') as unknown as SessionStore | undefined)?.get(sessionId as SessionId)
  }

  private async readProjectContext(sessionId: string): Promise<SidechatProjectContext> {
    const agents = this.ctx.get('agents') as unknown as AgentsFace | undefined
    const sp = this.ctx.get('sandboxPolicy') as unknown as SandboxPolicyFace | undefined
    let root: string | undefined
    try {
      const cwd = agents?.currentInitiator()?.session?.header?.cwd
      if (typeof cwd === 'string' && cwd.length > 0) root = cwd
    } catch { /* initiator read failed; fall through */ }
    if (root === undefined) root = sp?.workspaceRoot

    const context: SidechatProjectContext = {
      root: root ?? null,
      branch: null,
      entries: [],
      model: null,
      conversation: await this.readConversationContext(sessionId),
    }
    if (context.root === null) return context

    const fs = this.ctx.get('fs') as unknown as FsFace | undefined
    if (fs !== undefined) {
      try {
        const head = await fs.resolve('.git/HEAD', { cwd: context.root })
        const text = await fs.readText(head)
        const match = /ref:\s*refs\/heads\/([^\s]+)/.exec(text)
        if (match !== null) context.branch = match[1] ?? null
      } catch { /* not a git repository */ }
      try {
        const dir = await fs.resolve('.', { cwd: context.root })
        const list = await fs.listDir(dir)
        context.entries = list.slice(0, 40).map(entry => ({ name: entry.name, type: entry.type }))
      } catch { /* directory listing failed */ }
    }
    try {
      const selection = (this.ctx.get('agentDefaultModel') as unknown as DefaultModelFace | undefined)?.currentSelection()
      if (selection !== undefined) context.model = { provider: selection.provider, model: selection.model }
    } catch { /* model selection read failed */ }
    return context
  }

  private async readConversationContext(sessionId: string): Promise<SidechatProjectContext['conversation']> {
    const out: SidechatProjectContext['conversation'] = { title: null, messages: [] }
    if (sessionId === '') return out
    const session = this.session(sessionId)
    if (session === undefined) return out
    try {
      const snapshot = (this.ctx.get('sessionTitle') as unknown as SessionTitleFace | undefined)?.get(session)
      if (snapshot !== undefined && snapshot.title.length > 0) out.title = snapshot.title
    } catch { /* title read failed */ }
    try {
      const derived = session.deriveMessages()
      const picked: { role: string; text: string }[] = []
      for (let i = derived.length - 1; i >= 0 && picked.length < 12; i -= 1) {
        const message = derived[i]
        if (message === undefined) continue
        const text = message.content
          .filter(block => block !== null && block !== undefined && block.type === 'text')
          .map(block => (block as { text: string }).text)
          .join('')
          .slice(0, 2000)
        if (text === '') continue
        picked.push({ role: message.role === 'assistant' ? 'assistant' : 'user', text })
      }
      out.messages = picked.reverse()
    } catch { /* message derivation failed */ }
    return out
  }

  private async readEffectiveMode(sessionId: string): Promise<string> {
    const sp = this.ctx.get('sandboxPolicy') as unknown as SandboxPolicyFace | undefined
    if (sp !== undefined) {
      const session = this.session(sessionId)
      if (session !== undefined) {
        const override = sp.overrideOf(session)
        return override ?? sp.defaultMode
      }
    }
    if (sessionId !== '') {
      try {
        const snapshot = await (this.ctx.get('sessionQuery') as unknown as SessionQueryFace | undefined)?.readSession(sessionId)
        if (snapshot !== undefined) {
          const folded = foldSandboxMode(snapshot.events)
          if (folded !== undefined) return folded
        }
      } catch { /* session unreadable; fall through to default */ }
    }
    return sp?.defaultMode ?? 'workspace-write'
  }

  private buildSystemPrompt(context: SidechatProjectContext, provider: string, model: string, reasoningEffort?: string): string {
    const lines = [
      'You are a coding assistant embedded in the DeepSeek Harness side-chat panel.',
      `You are currently running as model "${model}" from provider "${provider}"`
        + (reasoningEffort !== undefined ? ` with reasoning effort "${reasoningEffort}"` : '') + '.',
      'When the user asks which model you are, answer with exactly this model id.',
      'The user is working inside the project below. Use this context to answer their questions.',
    ]
    if (context.root !== null) lines.push(`- Project root: ${context.root}`)
    if (context.branch !== null) lines.push(`- Git branch: ${context.branch}`)
    if (context.entries.length > 0) {
      lines.push(`- Top-level entries: ${context.entries.map(entry => `${entry.name} (${entry.type})`).join(', ')}`)
    }
    if (context.conversation.messages.length > 0) {
      lines.push('')
      lines.push('The main conversation in progress (most recent last) is below; keep your answer consistent with it:')
      for (const message of context.conversation.messages) {
        lines.push(`${message.role}: ${message.text}`)
      }
    }
    lines.push('Answer in the same language the user writes in. Be concise and accurate; say clearly when you are not sure.')
    return lines.join('\n')
  }

  /** Project + session context for the panel header and every generation. */
  @Remote
  async getContext(args: SidechatContextArgs): Promise<SidechatProjectContext> {
    return this.readProjectContext(String(args?.sessionId ?? ''))
  }

  /** Advisory provider/model catalog with per-model reasoning efforts. */
  @Remote
  async models(): Promise<SidechatModelsResult> {
    const llm = this.ctx.get('llm') as unknown as LlmRuntime | undefined
    let current: { provider: string; model: string } | null = null
    try {
      const selection = (this.ctx.get('agentDefaultModel') as unknown as DefaultModelFace | undefined)?.currentSelection()
      if (selection !== undefined) current = { provider: selection.provider, model: selection.model }
    } catch { /* ignore */ }
    const groups: SidechatModelGroup[] = []
    if (llm !== undefined) {
      for (const provider of llm.listProviders()) {
        try {
          const models = await llm.listModels(provider.id)
          const entries: SidechatModelGroup['models'] = []
          for (const model of models) {
            const entry: SidechatModelGroup['models'][number] = { id: model.id, name: model.name }
            try {
              const resolved = await llm.resolveModelInfo(provider.id, model.id)
              if (resolved.reasoning !== undefined) {
                entry.reasoning = {
                  efforts: resolved.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })),
                  defaultEffort: resolved.reasoning.defaultEffort ?? null,
                }
              }
            } catch { /* metadata lookup failed; keep id/name only */ }
            entries.push(entry)
          }
          groups.push({ id: provider.id, name: provider.name, models: entries })
        } catch { /* provider catalog read failed; skip group */ }
      }
    }
    return { groups, current }
  }

  /** Read the session's effective sandbox mode, or write a new one. */
  @Remote
  async mode(args: SidechatModeArgs): Promise<SidechatModeResult> {
    const sessionId = String(args?.sessionId ?? '')
    const next = args?.mode
    if (typeof next === 'string') {
      if (next !== 'read-only' && next !== 'workspace-write' && next !== 'danger-full-access') {
        throw new Error(`side chat: invalid sandbox mode ${next}`)
      }
      const session = this.session(sessionId)
      if (session === undefined) {
        return { mode: await this.readEffectiveMode(sessionId), error: '当前会话不可用，权限模式未修改' }
      }
      (session as unknown as { append(type: 'sandbox/mode', data: { mode: string }): unknown })
        .append('sandbox/mode', { mode: next })
      return { mode: next }
    }
    return { mode: await this.readEffectiveMode(sessionId) }
  }

  /** Slash commands the current session's agent resolves. */
  @Remote
  commands(args: SidechatCommandsArgs): SidechatCommandsResult {
    const sessionId = String(args?.sessionId ?? '')
    const agent = (this.ctx.get('agents') as unknown as AgentsFace | undefined)?.get(sessionId)
    const commands = this.ctx.get('commands') as unknown as CommandFace | undefined
    if (commands === undefined || agent === undefined) return { commands: [] }
    try {
      return {
        commands: commands.list(agent).map(command => ({
          name: command.name,
          description: command.description,
          input: command.input !== undefined ? command.input.hint : null,
        })),
      }
    } catch {
      return { commands: [] }
    }
  }

  /** Execute one slash command against the current session's agent. */
  @Remote
  async command(args: SidechatCommandArgs): Promise<SidechatCommandResult> {
    const sessionId = String(args?.sessionId ?? '')
    const line = typeof args?.line === 'string' ? args.line : ''
    if (line.length === 0) throw new Error('side chat: empty command line')
    const agent = (this.ctx.get('agents') as unknown as AgentsFace | undefined)?.get(sessionId)
    const commands = this.ctx.get('commands') as unknown as CommandFace | undefined
    if (commands === undefined) throw new Error('side chat: command registry unavailable')
    if (agent === undefined) throw new Error('side chat: current session has no active agent')
    try {
      const execution = await commands.execute(agent, line, inertSignal())
      if (execution === undefined) return { unknown: true }
      return { commandId: execution.commandId, result: execution.result }
    } catch (error) {
      return {
        commandId: null,
        result: {
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  /** Start one streaming generation; the browser polls {@link poll} for deltas. */
  @Remote
  async start(args: SidechatStartArgs): Promise<SidechatJobIdResult> {
    const raw = Array.isArray(args?.messages) ? args.messages : []
    const sessionId = String(args?.sessionId ?? '')
    const customProvider = typeof args?.provider === 'string' && args.provider.length > 0 ? args.provider : null
    const customModel = typeof args?.model === 'string' && args.model.length > 0 ? args.model : null
    const customEffort = typeof args?.reasoningEffort === 'string' && args.reasoningEffort.length > 0 ? args.reasoningEffort : null

    const history: Message[] = raw.slice(-20).map(message => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text' as const, text: String(message?.content ?? '') }],
      source: { kind: 'plugin' as const, plugin: 'dsh-sidechat' },
      id: `sidechat-${Date.now()}-${Math.random().toString(36).slice(2)}` as unknown as Message['id'],
    }))
    if (history.length === 0) throw new Error('side chat: no messages to send')

    const context = await this.readProjectContext(sessionId)
    const selection = (this.ctx.get('agentDefaultModel') as unknown as DefaultModelFace | undefined)?.currentSelection()
    const llm = this.ctx.get('llm') as unknown as LlmRuntime | undefined
    if (selection === undefined || llm === undefined) throw new Error('side chat: no model route is available')

    const provider = customProvider ?? selection.provider
    const model = customModel ?? selection.model
    const reasoningEffort = customProvider !== null
      ? (customEffort ?? undefined)
      : selection.reasoningEffort
    const options: GenerateOptions = {
      provider,
      model,
      messages: history,
      system: this.buildSystemPrompt(context, provider, model, reasoningEffort),
      temperature: 0.7,
      maxTokens: 4096,
      ...(reasoningEffort !== undefined
        ? { reasoningEffort: reasoningEffort as ReasoningEffortId }
        : {}),
    }

    const id = `sidechat-${++this.seq}`
    const job: Job = { id, text: '', done: false, error: null }
    this.jobs.set(id, job)
    void (async () => {
      try {
        for await (const chunk of llm.stream(options)) {
          if (this.jobs.get(id) !== job) return
          if (chunk.type === 'text-delta') job.text += chunk.text
          else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
            const failure = chunk.reason.failure
            job.error = failure !== null && typeof failure === 'object' && 'message' in failure
              ? String((failure as { message: unknown }).message)
              : String(failure)
          }
        }
      } catch (error) {
        if (this.jobs.get(id) === job) job.error = error instanceof Error ? error.message : String(error)
      } finally {
        if (this.jobs.get(id) === job) job.done = true
      }
    })()
    return { jobId: id }
  }

  /** Read the accumulated text of one job. */
  @Remote
  poll(args: SidechatPollArgs): SidechatPollResult {
    const job = this.jobs.get(String(args?.jobId ?? ''))
    if (job === undefined) return { done: true, text: '', error: 'side chat: job not found' }
    return { done: job.done, text: job.text, error: job.error }
  }

  /** Stop polling a job; the in-flight stream finishes but no longer updates it. */
  @Remote
  stop(args: SidechatStopArgs): SidechatStopResult {
    const id = String(args?.jobId ?? '')
    const job = this.jobs.get(id)
    if (job !== undefined) {
      job.done = true
      this.jobs.delete(id)
    }
    return { stopped: true }
  }
}
