# DSH Side Chat（侧边聊天）

面向 **DeepSeek Harness Web GUI** 的侧边聊天插件：悬停浏览器右边缘即可呼出，基于当前项目与会话上下文，与主对话区并排聊天。

## 功能

- **悬停呼出**：鼠标靠近浏览器右边缘停留片刻，从右侧展开
- **项目上下文**：自动读取项目根目录、Git 分支、目录结构
- **会话上下文**：感知当前主会话最近 12 条消息，回答保持上下文一致
- **独立问答**：流式输出、Markdown 渲染、不写入主会话
- **模型 / 推理等级**：输入框内直接切换
- **思考过程**：流式显示、可折叠（💭 块，生成中自动展开）
- **Markdown 表格**：内置渲染器支持表格
- **清空（二次确认）**：一键清空上下文开始新对话，带不可恢复确认
- **选中文本添加**：主聊天选中内容 → 浮出"添加到侧边聊天"按钮，点击展开并直接发送

## 快速开始（动态插件，零构建）

在 DSH Web GUI 的 Cordis 面板定义插件：

1. `code.host` ← 粘贴 [`host.js`](host.js)
2. `code.client` ← 粘贴 [`client.js`](client.js)
3. 批准运行，悬停浏览器右边缘即可使用

也可以直接对你的 agent 说：「用 cordis_define 创建插件，host/client 代码取 github.com/kittsai/dsh-sidechat 的 host.js / client.js，然后运行。」

## 正式安装（源码部署）

`packages/` 下是正式插件包（`@deepseek-ai/dsh-sidechat` + `@deepseek-ai/dsh-client-sidechat`）。在 harness 源码部署中：

1. 放入两个包，打上集成补丁（api-remotes 桥接、tsconfig 引用、web-app 注册，改动均为追加 sidechat 相关行）
2. `pnpm install && pnpm run build:lib && pnpm run build:web`
3. `dsh plugin --profile web add @deepseek-ai/dsh-sidechat`
4. 重启 `dsh web`

> 浏览器 UI 插件必须参与 web 前端构建，因此正式安装需要重建 web dist——这是 DSH 插件生态的结构性约束。

## 仓库结构

```
host.js / client.js               # 动态插件（零构建，粘贴即用）
packages/extensions/sidechat      # 正式 host 包（Remote 服务 + bundle 载体）
packages/client/sidechat          # 正式 client 包（浏览器面板）
```

## License

MIT
