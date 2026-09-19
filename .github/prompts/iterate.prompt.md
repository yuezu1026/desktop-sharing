---
description: "一轮迭代：一个切片，先路由再改。评审和门禁都过后才提交并推送。"
argument-hint: "这一轮只做的一件事，例如「MVP 第 2 步连接」或「补某一帧」"
agent: "agent"
---
一轮只做**一件**已经排进 `docs/plans` 的事。不做日历冲刺，不重开 P0–P3，不占决策编号（除非这一轮就是拍板，那走 `/add-decision`）。

cwd = `docs/design/wireframe`。

1. **冷启动**：只读 `.rounds/last.md`。不要通读 `docs/**`。上一轮没提交时，以用户这句要求为范围。
2. **定切片**：从 `node tools/harness-route.mjs plan --text` 里只取下一件未做的事。跨到别的阶段就停，写明留给哪一阶段。
3. **取料**：`node tools/harness-route.mjs <topic|Dxx> --text`。不要把中文路径交给 PowerShell，不要打开 `docs/archive`。
4. **改**：只动这一件。数值先改 `成本测算表` §0 再回写。正文禁 `L###`。线框加帧走 `/add-frame`（4 处一起）。高保真改完用 Playwright 看渲染结果。
5. **门禁**：`node tools/wireframe-selfcheck.mjs` 与 `node tools/wireframe-consistency.mjs` 都要 EXIT=0、FAIL=0。红了先修，不要带着失败进下一轮。
6. **收尾**：门禁都绿、并且这一轮已经评审过，才提交并推送。走 `/round-close`（提交后 `git push -u origin HEAD` 到 `https://github.com/yuezu1026/desktop-sharing`）。禁止 force push。门禁红了不要推。没评审完不要推。

检视和改动不要放在同一轮。要挑问题走 `/review-round`（只登记）。要补帧或改稿另开一轮。
