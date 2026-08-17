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
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
let SidechatService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _getContext_decorators;
    let _models_decorators;
    let _start_decorators;
    let _poll_decorators;
    let _stop_decorators;
    return class SidechatService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _getContext_decorators = [Remote];
            _models_decorators = [Remote];
            _start_decorators = [Remote];
            _poll_decorators = [Remote];
            _stop_decorators = [Remote];
            __esDecorate(this, null, _getContext_decorators, { kind: "method", name: "getContext", static: false, private: false, access: { has: obj => "getContext" in obj, get: obj => obj.getContext }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _models_decorators, { kind: "method", name: "models", static: false, private: false, access: { has: obj => "models" in obj, get: obj => obj.models }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _start_decorators, { kind: "method", name: "start", static: false, private: false, access: { has: obj => "start" in obj, get: obj => obj.start }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _poll_decorators, { kind: "method", name: "poll", static: false, private: false, access: { has: obj => "poll" in obj, get: obj => obj.poll }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _stop_decorators, { kind: "method", name: "stop", static: false, private: false, access: { has: obj => "stop" in obj, get: obj => obj.stop }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        jobs = (__runInitializers(this, _instanceExtraInitializers), new Map());
        seq = 0;
        constructor(ctx) {
            super(ctx, 'sidechat');
            ctx.effect(() => () => { this.jobs.clear(); }, 'sidechat: generation jobs');
        }
        async readProjectContext(sessionId) {
            const agents = this.ctx.get('agents');
            const sp = this.ctx.get('sandboxPolicy');
            let root;
            try {
                const cwd = agents?.currentInitiator()?.session?.header?.cwd;
                if (typeof cwd === 'string' && cwd.length > 0)
                    root = cwd;
            }
            catch { /* initiator read failed; fall through */ }
            if (root === undefined)
                root = sp?.workspaceRoot;
            const context = {
                root: root ?? null,
                branch: null,
                conversation: await this.readConversationContext(sessionId),
            };
            if (context.root === null)
                return context;
            const fs = this.ctx.get('fs');
            if (fs !== undefined) {
                try {
                    const head = await fs.resolve('.git/HEAD', { cwd: context.root });
                    const text = await fs.readText(head);
                    const match = /ref:\s*refs\/heads\/([^\s]+)/.exec(text);
                    if (match !== null)
                        context.branch = match[1] ?? null;
                }
                catch { /* not a git repository */ }
            }
            return context;
        }
        async readConversationContext(sessionId) {
            const out = { title: null, messages: [] };
            if (sessionId === '')
                return out;
            const session = this.ctx.get('sessions')?.get(sessionId);
            if (session === undefined)
                return out;
            try {
                const snapshot = this.ctx.get('sessionTitle')?.get(session);
                if (snapshot !== undefined && snapshot.title.length > 0)
                    out.title = snapshot.title;
            }
            catch { /* title read failed */ }
            try {
                const derived = session.deriveMessages();
                const picked = [];
                for (let i = derived.length - 1; i >= 0 && picked.length < 12; i -= 1) {
                    const message = derived[i];
                    if (message === undefined)
                        continue;
                    const text = message.content
                        .filter(block => block !== null && block !== undefined && block.type === 'text')
                        .map(block => block.text)
                        .join('')
                        .slice(0, 2000);
                    if (text === '')
                        continue;
                    picked.push({ role: message.role === 'assistant' ? 'assistant' : 'user', text });
                }
                out.messages = picked.reverse();
            }
            catch { /* message derivation failed */ }
            return out;
        }
        buildSystemPrompt(context, provider, model, reasoningEffort) {
            const lines = [
                'You are a coding assistant embedded in the DeepSeek Harness side-chat panel.',
                `You are currently running as model "${model}" from provider "${provider}"`
                    + (reasoningEffort !== undefined ? ` with reasoning effort "${reasoningEffort}"` : '') + '.',
                'When the user asks which model you are, answer with exactly this model id.',
                'The user is working inside the project below. Use this context to answer their questions.',
            ];
            if (context.root !== null)
                lines.push(`- Project root: ${context.root}`);
            if (context.branch !== null)
                lines.push(`- Git branch: ${context.branch}`);
            if (context.conversation.messages.length > 0) {
                lines.push('');
                lines.push('The main conversation in progress (most recent last) is below; keep your answer consistent with it:');
                for (const message of context.conversation.messages) {
                    lines.push(`${message.role}: ${message.text}`);
                }
            }
            lines.push('Answer in the same language the user writes in. Be concise and accurate; say clearly when you are not sure.');
            return lines.join('\n');
        }
        /** Project + session context for the panel header and every generation. */
        async getContext(args) {
            return this.readProjectContext(String(args?.sessionId ?? ''));
        }
        /** Advisory provider/model catalog with per-model reasoning efforts. */
        async models() {
            const llm = this.ctx.get('llm');
            let current = null;
            try {
                const selection = this.ctx.get('agentDefaultModel')?.currentSelection();
                if (selection !== undefined)
                    current = { provider: selection.provider, model: selection.model };
            }
            catch { /* ignore */ }
            const groups = [];
            if (llm !== undefined) {
                for (const provider of llm.listProviders()) {
                    try {
                        const models = await llm.listModels(provider.id);
                        const entries = [];
                        for (const model of models) {
                            const entry = { id: model.id, name: model.name };
                            try {
                                const resolved = await llm.resolveModelInfo(provider.id, model.id);
                                if (resolved.reasoning !== undefined) {
                                    entry.reasoning = {
                                        efforts: resolved.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })),
                                        defaultEffort: resolved.reasoning.defaultEffort ?? null,
                                    };
                                }
                            }
                            catch { /* metadata lookup failed; keep id/name only */ }
                            entries.push(entry);
                        }
                        groups.push({ id: provider.id, name: provider.name, models: entries });
                    }
                    catch { /* provider catalog read failed; skip group */ }
                }
            }
            return { groups, current };
        }
        /** Start one streaming generation; the browser polls {@link poll} for deltas. */
        async start(args) {
            const raw = Array.isArray(args?.messages) ? args.messages : [];
            const sessionId = String(args?.sessionId ?? '');
            const customProvider = typeof args?.provider === 'string' && args.provider.length > 0 ? args.provider : null;
            const customModel = typeof args?.model === 'string' && args.model.length > 0 ? args.model : null;
            const customEffort = typeof args?.reasoningEffort === 'string' && args.reasoningEffort.length > 0 ? args.reasoningEffort : null;
            const history = raw.slice(-20).map(message => ({
                role: message?.role === 'assistant' ? 'assistant' : 'user',
                content: [{ type: 'text', text: String(message?.content ?? '') }],
                source: { kind: 'plugin', plugin: 'dsh-sidechat' },
                id: `sidechat-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            }));
            if (history.length === 0)
                throw new Error('side chat: no messages to send');
            const context = await this.readProjectContext(sessionId);
            const selection = this.ctx.get('agentDefaultModel')?.currentSelection();
            const llm = this.ctx.get('llm');
            if (selection === undefined || llm === undefined)
                throw new Error('side chat: no model route is available');
            const provider = customProvider ?? selection.provider;
            const model = customModel ?? selection.model;
            const reasoningEffort = customProvider !== null
                ? (customEffort ?? undefined)
                : selection.reasoningEffort;
            const options = {
                provider,
                model,
                messages: history,
                system: this.buildSystemPrompt(context, provider, model, reasoningEffort),
                temperature: 0.7,
                maxTokens: 4096,
                ...(reasoningEffort !== undefined
                    ? { reasoningEffort: reasoningEffort }
                    : {}),
            };
            const id = `sidechat-${++this.seq}`;
            const job = { id, text: '', reasoning: '', done: false, error: null };
            this.jobs.set(id, job);
            void (async () => {
                try {
                    for await (const chunk of llm.stream(options)) {
                        if (this.jobs.get(id) !== job)
                            return;
                        if (chunk.type === 'text-delta')
                            job.text += chunk.text;
                        else if (chunk.type === 'reasoning-delta')
                            job.reasoning += chunk.text;
                        else if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
                            const failure = chunk.reason.failure;
                            job.error = failure !== null && typeof failure === 'object' && 'message' in failure
                                ? String(failure.message)
                                : String(failure);
                        }
                    }
                }
                catch (error) {
                    if (this.jobs.get(id) === job)
                        job.error = error instanceof Error ? error.message : String(error);
                }
                finally {
                    if (this.jobs.get(id) === job)
                        job.done = true;
                }
            })();
            return { jobId: id };
        }
        /** Read the accumulated text and reasoning of one job. */
        poll(args) {
            const job = this.jobs.get(String(args?.jobId ?? ''));
            if (job === undefined)
                return { done: true, text: '', reasoning: '', error: 'side chat: job not found' };
            return { done: job.done, text: job.text, reasoning: job.reasoning, error: job.error };
        }
        /** Stop polling a job; the in-flight stream finishes but no longer updates it. */
        stop(args) {
            const id = String(args?.jobId ?? '');
            const job = this.jobs.get(id);
            if (job !== undefined) {
                job.done = true;
                this.jobs.delete(id);
            }
            return { stopped: true };
        }
    };
})();
/**
 * The `sidechat` service: one Remote endpoint per panel capability.
 * @module dsh-sidechat
 */
export default SidechatService;
//# sourceMappingURL=index.js.map