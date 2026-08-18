/**
 * Durable settings section owned by the side-chat plugin.
 *
 * The host half registers the namespace + schema (`src/index.ts`) and the
 * browser half binds it through `ctx.settingsScope`, so the master switch
 * persists in the user-settings document and surfaces in the Settings panel.
 * @module dsh-sidechat/client/settings
 */
/** Settings namespace owned by the side-chat plugin (lowercase kebab-case). */
export declare const SIDECHAT_SETTINGS_NAMESPACE = "sidechat";
/** Durable side-chat preferences surfaced in the Settings panel. */
export interface SidechatSettings {
    /** Master switch: when false the hot zone, panel, and selection send are hidden. */
    enabled: boolean;
}
/** Value applied before the user document has any section. */
export declare const SIDECHAT_SETTINGS_DEFAULT: SidechatSettings;
