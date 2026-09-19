---
description: "Use when committing a round in this repo (writing .git-msg.txt or running round-close.ps1). Covers the two-gate precondition, the BOM-free message-file protocol, and the push-after-review rule."
applyTo: ["**/.git-msg.txt"]
---
# 收尾 / 提交协议

- 🔴 **两个门禁都 EXIT=0 才允许提交**（cwd = `docs/design/wireframe`）：
  `node tools/wireframe-selfcheck.mjs` + `node tools/wireframe-consistency.mjs`
- 🔴 **提交信息走 `-MsgFile`，禁 `git commit -m "中文"`**（PS 5.1 按 GBK 传参乱码）。
- `-MsgFile` 路径**必须在仓库根**（如 `./.git-msg.txt`），**不要**放 `docs\` 下。
- `.git-msg.txt` 必须是 **UTF-8 无 BOM**：前 3 字节 ≠ `239,187,191`（`EF BB BF`）。`round-close.ps1` 会先校验再提交。
- 一条命令收尾：
  `powershell -NoProfile -File docs\design\wireframe\tools\round-close.ps1 -MsgFile .\.git-msg.txt -Commit`
  （脚本：跑双门禁 → 校验 msg → `git add` → commit → 写 `.rounds/last.md`；暂存清单见脚本内 `$targets`。）
- 🔴 **评审已完成且两个门禁都 EXIT=0 之后才 push** 到 `https://github.com/yuezu1026/desktop-sharing`。禁止 force push，不探测代理。门禁红了不要推。
- 🔴 **无构建 / 无依赖**：禁 `npm install`、禁起服务、禁加 `package.json`。
- 临时脚本写 `.mjs` 用 `node` 跑；**别用终端整文件改写源码**（GBK 会把中文写成 mojibake）。
