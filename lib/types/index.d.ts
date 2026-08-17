/**
 * DSH Side Chat — host plugin.
 *
 * Provides the `sidechat` Typert Remote service backing the browser side-chat
 * panel: project/session context gathering, the model catalog, and streaming
 * generation through `llm.stream` (job + poll). Every Remote method crosses the
 * wire as plain JSON — session identity travels as a string, never as an Agent
 * or Session object.
 * @module dsh-sidechat
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { SidechatContextArgs, SidechatJobIdResult, SidechatModelsResult, SidechatPollArgs, SidechatPollResult, SidechatProjectContext, SidechatStartArgs, SidechatStopArgs, SidechatStopResult } from './types.ts';
export type * from './types.ts';
/**
 * The `sidechat` service: one Remote endpoint per panel capability.
 * @module dsh-sidechat
 */
export default class SidechatService extends TypertRemoteService {
    private readonly jobs;
    private seq;
    constructor(ctx: Context);
    private readProjectContext;
    private readConversationContext;
    private buildSystemPrompt;
    /** Project + session context for the panel header and every generation. */
    getContext(args: SidechatContextArgs): Promise<SidechatProjectContext>;
    /** Advisory provider/model catalog with per-model reasoning efforts. */
    models(): Promise<SidechatModelsResult>;
    /** Start one streaming generation; the browser polls {@link poll} for deltas. */
    start(args: SidechatStartArgs): Promise<SidechatJobIdResult>;
    /** Read the accumulated text and reasoning of one job. */
    poll(args: SidechatPollArgs): SidechatPollResult;
    /** Stop polling a job; the in-flight stream finishes but no longer updates it. */
    stop(args: SidechatStopArgs): SidechatStopResult;
}
