/**
 * DSH Side Chat — host plugin.
 *
 * Provides the `sidechat` Typert Remote service backing the browser side-chat
 * panel: project/session context gathering, the model catalog, and streaming
 * generation through `llm.stream` (job + poll). Every Remote method crosses the
 * wire as plain JSON — session identity travels as a string, never as an Agent
 * or Session object.
 *
 * The service is a plain class: it registers itself through
 * `ctx.reflect.provide` and carries a hand-written `typertRemote` binding, and
 * the strict invocation contract ships as the `./typert` artifact. It extends
 * no Typert runtime base and imports no `@deepseek-ai/*` module at runtime, so
 * a git install (whose profile node_modules holds only this package's own
 * dependencies) can load the host half without peer resolution.
 * @module dsh-sidechat
 */

import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, LlmRuntime, Message, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { TypertGatewayBinding } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {
  SidechatContextArgs,
  SidechatJobIdResult,
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
}
interface SandboxPolicyFace {
  workspaceRoot: string
}
interface SessionTitleFace { get(session: Session): { title: string } | undefined }
interface FsFace {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  readText(target: unknown, signal?: AbortSignal): Promise<string>
}
interface DefaultModelFace { currentSelection(): { provider: string; model: string; reasoningEffort?: string } | undefined }

/** One in-flight generation job; polled by the browser until `done`. */
interface Job {
  id: string
  text: string
  reasoning: string
  done: boolean
  error: string | null
}

/**
 * The `sidechat` service: one Remote endpoint per panel capability.
 *
 * Standard Cordis plugin shape: the module exports a named `apply` function
 * (the loader's `unwrapExports` passes the module namespace to
 * `registry.plugin`, which invokes `apply(ctx)`). `apply` instantiates the
 * service (which registers itself and its Gateway binding) and registers the
 * durable settings section when the Host settings service is present. The
 * only runtime `@deepseek-ai/*` import is `schemastery`, declared as a
 * dependency so a profile install carries it; every other import is
 * type-only.
 * @module dsh-sidechat
 */

/** Settings namespace owned by the side-chat plugin. */
export const SIDECHAT_SETTINGS_NAMESPACE = 'sidechat'

/** Durable side-chat preferences surfaced in the Settings panel. */
export interface SidechatSettings {
  /** Master switch: when false the hot zone, panel, and selection send are hidden. */
  enabled: boolean
}

/** Durable section schema; also the wire envelope the browser scope validates against. */
export const SidechatSettingsSchema: z<SidechatSettings> = z.object({
  enabled: z.boolean().default(true),
})

export function apply(ctx: Context): void {
  new SidechatService(ctx)
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.settings.register(SIDECHAT_SETTINGS_NAMESPACE as SettingsNamespace, SidechatSettingsSchema)
  })
}

export class SidechatService {
  private readonly ctx: Context
  private readonly jobs = new Map<string, Job>()
  private seq = 0

  /** Visible binding consumed by the Gateway's strict and source discovery. */
  readonly typertRemote: TypertGatewayBinding<this>

  constructor(ctx: Context) {
    this.ctx = ctx
    this.typertRemote = Object.freeze({ service: this, serviceKey: 'sidechat', namespace: 'sidechat' })
    ctx.reflect.provide('sidechat', this)
    ctx.effect(() => () => { this.jobs.clear() }, 'sidechat: generation jobs')
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
    }
    return context
  }

  private async readConversationContext(sessionId: string): Promise<SidechatProjectContext['conversation']> {
    const out: SidechatProjectContext['conversation'] = { title: null, messages: [] }
    if (sessionId === '') return out
    const session = (this.ctx.get('sessions') as unknown as SessionStore | undefined)?.get(sessionId as SessionId)
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
  async getContext(args: SidechatContextArgs): Promise<SidechatProjectContext> {
    return this.readProjectContext(String(args?.sessionId ?? ''))
  }

  /** Advisory provider/model catalog with per-model reasoning efforts. */
  async models(): Promise<SidechatModelsResult> {
    const llm = this.ctx.get('llm') as unknown as LlmRuntime | undefined
    let current: { provider: string; model: string } | null = null
    try {
      const selection = (this.ctx.get('agentDefaultModel') as unknown as DefaultModelFace | undefined)?.currentSelection()
      if (selection !== undefined) current = { provider: selection.provider, model: selection.model }
    } catch { /* ignore */ }
    const groups: SidechatModelsResult['groups'] = []
    if (llm !== undefined) {
      for (const provider of llm.listProviders()) {
        try {
          const models = await llm.listModels(provider.id)
          const entries: SidechatModelsResult['groups'][number]['models'] = []
          for (const model of models) {
            const entry: SidechatModelsResult['groups'][number]['models'][number] = { id: model.id, name: model.name }
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

  /** Start one streaming generation; the browser polls {@link poll} for deltas. */
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
    const job: Job = { id, text: '', reasoning: '', done: false, error: null }
    this.jobs.set(id, job)
    void (async () => {
      try {
        for await (const chunk of llm.stream(options)) {
          if (this.jobs.get(id) !== job) return
          if (chunk.type === 'text-delta') job.text += chunk.text
          else if (chunk.type === 'reasoning-delta') job.reasoning += chunk.text
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

  /** Read the accumulated text and reasoning of one job. */
  poll(args: SidechatPollArgs): SidechatPollResult {
    const job = this.jobs.get(String(args?.jobId ?? ''))
    if (job === undefined) return { done: true, text: '', reasoning: '', error: 'side chat: job not found' }
    return { done: job.done, text: job.text, reasoning: job.reasoning, error: job.error }
  }

  /** Stop polling a job; the in-flight stream finishes but no longer updates it. */
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
