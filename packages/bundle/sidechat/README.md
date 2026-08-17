# @deepseek-ai/dsh-sidechat-bundle

DSH Side Chat 侧边聊天的可安装 profile bundle。安装后在现有 profile（通常为 web-app）上挂载两行：`sidechat`（host 服务）与 `sidechat-ui`（浏览器面板）。

## 安装（在 deepseek-harness 源码部署中）

```sh
pnpm install   # 先让 workspace 链接本仓库三个 sidechat 包
pnpm run build:web --filter @deepseek-ai/dsh-sidechat-bundle  # 或全量 build
dsh plugin --profile web add @deepseek-ai/dsh-sidechat-bundle
```

> 注意：带浏览器 UI 的插件必须打进 web 前端构建产物（`dsh.client` 行由 client-modules 扫描）。安装本 bundle 后需重新构建并重新生成 `window.__DSH_BOOT__` 对应的 web dist（在源码部署中执行 `pnpm run build:web`），然后重启 `dsh web`。

## 组成

| 包 | 角色 |
| --- | --- |
| `@deepseek-ai/dsh-sidechat` | host：`sidechat` Remote 服务 |
| `@deepseek-ai/dsh-client-sidechat` | 浏览器：悬停热区 + 右侧面板 |

## License

MIT
