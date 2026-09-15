#!/usr/bin/env node
/**
 * wireframe-consistency.mjs —— 文档一致性门禁（防「漂移」）
 *
 * 设计原则
 *   1. 真值只有一处：7 个线框页 HTML（帧结构 / 画布尺寸 / 层 / 优先级）。文档里的计数句、
 *      层汇总表、画布台账都是**被检对象**，不是真值。
 *   2. 只对「当前值」硬门禁：带 📊 标记的计数句必须与真值逐字相符；
 *      带 ⏱ 标记的历史值只登记不判定；未标记的计数句报 WARN（提示该补标记）。
 *   3. stdout 一律 ASCII：终端是 PS 5.1 / GBK，中文会变乱码；细节全部落
 *      tools/consistency-report.json（UTF-8 无 BOM），用编辑器读。
 *   4. 任何 FAIL ⇒ EXIT=1 ⇒ 不许提交。
 *
 * 用法
 *   node tools/wireframe-consistency.mjs            # 门禁
 *   node tools/wireframe-consistency.mjs --report   # 额外把画布台账草稿打出来（ASCII）
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WIREFRAME_DIR,
  DOCS_DIR,
  PAGES,
  scanWireframes,
  parseEntries,
  parseLayerTable,
  parseLayerTableRows,
  parseCanvasLedger,
  findCountClaims,
  findLineRefs,
  STANDARD_WIDTHS,
  norm,
  lineOf,
} from "./lib/wireframe-scan.mjs";
import { impactIsStale } from "./lib/impact-scan.mjs";

const README = join(WIREFRAME_DIR, "README.md");
const INDEX = join(WIREFRAME_DIR, "index.html");
const REPORT = join(WIREFRAME_DIR, "tools", "consistency-report.json");

const results = [];
const ok = (id, where, msg) => results.push({ id, level: "PASS", where, msg });
const fail = (id, where, msg, expected, actual) =>
  results.push({ id, level: "FAIL", where, msg, expected, actual });
const warn = (id, where, msg, expected, actual) =>
  results.push({ id, level: "WARN", where, msg, expected, actual });

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const rel = (p) =>
  relative(join(WIREFRAME_DIR, "..", "..", ".."), p).replace(/\\/g, "/");

/* ============================================================
   ① 真值：扫 7 个线框页
   ============================================================ */
const scan = scanWireframes();
/** 6 个页面的全部 HTML id（含 `<h3 id="w1-05">` 这类分组锚点） */
const allAnchorIds = new Set(scan.pages.flatMap((p) => p.allIds ?? []));
const truth = {
  frames: scan.total,
  perPage: scan.perPage,
  frameLayer: scan.layerDist,
  framePrio: scan.prioDist,
  customHeights: scan.customHeights.length,
};

const readme = read(README);
const entries = parseEntries(readme);
const anchorsTotal = entries.reduce((a, e) => a + e.anchors.length, 0);
const entryLayerCount = { "①": 0, "②": 0, "③": 0, "④": 0 };
const entryPrioCount = { P0: 0, P1: 0, P2: 0 };
for (const e of entries) {
  if (entryLayerCount[e.layer] !== undefined) entryLayerCount[e.layer] += 1;
  if (entryPrioCount[e.prio] !== undefined) entryPrioCount[e.prio] += 1;
}
truth.entries = entries.length;
truth.anchors = anchorsTotal;
truth.entryLayer = entryLayerCount;
truth.entryPrio = entryPrioCount;
// README §6.2 台账合计句的三个分量（自由画布 = 非标准宽度）
truth.freeFrames = scan.frames.filter(
  (f) => f.width !== null && !STANDARD_WIDTHS.has(f.width),
).length;
truth.ledger = {
  custom: truth.customHeights,
  free: truth.freeFrames,
  standard: truth.frames - truth.customHeights - truth.freeFrames,
};

/* ============================================================
   ② 帧自洽：id 唯一 / 前缀 / fid 与 id 一致 / 子态有父帧 / 锚点可达
   ============================================================ */
const seen = new Map();
for (const f of scan.frames) {
  if (!f.id) {
    fail("C10-a", `${f.page}`, "frame has no id", "(id)", null);
    continue;
  }
  if (seen.has(f.id)) fail("C10-b", `${f.page} ${f.id}`, "duplicate frame id");
  seen.set(f.id, f);

  if (!f.id.startsWith(`${f.page.toLowerCase()}-`)) {
    fail("C10-c", `${f.page} ${f.id}`, "frame id prefix != page key");
  }
  if (f.fid && f.fid.toUpperCase() !== f.id.toUpperCase()) {
    fail(
      "C10-d",
      `${f.page} ${f.id}`,
      "figcaption .fid != figure id",
      f.id.toUpperCase(),
      f.fid,
    );
  }
  if (f.isSubState) {
    const parent = f.id.replace(/[a-z]$/, "");
    // 父级可以是帧（w1-06b 的父是 w1-06），也可以是分组标题（w1-05a 的父是 `<h3 id="w1-05">`），
    // 所以查「页面里的全部 id」而不是「帧 id」。
    if (!allAnchorIds.has(parent)) {
      fail(
        "C9",
        `${f.page} ${f.id}`,
        "sub-state frame has no parent anchor",
        parent,
        null,
      );
    }
  }
}

for (const e of entries) {
  for (const a of e.anchors) {
    if (!allAnchorIds.has(a)) {
      fail(
        "C3-b",
        `README.md:${e.line}`,
        `entry #${e.num} anchor not found in any page`,
        a,
        null,
      );
    }
  }
}

/* ============================================================
   ③ 计数句：📊 硬门禁 / ⏱ 免检 / 未标记 WARN
   ============================================================ */
const countDocs = [
  { path: README, label: "README.md" },
  { path: INDEX, label: "index.html" },
  {
    path: join(DOCS_DIR, "账号与管理系统设计.md"),
    label: "账号与管理系统设计.md",
  },
  { path: join(DOCS_DIR, "商业化与计费设计.md"), label: "商业化与计费设计.md" },
  // 🔴 归档也要扫：归档里只应出现 ⏱ 历史值，一旦有人写 📊 当前值就会被当场拦下。
  {
    path: join(DOCS_DIR, "archive", "wireframe-README-评审历史轮次.md"),
    label: "archive/wireframe-README-评审历史轮次.md",
  },
];

const claims = [];
for (const d of countDocs) {
  const text = read(d.path);
  if (text === null) continue;
  for (const c of findCountClaims(text))
    claims.push({
      ...c,
      // implicit = 「结构性数字」（标题里的总数、台账合计句），语义上默认就是当前值
      marker: c.marker ?? c.implicit ?? null,
      file: d.label,
      path: d.path,
    });
}

const checkPair = (file, line, marker, label, expected, actual) => {
  if (expected === null || expected === undefined) return;
  if (expected === actual) {
    ok(
      "C2",
      `${file}:${line}`,
      `${label} = ${actual} (${marker ?? "unmarked"})`,
    );
    return;
  }
  if (marker === "current") {
    // 📊 = 当前值 ⇒ 必须与 7 个线框页 HTML 实测一致（硬门禁）
    fail("C2", `${file}:${line}`, `${label} current-marker`, expected, actual);
  } else if (marker === "history") {
    // ⏱ = 历史值 ⇒ 本来就不该等于当前值，差异是「设计如此」，只留痕不报警
    ok(
      "C2",
      `${file}:${line}`,
      `${label} history kept at ${actual} (current ${expected}) — by design`,
    );
  } else {
    // 未标记 ⇒ 无法判断这句该不该跟着改（本轮新计数句一律必须打 📊 或 ⏱）
    warn("C2", `${file}:${line}`, `${label} unmarked`, expected, actual);
  }
};

for (const c of claims) {
  const isCurrent = c.marker === "current";
  if (c.marker === null) {
    warn(
      "C2-marker",
      `${c.file}:${c.line}`,
      "count sentence has no 📊/⏱ marker",
      "📊 or ⏱",
      null,
    );
  }
  if (c.kind === "full") {
    checkPair(c.file, c.line, c.marker, "entries", c.entries, truth.entries);
    checkPair(c.file, c.line, c.marker, "frames", c.frames, truth.frames);
    if (c.layers) {
      checkPair(
        c.file,
        c.line,
        c.marker,
        "layer-1",
        c.layers[0],
        truth.entryLayer["①"],
      );
      checkPair(
        c.file,
        c.line,
        c.marker,
        "layer-2",
        c.layers[1],
        truth.entryLayer["②"],
      );
      checkPair(
        c.file,
        c.line,
        c.marker,
        "layer-3",
        c.layers[2],
        truth.entryLayer["③"],
      );
    }
    if (c.prios) {
      checkPair(c.file, c.line, c.marker, "P0", c.prios[0], truth.entryPrio.P0);
      checkPair(c.file, c.line, c.marker, "P1", c.prios[1], truth.entryPrio.P1);
    }
  } else if (c.kind === "pair") {
    // 形如「计数 **55 ⇒ 59** 条目 / **58 ⇒ 65** 帧」：只判定箭头右侧（目标值）
    checkPair(
      c.file,
      c.line,
      c.marker,
      "entries-target",
      c.entries,
      truth.entries,
    );
    checkPair(
      c.file,
      c.line,
      c.marker,
      "frames-target",
      c.frames,
      truth.frames,
    );
    if (c.layersTo) {
      checkPair(
        c.file,
        c.line,
        c.marker,
        "layer-1-target",
        c.layersTo[0],
        truth.entryLayer["①"],
      );
    }
  } else if (c.kind === "title") {
    // 「## 1. …一共有 **59 个需要 UI 的位置**」——此前完全无门禁
    checkPair(
      c.file,
      c.line,
      c.marker,
      "entries-title",
      c.entries,
      truth.entries,
    );
  } else if (c.kind === "ledger-total") {
    // 「**合计 65 帧** = 44 帧加高 + 4 帧自由画布 + 17 帧标准默认」——此前完全无门禁
    checkPair(c.file, c.line, c.marker, "frames-total", c.frames, truth.frames);
    if (c.ledger) {
      checkPair(
        c.file,
        c.line,
        c.marker,
        "ledger-custom",
        c.ledger.custom,
        truth.ledger.custom,
      );
      checkPair(
        c.file,
        c.line,
        c.marker,
        "ledger-free",
        c.ledger.free,
        truth.ledger.free,
      );
      checkPair(
        c.file,
        c.line,
        c.marker,
        "ledger-standard",
        c.ledger.standard,
        truth.ledger.standard,
      );
    }
  } else if (c.kind === "ledger-inline") {
    // README §6「画布」行：「44 帧加高 + 4 帧自由画布」——此前完全无门禁
    checkPair(
      c.file,
      c.line,
      c.marker,
      "ledger-custom-inline",
      c.ledger.custom,
      truth.ledger.custom,
    );
    checkPair(
      c.file,
      c.line,
      c.marker,
      "ledger-free-inline",
      c.ledger.free,
      truth.ledger.free,
    );
  }
  if (isCurrent)
    ok("C2-seen", `${c.file}:${c.line}`, "current-marker claim found");
}

// 防「门禁自己失效」：一处 📊 当前值都没有 ⇒ C2 其实什么都没查（PASS 是假象）。
// 典型诱因：归档 / 搬移把带标记的计数句整段切走，或 findCountClaims 失配。
if (claims.filter((c) => c.marker === "current").length === 0) {
  fail("C2-0", "docs/**", "no 📊 current-value claim found", ">=1", 0);
}

/* ============================================================
   ④ README 条目表 / 层汇总表
   ============================================================ */
const layerTable = parseLayerTable(readme);
for (const k of ["①", "②", "③"]) {
  if (layerTable[k] !== truth.entryLayer[k]) {
    fail(
      "C4",
      "README.md §1 layer table",
      `layer ${k} mismatch`,
      truth.entryLayer[k],
      layerTable[k],
    );
  } else ok("C4", "README.md §1 layer table", `layer ${k} = ${layerTable[k]}`);
}
if (layerTable["④"] !== 7) {
  warn(
    "C4-b",
    "README.md §1 layer table",
    "layer ④ (explicitly-not-doing) != 7",
    7,
    layerTable["④"],
  );
}

/* ============================================================
   ⑤ 画布台账（README §6.2）
   ============================================================ */
const ledger = parseCanvasLedger(readme) ?? {
  line: null,
  text: "",
  items: [],
  free: [],
};
if (ledger.line === null) {
  fail(
    "C5-0",
    "README.md",
    "canvas ledger section (6.2) not found",
    "### 6.2",
    null,
  );
}
const actualCustom = new Map();
for (const f of scan.customHeights)
  actualCustom.set(f.id.toLowerCase(), f.inlineHeight);
const declared = new Map();
for (const it of ledger.items) declared.set(it.id.toLowerCase(), it.height);

const missing = [...actualCustom.keys()].filter((k) => !declared.has(k));
const extra = [...declared.keys()].filter((k) => !actualCustom.has(k));
const wrong = [...actualCustom.keys()]
  .filter((k) => declared.has(k) && declared.get(k) !== actualCustom.get(k))
  .map((k) => ({
    id: k,
    declared: declared.get(k),
    actual: actualCustom.get(k),
  }));

const whereLedger = `README.md:${ledger.line ?? "?"} canvas ledger`;
if (missing.length) {
  fail(
    "C5",
    whereLedger,
    `missing ${missing.length} frames`,
    "all custom-height frames",
    missing,
  );
} else {
  ok("C5", whereLedger, `covers all ${actualCustom.size} custom-height frames`);
}
if (extra.length)
  fail("C5-b", whereLedger, `stale entries ${extra.length}`, "(none)", extra);
if (wrong.length) fail("C5-c", whereLedger, "height mismatch", "(none)", wrong);

/* 自由画布（非标准宽度的组件级 / 子态帧）单独一行，同样必须完整 */
const actualFree = new Map();
for (const f of scan.frames)
  if (!f.isStandardWidth && f.inlineHeight !== null)
    actualFree.set(f.id.toLowerCase(), `${f.width}x${f.inlineHeight}`);
const declaredFree = new Map();
for (const it of ledger.free)
  declaredFree.set(it.id.toLowerCase(), `${it.width}x${it.height}`);
const freeMissing = [...actualFree.keys()].filter((k) => !declaredFree.has(k));
const freeWrong = [...actualFree.keys()]
  .filter(
    (k) => declaredFree.has(k) && declaredFree.get(k) !== actualFree.get(k),
  )
  .map((k) => ({
    id: k,
    declared: declaredFree.get(k),
    actual: actualFree.get(k),
  }));
if (freeMissing.length || freeWrong.length) {
  fail("C5-d", whereLedger, "free-canvas frames missing/mismatch", "(none)", {
    freeMissing,
    freeWrong,
  });
} else {
  ok("C5-d", whereLedger, `free-canvas frames = ${actualFree.size}`);
}

/* ============================================================
   ⑥ 引用校验：禁 L### 行号；§x.y 目标必须存在
   ============================================================ */
const mdFiles = [];
for (const name of readdirSync(DOCS_DIR)) {
  if (name.endsWith(".md")) mdFiles.push(join(DOCS_DIR, name));
}
mdFiles.push(README);
const htmlFiles = [INDEX];
for (const p of PAGES) htmlFiles.push(join(WIREFRAME_DIR, p.file));

/**
 * C6-a 豁免（人写的正文里禁行号，机器产物里行号即价值）：
 *  - docs/OUTLINE.md      = 机器生成目录，行号是它存在的理由；
 *                           漂移风险由 C11（源 md hash 对拍）兜底，不靠人眼。
 *  - docs/archive/**.md   = 归档件，顶栏标注「来源原始行号」是溯源证据。
 */
const LINE_REF_EXEMPT = /(^|[\\/])(OUTLINE\.md|archive[\\/])/;

const allLineRefs = [];
for (const p of [...mdFiles, ...htmlFiles]) {
  if (LINE_REF_EXEMPT.test(p)) continue;
  const t = read(p);
  if (!t) continue;
  for (const h of findLineRefs(t)) allLineRefs.push({ file: rel(p), ...h });
}
if (allLineRefs.length) {
  fail(
    "C6-a",
    `${allLineRefs.length} hits`,
    "L### line-number refs are forbidden",
    0,
    allLineRefs.slice(0, 20),
  );
} else ok("C6-a", "docs/**", "no L### line-number refs");

/** 收集每个文档的标题层级编号（### 3.2 之类） */
const headingNumbers = new Map();
for (const p of mdFiles) {
  const t = read(p);
  const nums = new Set();
  for (const line of t.split("\n")) {
    // 「## 3. 标题」「### 3.2 标题」「#### 2.6.1 …」「## 11.7 [D25] …」
    // 前瞻写成 (?!\d)(?!\.\d)：允许编号后跟「.」句点，只阻止把 1 从 1.1 里截出来
    const m = /^#{1,6}\s*(?:§\s*)?(\d+(?:\.\d+)*)(?!\d)(?!\.\d)/.exec(line);
    if (m) nums.add(m[1]);
  }
  headingNumbers.set(p, nums);
}

const sectionRefs = [];
for (const p of mdFiles) {
  const t = read(p);
  t.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/§\s*(\d+(?:\.\d+)*)(?!\d)(?!\.\d)/g)) {
      sectionRefs.push({ file: rel(p), line: i + 1, ref: m[1] });
    }
  });
}
const anyNumbers = new Set();
for (const s of headingNumbers.values()) for (const n of s) anyNumbers.add(n);
const unresolved = sectionRefs.filter((r) => !anyNumbers.has(r.ref));
if (unresolved.length) {
  fail(
    "C6-b",
    `${unresolved.length} hits`,
    "section ref target not found in any doc",
    "(existing §x.y)",
    unresolved.slice(0, 20),
  );
} else ok("C6-b", "docs/**", `all ${sectionRefs.length} section refs resolve`);

/* ============================================================
   ⑦ 被控端红线：可视文本不得出现计费/金额/推销词
   ============================================================ */
/** 自我否定的说明句（禁放区 / 注释）里允许出现禁用词 */
const NEGATING = /(严禁|不得|禁止|不含|不出现|不属于|不参与|绝无|无任何)/;

/**
 * 只扫**帧内可见文本**（`.notes` / `.stripe` / `figcaption` 已在 visibleTextOf 里剔除）。
 * 不做页面级扫描：帧外大多是「被控端绝不出现额度」这类说明句，扫它们只会产生假阳性。
 */
const redlineHits = [];
const w2 = PAGES.find((p) => p.key === "W2");
let redlineChars = 0;
if (w2) {
  const REDLINE_RE =
    /(余额|充值|会员|套餐|开通|购买|付费|订阅|续费|价格|计费|额度|升级|¥|￥|(?<![一二三四五六七八九十])元(?![气素件]))/g;
  for (const f of scan.frames.filter((x) => x.page === "W2")) {
    const text = f.plain;
    redlineChars += text.length;
    for (const m of text.matchAll(REDLINE_RE)) {
      const ctx = text.slice(Math.max(0, m.index - 30), m.index + 30);
      if (!NEGATING.test(ctx)) {
        redlineHits.push({
          where: `${w2.file} ${f.id}`,
          term: m[0],
          ctx: norm(ctx),
        });
      }
    }
  }
}
if (redlineHits.length) {
  fail(
    "C7",
    "w2-被控端.html",
    `red-line words in visible text: ${redlineHits.length}`,
    0,
    redlineHits.slice(0, 30),
  );
} else if (redlineChars < 500) {
  // 防「扫了个寂寞」：被控端帧可见文本若短得离谱，说明解析坏了，这项检查本身无意义
  fail(
    "C7-0",
    "w2-被控端.html",
    `visible text too short (${redlineChars} chars)`,
    ">=500 chars",
    redlineChars,
  );
} else {
  ok(
    "C7",
    "w2-被控端.html",
    `no red-line words in ${redlineChars} chars of visible text`,
  );
}

/* ============================================================
   ⑨ 跨帧一致性（C13 / C14）—— 第九轮评审沉淀
   ------------------------------------------------------------
   这两类漂移在第九轮之前**没有门禁**，只能靠人眼撞见：
     · C13 扉页声明计数：页内写着「本页 N 个条目 / M 张图」，而 N / M 与真值不符
            （第八轮给 W2 补了 2 帧，扉页却仍写 8 ⇒ 整整一轮无人发现）
     · C14 画布 pin ↔ notes 编号：两者必须互相对应
            （W6-06 有 ①②③④ 四条编号说明，画布上却一个 pin 都没有
              ⇒ 评审者照着编号找不到落点）
   两轴都不依赖文字措辞，因此对格式化器免疫（只匹配标签与数字）。
   ============================================================ */
const frontClaimOf = (html) => {
  const m = /本页\s*<b\s*>\s*(\d+)\s*个条目\s*\/\s*(\d+)\s*张图\s*<\/b\s*>/.exec(
    html ?? "",
  );
  return m ? { entries: Number(m[1]), figures: Number(m[2]) } : null;
};

/** README 里每个条目归属的页（一个条目可带多个锚点，按条目去重） */
const entriesPerPage = new Map();
for (const e of entries) {
  const keys = new Set(
    e.anchors
      .map((a) => String(a).split("-")[0].toUpperCase())
      .filter((k) => /^W[1-7]$/.test(k)),
  );
  for (const k of keys) entriesPerPage.set(k, (entriesPerPage.get(k) ?? 0) + 1);
}

/** 按 figure 切块（C14 需要逐帧看 pin / notes） */
const figureHtml = new Map();
for (const p of scan.pages) {
  const html = p.html ?? read(join(WIREFRAME_DIR, p.file));
  if (!html) continue;
  const re = /<figure[^>]*\bid="([^"]+)"[^>]*>/g;
  const marks = [];
  let m;
  while ((m = re.exec(html))) marks.push({ id: m[1], start: m.index });
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : html.length;
    if (!figureHtml.has(mk.id)) figureHtml.set(mk.id, html.slice(mk.start, end));
  });
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
const toNoteNo = (s) => {
  const i = CIRCLED.indexOf(s);
  return i >= 0 ? i + 1 : Number(s);
};

let c13Checked = 0;
let c14Checked = 0;
/** 编号 notes 无对应 pin 的帧（历史习惯：编号当列表序号用）⇒ 只汇总提醒，不逐帧刷屏 */
const c14Orphans = [];
for (const p of scan.pages) {
  const html = p.html ?? read(join(WIREFRAME_DIR, p.file));
  if (!html) continue;

  /* --- C13 扉页声明计数 vs 真值 --- */
  const claim = frontClaimOf(html);
  if (claim) {
    c13Checked += 1;
    const realFig = truth.perPage[p.key];
    const realEnt = entriesPerPage.get(p.key);
    if (realFig === undefined || realEnt === undefined) {
      warn(
        "C13",
        `${p.file} front claim`,
        "cannot resolve truth (entries/frames)",
        "resolvable",
        claim,
      );
    } else if (claim.figures !== realFig || claim.entries !== realEnt) {
      fail(
        "C13",
        `${p.file} front claim`,
        `front-page count drifted (entries ${claim.entries} vs ${realEnt}, figures ${claim.figures} vs ${realFig})`,
        `${realEnt} entries / ${realFig} figures`,
        `${claim.entries} entries / ${claim.figures} figures`,
      );
    } else {
      ok(
        "C13",
        `${p.file} front claim`,
        `${realEnt} entries / ${realFig} figures (in sync)`,
      );
    }
  }

  /* --- C14 pin 编号 ↔ notes 编号 --- */
  for (const f of scan.frames.filter((x) => x.page === p.key)) {
    const block = figureHtml.get(f.id);
    if (!block) continue;
    const pins = new Set(
      [...block.matchAll(/<span\s+class="pin[^"]*"[^>]*>\s*(\d+)\s*<\/span\s*>/g)].map(
        (m) => Number(m[1]),
      ),
    );
    const noteNos = new Set(
      [
        ...block.matchAll(
          /<li[^>]*>\s*<b\s*>\s*(①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩|\d+)\s*<\/b\s*>/g,
        ),
      ].map((m) => toNoteNo(m[1])),
    );
    if (pins.size === 0 && noteNos.size === 0) continue;
    c14Checked += 1;
    const dangling = [...pins].filter((n) => !noteNos.has(n));
    const orphan = [...noteNos].filter((n) => !pins.has(n));
    if (dangling.length) {
      fail(
        "C14",
        `${p.file} ${f.id}`,
        `canvas pin number(s) with no matching numbered note: ${dangling.join(",")}`,
        "every pin number appears in notes",
        { pins: [...pins].sort(), notes: [...noteNos].sort() },
      );
    } else if (orphan.length) {
      c14Orphans.push({ where: `${p.file} ${f.id}`, orphan });
    }
  }
}
if (c14Orphans.length) {
  warn(
    "C14-b",
    "wireframe pages",
    `${c14Orphans.length} frame(s) have numbered notes with no pin on canvas (legacy habit: numbers used as list markers)`,
    "0 frames",
    c14Orphans.slice(0, 6),
  );
}
if (c13Checked === 0) {
  warn("C13", "all wireframe pages", "no front-page count claim found", ">=1", 0);
}

/* ============================================================
   ⑩ 术语与危险动作（C16 / C17）—— 第十轮（[D27]）沉淀
   ------------------------------------------------------------
   两条「不许有第二个名字 / 第二种做法」的强制约定，落点见 README §6.1 / §6.3：
     · C16 术语词表：同一概念全稿一名一词（UI 面禁止词见下）——
           否则用户无法确认「是不是同一件事」（§11.11.2 R20）
     · C17 危险动作台账：破坏性 / 不可逆动作必须
           ① 权重 >= 常规动作（.btn.solid，禁止 .btn.sm 承载核弹动作）
           ② 走同一个二次确认组件（W3-11）
           ③ 触发按钮带 data-confirm
           ⇒ README §6.3 台账与 HTML 里的 data-confirm 双向对拍（§11.11.2 R19 / R30）
   两轴都只匹配词与属性，对格式化器免疫。
   ============================================================ */
const TERM_FILES = [
  ...PAGES.map((p) => p.file),
  "proto-流程原型.html",
  "index.html",
];
/** UI 面禁止词 => 规范词。README 不在扫描范围（它是宣布禁止词的地方，必须能写出旧词） */
const TERM_RULES = [
  { re: /纯\s*观\s*察\s*模\s*式/g, fix: "仅查看" },
  { re: /观\s*察\s*模\s*式/g, fix: "仅查看" },
  { re: /仅\s*观\s*看/g, fix: "仅查看" },
  /* 「只读」本身合法（权限语境：只读角色 / 只读镜像 / 订单视图只读），
     但它一旦用来指「观看模式」就与「仅查看」撞名 ⇒ 只在非权限语境报错 */
  { re: /(?<!视图|镜像|财务|权限|台账|索引|审计|订单)只\s*读(?!角色)/g, fix: "仅查看" },
];
{
  const hits = [];
  for (const file of TERM_FILES) {
    const html = read(join(WIREFRAME_DIR, file));
    if (!html) continue;
    for (const rule of TERM_RULES) {
      for (const m of html.matchAll(rule.re)) {
        hits.push({
          where: `${file}:${lineOf(html, m.index)}`,
          word: m[0],
          fix: rule.fix,
        });
      }
    }
  }
  if (hits.length) {
    fail(
      "C16",
      "wireframe pages",
      `${hits.length} forbidden synonym(s) of the canonical term`,
      "one name per concept (README 6.1)",
      hits.slice(0, 10),
    );
  } else {
    ok(
      "C16",
      `wireframe pages (${TERM_FILES.length} files)`,
      "one name per concept: no forbidden synonym",
    );
  }
}

/* --- C17 危险动作台账（README §6.3）↔ HTML data-confirm --- */
{
  const readmeText = read(README) ?? "";
  const lines = readmeText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,4}\s*6\.3(?![0-9.])/.test(l));
  /** 台账行：[动作名, 状态原文] */
  const ledger = [];
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^#{2,3}\s/.test(line)) break;
      if (!line.startsWith("|") || /^\|[\s:|-]+\|$/.test(line)) continue;
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length < 6) continue;
      if (/^-+$/.test(cells[0].replace(/\s/g, ""))) continue;
      ledger.push([cells[1], cells[cells.length - 1]]);
    }
  }
  const landed = new Map();
  let registered = 0;
  for (const [action, status] of ledger) {
    const m = /`data-confirm="([^"]+)"`/.exec(status ?? "");
    if (m) landed.set(m[1], action.replace(/[*`]/g, "").trim());
    else registered += 1;
  }
  /** HTML：每个 data-confirm 的值 + 承载标签是否够重（.btn.solid） */
  const found = new Map();
  const light = [];
  for (const p of PAGES) {
    const html = p.html ?? read(join(WIREFRAME_DIR, p.file));
    if (!html) continue;
    for (const m of html.matchAll(/data-confirm="([^"]+)"/g)) {
      const tagStart = html.lastIndexOf("<", m.index);
      const tag = tagStart >= 0 ? html.slice(tagStart, m.index) : "";
      if (!/class="[^"]*\bsolid\b/.test(tag)) light.push(`${p.file}:${lineOf(html, m.index)} ${m[1]}`);
      if (!found.has(m[1])) found.set(m[1], `${p.file}:${lineOf(html, m.index)}`);
    }
  }
  if (!ledger.length) {
    fail(
      "C17",
      "README.md 6.3",
      "danger-action ledger missing (see README 6.3)",
      ">=1 row",
      0,
    );
  } else {
    const onlyHtml = [...found.keys()].filter((v) => !landed.has(v));
    const onlyLedger = [...landed.keys()].filter((v) => !found.has(v));
    if (onlyHtml.length) {
      fail(
        "C17",
        "README.md 6.3 <-> wireframe HTML",
        `data-confirm value(s) with no ledger row: ${onlyHtml.join(", ")}`,
        "every data-confirm appears in the ledger",
        onlyHtml.map((v) => found.get(v)),
      );
    }
    if (onlyLedger.length) {
      fail(
        "C17",
        "README.md 6.3 <-> wireframe HTML",
        `ledger row(s) marked landed but no data-confirm in HTML: ${onlyLedger.join(", ")}`,
        "every landed row exists in HTML",
        onlyLedger.map((v) => landed.get(v)),
      );
    }
    if (!onlyHtml.length && !onlyLedger.length) {
      ok(
        "C17",
        "README.md 6.3 <-> wireframe HTML",
        `${landed.size} landed + ${registered} registered, data-confirm in sync`,
      );
    }
  }
  if (light.length) {
    fail(
      "C17-b",
      "wireframe pages",
      `data-confirm on a button lighter than .btn.solid: ${light.join(" | ")}`,
      "danger action weight >= .btn.solid",
      light,
    );
  } else {
    ok("C17-b", "wireframe pages", "every data-confirm sits on a .btn.solid button");
  }
}

/* ============================================================
   ⑧ 目录过期（C11）：docs/OUTLINE.md 必须与源 md 同步
   ============================================================ */
/**
 * L1 渐进披露目录里带**行号与 token 规模** ⇒ 源文档一旦改了而目录没重生成，
 * 读到的是**过期坐标**，比没有目录更坏（误导比无知贵）。
 * 用源文件 sha1 对拍兜底（实现与 hash 表都在 tools/doc-outline.mjs）。
 */
const OUTLINE_TOOL = join(WIREFRAME_DIR, "tools", "doc-outline.mjs");
const outlineRun = spawnSync(process.execPath, [OUTLINE_TOOL, "--check"], {
  encoding: "utf8",
});
const outlineOut = `${outlineRun.stdout ?? ""}${outlineRun.stderr ?? ""}`.trim();
if (outlineRun.status === 0) {
  ok("C11", "docs/OUTLINE.md", outlineOut || "doc outline up to date");
} else {
  fail(
    "C11",
    "docs/OUTLINE.md",
    "doc outline is stale (source md changed since last generation)",
    "up to date",
    outlineOut.split("\n").slice(0, 20),
  );
}

/* ============================================================
   ⑨ 决策影响面索引过期（C12）：docs/IMPACT.md 必须与源引用同步
   ============================================================ */
/**
 * 改一个已拍板决策（`[Dxx]`）之前要先看它的全部落点，而索引里的价值就在**行号新鲜**。
 * 源 md 里增删一行，下游全部行号漂 ⇒ 这里用「重扫描 vs 磁盘」对拍兜底。
 * 比对时抹掉行内空白（VS Code 的 md 格式化器会在中英文间补空格，否则假 FAIL）。
 */
const impact = impactIsStale();
if (impact.have === null) {
  fail(
    "C12",
    "docs/IMPACT.md",
    "decision impact index is missing",
    "docs/IMPACT.md present",
    ["run: node tools/impact-index.mjs"],
  );
} else if (impact.stale) {
  fail(
    "C12",
    "docs/IMPACT.md",
    "decision impact index is stale (line numbers moved)",
    "up to date",
    ["run: node tools/impact-index.mjs  (or --fix)"],
  );
} else {
  ok("C12", "docs/IMPACT.md", "decision impact index up to date");
}

/* ============================================================
   ⑩ 落报告
   ============================================================ */
const counts = { FAIL: 0, WARN: 0, PASS: 0 };
for (const r of results) counts[r.level] += 1;

const report = {
  generatedAt: new Date().toISOString(),
  truth,
  scan: {
    frameIds: scan.frameIds,
    customHeights: scan.customHeights.map((f) => ({
      id: f.id,
      page: f.page,
      variant: f.variant,
      width: f.width,
      height: f.inlineHeight,
      stdHeights: f.stdHeights,
    })),
  },
  countClaims: claims.map((c) => ({
    file: c.file,
    line: c.line,
    marker: c.marker,
    kind: c.kind,
    text: c.lineText,
  })),
  ledger: {
    line: ledger.line,
    declared: ledger.items,
    missing,
    extra,
    wrong,
    freeDeclared: ledger.free,
    freeActual: [...actualFree.entries()],
  },
  refs: {
    lineRefs: allLineRefs,
    sectionRefsTotal: sectionRefs.length,
    unresolved,
  },
  redline: { hits: redlineHits, visibleChars: redlineChars },
  results,
  counts,
};
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

/* ---- ASCII-only console ---- */
const pad = (s, n) => String(s).padEnd(n);
for (const r of results) {
  if (r.level === "PASS" && !process.argv.includes("--verbose")) continue;
  const extra =
    r.level === "FAIL" && r.expected !== undefined
      ? `  expect=${JSON.stringify(r.expected)} got=${JSON.stringify(r.actual)}`
      : "";
  console.log(
    `[${pad(r.level, 4)}] ${pad(r.id, 10)} ${pad(r.where, 42)} ${r.msg}${extra}`,
  );
}
console.log("");
console.log(
  `truth: entries=${truth.entries} anchors=${truth.anchors} frames=${truth.frames}`,
);
console.log(
  `       entryLayer 1/2/3/4=${truth.entryLayer["①"]}/${truth.entryLayer["②"]}/${truth.entryLayer["③"]}/${truth.entryLayer["④"]}` +
    `  entryPrio P0/P1=${truth.entryPrio.P0}/${truth.entryPrio.P1}`,
);
console.log(
  `       frameLayer 1/2/3=${truth.frameLayer[0]}/${truth.frameLayer[1]}/${truth.frameLayer[2]}` +
    `  framePrio P0/P1=${truth.framePrio[0]}/${truth.framePrio[1]}  customHeight frames=${truth.customHeights}`,
);
console.log(
  `counts: FAIL=${counts.FAIL} WARN=${counts.WARN} PASS=${counts.PASS}`,
);
console.log(`report: ${rel(REPORT)}`);

if (process.argv.includes("--report")) {
  console.log("\n--- canvas ledger draft (ASCII) ---");
  const byPage = {};
  for (const f of scan.customHeights) (byPage[f.page] ??= []).push(f);
  for (const [k, list] of Object.entries(byPage)) {
    console.log(
      `  ${k}: ${list.map((f) => `${f.id} \`${f.inlineHeight}\``).join(" . ")}`,
    );
  }
  const free = scan.frames.filter(
    (f) => !f.isStandardWidth && f.inlineHeight !== null,
  );
  console.log(
    `  FREE: ${free.map((f) => `${f.id} \`${f.width}x${f.inlineHeight}\``).join(" . ")}`,
  );
  console.log(`  FREE_TOTAL=${free.length}`);
  const stdDefault = scan.frames.filter(
    (f) => !f.isCustomHeight && f.isStandardWidth,
  );
  console.log(
    `  STD_DEFAULT=${stdDefault.length}  (${stdDefault.map((f) => f.id).join(", ")})`,
  );
}

/* ============================================================
   ⑯ --fix：把「可推导的手写点」按真值回写
   ------------------------------------------------------------
   只动「能由真值算出来的数字」，绝不动：正文 / 历史值（⏱）/ 条目表 / 帧原文 / 说明文字。
   改完以子进程重跑一遍（不带 --fix）做真实验证 ⇒ 一条命令就能看到收敛结果。
   ============================================================ */
if (process.argv.includes("--fix")) {
  /** 在「3 行窗口」上做「保留分隔符」的数字替换（md/html 都可能折行，不能假设同行） */
  const fixCountText = (c, s) => {
    const L = truth.entryLayer;
    const P = truth.entryPrio;
    if (c.kind === "full") {
      s = s.replace(
        /(\d+)(\s*个界面条目\s*⇒\s*)(\d+)(\s*张线框图)/,
        (_m, _a, s1, _b, s2) =>
          `${truth.entries}${s1}${truth.frames}${s2}`,
      );
      s = s.replace(
        /(①\s*)\d+(\s*\/\s*②\s*)\d+(\s*\/\s*③\s*)\d+/,
        (_m, a, b, d) => `${a}${L["①"]}${b}${L["②"]}${d}${L["③"]}`,
      );
      s = s.replace(
        /(P0\s*)\d+(\s*\/\s*P1\s*)\d+/,
        (_m, a, b) => `${a}${P.P0}${b}${P.P1}`,
      );
    } else if (c.kind === "pair") {
      s = s.replace(
        /(⇒\s*)\d+(\s*\*\*\s*条目)/,
        (_m, a, b) => `${a}${truth.entries}${b}`,
      );
      s = s.replace(
        /(⇒\s*)\d+(\s*\*\*\s*帧)/,
        (_m, a, b) => `${a}${truth.frames}${b}`,
      );
      if (c.layersTo) {
        s = s.replace(
          /(⇒\s*)\d+(\s*\*\*\s*)\d+(\s*\/\s*)/,
          (_m, a, b, d) => `${a}${L["①"]}${b}${truth.frames}${d}`,
        );
      }
    } else if (c.kind === "ledger-inline") {
      s = s.replace(
        /(\d+)(\s*帧加高\s*\+\s*)(\d+)(\s*帧自由画布)/,
        (_m, _a, s1, _b, s2) =>
          `${truth.ledger.custom}${s1}${truth.ledger.free}${s2}`,
      );
    } else if (c.kind === "title") {
      s = s.replace(
        /(\d+)(\s*个需要 UI 的位置)/,
        (_m, _a, b) => `${truth.entries}${b}`,
      );
    } else if (c.kind === "ledger-total") {
      s = s.replace(
        /(\d+)(\s*帧\*\*\s*=\s*)(\d+)(\s*帧加高[\s\S]{0,40}?)(\d+)(\s*帧自由画布[\s\S]{0,40}?)(\d+)(\s*帧标准默认)/,
        (_m, _a, s1, _b, s2, _c, s3, _d, s4) =>
          `${truth.frames}${s1}${truth.ledger.custom}${s2}${truth.ledger.free}${s3}${truth.ledger.standard}${s4}`,
      );
    }
    return s;
  };

  const byFile = new Map();
  const queue = (path, fromLine, toLine, before, after) => {
    if (before === after || before === undefined) return;
    const arr = byFile.get(path) ?? [];
    arr.push({ fromLine, toLine, before, after });
    byFile.set(path, arr);
  };

  /* ① 计数句（含标题型 / 台账合计型）：3 行窗口，容忍折行 */
  for (const c of claims) {
    const text = read(c.path);
    if (text === null) continue;
    const lines = text.split("\n");
    const from = Math.max(1, c.line - 1);
    const to = Math.min(lines.length, c.line + 1);
    const before = lines.slice(from - 1, to).join("\n");
    queue(c.path, from, to, before, fixCountText(c, before));
  }

  /* ② README §1 层汇总表末格（④ 是「明确不做」的计数，语义不同，不动） */
  {
    const lines = readme.split("\n");
    for (const r of parseLayerTableRows(readme)) {
      if (r.key === "④") continue;
      const want = truth.entryLayer[r.key];
      const line = lines[r.line - 1];
      if (line === undefined || r.n === want) continue;
      queue(
        README,
        r.line,
        r.line,
        line,
        line.replace(/\|\s*\d+\s*\|\s*$/, (m) => m.replace(/\d+/, String(want))),
      );
    }
  }

  /* ③ README §6.2 画布台账：按端重建加高帧行 / 自由画布行 / 标准默认列表 */
  {
    const lines = readme.split("\n");
    // 🔴 只大写首字母 w：子态后缀必须保持小写（台账写 `W1-06b`，不是 `W1-06B`）
    const uid = (id) => id.replace(/^w/, "W");
    const fmtCustom = (f) => `${uid(f.id)} \`${f.inlineHeight}\``;
    const byPage = {};
    for (const f of scan.customHeights) (byPage[f.page] ??= []).push(f);
    const free = scan.frames.filter(
      (f) => !f.isStandardWidth && f.inlineHeight !== null,
    );
    const stdDefault = scan.frames.filter(
      (f) => !f.isCustomHeight && f.isStandardWidth,
    );
    lines.forEach((line, i) => {
      const label = /^\|\s*([^|]+?)\s*\|/.exec(line)?.[1];
      // 加高帧行：`| W1 控制端 | W1-03 `470` · … |`
      if (label && /^W[1-6]\b/.test(label) && /`\d+`/.test(line)) {
        const list = (byPage[label.slice(0, 2)] ?? []).map(fmtCustom).join(" · ");
        const after = `| ${label} | ${list} |`;
        if (after !== line) queue(README, i + 1, i + 1, line, after);
        return;
      }
      // 自由画布行
      if (label && label.startsWith("**自由画布**") && /\d+×\d+/.test(line)) {
        const list = free
          .map((f) => `${uid(f.id)} ${f.width}×${f.height}`)
          .join(" · ");
        const after = `| ${label} | ${list} |`;
        if (after !== line) queue(README, i + 1, i + 1, line, after);
        return;
      }
      // 标准默认帧列表行（以 W1-01 开头）
      if (/^W1-01\s·/.test(line)) {
        const after = stdDefault.map((f) => uid(f.id)).join(" · ");
        if (after !== line) queue(README, i + 1, i + 1, line, after);
      }
    });
  }

  const applyFile = (path, edits) => {
    const all = read(path).split("\n");
    const taken = [];
    let applied = 0;
    let skipped = 0;
    for (const e of edits.slice().sort((a, b) => b.fromLine - a.fromLine)) {
      // 窗口重叠 ⇒ 留给下一轮（避免用「已过期的原文」去匹配）
      if (taken.some((t) => e.fromLine <= t.to + 1 && e.toLine >= t.from - 1)) {
        skipped++;
        continue;
      }
      if (all.slice(e.fromLine - 1, e.toLine).join("\n") !== e.before) {
        skipped++;
        continue;
      }
      all.splice(
        e.fromLine - 1,
        e.toLine - e.fromLine + 1,
        ...e.after.split("\n"),
      );
      taken.push({ from: e.fromLine, to: e.toLine });
      applied++;
    }
    if (applied > 0) writeFileSync(path, all.join("\n"), "utf8");
    return { applied, skipped };
  };

  let appliedTotal = 0;
  let skippedTotal = 0;
  for (const [path, edits] of byFile) {
    const r = applyFile(path, edits);
    appliedTotal += r.applied;
    skippedTotal += r.skipped;
    if (r.applied > 0)
      console.log(
        `[FIX ] ${rel(path).padEnd(42)} applied=${r.applied} skipped=${r.skipped}`,
      );
  }
  console.log(`fix: applied=${appliedTotal} skipped=${skippedTotal}`);
  if (skippedTotal > 0)
    console.log("NOTE: skipped usually means overlapping windows - re-run once.");

  // 🔴 被改的文档进了 docs/OUTLINE.md 的源 hash 表：不重生成就会让 C11 假 FAIL
  // 🔴 行号动了则 docs/IMPACT.md 也会过期 ⇒ 即使没改数字（applied=0）也要重生
  if (appliedTotal > 0 || impact.stale) {
    console.log("regenerating docs/OUTLINE.md ...");
    const g = spawnSync(
      process.execPath,
      [join(WIREFRAME_DIR, "tools", "doc-outline.mjs")],
      { stdio: "ignore" },
    );
    if (g.status !== 0) console.log("WARN: doc-outline.mjs exited non-zero");
    console.log("regenerating docs/IMPACT.md ...");
    const i = spawnSync(
      process.execPath,
      [join(WIREFRAME_DIR, "tools", "impact-index.mjs")],
      { stdio: "ignore" },
    );
    if (i.status !== 0) console.log("WARN: impact-index.mjs exited non-zero");
    console.log("re-running checks to verify ...\n");
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      stdio: "inherit",
    });
    process.exit(r.status ?? 1);
  }
}

process.exit(counts.FAIL > 0 ? 1 : 0);
