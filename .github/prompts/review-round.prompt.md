---
description: "评审一轮：从 .rounds/last.md 冷启动 → 定点取料 → 出报告并登记（只登记不补帧）"
argument-hint: "评审范围（文档 / 页 / 帧）"
agent: "agent"
---
评审轮纪律：**只登记、不补帧**（补帧另开一轮，走 `/add-frame` 的 4 处同步）。cwd = `docs/design/wireframe`。

1. **冷启动**：先读 `.rounds/last.md`（上一轮 ~300 token 摘要 + 真值块：帧数 / 条目数 / 层分布 / 台账）。**不要**通读 `docs/**`。
2. **定点取料**（别整文件读）：
   - 某帧：`node tools/frame.mjs <帧id> --brief`
   - 某节：`node tools/doc-outline.mjs --section <文档文件名> <x.y>`
   - 找位置：`docs/OUTLINE.md`（L1 精简档）；要行号加 `--doc <路径>`，要完整档加 `--full`。
   - 决策落点：`docs/IMPACT.md`。
3. **出报告**：问题 → 落点（`文件 §x.y`，**禁 `L###`**）→ 处置建议（登记 / 补帧 / 改稿）。
4. **登记**：结论写入 `docs/需求规划评审意见.md`（🔴 活跃待办 = §10）。新决策占号 → 走 `/add-decision`。
5. **收尾**：`/round-close`。

🔴 归档 `docs/archive/**`（42k token）默认不读；确需查证再审。数值问题一律回 `docs/成本测算表.md` §0。
