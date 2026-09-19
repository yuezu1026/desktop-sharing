---
description: "Use when editing or reviewing the high-fidelity pages under docs/design/high. Visual checks must open the rendered pages with Playwright, not by reading HTML alone."
applyTo: ["docs/design/high/**/*.html", "docs/design/high/**/*.css"]
---
# 高保真页 · 用 Playwright 开页检查

改完或评审 `docs/design/high` 的界面，必须用 Playwright 打开渲染结果再下结论。读 HTML / CSS 不能代替。产品范围不要通读需求文档，先 `node tools/harness-route.mjs high`（cwd = `docs/design/wireframe`）。

- 不把 Playwright 装进本仓库：禁止在仓库根 `npm install`，禁止新增 `package.json`。用 `npx --yes playwright`，脚本和截图放临时目录。
- 用 Node 拼 `file://` 地址再打开。不要把中文文件名交给 PowerShell 5.1 拼进命令行。
- 浏览器未装时，只在临时目录执行 `npx playwright install chromium`。
- 至少核对：横向溢出、会话 16:9 黑边、购买按钮不是青绿、手机可点高度 44px、画布内没有开发说明。
- 线框门禁仍走 `docs/design/wireframe/tools` 里的 node 脚本，不要用 Playwright 替换那两道门禁。
- 截图和浏览器缓存不提交。
