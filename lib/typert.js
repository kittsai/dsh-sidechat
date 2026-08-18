import { z } from "zod";
//#region lib/types/typert.js
/**
* Hand-written host-face Typert manifest for the `sidechat` service.
*
* The harness typert generator emits an equivalent artifact
* (`lib/typert.host.js`) inside the monorepo; a single self-contained package
* cannot run the generator (it requires the workspace layout), so this module
* restates the same wire contract: strict zod codecs for every parameter and
* result. The Gateway resolves these strict descriptors through
* `ctx.typert.local`, which does not depend on the decorator marker table, so
* the host half needs no `@Remote` decorator and no runtime `@deepseek-ai/*`
* import. The typert-loader discovers this artifact through the package's
* `./typert` export.
* @module dsh-sidechat/typert
*/
const contextArgsSchema = z.object({ sessionId: z.string() });
const projectContextSchema = z.object({
	root: z.union([z.literal(null), z.string()]),
	branch: z.union([z.literal(null), z.string()]),
	conversation: z.object({
		title: z.union([z.literal(null), z.string()]),
		messages: z.array(z.object({
			role: z.string(),
			text: z.string()
		}))
	})
});
const modelsResultSchema = z.object({
	groups: z.array(z.object({
		id: z.string(),
		name: z.string(),
		models: z.array(z.object({
			id: z.string(),
			name: z.string(),
			reasoning: z.object({
				efforts: z.array(z.object({
					id: z.string(),
					name: z.string()
				})),
				defaultEffort: z.union([z.literal(null), z.string()])
			}).optional()
		}))
	})),
	current: z.union([z.literal(null), z.object({
		provider: z.string(),
		model: z.string()
	})])
});
const startArgsSchema = z.object({
	sessionId: z.string(),
	messages: z.array(z.object({
		role: z.string(),
		content: z.string()
	})),
	provider: z.string().optional(),
	model: z.string().optional(),
	reasoningEffort: z.string().optional()
});
const jobIdResultSchema = z.object({ jobId: z.string() });
const pollArgsSchema = z.object({ jobId: z.string() });
const pollResultSchema = z.object({
	done: z.boolean(),
	text: z.string(),
	reasoning: z.string(),
	error: z.union([z.literal(null), z.string()])
});
const stopArgsSchema = z.object({ jobId: z.string() });
const stopResultSchema = z.object({ stopped: z.boolean() });
/**
* Host-face contribution registered by the typert-loader when the `sidechat`
* loader entry mounts. Strict descriptors mirror the browser contribution in
* `src/client/remote.ts`; the wire contract must stay in lockstep with it.
*/
const TYPERT = {
	package: "dsh-sidechat",
	face: "host",
	schemas: [
		{
			name: "SidechatContextArgs",
			schema: contextArgsSchema
		},
		{
			name: "SidechatProjectContext",
			schema: projectContextSchema
		},
		{
			name: "SidechatModelsResult",
			schema: modelsResultSchema
		},
		{
			name: "SidechatStartArgs",
			schema: startArgsSchema
		},
		{
			name: "SidechatJobIdResult",
			schema: jobIdResultSchema
		},
		{
			name: "SidechatPollArgs",
			schema: pollArgsSchema
		},
		{
			name: "SidechatPollResult",
			schema: pollResultSchema
		},
		{
			name: "SidechatStopArgs",
			schema: stopArgsSchema
		},
		{
			name: "SidechatStopResult",
			schema: stopResultSchema
		}
	],
	model: {
		services: [],
		events: [],
		objects: []
	},
	invocations: [
		{
			id: "dsh-sidechat#sidechat/getContext",
			service: "sidechat",
			namespace: "sidechat",
			method: "getContext",
			invocation: { kind: "direct" },
			parameters: [{
				name: "args",
				wire: "args",
				source: "json",
				codec: {
					mode: "strict",
					typeSymbol: "dsh-sidechat#SidechatContextArgs",
					schema: contextArgsSchema
				}
			}],
			result: {
				mode: "strict",
				typeSymbol: "dsh-sidechat#SidechatProjectContext",
				schema: projectContextSchema
			}
		},
		{
			id: "dsh-sidechat#sidechat/models",
			service: "sidechat",
			namespace: "sidechat",
			method: "models",
			invocation: { kind: "direct" },
			parameters: [],
			result: {
				mode: "strict",
				typeSymbol: "dsh-sidechat#SidechatModelsResult",
				schema: modelsResultSchema
			}
		},
		{
			id: "dsh-sidechat#sidechat/start",
			service: "sidechat",
			namespace: "sidechat",
			method: "start",
			invocation: { kind: "direct" },
			parameters: [{
				name: "args",
				wire: "args",
				source: "json",
				codec: {
					mode: "strict",
					typeSymbol: "dsh-sidechat#SidechatStartArgs",
					schema: startArgsSchema
				}
			}],
			result: {
				mode: "strict",
				typeSymbol: "dsh-sidechat#SidechatJobIdResult",
				schema: jobIdResultSchema
			}
		},
		{
			id: "dsh-sidechat#sidechat/poll",
			service: "sidechat",
			namespace: "sidechat",
			method: "poll",
			invocation: { kind: "direct" },
			parameters: [{
				name: "args",
				wire: "args",
				source: "json",
				codec: {
					mode: "strict",
					typeSymbol: "dsh-sidechat#SidechatPollArgs",
					schema: pollArgsSchema
				}
			}],
			result: {
				mode: "strict",
				typeSymbol: "dsh-sidechat#SidechatPollResult",
				schema: pollResultSchema
			}
		},
		{
			id: "dsh-sidechat#sidechat/stop",
			service: "sidechat",
			namespace: "sidechat",
			method: "stop",
			invocation: { kind: "direct" },
			parameters: [{
				name: "args",
				wire: "args",
				source: "json",
				codec: {
					mode: "strict",
					typeSymbol: "dsh-sidechat#SidechatStopArgs",
					schema: stopArgsSchema
				}
			}],
			result: {
				mode: "strict",
				typeSymbol: "dsh-sidechat#SidechatStopResult",
				schema: stopResultSchema
			}
		}
	]
};
//#endregion
export { TYPERT };
