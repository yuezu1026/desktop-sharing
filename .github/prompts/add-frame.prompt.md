---
description: "往线框页加一帧，并同步全部 4 处（HTML / README §6.2 台账 / index 帧清单 / 计数句）"
argument-hint: "页 (w1-w7) + 帧 id + 标题"
agent: "agent"
---
新增一帧 = 一次改 **4 处**，缺一处 `C2` / `C5` / `C6-b` 就会 FAIL。cwd = `docs/design/wireframe`。

1. **插帧位置（唯一锚）**：在目标页 HTML 末尾，以
   `      </figure>\n    </div>\n\n    <p class="pager">`
   为锚，把新 `<figure id="...">…</figure>` 插在 `</figure>` 与 `    </div>` 之间。
   🔴 **别**用非贪婪正则找 `</figure>`（一个页里有 15+ 个）。
2. **高度**：这一帧若要加高，写 inline `height` 并**同步 `README.md` §6.2 画布高度台账**（`C5-c` 逐帧对拍）。标准默认高度的帧**不登记**。
3. **`index.html` 帧清单**：在对应页的表格里补一行 `<td><a href="w4-….html#w4-xx">W4-xx</a></td>` 同类结构。
4. **计数句**：`README.md` §6 的「合计 N 帧」与 `index.html` 的 `📊 当前值` 句 —— 必须带 `📊` / `⏱` 标记（`C2-marker`）。
5. **兜底回写**：`node tools/wireframe-consistency.mjs --fix`（自动回写可推导的计数与台账；⚠️ 之后 `git checkout -- docs/archive`）。
6. **校验**：`node tools/wireframe-selfcheck.mjs`（EXIT=0）+ `node tools/wireframe-consistency.mjs`（FAIL=0）。
7. **红线**：画布内禁 `.spec` 块与「规格 / 给开发 / 验收点」字样（`C18`）；危险动作 `.btn.solid` + `data-confirm`（`C17`）；授权项**禁** `.btn.solid`（`C19`）；术语用 **仅查看**（`C16`）。

收尾走 `/round-close`。
