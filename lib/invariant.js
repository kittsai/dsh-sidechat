//#region lib/types/invariant.js
/**
* Package-owned invariant companion for the sidechat plugin.
* @module dsh-sidechat/invariant
*/
const PACKAGE_NAME = "dsh-sidechat";
/** Cordis companion plugin name. */
const name = "sidechat-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* Install the invariant contribution. The sidechat service owns only transient
* in-process generation jobs (a `Map` of `{ id, text, done, error }`); every
* durable fact it touches (sandbox mode, command lifecycle) is owned and
* checked by its source package, so there is no sidechat-owned event/data
* relationship an invariant could verify.
*/
const install = (_ctx, _fail) => {};
/**
* Register the sidechat invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
