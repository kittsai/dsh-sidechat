/**
 * Package-owned invariant companion for the sidechat plugin.
 * @module @deepseek-ai/dsh-sidechat/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-sidechat'

/** Cordis companion plugin name. */
export const name = 'sidechat-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the invariant contribution. The sidechat service owns only transient
 * in-process generation jobs (a `Map` of `{ id, text, done, error }`); every
 * durable fact it touches (sandbox mode, command lifecycle) is owned and
 * checked by its source package, so there is no sidechat-owned event/data
 * relationship an invariant could verify.
 */
const install: InvariantInstaller = (_ctx: Context, _fail: InvariantFailure) => {
  // No runtime invariant: see the function-level rationale above.
}

/**
 * Register the sidechat invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
