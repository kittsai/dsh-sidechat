/**
 * Hand-written Remote contribution for the `sidechat` namespace.
 *
 * The harness typert generator emits an equivalent artifact
 * (`lib/typert.remote-client.js`) inside the monorepo; a single self-contained
 * package cannot run the generator (it requires the workspace layout), so this
 * module restates the same wire contract: strict zod codecs for every
 * parameter and result, mounted through `ctx.remote.$mount` in apply.
 * @module dsh-sidechat/client/remote
 */
import { z } from 'zod';
const contextArgsSchema = z.object({ sessionId: z.string() });
const projectContextSchema = z.object({
    root: z.union([z.literal(null), z.string()]),
    branch: z.union([z.literal(null), z.string()]),
    conversation: z.object({
        title: z.union([z.literal(null), z.string()]),
        messages: z.array(z.object({ role: z.string(), text: z.string() })),
    }),
});
const modelsResultSchema = z.object({
    groups: z.array(z.object({
        id: z.string(),
        name: z.string(),
        models: z.array(z.object({
            id: z.string(),
            name: z.string(),
            reasoning: z.object({
                efforts: z.array(z.object({ id: z.string(), name: z.string() })),
                defaultEffort: z.union([z.literal(null), z.string()]),
            }).optional(),
        })),
    })),
    current: z.union([z.literal(null), z.object({ provider: z.string(), model: z.string() })]),
});
const startArgsSchema = z.object({
    sessionId: z.string(),
    messages: z.array(z.object({ role: z.string(), content: z.string() })),
    provider: z.string().optional(),
    model: z.string().optional(),
    reasoningEffort: z.string().optional(),
});
const jobIdResultSchema = z.object({ jobId: z.string() });
const pollArgsSchema = z.object({ jobId: z.string() });
const pollResultSchema = z.object({
    done: z.boolean(),
    text: z.string(),
    reasoning: z.string(),
    error: z.union([z.literal(null), z.string()]),
});
const stopArgsSchema = z.object({ jobId: z.string() });
const stopResultSchema = z.object({ stopped: z.boolean() });
/** Remote contribution owned by this package, one descriptor per endpoint. */
export const TYPERT_REMOTE = {
    package: 'dsh-sidechat',
    descriptors: [
        {
            id: 'dsh-sidechat#sidechat/getContext',
            service: 'sidechat',
            namespace: 'sidechat',
            method: 'getContext',
            invocation: { kind: 'direct' },
            parameters: [{
                    name: 'args',
                    wire: 'args',
                    source: 'json',
                    codec: { mode: 'strict', typeSymbol: 'dsh-sidechat/types#SidechatContextArgs', schema: contextArgsSchema },
                }],
            result: { mode: 'strict', typeSymbol: 'dsh-sidechat/types#SidechatProjectContext', schema: projectContextSchema },
        },
        {
            id: 'dsh-sidechat#sidechat/models',
            service: 'sidechat',
            namespace: 'sidechat',
            method: 'models',
            invocation: { kind: 'direct' },
            parameters: [],
            result: { mode: 'strict', typeSymbol: 'dsh-sidechat/types#SidechatModelsResult', schema: modelsResultSchema },
        },
        {
            id: 'dsh-sidechat#sidechat/start',
            service: 'sidechat',
            namespace: 'sidechat',
            method: 'start',
            invocation: { kind: 'direct' },
            parameters: [{
                    name: 'args',
                    wire: 'args',
                    source: 'json',
                    codec: { mode: 'strict', typeSymbol: 'dsh-sidechat/types#SidechatStartArgs', schema: startArgsSchema },
                }],
            result: { mode: 'strict', typeSymbol: 'dsh-sidechat/types#SidechatJobIdResult', schema: jobIdResultSchema },
        },
        {
            id: 'dsh-sidechat#sidechat/poll',
            service: 'sidechat',
            namespace: 'sidechat',
            method: 'poll',
            invocation: { kind: 'direct' },
            parameters: [{
                    name: 'args',
                    wire: 'args',
                    source: 'json',
                    codec: { mode: 'strict', typeSymbol: 'dsh-sidechat/types#SidechatPollArgs', schema: pollArgsSchema },
                }],
            result: { mode: 'strict', typeSymbol: 'dsh-sidechat/types#SidechatPollResult', schema: pollResultSchema },
        },
        {
            id: 'dsh-sidechat#sidechat/stop',
            service: 'sidechat',
            namespace: 'sidechat',
            method: 'stop',
            invocation: { kind: 'direct' },
            parameters: [{
                    name: 'args',
                    wire: 'args',
                    source: 'json',
                    codec: { mode: 'strict', typeSymbol: 'dsh-sidechat/types#SidechatStopArgs', schema: stopArgsSchema },
                }],
            result: { mode: 'strict', typeSymbol: 'dsh-sidechat/types#SidechatStopResult', schema: stopResultSchema },
        },
    ],
};
//# sourceMappingURL=remote.js.map