/**
 * Node half of the sidechat bundle: this package only declares the profile
 * patch (`cordis.patch.yml`); it owns no runtime glue.
 * @module @deepseek-ai/dsh-sidechat-bundle
 */

/** No-op host half: the patch layer does all the work. */
export const apply = (): void => { /* patch-only bundle */ }
