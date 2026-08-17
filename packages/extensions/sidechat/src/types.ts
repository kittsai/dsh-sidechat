/**
 * Public wire vocabulary of the `sidechat` Remote service. Every type here is
 * a Remote boundary type: it crosses the wire as lossless JSON, so only
 * plain-object shapes appear.
 * @module @deepseek-ai/dsh-sidechat/types
 */

/** Project + conversation snapshot injected into every side-chat system prompt. */
export interface SidechatProjectContext {
  root: string | null
  branch: string | null
  entries: { name: string; type: string }[]
  model: { provider: string; model: string } | null
  conversation: { title: string | null; messages: { role: string; text: string }[] }
}

/** One provider group of the advisory model catalog. */
export interface SidechatModelGroup {
  id: string
  name: string
  models: {
    id: string
    name: string
    reasoning?: { efforts: { id: string; name: string }[]; defaultEffort: string | null }
  }[]
}

/** Advisory model catalog plus the currently selected default route. */
export interface SidechatModelsResult {
  groups: SidechatModelGroup[]
  current: { provider: string; model: string } | null
}

/** Read or written session sandbox mode; `error` present when the write was refused. */
export interface SidechatModeResult {
  mode: string
  error?: string
}

/** Slash commands the addressed session's agent resolves. */
export interface SidechatCommandsResult {
  commands: { name: string; description: string; input: string | null }[]
}

/** Settled command execution: `unknown: true` when the line did not resolve. */
export type SidechatCommandResult =
  | { unknown: true }
  | { commandId: string | null; result: { kind: string; text?: string } }

/** One started generation job. */
export interface SidechatJobIdResult {
  jobId: string
}

/** Accumulated text of one job; `done` once generation settled. */
export interface SidechatPollResult {
  done: boolean
  text: string
  error: string | null
}

/** Stop acknowledgement. */
export interface SidechatStopResult {
  stopped: boolean
}

/** getContext request. */
export interface SidechatContextArgs {
  sessionId: string
}

/** mode request; omit `mode` to read. */
export interface SidechatModeArgs {
  sessionId: string
  mode?: string
}

/** commands request. */
export interface SidechatCommandsArgs {
  sessionId: string
}

/** command request. */
export interface SidechatCommandArgs {
  sessionId: string
  line: string
}

/** start request; provider/model/effort override the default selection when present. */
export interface SidechatStartArgs {
  sessionId: string
  messages: { role: string; content: string }[]
  provider?: string
  model?: string
  reasoningEffort?: string
}

/** poll request. */
export interface SidechatPollArgs {
  jobId: string
}

/** stop request. */
export interface SidechatStopArgs {
  jobId: string
}
