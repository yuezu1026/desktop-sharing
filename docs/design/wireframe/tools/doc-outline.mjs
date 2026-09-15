// doc-outline.mjs — 渐进披露 L1 层：文档目录生成 + 过期门禁
//
// 用法：
//   node tools/doc-outline.mjs           生成**精简档** docs/OUTLINE.md + tools/outline-hashes.json
//   node tools/doc-outline.mjs --check   对拍源文件 hash，过期即 exit 1（门禁 C11）
//   node tools/doc-outline.mjs --print   只打印精简档到 stdout，不写文件
//   node tools/doc-outline.mjs --full    打印**完整档**（`##` + 大 `###` + 行号 + 节 tok）到 stdout，不落盘
//   node tools/doc-outline.mjs --doc <相对路径>   单文档全展开（含每节行号与 tok）
//   node tools/doc-outline.mjs --section <相对路径> <节号>   单节定位（行范围 + 直接子节；加 --text 打正文）
//
// 两档分野：日常只读精简档（≈2k tok，回答「读哪个文件 / 有哪些章」）；
// 行号、节 tok、`###` 大节这些会漂移 / 会膨胀的信息，只在显式索取时才展开。
//
// 🔴 设计约束：stdout 只输出 ASCII（PowerShell 5.1 的中文会 GBK 碎掉）；
//    文件一律以 UTF-8 无 BOM 写入（Node 默认行为）。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // docs/design/wireframe/tools
const WIREFRAME = path.resolve(HERE, ".."); // docs/design/wireframe
const DOCS = path.resolve(WIREFRAME, "..", ".."); // docs
const REPO = path.resolve(DOCS, ".."); // repo root
const ARCHIVE_DIR = path.join(DOCS, "archive");
const OUTLINE = path.join(DOCS, "OUTLINE.md");
const HASHES = path.join(HERE, "outline-hashes.json");
/** L0 名片（仓库根，手写）：纳入 hash 表，改了忘重生成目录同样被 C11 拦下 */
const AGENTS = path.join(REPO, "AGENTS.md");

// 大节阈值：### 级只有超过这个 token 才进总目录（否则目录本身会膨胀）
const BIG_SECTION_TOKENS = 700;

/** 「何时读」的人工判断（脚本无法生成）—— key = 相对 repo 根的路径 */
const WHEN_TO_READ = {
  "docs/成本测算表.md":
    "🔴 **数值唯一事实源（SSOT §0）**。任何文档间的数字冲突以本文为准。**只查 §0 权威数值表 + 目标参数行，勿通读**。",
  "docs/需求规划-v2-P0P3重构.md":
    "确认「P0 做什么 / 不做什么 / 验收目标」时。**先读 §0 一页纸概览 + §1 范围**，其余按需。",
  "docs/商业化与计费设计.md": "涉及钱 / 额度 / 计费口径 / 计费 UI / 支付通道 / 增长红线时。",
  "docs/账号与管理系统设计.md": "涉及账号 / 设备 / 权限 / 审计 / 订单状态时。",
  "docs/竞品对标表.md":
    "需引用对手事实时。🔴 **引用前必核 §9 待核实清单**（未核实的不得写入对外材料）。",
  "docs/需求规划评审意见.md":
    "追溯「某决策为什么这么定」时。🔴 本文含**大段已回写的历史条目**，不必通读。",
  "docs/个人消费级远程桌面需求规划.md":
    "v1 原始需求。⚠️ **多数结论已被 v2 取代**，只在追溯来源时读。",
  "docs/design/wireframe/README.md":
    "改线框稿前必读：**§6.1 术语表 / §6.2 画布台账 / §12 防漂移工具链**。🔴 **不要通读**（§11 历史轮次已外置归档，见 `docs/archive/`）。",
  "docs/OUTLINE.md": "🤖 本文件（机器生成）。**入口**：先读它定位，再定点读原文。",
  "AGENTS.md": "🔑 **L0 名片（冷启动先读它）**：铁律 / 门禁命令 / 文档地图 / 决策编号。",
};

/** 章节状态的人工判断（未列出的默认 ✅ 有效） */
const SECTION_STATUS = {
  "docs/design/wireframe/README.md::11.4": "🔴 **活跃待办**（高保真阶段收，4 项）",
  "docs/design/wireframe/README.md::11.5.2": "🔴 **活跃待办**（已登记待高保真阶段收）",
  "docs/design/wireframe/README.md::7": "🔴 **活跃**（未出稿清单，改稿时必看）",
  "docs/design/wireframe/README.md::12": "🔴 **活跃**（门禁纪律，提交前必看）",
  "docs/成本测算表.md::0": "🔴 **SSOT**（数值唯一事实源）",
  "docs/成本测算表.md::10": "🔴 **活跃**（待核实 / 待询价清单）",
  "docs/竞品对标表.md::9": "🔴 **活跃**（待核实清单，引用前必核）",
  "docs/需求规划-v2-P0P3重构.md::1": "🔴 **活跃**（范围与优先级，含 P0 发版阻塞项清单）",
  "docs/需求规划评审意见.md::10": "🔴 **活跃**（待拍板台账）",
};

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

function sha1(text) {
  return crypto.createHash("sha1").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex").slice(0, 16);
}

function collectFiles() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith(".")) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (p === path.join(WIREFRAME, "tools")) continue; // 工具目录不是文档
        walk(p);
        continue;
      }
      if (!ent.name.endsWith(".md")) continue;
      if (p === OUTLINE) continue; // 自我引用排除
      // 决策影响面索引 = 查阅用生成物，不是「文档地图」成员；它由 C12 单独校验
      if (ent.name === "IMPACT.md") continue;
      out.push(scanFile(p));
    }
  };
  walk(DOCS);
  if (fs.existsSync(AGENTS)) out.push(scanFile(AGENTS));
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** 解析标题树 + 计算每节 token 与行范围 */
function parseHeadings(lines) {
  const heads = [];
  lines.forEach((l, i) => {
    const m = /^(#{2,4})\s+(.*)$/.exec(l);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), start: i });
  });
  for (let i = 0; i < heads.length; i++) {
    heads[i].end = i + 1 < heads.length ? heads[i + 1].start - 1 : lines.length - 1;
  }
  for (const h of heads) {
    const body = lines.slice(h.start, h.end + 1).join("\n");
    h.tokens = estTokens(body);
    h.from = h.start + 1;
    h.to = h.end + 1;
    const num = /^(\d+(?:\.\d+)*)\b/.exec(h.title);
    h.num = num ? num[1] : null;
  }
  return heads;
}

function scanFile(p) {
  const text = fs.readFileSync(p, "utf8");
  const lines = text.split(/\r?\n/);
  const rel = path.relative(REPO, p).replace(/\\/g, "/");
  return {
    rel,
    abs: p,
    lines: lines.length,
    tokens: estTokens(text),
    hash: sha1(text),
    heads: parseHeadings(lines),
    archived: p.startsWith(ARCHIVE_DIR + path.sep),
  };
}

const fmt = (n) => n.toLocaleString("en-US");

/**
 * 完整档（`--full`，**只打 stdout、不落盘**）——逃生舱。
 * 默认档（精简档）刻意不写行号、不列 `###`；需要行号 / 节 tok / `###` 大节时才展开这一档。
 */
function renderOutlineFull(files) {
  const docs = files.filter((f) => !f.archived);
  const archived = files.filter((f) => f.archived);
  const docTokens = docs.reduce((a, f) => a + f.tokens, 0);
  const arcTokens = archived.reduce((a, f) => a + f.tokens, 0);

  const L = [];
  L.push(
    "# 文档目录 · 渐进披露索引（L1 · 完整档）",
  );
  L.push("");
  L.push(
    "> 🤖 由 `node tools/doc-outline.mjs --full` 机器生成（**只打 stdout**）。日常用精简档 `docs/OUTLINE.md`。",
  );
  L.push(
    " > 🔑 **读法**：**先在这里定位 → 再定点读原文的 60~150 行**，远便宜于通读任何一份原文。",
  );
  L.push("");
  L.push("## 0. 一屏速查");
  L.push("");
  L.push(`| 文档 | 行 | token | 何时读 |`);
  L.push(`|---|--:|--:|---|`);
  for (const f of docs) {
    const when = WHEN_TO_READ[f.rel] ?? "—";
    L.push(`| \`${f.rel}\` | ${fmt(f.lines)} | ${fmt(f.tokens)} | ${when} |`);
  }
  if (archived.length) {
    L.push(
      `| 📦 \`docs/archive/\` (${archived.length} 份，**默认不读**) | ${fmt(
        archived.reduce((a, f) => a + f.lines, 0),
      )} | ${fmt(arcTokens)} | 只在追溯历史决策细节时打开 |`,
    );
  }
  L.push("");
  L.push(`> 正文文档合计 **${fmt(docTokens)}** tok；归档 ${fmt(arcTokens)} tok（已从正文移出）。`);
  L.push("");
  L.push("## 1. 章节定位（列全部 `##`，`###` 只列 token ≥ " + BIG_SECTION_TOKENS + " 的大节）");
  L.push("");
  L.push("> 需要某文档的**全部**小节：`node tools/doc-outline.mjs --doc <相对路径>`");
  L.push("");
  for (const f of docs) {
    L.push(`### \`${f.rel}\` — ${fmt(f.lines)} 行 / ${fmt(f.tokens)} tok`);
    const rows = f.heads.filter((h) => h.level === 2 || h.tokens >= BIG_SECTION_TOKENS);
    if (!rows.length) {
      L.push("");
      L.push("（无 `##` 级小节）");
      L.push("");
      continue;
    }
    L.push("");
    L.push("| § | 标题 | 行 | tok | 状态 |");
    L.push("|---|---|---|--:|---|");
    for (const h of rows) {
      const status = SECTION_STATUS[`${f.rel}::${h.num}`] ?? "";
      const indent = h.level === 3 ? "└ " : "";
      L.push(
        `| ${h.num ? `\`${h.num}\`` : "—"} | ${indent}${h.title.replace(/\|/g, "\\|")} | L${h.from}–${h.to} | ${fmt(
          h.tokens,
        )} | ${status} |`,
      );
    }
    L.push("");
  }
  if (archived.length) {
    L.push("## 2. 📦 归档（默认不读）");
    L.push("");
    L.push("> 这些是从正文**原样搬出**的历史 / 速查段落。正文保留 `§` 编号与指针，因此既有引用仍可解析。");
    L.push("");
    L.push("| 归档文件 | 行 | token | 来源 |");
    L.push("|---|--:|--:|---|");
    for (const f of archived) {
      L.push(`| \`${f.rel}\` | ${fmt(f.lines)} | ${fmt(f.tokens)} | — |`);
    }
    L.push("");
  }
  return L.join("\n");
}

/** 状态徽标：只留 emoji + 紧跟的短词（完整说明见 `--full`），例：`🔴SSOT` / `🔴活跃` */
function badgeOf(rel, num) {
  const s = SECTION_STATUS[`${rel}::${num}`];
  if (!s) return "";
  const m = /^(\S+)\s*\*\*([^*]+)\*\*/.exec(s);
  return m ? `${m[1]}${m[2]}` : s.split(/\s/)[0];
}

/**
 * 🔴 人工标注过的节点（📊 与 `SECTION_STATUS` 同源的人工判断）—— 精简档**只为它们破例**。
 * 精简档规则：**列全部 `##` + 只列人工标了 🔴 的 `###`**。
 * 理由：`###` 每轮只增不减（会令 L1 自我膨胀）；而人工标 🔴 的（活跃待办 / SSOT）恰恰是最该被看见的。
 */
const isKeyNode = (rel, h) => h.level === 2 || Boolean(badgeOf(rel, h.num).includes("🔴"));

/** 精简档的「何时读」：只取首句（完整判断见 `--full`），避免同一句在每个文档重复铺开 */
function shortWhen(rel) {
  const full = WHEN_TO_READ[rel];
  if (!full) return "—";
  return full.split("。")[0] + "。";
}

/**
 * 精简档（默认落盘 `docs/OUTLINE.md`）——只回答两个问题：
 *   ① 读哪个文件？ ② 这个文件有哪些章？
 *
 * 刻意**不写行号**：行号经任何一次编辑就漂移（与本仓库 `C6-a`「正文禁写 L###」同源）；
 *   需要行号时 `--doc <路径>` 一次就能拿到（含每节 tok），比读目录后在脑中做行号加减更可靠也更便宜。
 * 刻意**不列普通 `###`**：见 `isKeyNode`。
 */
function renderOutlineLite(files) {
  const docs = files.filter((f) => !f.archived);
  const archived = files.filter((f) => f.archived);
  const docTokens = docs.reduce((a, f) => a + f.tokens, 0);
  const arcTokens = archived.reduce((a, f) => a + f.tokens, 0);

  const L = [];
  L.push("# 文档目录 · 渐进披露索引（L1 · 精简档）");
  L.push("");
  L.push(
    "> 🤖 机器生成（`node tools/doc-outline.mjs`），**勿手改**；改任何 md 后必须重跑，否则 `--check` FAIL（门禁 `C11`）。",
  );
  L.push(
    "> 🧰 **取行号**：`… --doc <路径>`（单文档全展开，含节 tok）· **取完整档**（`##` + 全部 `###` + 行号 + 节 tok）：`… --full`（只打 stdout，不落盘）。",
  );
  L.push("");
  L.push("## 0. 读哪个文件");
  L.push("");
  L.push(`| 文档 | 行 | token | 何时读 |`);
  L.push(`|---|--:|--:|---|`);
  for (const f of docs) {
    L.push(`| \`${f.rel}\` | ${fmt(f.lines)} | ${fmt(f.tokens)} | ${shortWhen(f.rel)} |`);
  }
  if (archived.length) {
    L.push(
      `| 📦 \`docs/archive/\` (${archived.length} 份，**默认不读**) | ${fmt(
        archived.reduce((a, f) => a + f.lines, 0),
      )} | ${fmt(arcTokens)} | 只在追溯历史决策细节时打开 |`,
    );
  }
  L.push("");
  L.push(`> 正文合计 **${fmt(docTokens)}** tok · 归档 ${fmt(arcTokens)} tok（已移出正文）。`);
  L.push("");
  L.push(`## 1. 有哪些章（列全部 \`##\`；\`###\` 只列人工标 🔴 的关键节点，其余用 \`--full\`）`);
  L.push("");
  for (const f of docs) {
    const rows = f.heads.filter((h) => isKeyNode(f.rel, h));
    if (!rows.length) {
      L.push(`- \`${f.rel}\` — （无 \`##\` 级小节）`);
      continue;
    }
    const parts = rows.map((h) => {
      const name = h.title.replace(/^\d+(?:\.\d+)*\.?\s*/, "");
      const b = h.level === 3 ? "└" : "";
      return `\`${h.num ?? "—"}\`${b} ${name}${badgeOf(f.rel, h.num)}`;
    });
    L.push(`- \`${f.rel}\` — ${parts.join(" · ")}`);
  }
  if (archived.length) {
    L.push("");
    L.push("## 2. 📦 归档（默认不读）");
    L.push("");
    L.push(
      "> 从正文**原样搬出**的历史 / 速查段落；正文保留 `§` 编号与指针，因而既有引用仍可解析。",
    );
    L.push("");
    for (const f of archived) {
      L.push(`- \`${f.rel}\` — ${fmt(f.lines)} 行 / ${fmt(f.tokens)} tok`);
    }
  }
  return L.join("\n");
}

// ---- CLI ----
const args = process.argv.slice(2);
const files = collectFiles();

if (args.includes("--doc")) {
  const want = args[args.indexOf("--doc") + 1];
  const f = files.find((x) => x.rel === want || x.rel.endsWith(want));
  if (!f) {
    console.log(`not found: ${want}`);
    process.exit(1);
  }
  console.log(`${f.rel}  lines=${f.lines} tokens=${f.tokens}`);
  for (const h of f.heads) {
    console.log(`${"  ".repeat(h.level - 2)}${h.num ?? "-"} | L${h.from}-${h.to} | ${h.tokens} | ${h.title}`);
  }
  process.exit(0);
}

if (args.includes("--section")) {
  const i = args.indexOf("--section");
  const want = args[i + 1];
  const rawNum = args[i + 2];
  if (!want || !rawNum) {
    console.log("usage: node tools/doc-outline.mjs --section <doc-rel-path> <x.y> [--text]");
    process.exit(1);
  }
  const f = files.find((x) => x.rel === want || x.rel.endsWith(want));
  if (!f) {
    console.log(`not found: ${want}`);
    process.exit(1);
  }
  const num = String(rawNum).replace(/^§\s*/, "");
  const hit = f.heads.find((h) => h.num === num);
  if (!hit) {
    console.log(`section not found: §${num} in ${f.rel}`);
    console.log(`available: ${f.heads.filter((h) => h.num).map((h) => h.num).join(", ")}`);
    process.exit(1);
  }
  // 🔴 行范围是「本节含全部子节」：Read<from..to> 一次拿全，比自己拼子节更安全。
  console.log(
    `${f.rel}  section=§${hit.num}  lines=${hit.from}-${hit.to}  (${hit.to - hit.from + 1} lines / ~${hit.tokens} tok)  level=${hit.level}  file_lines=${f.lines}`,
  );
  console.log(`  title: ${hit.title}`);
  const kids = f.heads.filter(
    (k) => k.level === hit.level + 1 && k.from > hit.from && k.to <= hit.to,
  );
  for (const k of kids) {
    console.log(`  sub §${k.num ?? "-"}  lines=${k.from}-${k.to}  ~${k.tokens} tok  ${k.title}`);
  }
  if (args.includes("--text")) {
    const all = fs.readFileSync(f.abs, "utf8").split(/\r?\n/);
    process.stdout.write(all.slice(hit.from - 1, hit.to).join("\n") + "\n");
  }
  process.exit(0);
}

if (args.includes("--check")) {
  if (!fs.existsSync(HASHES)) {
    console.log("FAIL  outline hashes missing. run: node tools/doc-outline.mjs");
    process.exit(1);
  }
  const known = JSON.parse(fs.readFileSync(HASHES, "utf8"));
  const stale = [];
  const missing = [];
  const extra = [];
  for (const f of files) {
    if (!(f.rel in known)) {
      missing.push(f.rel);
      continue;
    }
    if (known[f.rel].hash !== f.hash) stale.push(f.rel);
  }
  for (const rel of Object.keys(known)) {
    if (!files.some((f) => f.rel === rel)) extra.push(rel);
  }
  if (stale.length || missing.length || extra.length) {
    console.log("FAIL  doc outline is stale.");
    for (const r of stale) console.log(`  changed : ${r}`);
    for (const r of missing) console.log(`  new     : ${r}`);
    for (const r of extra) console.log(`  removed : ${r}`);
    console.log("fix     : node tools/doc-outline.mjs   (then review the diff of docs/OUTLINE.md)");
    process.exit(1);
  }
  console.log(`PASS  doc outline up to date (${files.length} files)`);
  process.exit(0);
}

const outlineText = renderOutlineLite(files);
const hashMap = {};
for (const f of files) hashMap[f.rel] = { lines: f.lines, tokens: f.tokens, hash: f.hash };

// 完整档 = 逃生舱，只打 stdout、**不落盘**（落盘会跟精简档打架，也让 C11 失去单一目标）
if (args.includes("--full")) {
  process.stdout.write(renderOutlineFull(files) + "\n");
  process.exit(0);
}

if (args.includes("--print")) {
  process.stdout.write(outlineText + "\n");
  process.exit(0);
}

fs.writeFileSync(OUTLINE, outlineText, "utf8");
fs.writeFileSync(HASHES, JSON.stringify(hashMap, null, 2) + "\n", "utf8");
console.log(`wrote ${path.relative(REPO, OUTLINE)}  (${outlineText.length} chars / ~${fmt(estTokens(outlineText))} tok)`);
console.log(`wrote ${path.relative(REPO, HASHES)}  (${files.length} files tracked)`);
for (const f of files) console.log(`  ${f.archived ? "ARCH" : "DOC "} ${f.rel}  ${f.lines}L ${f.tokens}tok`);
