/**
 * Node half of the sidechat client plugin: the browser half (`./client`) owns
 * every effect. This module exists so the package has a neutral host face.
 * @module @deepseek-ai/dsh-client-sidechat
 */

/** No-op host half: nothing to run outside the browser. */
export const apply = (): void => { /* browser-only plugin */ }
