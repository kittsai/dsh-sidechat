# DSH Side Chat（侧边聊天）

一个面向 **DeepSeek Harness Web GUI** 的侧边聊天插件：**鼠标悬停浏览器右边缘**即可呼出，基于当前项目与会话上下文，与主对话区并排聊天。

![效果截图](screenshot.png)

## 功能

| 能力 | 说明 |
| --- | --- |
| 悬停呼出 | 鼠标靠近浏览器右边缘停留约 300ms，从右侧展开，与主对话并排 |
| 项目上下文 | 自动注入项目根目录、Git 分支 |
| 会话上下文 | 感知当前主会话最近 12 条消息，回答保持上下文一致 |
| 流式输出 | 逐字显示，可中途停止 |
| 思考过程 | 模型推理内容流式显示为可折叠「💭 思考过程」块 |
| Markdown | 标题 / 粗斜体 / 代码块 / 列表 / 引用 / 链接 / 表格 |
| 模型 / 推理等级 | 输入框内直接切换（推理等级仅在模型支持时出现） |
| 清空 | 一键清空上下文开始新对话，带「不可恢复」二次确认 |
| 选中添加 | 在主聊天中选中文本 → 浮出「添加到侧边聊天」→ 点击直接发送 |

## 安装

### 方式一：动态插件（推荐，零构建）

不需要 clone 本仓库，只需要 DSH Web GUI 的 Cordis 面板：

1. 打开 **Cordis 插件面板** → **定义插件**
2. `code.host` ← 粘贴 [`host.js`](host.js) 的完整内容
3. `code.client` ← 粘贴 [`client.js`](client.js) 的完整内容
4. 名称填 `Project Side Chat`，批准运行
5. 鼠标悬停浏览器右边缘，侧边聊天出现

> 也可以让你的 agent 代劳：「请用 cordis_define 创建插件，code.host / code.client 分别取 github.com/kittsai/dsh-sidechat 的 host.js / client.js 内容，然后 cordis_run 运行它。」

### 方式二：正式插件（源码部署）

`packages/` 下是正式 npm 包：`@deepseek-ai/dsh-sidechat`（Host 服务 + bundle 载体）+ `@deepseek-ai/dsh-client-sidechat`（浏览器面板）。适合在 DeepSeek Harness 源码部署中使用：

**第 1 步：放入包并打集成补丁**

将两个包放进 harness 仓库（`packages/extensions/sidechat`、`packages/client/sidechat`），并追加以下 sidechat 相关行（均为纯追加，不影响其他包）：

| 文件 | 追加内容 |
| --- | --- |
| `packages/api/remotes/src/client/index.ts` | import + export type + mount 列表加 `sidechatRemote` |
| `packages/api/remotes/tsconfig.client.json` | references 加 `../../extensions/sidechat` |
| `packages/api/remotes/package.json` | dependencies / devDependencies 加 `@deepseek-ai/dsh-sidechat` |
| `tsconfig.host.json` / `tsconfig.client.json` | references 加两个新包 |
| `packages/bundle/web-app/cordis.patch.yml` | 加 `sidechat-ui` 的 dsh.client 行 |
| `packages/bundle/web-app/package.json` | dependencies 加 `@deepseek-ai/dsh-client-sidechat` |

**第 2 步：安装并构建**

```sh
pnpm install
pnpm run build:lib && pnpm run build:web
```

**第 3 步：挂载 bundle**

```sh
dsh plugin --profile web add @deepseek-ai/dsh-sidechat
```

**第 4 步：重启**

```sh
# 重启 dsh web，悬停右边缘即可使用
```

> 注意：带浏览器 UI 的插件必须参与 web 前端构建（`dsh.client` 行由 client-modules 扫描进 `window.__DSH_BOOT__`），所以方式二需要重建 web dist——这是 DSH 插件生态的结构性约束。想要免构建体验请用方式一。

## 使用提示

- 面板只通过「悬停右边缘」展开、「✕」关闭；点击主聊天不会收起
- 侧边聊天是**独立问答**：不写入主会话，也没有工具，适合问概念、解释、方案类问题
- 推理等级选 `high` / `max` 时模型会先思考，「思考过程」块在生成中自动展开

## 仓库结构

```
host.js / client.js               # 动态插件（零构建，粘贴即用）
screenshot.png                    # 效果截图
packages/extensions/sidechat      # 正式 Host 包（Remote 服务 + bundle 载体）
packages/client/sidechat          # 正式 Client 包（浏览器面板）
```

## License

MIT
