/* 线框静态扫描器 · tools/lib/wireframe-scan.mjs
 * ---------------------------------------------------------------------------
 * 为什么需要它：
 *   全稿的「真值」是 6 个线框页 HTML 本身（figure.frame / .screen 数得出来）。
 *   README / index.html / 账号设计文档 里的「59 个界面条目 ⇒ 65 张线框图」这类
 *   计数句，都只是【被检对象】。以前靠人肉每轮同步 10+ 处手写点，漏一处就漂移
 *   一次（并且每次评审都要重新数一遍），是本项目最大的 token 黑洞。
 *
 * 本文件只做**静态解析**（不启动浏览器、无 playwright 依赖）：把 HTML 与
 * Markdown 里的结构化事实抽成 JSON，供 wireframe-consistency.mjs 做门禁。
 *
 * 解析要点：编辑器（Prettier-like）会把属性拆行、把 `</b>` 断成 `</b\n>`，
 * 因此所有正则一律用 [\s\S] / [^>] 容忍换行与空白，不用 `.`。
 *
 * 用法：
 *   import { scanWireframes, parseEntries, findCountClaims } from "./lib/wireframe-scan.mjs";
 *   命令行直跑可看真值快照：node tools/lib/wireframe-scan.mjs
 * ---------------------------------------------------------------------------
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
/** docs/design/wireframe */
export const WIREFRAME_DIR = resolve(HERE, "..", "..");
/** docs */
export const DOCS_DIR = resolve(WIREFRAME_DIR, "..", "..");

/* ---------- 画布默认尺寸（与 wireframe.css 的 .screen--* 一一对应） ----------
   注意：键 = 「剥离了 screen-- 前缀」的短名，与 parsePage() 里 frame.variant 的取值一致
   （frame.variant 取的是 `screen--desk` 里的 `desk`）。
   CSS 真值见 wireframe.css 的 .screen--desk / .screen--win / … */
export const DEFAULT_HEIGHTS = {
  desk: 500,
  win: 440,
  panel: 470,
  "panel-s": 300,
  mob: 620,
  "mob-s": 320,
};

/** 变体短名 → 标准宽度 */
export const WIDTH_OF_VARIANT = {
  desk: 830,
  win: 760,
  panel: 430,
  "panel-s": 430,
  mob: 330,
  "mob-s": 330,
};

/** 标准宽度 → 该宽度下的全部标准高度（430 / 330 各有两个档） */
export const STD_HEIGHTS_BY_WIDTH = {
  830: [500],
  760: [440],
  430: [470, 300],
  330: [620, 320],
};

/** 标准宽度集合；宽度不在此列的 = 自由画布（组件级 / 子状态，例：W1-05a 的 392×236） */
export const STANDARD_WIDTHS = new Set([830, 760, 430, 330]);

/* ---------- 6 个线框页（顺序 = 端顺序） ---------- */
export const PAGES = [
  { key: "W1", file: "w1-控制端-连接与额度.html" },
  { key: "W2", file: "w2-被控端.html" },
  { key: "W3", file: "w3-账号与设备管理.html" },
  { key: "W4", file: "w4-计费与个人中心.html" },
  { key: "W5", file: "w5-合规实名与运营台.html" },
  { key: "W6", file: "w6-移动端手持.html" },
];

/** 帧编号规范：w1-01 / w4-10a / w1-06b */
export const FRAME_ID_RE = /^w[1-6]-[0-9]{2}[a-z]?$/;
export const LAYER_CHARS = "①②③④";

/* ---------- 文本工具 ---------- */
const ENT = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

export const stripTags = (s) => s.replace(/<[^>]*>/g, " ");
export const unescapeEnt = (s) =>
  s.replace(/&[a-z#0-9]+;/gi, (m) => ENT[m] ?? " ");
export const norm = (s) => s.replace(/\s+/g, " ").trim();
/** HTML 片段 → 可见纯文本 */
export const textOf = (s) => norm(unescapeEnt(stripTags(s)));
/** 字符偏移 → 1-based 行号 */
export const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

/* ---------- 帧解析 ---------- */
const FIG_RE = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/g;
const CAPTION_RE = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/;
// ⚠️ 编辑器会把 `</span>` 断成 `</span\n>` ⇒ 必须写成 <\/span\s*>
const FID_RE =
  /<span\b[^>]*class\s*=\s*"[^"]*\bfid\b[^"]*"[^>]*>([\s\S]*?)<\/span\s*>/;
const NOTES_RE =
  /<ul\b[^>]*class\s*=\s*"[^"]*\bnotes\b[^"]*"[\s\S]*?<\/ul\s*>/g;
const STRIPE_RE =
  /<div\b[^>]*class\s*=\s*"[^"]*\bstripe\b[^"]*"[\s\S]*?<\/div\s*>/g;
/* 两种画布写法都要吃下：
 *   ① 标准变体 `<div class="screen screen--desk" style="height: 740px">`
 *   ② 自由画布 `<div class="screen" style="width: 830px; height: 346px">`
 *      （W1-04 组件规格 / W1-05a 子状态 / W4-10a 支付四态 都用这一种） */
const SCREEN_TAG_RE = /<div\b([^>]*\bclass\s*=\s*"[^"]*\bscreen\b[^"]*"[^>]*)>/;

/**
 * 帧的「界面可见文案」= figure 块 去掉 figcaption / notes / 禁放区斜纹块。
 * 🔴 禁放区（`此处严禁出现：余额…`）是**反面示例**，不是界面文案，必须排除，
 *    否则被控端红线检查会被自己的标注刷成 13 条假阳性。
 */
function visibleTextOf(block) {
  const t = block
    .replace(/<figcaption\b[\s\S]*?<\/figcaption>/g, " ")
    .replace(NOTES_RE, " ")
    .replace(STRIPE_RE, " ");
  return textOf(t);
}

/** 解析单个 HTML 页 → 帧数组 + 全量 id 集合 */
export function parsePage(html, pageKey) {
  const frames = [];
  const allIds = [...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1]);

  for (const m of html.matchAll(FIG_RE)) {
    const attrs = m[1];
    const classM = /class\s*=\s*"([^"]*)"/.exec(attrs);
    if (!classM || !/\bframe\b/.test(classM[1])) continue;

    const idM = /id\s*=\s*"([^"]+)"/.exec(attrs);
    const block = m[2];
    const capM = CAPTION_RE.exec(block);
    const caption = capM ? textOf(capM[1]) : "";
    const fidM = FID_RE.exec(block);
    const fid = fidM ? norm(fidM[1]) : "";

    const layerM = /层\s*([①②③④])/.exec(caption);
    const prioM = /P([0-3])(?![0-9])/.exec(caption);

    const screenM = SCREEN_TAG_RE.exec(block);
    const tag = screenM ? screenM[1] : "";
    const vm = /screen--([a-z0-9-]+)/.exec(tag);
    const variant = vm ? vm[1] : null;
    const hm = /(?<![\w-])height\s*:\s*(\d+(?:\.\d+)?)\s*px/.exec(tag);
    const inlineHeight = hm ? Number(hm[1]) : null;
    const wm = /(?<![\w-])width\s*:\s*(\d+(?:\.\d+)?)\s*px/.exec(tag);
    const width = wm
      ? Number(wm[1])
      : variant
        ? (WIDTH_OF_VARIANT[variant] ?? null)
        : null;

    const stdHeights = STD_HEIGHTS_BY_WIDTH[width] ?? null;
    const height = inlineHeight ?? (variant ? DEFAULT_HEIGHTS[variant] : null);
    const isStandardWidth = STANDARD_WIDTHS.has(width);
    // 「非默认高度」= 标准宽度帧，但 height 落不进该宽度的标准档
    const isCustomHeight =
      inlineHeight !== null &&
      stdHeights !== null &&
      !stdHeights.includes(inlineHeight);

    const pins = (
      block.match(/<span\b[^>]*class\s*=\s*"[^"]*\bpin\b[^"]*"/g) || []
    ).length;
    const notesM = block.match(NOTES_RE);
    const notes = notesM ? (notesM[0].match(/<li\b/g) || []).length : 0;
    const id = idM ? idM[1] : null;

    frames.push({
      page: pageKey,
      id,
      // 子状态帧（w1-05a / w4-10d）自带 figcaption 只写「态 A · …」，
      // 层与优先级由 README 条目继承 ⇒ 允许为空，但必须带字母后缀。
      isSubState: !!id && /-[0-9]{2}[a-z]$/.test(id),
      fid,
      layer: layerM ? layerM[1] : null,
      prio: prioM ? `P${prioM[1]}` : null,
      variant,
      width,
      isStandardWidth,
      stdHeights,
      inlineHeight,
      height,
      isCustomHeight,
      pins,
      notes,
      caption,
      plain: visibleTextOf(block),
    });
  }
  return { frames, allIds };
}

/** 全量扫描 6 页（readDir 由 PAGES 固定，不 glob，避免误收临时文件） */
export function scanWireframes(dir = WIREFRAME_DIR) {
  const pages = [];
  for (const p of PAGES) {
    const full = join(dir, p.file);
    if (!existsSync(full)) {
      pages.push({ ...p, missing: true, frames: [], allIds: [] });
      continue;
    }
    const html = readFileSync(full, "utf8");
    const { frames, allIds } = parsePage(html, p.key);
    pages.push({ ...p, missing: false, html, frames, allIds });
  }
  const frames = pages.flatMap((p) => p.frames);
  const perPage = Object.fromEntries(
    pages.map((p) => [p.key, p.frames.length]),
  );
  const layerDist = [1, 2, 3].map(
    (n) => frames.filter((f) => f.layer === LAYER_CHARS[n - 1]).length,
  );
  const prioDist = ["P0", "P1", "P2", "P3"].map(
    (p) => frames.filter((f) => f.prio === p).length,
  );
  return {
    dir,
    pages,
    frames,
    perPage,
    total: frames.length,
    frameIds: new Set(frames.map((f) => f.id)),
    layerDist,
    prioDist,
    customHeights: frames.filter((f) => f.isCustomHeight),
  };
}

/* ---------- README §2.x 条目表解析 ---------- */
/** 表头：| # | 界面 | 层 | 优先级 | 归属文档 | 帧 | */
const ENTRY_ROW_RE = /^\|\s*(\d+[a-z]?)\s*\|/;
const ANCHOR_RE = /\(([^()#\s]+)#(w[1-6]-[0-9]{2}[a-z]?)\)/g;

/**
 * 解析 README §2.1 ~ §2.7 的「全量 UI 清单」条目行。
 * 返回 [{ num, layer, prio, anchors:[...], line }]
 */
export function parseEntries(md) {
  const out = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = ENTRY_ROW_RE.exec(line);
    if (!m) continue;
    const cells = line.split("|").map((c) => norm(c));
    // cells[0]="" cells[1]=num cells[2]=界面 cells[3]=层 cells[4]=优先级 ... cells[n-1]=""
    const layerCell = cells[3] ?? "";
    const prioCell = cells[4] ?? "";
    const layerM = /([①②③④])/.exec(layerCell);
    const prioM = /(P[0-3])\b/.exec(prioCell);
    if (!layerM || !prioM) continue;
    const anchors = [...line.matchAll(ANCHOR_RE)].map((a) => a[2]);
    out.push({
      num: m[1],
      layer: layerM[1],
      prio: prioM[1],
      anchors,
      line: i + 1,
    });
  }
  return out;
}

/* ---------- README §1 层汇总表解析（①②③④ 数量） ---------- */
export function parseLayerTable(md) {
  const rows = {};
  for (const line of md.split("\n")) {
    const m = /^\|\s*\*\*([①②③④])[^|]*\|/.exec(line);
    if (!m) continue;
    const cells = line.split("|");
    const last = norm(cells[cells.length - 2] ?? "");
    const n = /^(\d+)/.exec(last);
    if (n) rows[m[1]] = Number(n[1]);
  }
  return rows;
}

/* ---------- README §6.2「画布高度台账」解析 ---------- */
/**
 * 台账格式（§6.2 内，逐行匹配，避免 `[^`\w]` 跨行误配）：
 *   | W1 控制端 | W1-03 `470` · W1-04 `346` · … |
 *   | 自由画布（非标准宽度） | W1-05a 392×236 · … |
 * 返回 { line, items:[{id,height}], free:[{id,width,height}] }；找不到返回 null。
 * 回退：没有 §6.2 时退回旧版「| 画布 | …」单行。
 */
export function parseCanvasLedger(md) {
  const lines = md.split("\n");
  const items = [];
  const free = [];
  const collect = (line) => {
    for (const m of line.matchAll(
      /(W[1-6]-[0-9]{2}[a-z]?)[^`\w]{0,8}`(\d+)`/g,
    )) {
      items.push({ id: m[1].toLowerCase(), height: Number(m[2]) });
    }
    for (const m of line.matchAll(
      /(W[1-6]-[0-9]{2}[a-z]?)[^\w]{0,6}(\d+)\s*×\s*(\d+)/gi,
    )) {
      free.push({
        id: m[1].toLowerCase(),
        width: Number(m[2]),
        height: Number(m[3]),
      });
    }
  };

  const start = lines.findIndex((l) => /^#{2,4}\s*6\.2(?![0-9.])/.test(l));
  if (start !== -1) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{1,4}\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    for (let i = start + 1; i < end; i++) collect(lines[i]);
    return {
      line: start + 1,
      text: lines.slice(start, end).join("\n"),
      items,
      free,
    };
  }

  for (let i = 0; i < lines.length; i++) {
    if (!/^\|\s*画布\s*\|/.test(lines[i])) continue;
    collect(lines[i]);
    return { line: i + 1, text: lines[i], items, free };
  }
  return null;
}

/* ---------- 计数句解析 ---------- */
/**
 * 找「N 个界面条目 ⇒ M 张线框图」类计数句。
 * 同时给出该行前后的 marker（📊 当前值 / ⏱ 历史值），用于判定「这处该不该改」。
 */
export function findCountClaims(text) {
  const lines = text.split("\n");
  const out = [];

  const push = (idx, rec) => {
    const line = lineOf(text, idx);
    const ctx = [
      lines[line - 2] ?? "",
      lines[line - 1] ?? "",
      lines[line] ?? "",
    ].join("\n");
    const marker = ctx.includes("📊")
      ? "current"
      : ctx.includes("⏱")
        ? "history"
        : null;
    out.push({ ...rec, line, marker, lineText: lines[line - 1] ?? "" });
  };

  // 形式一：N 个界面条目 ⇒ M 张线框图（+ 层分布 / 优先级）
  for (const m of text.matchAll(/(\d+)\s*个界面条目\s*⇒\s*(\d+)\s*张线框图/g)) {
    const line = lineOf(text, m.index);
    const win = [
      lines[line - 1] ?? "",
      lines[line] ?? "",
      lines[line + 1] ?? "",
    ].join(" ");
    const lay = /①\s*(\d+)\s*\/\s*②\s*(\d+)\s*\/\s*③\s*(\d+)/.exec(win);
    const pri = /P0\s*(\d+)\s*\/\s*P1\s*(\d+)/.exec(win);
    push(m.index, {
      kind: "full",
      entries: Number(m[1]),
      frames: Number(m[2]),
      layers: lay ? [Number(lay[1]), Number(lay[2]), Number(lay[3])] : null,
      prios: pri ? [Number(pri[1]), Number(pri[2])] : null,
    });
  }

  // 形式二：计数 **A ⇒ B** 条目 / **C ⇒ D** 帧（跨文档回写块，B / D 是当时的新值）
  for (const m of text.matchAll(
    /计数\s*\*\*\s*(\d+)\s*⇒\s*(\d+)\s*\*\*\s*条目\s*\/\s*\*\*\s*(\d+)\s*⇒\s*(\d+)\s*\*\*\s*帧/g,
  )) {
    const line = lineOf(text, m.index);
    const win = [lines[line - 1] ?? "", lines[line] ?? ""].join(" ");
    const lay = /①\s*(\d+)\s*⇒\s*(\d+)/.exec(win);
    push(m.index, {
      kind: "pair",
      entries: Number(m[2]),
      frames: Number(m[4]),
      layersTo: lay ? [Number(lay[2])] : null,
      prios: null,
    });
  }

  return out.sort((a, b) => a.line - b.line);
}

/* ---------- 单行「L###」行号引用扫描 ---------- */
export function findLineRefs(text) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/(?<![A-Za-z0-9_])L\d{3}(?![0-9])/g)) {
      hits.push({ line: i + 1, ref: m[0], text: norm(line).slice(0, 120) });
    }
  });
  return hits;
}

/* ---------- 命令行直跑：打印真值快照 ---------- */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const s = scanWireframes();
  console.log(`帧总数 = ${s.total}`);
  console.log(
    `每页：${Object.entries(s.perPage)
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ")}`,
  );
  console.log(
    `层分布（帧级）= ① ${s.layerDist[0]} / ② ${s.layerDist[1]} / ③ ${s.layerDist[2]}`,
  );
  console.log(`优先级（帧级）= P0 ${s.prioDist[0]} / P1 ${s.prioDist[1]}`);
  console.log(`非默认画布高度 ${s.customHeights.length} 帧：`);
  for (const f of s.customHeights) {
    console.log(
      `  ${f.id.toUpperCase()}  ${f.width}×${f.height}  (标准档 ${JSON.stringify(f.stdHeights)})`,
    );
  }
  console.log(`\n全部 ${s.total} 帧画布清单：`);
  for (const f of s.frames) {
    console.log(
      [
        `${f.id.padEnd(8)}`,
        `fid=${(f.fid || "-").padEnd(7)}`,
        `层=${f.layer ?? "-"}`,
        `${f.prio ?? "-"}`,
        `${f.variant ?? "(free)"}`.padEnd(14),
        `${f.width ?? "?"}x${f.height ?? "?"}`.padEnd(9),
        f.isCustomHeight ? "加高" : "",
        f.isSubState ? "子态" : "",
        f.layer ? "" : "无自带层标",
      ]
        .filter(Boolean)
        .join("  "),
    );
  }
  const md = readFileSync(join(WIREFRAME_DIR, "README.md"), "utf8");
  const es = parseEntries(md);
  console.log(
    `\nREADME 条目 = ${es.length} · 锚点合计 = ${es.reduce((a, e) => a + e.anchors.length, 0)}`,
  );
  console.log(`README 层表 = ${JSON.stringify(parseLayerTable(md))}`);
  const led = parseCanvasLedger(md);
  console.log(
    `README 画布台账 L${led?.line}：登记加高 ${led?.items.length ?? 0} 项 · 自由画布 ${led?.free.length ?? 0} 项`,
  );
  for (const c of findCountClaims(md)) {
    console.log(
      `  L${c.line} [${c.marker ?? "未标记"}] ${c.entries} ⇒ ${c.frames} ${JSON.stringify(c.layers)}`,
    );
  }
}
