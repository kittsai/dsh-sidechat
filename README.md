# DSH Side Chat（侧边聊天）

一个面向 **DeepSeek Harness Web GUI** 的侧边聊天插件：基于当前项目上下文与当前会话上下文，在右侧原生列并排开启的聊天面板。

本仓库**只包含这一个插件**，有两种形态：

1. **动态 Cordis 插件**（零构建、粘贴即用）：`host.js` / `client.js`
2. **正式可安装插件**（三个 npm 包 + profile bundle）：`packages/` 下的 host / client / bundle

## 功能

- **右侧边缘悬停呼出**：鼠标靠近浏览器右边缘停留约 300ms，侧边聊天从右侧展开，与主对话区左右并排
- **项目上下文**：自动采集项目根目录、Git 分支、顶层目录结构，注入每次回答的系统提示词
- **会话上下文**：读取当前主会话最近 12 条消息与会话标题，回答与主对话保持一致
- **独立问答**：侧边聊天是独立对话，不写入主会话；`llm.stream` 流式输出，逐字显示
- **Markdown 渲染**：内置轻量渲染器（标题 / 粗斜体 / 行内代码 / 代码块 / 列表 / 引用 / 链接 / 分隔线），纯文本节点输出、天然防注入
- **斜杠命令**：输入 `/` 弹出当前会话可用命令建议（前缀过滤、点击填入），回车走真实命令注册表执行
- **权限模式**：Read-only / Workspace write / Full access，切换当前会话沙箱模式（与主聊天同一条状态）
- **模型切换 + 推理等级**：按 provider 分组的模型目录，支持选择模型的 reasoning effort；切换即感知
- **模型身份自报**：实际生效的模型 ID 注入系统提示词，问"你是什么模型"回答与 UI 一致

## 架构

| 形态 | 文件/包 | 职责 |
| --- | --- | --- |
| 动态（零构建） | `host.js` / `client.js` | 同下，`harness.handle` / `host.call` 私有通道 |
| 正式 host 包 | `packages/extensions/sidechat`（`@deepseek-ai/dsh-sidechat`） | 上下文采集、模型目录、权限模式、命令、`llm.stream` 生成（`sidechat` Remote 服务） |
| 正式 client 包 | `packages/client/sidechat`（`@deepseek-ai/dsh-client-sidechat`） | 悬停热区、details 列面板、命令建议、模型/权限/推理控制、markdown（`ctx.remote.sidechat`） |
| bundle | `packages/bundle/sidechat`（`@deepseek-ai/dsh-sidechat-bundle`） | profile 补丁，一行挂载 host + client 两行 |

依赖的 DSH 服务：`llm`、`agentDefaultModel`、`sessions`、`sessionQuery`、`sessionTitle`、`sandboxPolicy`、`fs`、`agents`、`commands`、`layout`、`slots`。

## 安装方式一：动态插件（零构建，快速体验）

基于 DSH 的动态 Cordis 插件能力（`cordis_define` / `cordis_run`）：

1. 在 DeepSeek Harness Web GUI 打开 Cordis 插件面板
2. 定义新插件：`code.host` 粘贴 `host.js`、`code.client` 粘贴 `client.js`
3. 批准运行后：悬停浏览器右边缘展开面板；输入 `/` 查看命令建议；底部切换权限模式 / 模型 / 推理等级

也可以让你的 agent 代劳：「请用 cordis_define 创建插件，code.host / code.client 分别取 github.com/kittsai/dsh-sidechat 的 host.js / client.js 内容，然后 cordis_run 运行。」

## 安装方式二：正式插件（bundle，适合源码部署）

正式形态在 **DeepSeek Harness 源码部署**中构建与挂载（浏览器 UI 插件必须参与 web 前端构建，这是 DSH 插件生态的结构性约束）：

```sh
# 1. 把三个包放进 harness 仓库（或作为 workspace 成员引用），并打上集成补丁：
#    - packages/bundle/web-app/cordis.patch.yml 追加 sidechat-ui 的 dsh.client 行
#    - packages/bundle/web-app/package.json 追加 @deepseek-ai/dsh-client-sidechat 依赖
#    - packages/api/remotes 桥接 sidechatRemote（import + mount，见集成说明）
# 2. 安装并构建
pnpm install
pnpm run build:lib && pnpm run build:web
# 3. 挂载 bundle 到 profile
dsh plugin --profile web add @deepseek-ai/dsh-sidechat-bundle
# 4. 重启 dsh web，悬停右边缘即可使用
```

集成补丁的精确位置（对 deepseek-harness 主仓库的改动，均只追加 sidechat 相关行）：

- `packages/api/remotes/src/client/index.ts`：import `sidechatRemote from '@deepseek-ai/dsh-sidechat/remote'`、`export type {}`、mount 列表追加
- `packages/api/remotes/tsconfig.client.json`：references 追加 `../../extensions/sidechat`
- `packages/api/remotes/package.json`：dependencies/devDependencies 追加 `@deepseek-ai/dsh-sidechat`
- `tsconfig.host.json` / `tsconfig.client.json`：references 追加三个新包
- `packages/bundle/web-app/cordis.patch.yml` + `package.json`：追加 `sidechat-ui` 行与依赖

## 交互细节

- 只通过「悬停右边缘」展开、「✕」关闭；点击主聊天不会收起
- `/` 开头的内容走命令注册表执行（作用于当前会话），普通文本走独立问答
- 模型下拉无"默认"占位项，打开面板时自动选中当前全局生效模型

## 版本演变

1. 基础侧边面板（悬浮层）
2. 原生右侧 details 列并排布局
3. 接入当前会话上下文
4. 悬停呼出、背景一致、Markdown 渲染
5. 命令执行 / 权限模式 / 模型切换
6. 控制项移入输入框底部 + 推理等级
7. `/` 命令建议、中文界面、移除 Clear
8. 点击外部收起（后因拖拽宽度冲突移除，改用仅悬停/✕）
9. 移除侧边栏入口
10. 模型身份注入系统提示词
11. 移除模型标识与目录展示、去掉"默认"占位、权限模式读取加固
12. 正式插件化：`@deepseek-ai/dsh-sidechat`（Remote 服务）+ `@deepseek-ai/dsh-client-sidechat`（浏览器面板）+ `@deepseek-ai/dsh-sidechat-bundle`（profile bundle）

## License

MIT
