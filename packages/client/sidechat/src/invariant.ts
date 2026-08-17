/**
 * Package-owned invariant companion for the sidechat client plugin.
 * @module @deepseek-ai/dsh-client-sidechat/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-sidechat'

/** Cordis companion plugin name. */
export const name = 'sidechat-client-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the invariant contribution. The browser half is pure presentation:
 * it renders slot UI and drives the host `sidechat` Remote; every durable fact
 * it reads or writes is owned by its source package, so there is no
 * sidechat-owned event/data relationship an invariant could verify.
 */
const install: InvariantInstaller = (_ctx: Context, _fail: InvariantFailure) => {
  // No runtime invariant: see the function-level rationale above.
}

/**
 * Register the sidechat client invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
