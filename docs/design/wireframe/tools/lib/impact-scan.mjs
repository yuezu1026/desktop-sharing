/**
 * impact-scan.mjs —— 决策影响面扫描（`D##` → 落点「文件:行号」）
 *
 * 为什么需要它
 *   一个已拍板决策（例 `[D25]` 支付状态机）的落点散在 6~8 个文件里。改它的时候，
 *   靠 grep 现场找 = 每轮重复付 token，而且**一定会漏**（漏改 = 漂移）。
 *   这里把「谁引用了我」预先算好、落成一份索引（`docs/IMPACT.md`），
 *   改之前先看索引 ⇒ 一次改全。
 *
 * 口径（有意为之）
 *   - 只登记**位置**，不登记内容：内容会漂移，位置好核对。
 *   - 行号写**裸数字**（`:281`），**不带 `L` 前缀** ⇒ 故意避开 `C6-a` 的「正文禁写 L###」禁令。
 *   - 范围 = `docs/**` 的 `.md` + `design/wireframe/**` 的 `.html`；
 *     🔴 不含 `archive/`（历史快照，不是落点）、不含 `tools/`（生成物）。
 *   - 识别两种写法：`[D25]` 与 `[新增·D25]`（后者是补稿时的新增标记）。
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** docs/design/wireframe */
export const WIREFRAME_DIR = join(HERE, "..", "..");
/** docs */
export const DOCS_DIR = join(WIREFRAME_DIR, "..", "..");
/** 仓库根 */
export const REPO = join(DOCS_DIR, "..");
/** 索引产物 */
export const IMPACT = join(DOCS_DIR, "IMPACT.md");

/** `[D25]` / `[D23-1]` / `[新增·D22]` 都算 */
const DECISION_RE = /\[(?:新增·)?D(\d+(?:-\d+)?)\]/g;
/** 不参与扫描的目录（历史快照 / 生成物 / 脚本） */
const SKIP_DIRS = new Set(["archive", "tools", "node_modules", ".git"]);
/** 不参与扫描的文件（生成物） */
const SKIP_FILES = new Set(["OUTLINE.md", "IMPACT.md"]);

function collect(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collect(join(dir, e.name), out);
      continue;
    }
    if (!/\.(md|html)$/.test(e.name)) continue;
    if (SKIP_FILES.has(e.name)) continue;
    out.push(join(dir, e.name));
  }
  return out;
}

const relPath = (p) => relative(DOCS_DIR, p).replace(/\\/g, "/");

/** 主号 / 子号排序用（`23-1` → [23, 1]） */
const numKey = (code) => code.split("-").map(Number);

/**
 * 扫全库的决策引用。
 * @returns {{ byCode: Map<string, {rel:string,line:number}[]>, files: string[], total: number }}
 */
export function scanDecisions() {
  const files = collect(DOCS_DIR).sort();
  /** @type {Map<string, {rel:string,line:number}[]>} */
  const byCode = new Map();
  let total = 0;

  for (const p of files) {
    const rel = relPath(p);
    const lines = readFileSync(p, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("[D") && !line.includes("新增·D")) return;
      // 同一行反复引用同一个决策只算一处（否则「处数」被行内重复放大）
      const seen = new Set();
      for (const m of line.matchAll(DECISION_RE)) seen.add(m[1]);
      for (const code of seen) {
        const arr = byCode.get(code) ?? [];
        arr.push({ rel, line: i + 1 });
        byCode.set(code, arr);
        total++;
      }
    });
  }
  return { byCode, files: files.map(relPath), total };
}

/** 由扫描结果渲染索引正文（`--check` 直接拿它跟磁盘对拍） */
export function renderImpactMd(scan) {
  const codes = [...scan.byCode.keys()].sort((a, b) => {
    const ka = numKey(a);
    const kb = numKey(b);
    return ka[0] - kb[0] || (ka[1] ?? 0) - (kb[1] ?? 0);
  });

  const L = [];
  L.push("# 决策影响面索引（IMPACT）");
  L.push("");
  L.push(
    "> 🔴 **生成物，勿手改**：由 `node tools/impact-index.mjs` 生成（或 `wireframe-consistency.mjs --fix` 顺带重跑）。",
  );
  L.push(
    "> **用途**：改任何一个已拍板决策（`D1`–`D25`）之前，先来这里看它的**全部落点** ⇒ 一次改全，不必 grep 现场找、也不会漏。",
  );
  L.push(
    "> **口径**：只登记「文件:行号」，**不登记内容**（内容会漂移，位置易核对）；行号是**裸数字**（`:281`，不带 `L` 前缀），故意避开 `C6-a` 的「正文禁写 `L###`」禁令。",
  );
  L.push(
    "> **范围**：`docs/**` 的 `.md` 与 `design/wireframe/**` 的 `.html`；🔴 不含 `archive/`（历史快照，不是落点）与 `tools/`（生成物）。",
  );
  L.push(
    "> **过期判定**：门禁 `C12`（`wireframe-consistency.mjs`）拿本文件与重新扫描结果逐字对拍 ⇒ 任何文档增删行都会让它 FAIL 提示重跑。",
  );
  L.push("");
  L.push(
    `**共 ${codes.length} 个决策 / ${scan.total} 处落点 / ${scan.files.length} 个文件。**`,
  );
  L.push("");
  L.push("---");
  L.push("");
  L.push("## 逐决策落点（按编号升序 · 数字 = 行号）");
  L.push("");

  for (const code of codes) {
    const hits = scan.byCode.get(code);
    /** @type {Map<string, number[]>} */
    const byFile = new Map();
    for (const h of hits) {
      const arr = byFile.get(h.rel) ?? [];
      arr.push(h.line);
      byFile.set(h.rel, arr);
    }
    L.push(
      `### \`D${code}\` · ${hits.length} 处 / ${byFile.size} 个文件`,
    );
    for (const [rel, nums] of byFile) {
      L.push(`- \`${rel}\`: ${nums.join(", ")}`);
    }
    L.push("");
  }

  L.push("---");
  L.push("");
  L.push("## 怎么用（三个高频动作）");
  L.push("");
  L.push(
    "1. **改某个决策前**：搜 `### \\`Dxx\\``，把列出的位置全部打开看一遍 ⇒ 定稿后一次改全。",
  );
  L.push(
    "2. **改完**：跑 `node tools/impact-index.mjs`（或 `--fix`）重生成本文件 ⇒ 行号重新对齐。",
  );
  L.push(
    "3. **收尾前**：`node tools/wireframe-consistency.mjs` 必须 `FAIL=0`（`C12` 会告诉你索引是否过期）。",
  );
  L.push("");

  return L.join("\n");
}

/**
 * 行内空白归一化：VS Code 的 markdown 格式化器会在中英文之间补空格，
 * 逐字对拍会因此假失败 ⇒ 只把「行内空白」抹掉再比（换行仍严格比对）。
 */
const squash = (s) => s.split("\n").map((l) => l.replace(/[ \t]+/g, "")).join("\n");

/** 磁盘上的索引是否与「重新扫描后应有内容」一致 */
export function impactIsStale() {
  const want = renderImpactMd(scanDecisions());
  const have = existsSync(IMPACT) ? readFileSync(IMPACT, "utf8") : null;
  return { want, have, stale: have === null || squash(have) !== squash(want) };
}
