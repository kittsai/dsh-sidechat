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
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types';
/**
 * Host-face contribution registered by the typert-loader when the `sidechat`
 * loader entry mounts. Strict descriptors mirror the browser contribution in
 * `src/client/remote.ts`; the wire contract must stay in lockstep with it.
 */
export declare const TYPERT: TypertContribution;
