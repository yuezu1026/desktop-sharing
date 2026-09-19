---
description: "改之前先路由：只读该读的节，避免通读把 token 打爆"
argument-hint: "topic 或 D 编号，例如 mvp / tech / D25"
agent: "agent"
---
cwd 必须是 `docs/design/wireframe`。

1. 先跑 `node tools/harness-route.mjs <topic>`。topic 用它列出的 id，或直接给 `D25` 这种编号。要正文再加 `--text`。不要自己把中文路径拼进 PowerShell。
2. 只读它打印的那些目标。不要打开 `docs/archive`，不要通读需求规划、成本测算表、IMPACT。
3. 只改目标段，不要整文件重写。
4. 改完 md 后只重生索引：`node tools/doc-outline.mjs` 和 `node tools/impact-index.mjs`。不要把生成物再读一遍。
5. 这一轮若只是流程 / 工具，不占决策编号。
