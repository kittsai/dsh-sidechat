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
import type { Context } from '@deepseek-ai/cordis';
import type { TypertGatewayBinding } from '@deepseek-ai/dsh-typert-protocol';
import type { SidechatContextArgs, SidechatJobIdResult, SidechatModelsResult, SidechatPollArgs, SidechatPollResult, SidechatProjectContext, SidechatStartArgs, SidechatStopArgs, SidechatStopResult } from './types.ts';
export type * from './types.ts';
/**
 * The `sidechat` service: one Remote endpoint per panel capability.
 *
 * Standard Cordis plugin shape: the module exports a named `apply` function
 * (the loader's `unwrapExports` passes the module namespace to
 * `registry.plugin`, which invokes `apply(ctx)`). `apply` instantiates the
 * service, which registers itself and its Gateway binding; no `@deepseek-ai/*`
 * module is imported at runtime, so the host half loads from a profile whose
 * node_modules holds only this package's own dependencies (peers are never
 * auto-installed with `autoInstallPeers: false`).
 * @module dsh-sidechat
 */
export declare function apply(ctx: Context): void;
export declare class SidechatService {
    private readonly ctx;
    private readonly jobs;
    private seq;
    /** Visible binding consumed by the Gateway's strict and source discovery. */
    readonly typertRemote: TypertGatewayBinding<this>;
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
