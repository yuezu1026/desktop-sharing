---
description: "Use when editing the static low-fidelity wireframe pages or stylesheet under docs/design/wireframe. Covers the geometry self-check gate, the canvas-height ledger, the .spec ban, danger vs authorization button weights, and terminology rules C15/C16/C17/C18/C19."
applyTo: ["docs/design/wireframe/*.html", "docs/design/wireframe/*.css"]
---
# 线框页（html / css）改动纪律

cwd **必须**是 `docs/design/wireframe`（脚本在 `tools/` 下）。

- 加 / 改帧后**必跑** `node tools/wireframe-selfcheck.mjs` —— 几何（静默裁切 / 横向溢出 / 锚点可达 / 原型 JS）+ `C15` 死按钮 + `C18-a`/`C18-b` + `C19` 权重。EXIT 必须 `0`。
- **改了帧内 inline `height` ⇒ 同步 `README.md` §6.2 画布高度台账**（`C5` 缺项 / `C5-b` 多余 / `C5-c` 高度不符 / `C5-d` 自由画布缺项）。标准默认高度的帧**不登记**。
- 🔴 **画布内禁 `.spec` 规格块**，也禁出现「规格 / 给开发 / 验收点」类词 ⇒ `C18-a` / `C18-b`。规格内容属于 `README.md`，不属于线框页。
- **危险动作**（破坏性 / 不可逆）⇒ `.btn.solid` **且**带 `data-confirm`；二次确认**必须复用** W3-11 组件；禁 `.btn.sm` / `.btn.ghost` 承载 ⇒ `C17`。
- 🔴 **授权项禁用 `.btn.solid`**（授权动作 vs 安全出口的权重差是红线）⇒ `C19` family。
- 术语：规范词 = **仅查看**；禁「只读（模式义）/ 观察模式 / 纯观察模式 / 仅观看」⇒ `C16`。
- 收尾跑 `node tools/wireframe-consistency.mjs`（`C2` 计数 / `C5` 台账 / `C6-b` 锚点 / `C17` 危险动作台账）。
- 改规格前先 `node tools/harness-route.mjs wire`，不要通读 README。新增帧要同步 **4 处**：本页 HTML / `README.md` §6.2 台账 / `index.html` 帧清单 / 计数句 ⇒ 走 `/add-frame`。
