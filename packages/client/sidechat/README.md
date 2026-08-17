# @deepseek-ai/dsh-client-sidechat

DeepSeek Harness 侧边聊天的 **浏览器半段**：悬停右边缘呼出、右侧 details 列面板、`/` 命令建议、权限模式 / 模型 / 推理等级控制、markdown 渲染。通过 `ctx.remote.sidechat` 调用 host 服务（见 `@deepseek-ai/dsh-sidechat`）。

## 注册的插槽

| 插槽 | id | 内容 |
| --- | --- | --- |
| `shell.overlay` | `sidechat-hotzone` | 右边缘 14px 热区，悬停 300ms 打开 details 列 |
| `details` | — | 侧边聊天面板（标题、上下文条、消息流、输入卡片） |

## 交互

- 悬停浏览器右边缘展开，面板 ✕ 关闭；点击主聊天不收起。
- 输入 `/` 弹出当前会话命令建议（前缀过滤、点击填入）。
- 输入卡片底部：权限模式 / 模型（分组目录）/ 推理等级（模型支持时显示）。
- 普通文本走 `sidechat.start` 独立问答（流式轮询 200ms），`/` 开头走 `sidechat.command` 真实命令。

## Model experience

- 模型下拉无"默认"占位，目录加载后自动选中当前全局生效模型。
- 每条回复由 host 侧 `start` 记录实际 provider/model；模型身份已注入系统提示词。

## License

MIT
