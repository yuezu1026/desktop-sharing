---
description: "Use when editing the spec docs under docs/**/*.md or AGENTS.md in this repo. Covers the single-source-of-truth rule for numbers, the ban on L### line references, mandatory 📊/⏱ count markers, and the OUTLINE/IMPACT regeneration gates C11/C12."
applyTo: ["docs/**/*.md", "**/AGENTS.md"]
---
# 规格文档（md）改动纪律

- 🔴 **数值只有一个源**：价格 / 费率 / 额度 / 设备数 / 留存期 ⇒ **先改 `docs/成本测算表.md` §0 SSOT**，再回写别处。别直接改下游那一处。
- 🔴 **正文禁写 `L###` 行号**（会漂移 ⇒ `C6-a` FAIL）⇒ 指位置一律用 `§x.y`。
- **计数句**（帧数 / 条目数 / 层分布 / P0 档 / 台账行数 / 文件数 / token 数）必须带 `📊`（机器可读当前值）或 `⏱`（历史规模快照）标记 ⇒ 否则 `C2-marker` FAIL。
- 引用的 `§x.y` **目标必须真实存在** ⇒ `C6-b` 对拍。
- **改完必跑**（cwd = `docs/design/wireframe`，脚本在 `tools/` 下）：
  - `node tools/doc-outline.mjs` → 重生 `docs/OUTLINE.md`（`C11` 校验过期）
  - `node tools/impact-index.mjs` → 重生 `docs/IMPACT.md`（`C12` 校验过期）
- 🔴 **改之前先路由，不要通读**（cwd = `docs/design/wireframe`）：`node tools/harness-route.mjs <topic|Dxx>`，要正文再加 `--text`。不要打开归档，不要通读需求规划 / 成本测算表 / IMPACT。决策只看它抽出的那一节。
- 🔴 **只改目标段**：不要整文件重写（必带格式器重排漂移 + token 浪费）。
- **UI 面术语**：规范词 = **仅查看**；禁「只读（模式义）/ 观察模式 / 纯观察模式 / 仅观看」⇒ `C16`。
- 数字/台账漂移可一键回写：`node tools/wireframe-consistency.mjs --fix`
  ⚠️ 已知会误改 `docs/archive/wireframe-README-评审历史轮次.md` ⇒ 跑完 `git checkout -- docs/archive`，再 `node tools/doc-outline.mjs` 重生哈希。
- 归档 `docs/archive/**`（42k token）**默认不读**，确需查证再审。
