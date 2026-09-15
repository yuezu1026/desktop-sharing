# AGENTS.md（L0 名片 · 读完 ≤ 1.5k token）

> 渐进披露的最外层：读完本文件即可正确行动，**不必先读 19 万 token 的文档集**。
> 🔴 **不要往本文件加内容** —— 它一臃肿就变成第二个 README，而那正是它存在的理由。

## 0. 定位

- **个人消费级远程桌面**（对标 ToDesk / 向日葵）· 当前 = **P0 低保真线框 + 需求定稿**。
- 产物 = `docs/**/*.md` 规划文档 + `docs/design/wireframe/**` 静态 HTML 线框（7 页 + 索引 + 1 原型 · **83 帧**）。
- **无构建 / 无依赖 / 无 remote**：纯静态 HTML+CSS+Markdown。别 `npm install`，别起服务。
- 分支 `master`：**只 commit，永不 push，永不探测代理**。

## 1. 铁律（违反即返工）

1. **数值只有一个源**：价格 / 费率 / 额度 / 设备数 / 留存期 ⇒ 先改 `docs/成本测算表.md` **§0 SSOT**，再回写别处。（本项目 6 条硬矛盾里 4 条源于「同一参数多处各写一遍」。）
2. **改完跑门禁，两个 EXIT=0 才提交**（见 §2）。
3. **正文禁写 `L###` 行号**（会漂移，门禁 `C6-a` 判 FAIL）⇒ 指位置一律用 `§x.y`。

## 2. 门禁

```powershell
cd docs\design\wireframe                  # 🔴 脚本在 tools\ 下，cwd 必须是这里
node tools/wireframe-selfcheck.mjs        # 几何：静默裁切 / 溢出 / 锚点 / 原型 JS
node tools/wireframe-consistency.mjs      # 一致性：计数 / 台账 / 引用 / 红线 / 目录过期 / 索引过期
node tools/wireframe-consistency.mjs --fix  # 上一条报数字/台账漂移？一键回写（顺带重生 OUTLINE + IMPACT）
```

跑完并提交（推荐一条命令）：

```powershell
powershell -NoProfile -File docs\design\wireframe\tools\round-close.ps1 -MsgFile .\.git-msg.txt -Commit
```

- 覆盖 8 类漂移（计数 / 几何 / 术语 / 数值 / 引用 / 格式器 / 台账 / 被控端红线）+ `C11` 目录过期 + `C12` 索引过期 ⇒ 见 `wireframe/README.md` §12。
- 明细报告落在 `wireframe/tools/*-report.json`（**勿手改、勿提交**）。
- 提交信息走 `-MsgFile`（UTF-8 **无 BOM**）；**禁** `git commit -m "中文"`（PS 5.1 按 GBK 传参乱码）。
- 每次收尾自动写 `.rounds/last.md`（**上一轮的 ~300 token 摘要，冷启动时先读它**）。

## 3. 文档地图

🔑 **不知道去哪查 ⇒ 先读 `docs/OUTLINE.md`**（L1 **精简档**：文档速查 + 章级地图，**~2.5k tok**；**要行号**加 `--doc <路径>`，**要完整档**加 `--full`）**，再不行 grep。**

| 文档 | ⏱ | 何时读 |
|---|---|---|
| `docs/成本测算表.md` | 21k | 🔴 **一切数值的 SSOT**（§0 参数 / §7 免费额度 / §10 待实测清单） |
| `docs/需求规划-v2-P0P3重构.md` | 36k | 需求主文档（§1 优先级 + P0 发版阻塞项清单） |
| `docs/商业化与计费设计.md` | 26k | 计费 / 免费额度 / 付费墙 / §13.x 界面清单与红线 |
| `docs/账号与管理系统设计.md` | 18k | 账号体系 / 设备管理 / 权限 / 运营台 |
| `docs/需求规划评审意见.md` | 18k | 评审台账（§10 = 🔴 **活跃待办**，改稿前必看） |
| `docs/IMPACT.md` | ~4k | 🔑 **改任何已拍板 `D##` 前查落点**（文件:行号，生成物 + `C12` 门禁） |
| `docs/竞品对标表.md` | 14k | 竞品数据 / 矩阵 / 待核实项 |
| `docs/design/wireframe/README.md` | 17k | 线框规格与纪律（§5 通行规范 / §6 计数台账 / §12 门禁 / §11.4+§11.5.2 活跃缺口） |
| `docs/archive/*.md` | 42k | 📦 **历史，默认不读**（评审过程 / 回写清单 / 变更摘要） |

（`⏱` = 历史规模快照，权威数字见 `docs/OUTLINE.md`。）

## 4. 决策编号

- **已拍板 `D1`–`D28`**（含 `D23-1` / `D23-2` 等子项）· **待拍板 0 项** · **下一个可用 = `D29`**。
- 登记位 = `需求规划评审意见.md` §7（决策表）+ 各文档自己的决策块。纯工具 / 流程轮**不占编号**。

## 5. 兜底

- 本文件与 `docs/OUTLINE.md` 都可能漂移 ⇒ 目录漂移由 `C11`（源 md hash 对拍）拦截。
- 找不到答案时：grep 全文 → 涉及数值回 `成本测算表` §0 → 涉及线框回 `wireframe/README.md` §5。
- 终端是 **PS 5.1 + GBK**：写中文源文件必须 UTF-8 **无 BOM**；**别用终端整文件改写源码**。
