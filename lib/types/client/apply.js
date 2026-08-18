import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Side chat plugin, browser half: hover-to-open hot zone over `shell.overlay`,
 * the chat panel in the right `details` column, and a selection-triggered
 * "add to side chat" button. The panel is a focused project Q&A surface:
 * model/effort selection, streaming replies with collapsible reasoning, table
 * markdown, and a confirm-guarded clear — driven through the host `sidechat`
 * Remote (see dsh-sidechat).
 * @module dsh-sidechat/client
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import { TYPERT_REMOTE } from "./remote.js";
import { SIDECHAT_SETTINGS_DEFAULT, SIDECHAT_SETTINGS_NAMESPACE } from "./settings.js";
import css from './sidechat.module.css';
/** Required services: slot registry, layout transitions, the Host Remote, and the settings scope binder. */
export const inject = ['slots', 'layout', 'remote', 'settingsScope'];
/** Unwrap one remote result into its value, throwing the wire error. */
async function callRemote(call) {
    const result = await call();
    if (!result.ok)
        throw new Error(`${result.error.message} (${result.error.code})`);
    return result.value;
}
/** Shared plugin state: panel open flag, the selection-to-send handoff, and the enabled master switch. */
const store = { open: false, modelKey: '', effort: '', messages: [], pendingSend: null, sendHook: null, enabled: SIDECHAT_SETTINGS_DEFAULT.enabled };
const subscribers = new Set();
const setOpenShared = (value, layout) => {
    store.open = value;
    if (layout !== undefined) {
        try {
            if (value)
                layout.openDetails();
            else
                layout.closeDetails();
        }
        catch { /* layout transition failed; keep local state */ }
    }
    subscribers.forEach(listener => listener());
};
/** Live settings-scope handle, bound in apply; drives the enabled master switch. */
let settingsScopeHandle;
/** Publish one enabled-state change through the settings scope (persisted). */
const setEnabledShared = (value) => {
    store.enabled = value;
    subscribers.forEach(listener => listener());
    void settingsScopeHandle?.set('enabled', value);
};
/** Subscribe a component to the enabled master switch. */
function useEnabled() {
    const [enabled, setState] = useState(store.enabled);
    useEffect(() => {
        const listener = () => setState(store.enabled);
        subscribers.add(listener);
        return () => { subscribers.delete(listener); };
    }, []);
    return enabled;
}
const isHr = (line) => /^-{3,}$/.test(line) || /^\*{3,}$/.test(line) || /^_{3,}$/.test(line);
/** Split one markdown table row into cells, or null when the line is not a row. */
function splitTableRow(line) {
    const trimmed = line.trim();
    if (!trimmed.includes('|'))
        return null;
    return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}
/** Inline markdown spans: code, bold, italic, links. */
function renderInline(text) {
    const nodes = [];
    const tokenRe = /(`+)([\s\S]*?)\1|(\*\*|__)([\s\S]*?)\3|(\*|_)([\s\S]*?)\5|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0;
    let key = 0;
    let match;
    while ((match = tokenRe.exec(text)) !== null) {
        if (match.index > last)
            nodes.push(text.slice(last, match.index));
        const codeDelim = match[1];
        if (codeDelim !== undefined) {
            nodes.push(_jsx("code", { children: match[2] ?? '' }, `md-c-${key++}`));
        }
        else if (match[3] !== undefined) {
            nodes.push(_jsxs("strong", { children: [...renderInline(match[4] ?? '')] }, `md-s-${key++}`));
        }
        else if (match[5] !== undefined) {
            nodes.push(_jsxs("em", { children: [...renderInline(match[6] ?? '')] }, `md-e-${key++}`));
        }
        else if (match[7] !== undefined && match[8] !== undefined) {
            nodes.push(_jsx("a", { className: css.mdLink, href: match[8], target: "_blank", rel: "noreferrer", children: match[7] }, `md-a-${key++}`));
        }
        last = tokenRe.lastIndex;
    }
    if (last < text.length)
        nodes.push(text.slice(last));
    return nodes;
}
/** Lightweight markdown → React renderer (text-only output; never raw HTML). */
function renderMarkdown(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    const nodes = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i] ?? '';
        const trimmed = line.trim();
        const fence = /^```(\w*)\s*$/.exec(trimmed);
        if (fence !== null) {
            const body = [];
            i += 1;
            while (i < lines.length && !/^```\s*$/.test((lines[i] ?? '').trim())) {
                body.push(lines[i] ?? '');
                i += 1;
            }
            i += 1;
            nodes.push(_jsx("pre", { className: css.mdPre, children: _jsx("code", { className: css.mdCodeblock, children: body.join('\n') }) }, `md-pre-${nodes.length}`));
            continue;
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (heading !== null) {
            const level = heading[1]?.length ?? 1;
            nodes.push(React.createElement(`h${level}`, { key: `md-h-${nodes.length}`, className: `${css.mdH} ${css[`mdH${level}`]}` }, ...renderInline(heading[2] ?? '')));
            i += 1;
            continue;
        }
        const headerCells = splitTableRow(line);
        const nextCells = i + 1 < lines.length ? splitTableRow(lines[i + 1] ?? '') : null;
        if (headerCells !== null && nextCells !== null
            && nextCells.length >= 2 && nextCells.every(cell => /^:?-+:?$/.test(cell))) {
            const bodyRows = [];
            i += 2;
            while (i < lines.length) {
                const cells = splitTableRow(lines[i] ?? '');
                if (cells === null || (lines[i] ?? '').trim() === '')
                    break;
                bodyRows.push(cells);
                i += 1;
            }
            nodes.push(React.createElement('table', { key: `md-table-${nodes.length}`, className: css.mdTable }, React.createElement('thead', null, React.createElement('tr', null, headerCells.map((cell, idx) => React.createElement('th', { key: idx }, ...renderInline(cell))))), React.createElement('tbody', null, bodyRows.map((row, ri) => React.createElement('tr', { key: ri }, row.map((cell, ci) => React.createElement('td', { key: ci }, ...renderInline(cell))))))));
            continue;
        }
        if (isHr(trimmed)) {
            nodes.push(_jsx("hr", { className: css.mdHr }, `md-hr-${nodes.length}`));
            i += 1;
            continue;
        }
        if (/^>\s?/.test(trimmed)) {
            const quote = [];
            while (i < lines.length && /^>\s?/.test((lines[i] ?? '').trim())) {
                quote.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
                i += 1;
            }
            nodes.push(_jsx("blockquote", { className: css.mdQuote, children: _jsxs("p", { children: [...renderInline(quote.join(' '))] }) }, `md-q-${nodes.length}`));
            continue;
        }
        const ulMatch = /^(\s*)[-*+]\s+(.*)$/.exec(line);
        const olMatch = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
        if (ulMatch !== null || olMatch !== null) {
            const ordered = olMatch !== null;
            const items = [];
            while (i < lines.length) {
                const m2 = /^(\s*)[-*+]\s+(.*)$/.exec(lines[i] ?? '');
                const m3 = /^(\s*)\d+[.)]\s+(.*)$/.exec(lines[i] ?? '');
                if (ordered ? m3 !== null : m2 !== null) {
                    items.push(_jsxs("li", { children: [...renderInline((ordered ? m3[2] : m2[2]) ?? '')] }, `md-li-${items.length}`));
                    i += 1;
                }
                else if (/^\s+/.test(lines[i] ?? '') && (lines[i] ?? '').trim() !== '') {
                    i += 1;
                }
                else
                    break;
            }
            nodes.push(React.createElement(ordered ? 'ol' : 'ul', { key: `md-ul-${nodes.length}`, className: css.mdList }, items));
            continue;
        }
        if (trimmed === '') {
            i += 1;
            continue;
        }
        const paragraph = [line];
        i += 1;
        while (i < lines.length) {
            const t = (lines[i] ?? '').trim();
            if (t === '')
                break;
            if (/^```/.test(t) || /^#{1,6}\s/.test(t) || /^>\s?/.test(t) || isHr(t) || /^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t))
                break;
            paragraph.push(lines[i] ?? '');
            i += 1;
        }
        nodes.push(_jsxs("p", { className: css.mdP, children: [...renderInline(paragraph.join(' '))] }, `md-p-${nodes.length}`));
    }
    return nodes;
}
/** Hover hot zone over the right edge; hidden while the panel is disabled. */
function HotZone({ layout }) {
    const enabled = useEnabled();
    if (!enabled)
        return null;
    return (_jsx("div", { className: css.hotzone, onMouseEnter: () => { setOpenShared(true, layout); }, "aria-hidden": "true" }));
}
/** Selection-triggered button: sends the main-chat selection into the side chat. */
function SelectionSendButton() {
    const enabled = useEnabled();
    const [position, setPosition] = useState(null);
    const [selectedText, setSelectedText] = useState('');
    useEffect(() => {
        const onSelectionChange = () => {
            try {
                const selection = window.getSelection();
                const value = selection?.toString().trim() ?? '';
                if (value === '') {
                    setPosition(null);
                    setSelectedText('');
                    return;
                }
                const node = selection?.anchorNode;
                const el = node !== null && node !== undefined && node.nodeType === 1 ? node : (node !== null && node !== undefined ? node.parentElement : null);
                if (el instanceof Element && el.closest('.sidechatPanel') !== null) {
                    setPosition(null);
                    setSelectedText('');
                    return;
                }
                const range = selection?.getRangeAt(0);
                if (range === undefined) {
                    setPosition(null);
                    return;
                }
                const rect = range.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) {
                    setPosition(null);
                    return;
                }
                setSelectedText(value.slice(0, 2000));
                setPosition({ x: Math.max(0, rect.left), y: Math.max(0, rect.top) });
            }
            catch {
                setPosition(null);
            }
        };
        window.document.addEventListener('selectionchange', onSelectionChange);
        window.document.addEventListener('mouseup', onSelectionChange);
        return () => {
            window.document.removeEventListener('selectionchange', onSelectionChange);
            window.document.removeEventListener('mouseup', onSelectionChange);
        };
    }, []);
    if (position === null || selectedText === '' || !enabled)
        return null;
    return React.createElement('button', {
        className: css.sendsel,
        type: 'button',
        style: { left: `${position.x}px`, top: `${position.y}px` },
        onMouseDown: (event) => event.preventDefault(),
        onClick: () => {
            store.pendingSend = selectedText;
            setOpenShared(true, undefined);
            setPosition(null);
            setSelectedText('');
        },
    }, '添加到侧边聊天');
}
/** The side-chat panel occupying the right details column. */
function Panel(props) {
    const { ctx, sidechat, sessionId } = props;
    const enabled = useEnabled();
    const [modelCatalog, setModelCatalog] = useState(null);
    const [modelKey, setModelKey] = useState('');
    const [effort, setEffort] = useState('');
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [jobId, setJobId] = useState(null);
    const [error, setError] = useState(null);
    const [confirmClear, setConfirmClear] = useState(false);
    store.modelKey = modelKey;
    store.effort = effort;
    store.messages = messages;
    const findModel = (key) => {
        if (key === '')
            return null;
        const parts = key.split('/');
        if (parts.length !== 2)
            return null;
        for (const group of modelCatalog?.groups ?? []) {
            if (group.id !== parts[0])
                continue;
            for (const model of group.models)
                if (model.id === parts[1])
                    return model;
        }
        return null;
    };
    useEffect(() => {
        let cancelled = false;
        setError(null);
        void callRemote(() => sidechat.models()).then(value => {
            if (!cancelled)
                setModelCatalog(value);
        }, () => { });
        return () => { cancelled = true; };
    }, [ctx]);
    useEffect(() => {
        if (modelKey !== '' || modelCatalog?.current == null)
            return;
        const { provider, model } = modelCatalog.current;
        if (provider === '' || model === '')
            return;
        if (findModel(`${provider}/${model}`) !== null)
            setModelKey(`${provider}/${model}`);
    }, [modelCatalog]);
    useEffect(() => {
        if (modelKey === '') {
            setEffort('');
            return;
        }
        const info = findModel(modelKey);
        const def = info?.reasoning?.defaultEffort;
        setEffort(typeof def === 'string' && def.length > 0 ? def : '');
    }, [modelKey]);
    useEffect(() => {
        if (jobId === null)
            return;
        const timer = window.setInterval(() => {
            void callRemote(() => sidechat.poll({ jobId })).then(value => {
                setMessages(prev => prev.map(message => (message.id === jobId
                    ? { ...message, content: value.text, reasoning: value.reasoning, error: value.error }
                    : message)));
                if (value.done) {
                    setJobId(null);
                    setBusy(false);
                    if (value.error !== null)
                        setError(value.error);
                }
            }, (reason) => {
                setError(reason instanceof Error ? reason.message : String(reason));
                setJobId(null);
                setBusy(false);
            });
        }, 200);
        return () => { window.clearInterval(timer); };
    }, [ctx, jobId]);
    const send = (externalText) => {
        const text = (externalText !== undefined && externalText !== null ? externalText : input).trim();
        if (text === '' || busy)
            return;
        const userMessage = { id: `user-${Date.now()}`, role: 'user', content: text, reasoning: '', error: null };
        const history = messages.concat([userMessage])
            .filter(message => message.content !== '')
            .map(message => ({ role: message.role, content: message.content }));
        setMessages(prev => prev.concat([userMessage]));
        setInput('');
        setBusy(true);
        setError(null);
        const args = {
            sessionId: String(sessionId),
            messages: history,
        };
        if (modelKey !== '') {
            const parts = modelKey.split('/');
            const provider = parts[0];
            const model = parts[1];
            if (provider !== undefined && model !== undefined) {
                args.provider = provider;
                args.model = model;
                if (effort !== '')
                    args.reasoningEffort = effort;
            }
        }
        void callRemote(() => sidechat.start(args)).then(value => {
            setJobId(value.jobId);
            setMessages(prev => prev.concat([{ id: value.jobId, role: 'assistant', content: '', reasoning: '', error: null }]));
        }, (reason) => {
            setError(reason instanceof Error ? reason.message : String(reason));
            setBusy(false);
        });
    };
    store.sendHook = send;
    useEffect(() => {
        if (!store.open)
            return;
        const timer = window.setInterval(() => {
            if (store.pendingSend !== null && store.pendingSend !== undefined && store.pendingSend !== '') {
                const value = store.pendingSend;
                store.pendingSend = null;
                const hook = store.sendHook;
                if (typeof hook === 'function')
                    hook(value);
            }
        }, 200);
        return () => { window.clearInterval(timer); };
    }, []);
    const stop = () => {
        if (jobId !== null) {
            void sidechat.stop({ jobId }).then(() => { }, () => { });
            setJobId(null);
            setBusy(false);
        }
    };
    const clear = () => {
        stop();
        setMessages([]);
        setError(null);
        setConfirmClear(false);
    };
    const modelOptions = [];
    for (const group of modelCatalog?.groups ?? []) {
        const options = group.models.map(model => (_jsx("option", { value: `${group.id}/${model.id}`, children: model.name }, `${group.id}/${model.id}`)));
        modelOptions.push(_jsx("optgroup", { label: group.name, children: options }, `g-${group.id}`));
    }
    const selectedModel = findModel(modelKey);
    const efforts = selectedModel?.reasoning?.efforts ?? [];
    const effortSelect = efforts.length > 0 ? (_jsx("select", { className: css.select, value: effort, title: "\u63A8\u7406\u7B49\u7EA7", onChange: event => setEffort(event.target.value), children: efforts.map(effortOption => _jsx("option", { value: effortOption.id, children: effortOption.name }, effortOption.id)) })) : null;
    const messageNodes = messages.map(message => {
        const isUser = message.role === 'user';
        const body = isUser
            ? message.content
            : (message.content === '' && busy ? '…' : renderMarkdown(message.content));
        const reasoningBlock = !isUser && message.reasoning !== ''
            ? (_jsxs("details", { className: css.reasoning, open: busy, children: [_jsx("summary", { children: "\uD83D\uDCAD \u601D\u8003\u8FC7\u7A0B" }), _jsx("div", { className: css.reasoningBody, children: message.reasoning })] }))
            : null;
        return (_jsxs("div", { className: isUser ? `${css.msg} ${css.msgUser}` : `${css.msg} ${css.msgAssistant}`, children: [_jsx("div", { className: css.msgRole, children: isUser ? '你' : '助手' }), reasoningBlock, _jsx("div", { className: css.msgBody, children: body }), message.error !== null ? _jsx("div", { className: css.msgError, children: message.error }) : null] }, message.id));
    });
    return (_jsxs("div", { className: `${css.panel} sidechatPanel`, role: "dialog", "aria-label": "\u4FA7\u8FB9\u804A\u5929", children: [_jsxs("div", { className: css.header, children: [_jsx("span", { className: css.headerTitle, children: "\u4FA7\u8FB9\u804A\u5929" }), _jsx("button", { className: css.iconBtn, type: "button", title: "\u6E05\u7A7A\u5BF9\u8BDD\uFF0C\u5F00\u59CB\u65B0\u7684\u4FA7\u8FB9\u804A\u5929", onClick: () => setConfirmClear(true), children: "\u6E05\u7A7A" }), _jsx("button", { className: css.iconBtn, type: "button", title: "\u5173\u95ED", onClick: () => setOpenShared(false, ctx.get('layout')), children: "\u2715" })] }), confirmClear ? (_jsxs("div", { className: css.confirm, children: [_jsx("span", { children: "\u6E05\u7A7A\u540E\u5185\u5BB9\u4E0D\u53EF\u6062\u590D\uFF0C\u786E\u8BA4\u6E05\u7A7A\uFF1F" }), _jsx("button", { className: `${css.confirmBtn} ${css.confirmBtnDanger}`, type: "button", onClick: clear, children: "\u786E\u8BA4\u6E05\u7A7A" }), _jsx("button", { className: css.confirmBtn, type: "button", onClick: () => setConfirmClear(false), children: "\u53D6\u6D88" })] })) : null, error !== null ? _jsx("div", { className: css.error, children: error }) : null, _jsx("div", { className: css.messages, children: messageNodes.length === 0 ? (_jsx("div", { className: css.empty, children: "\u53EF\u4EE5\u95EE\u9879\u76EE\u6216\u65C1\u8FB9\u5BF9\u8BDD\u76F8\u5173\u7684\u95EE\u9898\u3002" })) : messageNodes }), _jsxs("div", { className: css.composer, children: [_jsxs("div", { className: css.inputRow, children: [_jsx("textarea", { className: css.input, value: input, placeholder: "\u63D0\u95EE\u2026", rows: 2, disabled: busy, onChange: event => setInput(event.target.value), onKeyDown: event => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault();
                                        send();
                                    }
                                } }), _jsx("button", { className: css.send, type: "button", disabled: !busy && input.trim() === '', onClick: busy ? stop : () => send(), children: busy ? '停止' : '发送' })] }), _jsxs("div", { className: css.composerTools, children: [_jsx("select", { className: css.select, value: modelKey, title: "\u4FA7\u8FB9\u804A\u5929\u7684\u56DE\u590D\u6A21\u578B", onChange: event => setModelKey(event.target.value), children: modelOptions }), effortSelect] })] }), _jsx("div", { className: css.tip, children: "\u4FA7\u8FB9\u804A\u5929\u53EA\u662F\u4E34\u65F6\u804A\u5929" })] }));
}
/** Settings-panel section: the side-chat master switch. */
function SidechatSettingsSection() {
    const enabled = useEnabled();
    return (_jsxs("div", { className: css.settingsSection, children: [_jsxs("div", { className: css.settingsRow, children: [_jsxs("div", { className: css.settingsText, children: [_jsx("div", { className: css.settingsTitle, children: "\u4FA7\u8FB9\u804A\u5929" }), _jsx("div", { className: css.settingsDesc, children: "\u5F00\u542F\u540E\uFF0C\u9F20\u6807\u60AC\u505C\u6D4F\u89C8\u5668\u53F3\u8FB9\u7F18\u53EF\u6253\u5F00\u4FA7\u8FB9\u804A\u5929\u9762\u677F\u3002" })] }), _jsxs("label", { className: css.switch, children: [_jsx("input", { type: "checkbox", checked: enabled, onChange: event => setEnabledShared(event.target.checked) }), _jsx("span", { className: css.switchTrack, "aria-hidden": "true" })] })] }), _jsx("div", { className: css.settingsTip, children: "\u4FA7\u8FB9\u804A\u5929\u53EA\u662F\u4E34\u65F6\u804A\u5929\uFF0C\u4E0D\u4F1A\u5199\u5165\u4E3B\u4F1A\u8BDD\uFF0C\u4E5F\u4E0D\u4F1A\u6267\u884C\u5DE5\u5177\u3002" })] }));
}
/**
 * Browser plugin body: mount the Host Remote contribution, then the hover hot
 * zone, the selection-send button, and the details-column panel.
 * @param ctx - client root context.
 * @returns disposer that unmounts the Remote and every slot registration.
 */
export async function apply(ctx) {
    const disposers = [];
    disposers.push(await ctx.remote.$mount(TYPERT_REMOTE));
    // The namespace service key is `remote.sidechat`; read it explicitly rather
    // than declaring it in `inject`, which would deadlock this self-mounting
    // plugin (the service only appears after $mount runs inside apply).
    const sidechat = ctx.get('remote.sidechat');
    if (sidechat === undefined)
        throw new Error('side chat: remote.sidechat not mounted');
    // Bind the durable enabled switch: seed local state and keep it in sync
    // with the user-settings document for the lifetime of this fiber.
    settingsScopeHandle = ctx.settingsScope.bind({ namespace: SIDECHAT_SETTINGS_NAMESPACE });
    const seedEnabled = () => {
        const snapshot = settingsScopeHandle?.getSnapshot();
        return snapshot?.status === 'ready' ? (snapshot.value?.enabled ?? SIDECHAT_SETTINGS_DEFAULT.enabled) : store.enabled;
    };
    store.enabled = seedEnabled();
    disposers.push(settingsScopeHandle.subscribe(() => {
        const next = seedEnabled();
        if (next !== store.enabled) {
            store.enabled = next;
            subscribers.forEach(listener => listener());
        }
    }));
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'sidechat-hotzone', order: 5 }, () => {
        const layout = ctx.get('layout');
        return _jsx(HotZone, { layout: layout });
    }));
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'sidechat-sendsel', order: 6 }, () => _jsx(SelectionSendButton, {})));
    ctx.slots.inject('details', () => ctx.slots.register(
    // `details` is a single slot also occupied by ui-conversation's
    // DetailsPanel at priority 0; a lower priority shadows it (lowest renders).
    { name: 'details', priority: -100 }, (props) => _jsx(Panel, { ctx: ctx, sidechat: sidechat, sessionId: props.sessionId })));
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'sidechat', order: 40, label: () => '侧边聊天' }, () => _jsx(SidechatSettingsSection, {})));
    return () => {
        for (const dispose of disposers.reverse())
            dispose();
    };
}
//# sourceMappingURL=apply.js.map