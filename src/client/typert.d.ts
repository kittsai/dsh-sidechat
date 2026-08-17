/**
 * Type-only merge giving `ctx.remote.sidechat` its method signatures.
 *
 * The harness generator would emit this as part of the remote-client artifact;
 * a self-contained package restates the merge so the browser half sees a typed
 * namespace without importing a generated d.ts.
 * @module dsh-sidechat/client/typert
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
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
} from '../types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    sidechat: {
      getContext: (args: SidechatContextArgs) => Promise<RemoteResult<SidechatProjectContext>>
      models: () => Promise<RemoteResult<SidechatModelsResult>>
      start: (args: SidechatStartArgs) => Promise<RemoteResult<SidechatJobIdResult>>
      poll: (args: SidechatPollArgs) => Promise<RemoteResult<SidechatPollResult>>
      stop: (args: SidechatStopArgs) => Promise<RemoteResult<SidechatStopResult>>
    }
  }
}
