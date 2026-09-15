#!/usr/bin/env node
/**
 * frame.mjs —— 帧级「定位卡」：改一帧只读这一帧，不必读整个 1,700 行的 HTML
 *
 * 为什么需要它：
 *   7 个线框页 HTML 是最大单文件 token 体量（最大 w4 ≈ 39.8k tok / 1,768 行），
 *   但一次改动通常只涉及**一帧**（约 30~70 行）。以前必须「grep 定位 → 大段 read_file」，
 *   每次都要把整页读进上下文。本工具把「一帧 + 它的全部同步点」压成一张卡片。
 *
 * 用法：
 *   node tools/frame.mjs w4-09              写 tools/frame-dump.md（UTF-8）+ stdout ASCII 摘要
 *   node tools/frame.mjs w4-09 --print      直接打 stdout（UTF-8 终端用）
 *   node tools/frame.mjs w4-09 --brief      只要「定位 + 同步点」，不含帧原文
 *   node tools/frame.mjs --list             列全部 65 帧（id / 页 / 行范围 / 尺寸 / 加高）
 *
 * 🔴 设计约束：stdout 只输出 ASCII（PS 5.1 终端是 GBK，中文会碎）；
 *    卡片正文（含中文）一律落 tools/frame-dump.md —— 它已进 tools/.gitignore。
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

import {
  WIREFRAME_DIR,
  DOCS_DIR,
  PAGES,
  scanWireframes,
  parseEntries,
  parseCanvasLedger,
  norm,
} from "./lib/wireframe-scan.mjs";

const README = join(WIREFRAME_DIR, "README.md");
const INDEX = join(WIREFRAME_DIR, "index.html");
const DUMP = join(WIREFRAME_DIR, "tools", "frame-dump.md");
const REPO = join(WIREFRAME_DIR, "..", "..", "..");

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const rel = (p) => relative(REPO, p).replace(/\\/g, "/");
/** 与 doc-outline.mjs 同口径的 token 估算 */
const est = (s) => {
  let cjk = 0;
  let ascii = 0;
  for (const ch of s) (ch.codePointAt(0) > 0x2e7f ? cjk++ : ascii++);
  return Math.round(cjk + ascii / 3.6);
};

const args = process.argv.slice(2);
const scan = scanWireframes();

/* ---------- --list ---------- */
if (args.includes("--list")) {
  console.log("frame     page  lines        size      flags");
  for (const f of scan.frames) {
    const flags = [
      f.isCustomHeight ? "custom-height" : "",
      f.isSubState ? "sub-state" : "",
      f.pins ? `pin=${f.pins}` : "",
      f.notes ? `notes=${f.notes}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      [
        (f.id ?? "(no-id)").padEnd(9),
        f.page.padEnd(5),
        `${f.fromLine}-${f.toLine}`.padEnd(13),
        `${f.width}x${f.height}`.padEnd(9),
        flags,
      ].join(" "),
    );
  }
  console.log(`total=${scan.total} frames`);
  process.exit(0);
}

const rawId = args.find((a) => !a.startsWith("--"));
if (!rawId) {
  console.log("usage: node tools/frame.mjs <frame-id> [--print] [--brief] | --list");
  console.log(`       frame ids look like w4-09 / w1-05a  (${scan.total} frames available, use --list)`);
  process.exit(1);
}

const want = rawId.toLowerCase();

/* ---------- 定位帧（精确 → 前缀/包含 → 报候选） ---------- */
let f = scan.frames.find((x) => x.id === want);
if (!f && !/^w[1-6]-/.test(want)) {
  f = scan.frames.find((x) => x.id === `w${want.replace(/^w?/, "")}`);
}
if (!f) {
  const cands = scan.frames
    .filter((x) => x.id?.includes(want))
    .map((x) => x.id)
    .slice(0, 20);
  console.log(`not found: ${rawId}`);
  if (cands.length) console.log(`candidates: ${cands.join(", ")}`);
  process.exit(1);
}

const page = scan.pages.find((p) => p.key === f.page);
const lines = page.html.split(/\r?\n/);
const rawLines = lines.slice(f.fromLine - 1, f.toLine);

/* ---------- 同步点 ①：README §2 条目 ---------- */
const readme = read(README);
const entries = parseEntries(readme);
const hitEntries = entries.filter((e) => e.anchors.includes(f.id));

/* ---------- 同步点 ②：README §6.2 画布台账 ---------- */
const ledger = parseCanvasLedger(readme);
const ledItem = ledger?.items.find((i) => i.id === f.id) ?? null;
const ledFree = ledger?.free.find((i) => i.id === f.id) ?? null;

/* ---------- 同步点 ③：index.html 锚点 ---------- */
const indexHits = read(INDEX)
  .split(/\r?\n/)
  .map((l, i) => ({ n: i + 1, l }))
  .filter((x) => x.l.includes(`#${f.id}`));

/* ---------- 同步点 ④：其他文档里的引用 ---------- */
const mdFiles = [];
for (const name of readdirSync(DOCS_DIR)) {
  if (name.endsWith(".md")) mdFiles.push(join(DOCS_DIR, name));
}
const otherRefs = [];
for (const p of mdFiles) {
  if (p === README) continue;
  const t = read(p);
  t.split(/\r?\n/).forEach((line, i) => {
    if (line.toLowerCase().includes(f.id))
      otherRefs.push({ file: rel(p), line: i + 1, text: norm(line).slice(0, 160) });
  });
}

/* ---------- 渲染卡片 ---------- */
const spanLines = f.toLine - f.fromLine + 1;
const rawTok = est(rawLines.join("\n"));
const sizeNote = f.isCustomHeight
  ? `${f.variant ?? "(free)"} ${f.width}×${f.height}（标准档 ${JSON.stringify(f.stdHeights)} ⇒ **加高** ${f.height}）`
  : f.isStandardWidth
    ? `${f.variant ?? "(free)"} ${f.width}×${f.height}（标准档）`
    : `${f.variant ?? "(free)"} ${f.width}×${f.height}（**自由画布**，非标准宽度）`;

const L = [];
L.push(`# 帧定位卡 · ${f.id.toUpperCase()}`);
L.push("");
L.push(`**${f.page}** \`${page.file}\` · **L${f.fromLine}–L${f.toLine}**（${spanLines} 行 / ~${rawTok} tok，整页 ${lines.length} 行）`);
L.push("");
L.push(`| 项 | 值 |`);
L.push(`|---|---|`);
L.push(`| id / fid | \`${f.id}\` / \`${f.fid || "—"}\` |`);
L.push(`| 层 / 优先级 | ${f.layer ?? "—（子态，继承条目）"} / ${f.prio ?? "—"} |`);
L.push(`| 画布 | ${sizeNote} |`);
L.push(`| 元素 | pin ${f.pins} · notes ${f.notes} |`);
L.push(`| figcaption | ${f.caption || "—"} |`);
L.push("");

L.push(`## 同步点（改这一帧必须一起改的位置）`);
L.push("");
L.push(`**① README §2 条目**${hitEntries.length ? "" : " 🔴 **没有条目引用此帧**"}`);
for (const e of hitEntries) {
  L.push(
    `- \`docs/design/wireframe/README.md:${e.line}\` — 条目 **#${e.num}** · 层 ${e.layer} · ${e.prio} · 锚点 ${e.anchors.map((a) => `\`${a}\``).join(" ")}`,
  );
}
L.push("");
if (f.isStandardWidth && f.isCustomHeight) {
  L.push(`**② 画布台账 §6.2**`);
  L.push(
    ledItem
      ? `- 已登记 \`${ledItem.height}\` ${ledItem.height === f.inlineHeight ? "✅ 与实测一致" : `🔴 **与实测 ${f.inlineHeight} 不符**`}`
      : `- 🔴 **未登记**（实测加高 ${f.inlineHeight}）⇒ 跑门禁会 FAIL \`C5\``,
  );
} else if (!f.isStandardWidth && f.inlineHeight !== null) {
  L.push(`**② 自由画布台账 §6.2**`);
  L.push(
    ledFree
      ? `- 已登记 \`${ledFree.width}×${ledFree.height}\` ${ledFree.width === f.width && ledFree.height === f.inlineHeight ? "✅" : `🔴 **与实测 ${f.width}×${f.inlineHeight} 不符**`}`
      : `- 🔴 **未登记**（实测 ${f.width}×${f.inlineHeight}）⇒ 跑门禁会 FAIL \`C5-d\``,
  );
} else {
  L.push(`**② 画布台账 §6.2**`);
  L.push(`- 标准档画布，无需登记 ✅`);
}
L.push("");
L.push(`**③ index.html 锚点**`);
L.push(
  indexHits.length
    ? indexHits.map((h) => `- \`index.html:${h.n}\``).join("\n")
    : `- （无 \`#${f.id}\` 链接）`,
);
L.push("");
L.push(`**④ 其他文档引用**`);
L.push(
  otherRefs.length
    ? otherRefs.map((r) => `- \`${r.file}:${r.line}\` — ${r.text}`).join("\n")
    : `- （无）`,
);
L.push("");

if (!args.includes("--brief")) {
  L.push(`## 帧原文（\`${page.file}\` L${f.fromLine}–L${f.toLine}）`);
  L.push("");
  L.push("```html");
  L.push(rawLines.join("\n"));
  L.push("```");
  L.push("");
}

const card = L.join("\n");
const cardTok = est(card);

if (args.includes("--print")) {
  process.stdout.write(card + "\n");
  process.exit(0);
}

writeFileSync(DUMP, card, "utf8");

/* ---------- stdout（ASCII only） ---------- */
console.log(
  `frame ${f.id}  page=${f.page}  lines=${f.fromLine}-${f.toLine} (${spanLines} of ${lines.length})  ${f.width}x${f.height}${f.isCustomHeight ? " CUSTOM" : ""}  layer=${f.layer ?? "-"} prio=${f.prio ?? "-"}`,
);
console.log(
  `  card tokens ~${cardTok}  vs whole-file ~${est(page.html)}  (saved ~${Math.max(0, est(page.html) - cardTok)})`,
);
console.log(
  `  README entry: ${hitEntries.length ? hitEntries.map((e) => `README.md:${e.line} #${e.num}`).join(", ") : "NONE"}`,
);
console.log(
  `  ledger: ${ledItem ? `${ledItem.height} OK` : ledFree ? `${ledFree.width}x${ledFree.height}` : f.isCustomHeight || !f.isStandardWidth ? "MISSING" : "n/a"}`,
);
console.log(
  `  index anchor: ${indexHits.length ? indexHits.map((h) => `index.html:${h.n}`).join(", ") : "none"}`,
);
console.log(
  `  other refs: ${otherRefs.length} (${[...new Set(otherRefs.map((r) => r.file))].length} files)`,
);
console.log(`wrote ${rel(DUMP)}`);
