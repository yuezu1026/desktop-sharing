---
description: "本仓收尾：跑双门禁 → 提交 → 推到 desktop-sharing"
agent: "agent"
---
按本仓纪律收尾这一轮：

1. 切到 `docs/design/wireframe`（脚本在 `tools/` 下，**必须** cwd 到这里；相对路径别写成 `docs/docs/...`）。
2. 几何门禁：`node tools/wireframe-selfcheck.mjs` —— 必须 EXIT=0。
3. 一致性门禁：`node tools/wireframe-consistency.mjs` —— 必须 FAIL=0、EXIT=0。
4. 若第 3 步报「数字 / 台账漂移」：跑 `node tools/wireframe-consistency.mjs --fix`（顺带回写计数、台账，并重生 `OUTLINE.md` + `IMPACT.md`）。
   ⚠️ `--fix` 已知会误改 `docs/archive/wireframe-README-评审历史轮次.md` ⇒ 跑完先 `git checkout -- docs/archive`，再 `node tools/doc-outline.mjs` 重生哈希，最后重跑第 3 步确认 EXIT=0。
5. 把提交信息写到**仓库根**的 `.git-msg.txt`：UTF-8 **无 BOM**（前 3 字节 ≠ 239,187,191），中文、一句话概括改动。
6. 提交：`powershell -NoProfile -File docs\design\wireframe\tools\round-close.ps1 -MsgFile .\.git-msg.txt -Commit`
7. 提交成功后推送：`git push -u origin HEAD`，远程是 `https://github.com/yuezu1026/desktop-sharing`。禁止 `--force`。不要探测代理。门禁没过就不要推。

汇报：两个门禁的 EXIT 码、changed paths 数量、`.rounds/last.md` 真值块（帧数 / 条目数 / 台账）。
