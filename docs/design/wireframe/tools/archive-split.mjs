// archive-split.mjs — 渐进披露：把「历史 / 已回写」段落从正文搬进 docs/archive/
//
// 设计目标（与 wireframe-consistency / doc-outline 同一套纪律）：
//   1. 正文**保留全部标题行**（锚点不丢 ⇒ 既有 §x.y 引用仍可解析、C6 门禁不炸）
//   2. 每个 `##` 标题下插一行指针 → 读者/AI 知道内容去哪了
//   3. 归档文件原样搬运，顶部写「来源 + 原行号」，便于回溯与二次检索
//
// 用法：
//   node tools/archive-split.mjs --dry     只报告将切割的行范围与 token（核对用）
//   node tools/archive-split.mjs --apply   真正切割并写文件
//
// 🔴 stdout 只输出 ASCII（PowerShell 5.1）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIREFRAME = path.resolve(HERE, ".."); // docs/design/wireframe
const DOCS = path.resolve(WIREFRAME, "..", ".."); // docs
const REPO = path.resolve(DOCS, "..");
const ARCHIVE = path.join(DOCS, "archive");
const TODAY = new Date().toISOString().slice(0, 10);

/**
 * PLAN —— 「哪一段属于归档」的唯一声明处。
 * from/to 为正则；to 为 null 表示切到文件末尾。
 * 改动本表 = 改变归档边界，必须重跑 --dry 核对。
 */
const PLAN = [
  {
    src: "docs/design/wireframe/README.md",
    from: /^## 11\.\s/,
    to: /^## 12\.\s/,
    dest: "docs/archive/wireframe-README-评审历史轮次.md",
    h1: "# 线框 README · §11 UI/UX 评审历史轮次（第一 ~ 六轮）",
    lead: "> 📦 由 `README.md` §11 **原样外置**（渐进披露「归档层」）。正文保留 `§` 编号与标题锚点，既有引用不受影响。",
    note: "🔴 **改稿前必看（虽随本节外置，但不属历史）**：`§11.4` 缺口与范围声明（待收 1 项 + 范围声明 1 项）· `§11.5.2` 已登记项 R8–R18（均已标状态）。", 
  },
  {
    src: "docs/需求规划-v2-P0P3重构.md",
    from: /^## 附：v1 → v2 变更摘要/,
    to: null,
    dest: "docs/archive/需求规划v2-变更摘要.md",
    h1: "# 需求规划 v2 · v1 → v2 变更摘要（全量台账）",
    lead: "> 📦 由 `需求规划-v2-P0P3重构.md` 文末**原样外置**。这是逐轮变更台账（每轮一行），正文只保留条目索引。",
    note: "🔑 **追加新轮次**：直接追加到本文件末尾；正文 §附 处的条目索引可一并补一行。", 
  },
  {
    src: "docs/商业化与计费设计.md",
    from: /^## 12\.\s/,
    to: /^## 13\.\s/,
    dest: "docs/archive/商业化-回写清单.md",
    h1: "# 商业化与计费设计 · §12 与既有文档的联动（回写清单）",
    lead: "> 📦 由 `商业化与计费设计.md` §12 **原样外置**。",
    note: "🔑 数值仍以 `成本测算表` §0 为唯一事实源。",
  },
  {
    src: "docs/商业化与计费设计.md",
    from: /^## 附/,
    to: null,
    dest: "docs/archive/商业化-附录速查.md",
    h1: "# 商业化与计费设计 · 附录：一句话速查",
    lead: "> 📦 由 `商业化与计费设计.md` 文末附录**原样外置**。",
    note: "",
  },
  {
    src: "docs/账号与管理系统设计.md",
    from: /^## 9\.\s/,
    to: /^## 附|^## 10\.\s/,
    dest: "docs/archive/账号设计-回写清单.md",
    h1: "# 账号与管理系统设计 · §9 与既有文档的联动（回写清单）",
    lead: "> 📦 由 `账号与管理系统设计.md` §9 **原样外置**。",
    note: "",
  },
  {
    src: "docs/账号与管理系统设计.md",
    from: /^## 附/,
    to: null,
    dest: "docs/archive/账号设计-附录速查.md",
    h1: "# 账号与管理系统设计 · 附录：一句话速查",
    lead: "> 📦 由 `账号与管理系统设计.md` 文末附录**原样外置**。",
    note: "",
  },
  {
    src: "docs/需求规划评审意见.md",
    from: /^### D8 的连带影响/,
    to: /^## 8\.\s/,
    dest: "docs/archive/评审意见-决策连带影响.md",
    h1: "# 需求规划评审意见 · 各决策的连带影响（D1–D11 · 已回写）",
    lead: "> 📦 由 `需求规划评审意见.md` §7 下辖各「D# 的连带影响（已回写 v2）」小节**原样外置**。",
    note: "🔑 这些内容**均已回写进 v2 / 成本表 / 商业化 / 账号设计**；此处仅作追溯。",
  },
  {
    src: "docs/需求规划评审意见.md",
    from: /^## 9\.\s/,
    to: /^## 10\.\s/,
    dest: "docs/archive/评审意见-全量评审登记.md",
    h1: "# 需求规划评审意见 · §9 业务专家全量评审的登记与落地",
    lead: "> 📦 由 `需求规划评审意见.md` §9 **原样外置**（A 组硬矛盾 / B 组口径 / 完善缺口 / 增强项，**均已落地**）。",
    note: "🔴 **仍活跃的台账在正文 §10**（待确认总台账：待填参数 / 需询价 / 需实测 / 需核实）。",
  },
];

function estTokens(text) {
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c > 0x2e7f) cjk++;
    else ascii++;
  }
  return Math.round(cjk + ascii / 3.6);
}

const fmt = (n) => n.toLocaleString("en-US");
const toPosix = (p) => p.replace(/\\/g, "/");
const fmtRe = (re) => (re === null ? "EOF" : String(re));

function findIdx(lines, re, from = 0) {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  return -1;
}

/** 计算所有切片，按 (src, start) 降序，保证同一文件从后往前替换 */
function computeSlices() {
  const items = [];
  for (const p of PLAN) {
    const abs = path.join(REPO, p.src);
    const text = fs.readFileSync(abs, "utf8");
    const lines = text.split(/\r?\n/);
    const s = findIdx(lines, p.from);
    if (s < 0) throw new Error(`[${p.src}] "from" not matched: ${p.from}`);
    let e = lines.length;
    if (p.to) {
      const e0 = findIdx(lines, p.to, s + 1);
      if (e0 < 0) throw new Error(`[${p.src}] "to" not matched: ${p.to}`);
      e = e0;
    }
    // 去掉尾部空行
    let end = e;
    while (end > s && lines[end - 1].trim() === "") end--;
    const section = lines.slice(s, end);
    items.push({
      ...p,
      lines,
      start: s,
      end,
      section,
      tokens: estTokens(section.join("\n")),
      headCount: section.filter((l) => /^#{2,4}\s/.test(l)).length,
      relLink: toPosix(path.relative(path.dirname(abs), path.join(REPO, p.dest))),
    });
  }
  return items.sort((a, b) => (a.src === b.src ? b.start - a.start : a.src.localeCompare(b.src)));
}

/** 正文占位：只保留标题行；每个 `##` 后插一行指针；「表格型小节」附首列索引 */
function buildStub(item) {
  const pointer = `> 📦 **本小节已外置（历史记录，默认不读）** → [\`${item.relLink.split("/").pop()}\`](${item.relLink})`;
  const heads = item.section.filter((l) => /^#{2,4}\s/.test(l));
  const bodyRows = item.section.filter(
    (l) => /^\|/.test(l.trim()) && !/^\|[\s:|-]+\|$/.test(l.trim()),
  ).length;
  // 「表格型小节」= 几乎只有一个标题但表格很长（如逐轮变更台账）
  const isTableSection = bodyRows >= 5 && heads.length <= 2;
  const keys = isTableSection ? tableKeys(item.section, 30) : [];
  const out = [];

  if (!heads.length) {
    out.push(pointer);
    if (keys.length) out.push("", `> 条目：${keys.map((k) => `\`${k}\``).join(" · ")}`);
    out.push("");
    return out;
  }

  let firstH2 = true;
  for (const l of item.section) {
    if (!/^#{2,4}\s/.test(l)) continue;
    out.push(l);
    if (/^##\s/.test(l)) {
      out.push("", pointer);
      if (firstH2 && item.note) {
        out.push(`> ${item.note}`);
        firstH2 = false;
      }
      if (keys.length) out.push("", `> 条目：${keys.map((k) => `\`${k}\``).join(" · ")}`);
    }
  }
  out.push("");
  return out;
}

/** 提取 markdown 表格的首列（跳过表头与分隔行），去重保序，上限 limit 项 */
function tableKeys(section, limit = 12) {
  const keys = [];
  for (const l of section) {
    const t = l.trim();
    if (!t.startsWith("|")) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue; // 分隔行
    const cells = t.split("|").slice(1, -1).map((c) => c.trim());
    if (!cells.length) continue;
    const k = cells[0].replace(/[*_`]/g, "");
    if (!k || k === "变更" || k === "条目" || k === "编号") continue; // 表头
    if (keys.includes(k)) continue;
    keys.push(k);
    if (keys.length >= limit) break;
  }
  return keys;
}

function buildArchive(item) {
  const rel = toPosix(path.relative(REPO, path.join(REPO, item.src)));
  const L = [];
  L.push(item.h1);
  L.push("");
  L.push(item.lead);
  L.push("");
  L.push(`> 📦 **来源**：\`${rel}\` 原 L${item.start + 1}–${item.end} · 外置于 ${TODAY} · \`tools/archive-split.mjs\``);
  L.push("> 🔎 正文对应位置仍保留 `§` 编号与标题锚点，可直接在本文件内检索定位。");
  if (item.note) L.push(`> ${item.note}`);
  L.push("");
  L.push("---");
  L.push("");
  L.push(...item.section);
  L.push("");
  return L.join("\n");
}

// ---- CLI ----
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dry = args.includes("--dry") || !apply;

const items = computeSlices();

let totalMoved = 0;
let totalStub = 0;
const byFile = new Map();
for (const it of items) {
  const stub = buildStub(it);
  const stubTok = estTokens(stub.join("\n"));
  totalMoved += it.tokens;
  totalStub += stubTok;
  if (!byFile.has(it.src)) byFile.set(it.src, []);
  byFile.get(it.src).push(it);
  console.log(
    `${dry ? "DRY " : "CUT "} ${it.src}  L${it.start + 1}-${it.end}  ${it.end - it.start}L ${fmt(
      it.tokens,
    )}tok -> ${it.dest}  [stub ${stubTok}tok, headings kept ${it.headCount}]  to=${fmtRe(it.to)}`,
  );
}
console.log(`----`);
const net = totalMoved - totalStub;
console.log(`TOTAL  moved=${fmt(totalMoved)}tok  stub=${fmt(totalStub)}tok  net=${net >= 0 ? "-" + fmt(net) : "+" + fmt(-net)}tok`);

if (dry) {
  console.log("dry run only. add --apply to write.");
  process.exit(0);
}

fs.mkdirSync(ARCHIVE, { recursive: true });
for (const it of items) {
  fs.writeFileSync(path.join(REPO, it.dest), buildArchive(it), "utf8");
}
for (const [src, list] of byFile) {
  const abs = path.join(REPO, src);
  const lines = list[0].lines.slice();
  for (const it of list) {
    // list 已是降序
    lines.splice(it.start, it.end - it.start, ...buildStub(it));
  }
  fs.writeFileSync(abs, lines.join("\n"), "utf8");
}
console.log(`applied: ${items.length} sections -> ${new Set(items.map((i) => i.dest)).size} archive files`);
