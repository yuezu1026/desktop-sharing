---
description: "拍板一个新决策 D##：先改 SSOT → 回写落点 → 登记 → 重生 OUTLINE + IMPACT"
argument-hint: "决策内容（编号自动取下一个）"
agent: "agent"
---
本仓决策编号：已拍板 `D1`–`D29`（含 `D23-1` / `D23-2` 子项），**下一个可用 = `D30`**。纯工具 / 流程轮**不占编号**。登记位 = `docs/需求规划评审意见.md` §7 决策表 + 各文档自己的决策块。

顺序（**不许颠倒**）：

1. **先改 SSOT**：涉及价格 / 费率 / 额度 / 设备数 / 留存期的，先改 `docs/成本测算表.md` §0，再回写别处。
2. **查影响面**：读 `docs/IMPACT.md` 找该决策已有的落点，**别靠 grep 现找**。
3. **回写落点**：正文禁 `L###`，指位置用 `§x.y`（`C6-a` / `C6-b`）；新增计数句带 `📊` / `⏱`（`C2-marker`）。
4. **登记**：`docs/需求规划评审意见.md` §7 + 文档自己的决策块。若属活跃待办，同步 §10。
5. **重生生成物**（cwd = `docs/design/wireframe`）：
   `node tools/doc-outline.mjs`（`C11`）+ `node tools/impact-index.mjs`（`C12`）
6. 若线框受影响：`node tools/wireframe-selfcheck.mjs` + `node tools/wireframe-consistency.mjs`。

🔴 **不要**用 `--fix` 代劳第 1 步的语义判断 —— 它只回写可推导的数字 / 台账，不会替你决定该改成多少。

收尾走 `/round-close`。
