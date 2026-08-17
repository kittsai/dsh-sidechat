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
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
/** Remote contribution owned by this package, one descriptor per endpoint. */
export declare const TYPERT_REMOTE: TypertRemoteContribution;
