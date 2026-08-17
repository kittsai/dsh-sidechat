# @deepseek-ai/dsh-sidechat

DeepSeek Harness 侧边聊天的 **Host 半段**：一个 `sidechat` Typert Remote 服务，为浏览器侧边面板提供项目/会话上下文采集、模型目录、沙箱权限模式读写、斜杠命令列表与执行、以及 `llm.stream` 流式生成（job + poll）。

配套的浏览器半段见 `@deepseek-ai/dsh-client-sidechat`。本包同时是 **profile bundle 载体**：`cordis.patch.yml` 声明挂载 host 行 + client 行，安装方执行 `dsh plugin --profile web add @deepseek-ai/dsh-sidechat`。

## Remote 方法

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `getContext` | `{ sessionId }` | 项目上下文 + 会话上下文 |
| `models` | — | 分组模型目录（含每模型 reasoning efforts） |
| `start` | `{ sessionId, messages, provider?, model?, reasoningEffort? }` | 启动流式生成，返回 `jobId` |
| `poll` | `{ jobId }` | 读取累计文本 |
| `stop` | `{ jobId }` | 停止轮询 |

## Model experience

- 每次 `start` 都重新采集项目上下文（根目录 / Git 分支 / 顶层条目）与当前会话最近 12 条消息，注入系统提示词。
- 实际生效的 `provider/model/reasoningEffort` 写入系统提示词，模型可准确自报身份。

## License

MIT
