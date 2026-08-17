# @deepseek-ai/dsh-sidechat

DeepSeek Harness 侧边聊天的 **Host 半段**：一个 `sidechat` Typert Remote 服务，为浏览器侧边面板提供项目/会话上下文采集、模型目录、沙箱权限模式读写、斜杠命令列表与执行、以及 `llm.stream` 流式生成（job + poll）。

配套的浏览器半段见 `@deepseek-ai/dsh-client-sidechat`，安装入口见 `@deepseek-ai/dsh-sidechat-bundle`。

## Remote 方法

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `getContext` | `{ sessionId }` | 项目上下文 + 会话上下文 |
| `models` | — | 分组模型目录（含每模型 reasoning efforts） |
| `mode` | `{ sessionId, mode? }` | 读取/写入当前会话沙箱模式（多层回退） |
| `commands` | `{ sessionId }` | 当前会话可执行的斜杠命令 |
| `command` | `{ sessionId, line }` | 执行一条命令 |
| `start` | `{ sessionId, messages, provider?, model?, reasoningEffort? }` | 启动流式生成，返回 `jobId` |
| `poll` | `{ jobId }` | 读取累计文本 |
| `stop` | `{ jobId }` | 停止轮询 |

## Model experience

- 每次 `start` 都重新采集项目上下文（根目录 / Git 分支 / 顶层条目）与当前会话最近 12 条消息，注入系统提示词。
- 实际生效的 `provider/model/reasoningEffort` 写入系统提示词，模型可准确自报身份。
- `mode` 写路径走 `sandbox/mode` 会话事件（与主聊天同一条状态）；读取在 live session、持久化日志、部署默认之间回退。
- 斜杠命令通过 `commands` 注册表执行，作用于当前会话；`signal` 用最小兼容对象（注册表仅做鸭子类型访问）。

## License

MIT
