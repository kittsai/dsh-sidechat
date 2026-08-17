/**
 * Side chat plugin, browser half: hover-to-open hot zone over `shell.overlay`,
 * the chat panel in the right `details` column, and a selection-triggered
 * "add to side chat" button. The panel is a focused project Q&A surface:
 * model/effort selection, streaming replies with collapsible reasoning, table
 * markdown, and a confirm-guarded clear — driven through the host `sidechat`
 * Remote (see dsh-sidechat).
 * @module dsh-sidechat/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/** Required services: slot registry, layout transitions, and the Host Remote. */
export declare const inject: string[];
/**
 * Browser plugin body: mount the Host Remote contribution, then the hover hot
 * zone, the selection-send button, and the details-column panel.
 * @param ctx - client root context.
 * @returns disposer that unmounts the Remote and every slot registration.
 */
export declare function apply(ctx: ClientContext): Promise<() => void>;
