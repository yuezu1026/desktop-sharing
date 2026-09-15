---
description: "Use when editing the gate / self-check tool scripts under docs/design/wireframe/tools. Covers ASCII-only stdout, mandatory negative validation of new assertions, tag-stack pairing instead of non-greedy regex, and generated report files."
applyTo: ["docs/design/wireframe/tools/**/*.mjs"]
---
# 门禁 / 工具脚本（.mjs）改动纪律

- 🔴 **stdout 必须纯 ASCII**：终端是 PowerShell 5.1 + GBK，中文只允许出现在**注释**和**写入 md 的字符串**里，`console.log` 一律英文。
- 🔴 **每条新断言都必须做负向验证**：写完后**构造一个会失败的输入**，确认它真的 FAIL，再还原。只跑「全绿」= 假门禁（`C2-0` 的历史教训）。
- 扫描面要显式排除生成物与历史快照：`SKIP_DIRS = archive / tools / node_modules / .git`、`SKIP_FILES = OUTLINE.md / IMPACT.md`（照 `lib/impact-scan.mjs` 既有约定）。
- 🔴 **元素配对按标签栈配平，不要用非贪婪正则**（容器不参与匹配），否则会「空跑绿灯」。
- `--fix` 只允许回写**可推导**的东西（计数 / 台账 / 索引）；**不要**让它改 `docs/archive/**` 历史快照。
- 报告落在 `tools/*-report.json`：**勿手改、勿提交**（已在 `.gitignore`；`grep_search` 默认跳过它们，需 `includeIgnoredFiles: true`）。
- 调试开关：`--verbose`（逐条断言）、`--report`（写 JSON）。新断言要能被 `--verbose` 单独看到。
- 本仓**无构建 / 无依赖**：不引第三方包，不加 `package.json`，只用 Node 内置模块。
