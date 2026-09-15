/* 线框几何自检 · wireframe-selfcheck.mjs
 * ---------------------------------------------------------------------------
 * 为什么需要它：.screen 用了固定高度 + overflow:hidden，子元素底边一旦超过画布
 * 底边会被【静默裁掉】——看图的人不知道少了东西，截图也看不出来。
 * 2026-09-14 的 UI 评审里，一次就查出 5 处这种静默裁切（W1-03 / W1-10 / W2-05 /
 * W5-06 / W1-06b）。
 *
 * 检查项（对目录下每个 *.html 都跑，viewport 1440×900）：
 *   1. 画布裁切：.screen 内任一后代的底边 / 右边不得超出画布内边界（容差 1px）
 *   2. 横向溢出：documentElement.scrollWidth 不得超出视口宽
 *   3. 锚点：所有 a[href="#..."] 与 a[href="x.html#..."] 的目标 id 必须存在
 *   4. 原型页额外：无 JS 报错、静止状态红线告警必须为关
 *
 * 用法（在 wireframe 目录下）：node tools/wireframe-selfcheck.mjs
 * 退出码：0 = 全过；1 = 有 FAIL（可直接接进 CI / 提交前自检）
 * ---------------------------------------------------------------------------
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, ".."); // docs/design/wireframe
const VIEWPORT = { width: 1440, height: 900 };
const TOL = 1; // px 容差，抗亚像素舍入

/* ---------- 找到 playwright（本地没有就退回全局） ---------- */
const pickChromium = (mod) => mod?.chromium ?? mod?.default?.chromium ?? null;

async function loadChromium() {
  for (const spec of ["playwright", "@playwright/test"]) {
    try {
      const c = pickChromium(await import(spec));
      if (c) return c;
    } catch {}
  }
  try {
    const g = execSync("npm root -g", { encoding: "utf8" })
      .trim()
      .replace(/\\/g, "/");
    for (const p of ["@playwright/test/index.js", "playwright/index.js"]) {
      try {
        const c = pickChromium(await import(new URL(`file:///${g}/${p}`).href));
        if (c) return c;
      } catch {}
    }
  } catch {}
  console.error(
    "✗ 找不到 playwright。请先 `npm i -D playwright` 或 `npm i -g @playwright/test`，再重跑。",
  );
  process.exit(2);
}

/* ---------- 收集页面与锚点（静态读文件，不依赖渲染） ---------- */
const files = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const idsByFile = new Map();
for (const f of files) {
  const html = readFileSync(join(ROOT, f), "utf8");
  idsByFile.set(
    f,
    new Set([...html.matchAll(/\bid\s*=\s*"([^"]+)"/g)].map((m) => m[1])),
  );
}

/** 页面里的所有锚点 → [{target, id}] */
function anchorsOf(file, html) {
  const out = [];
  for (const m of html.matchAll(/href\s*=\s*"([^"]*#[^"]+)"/g)) {
    const href = m[1];
    const [maybeFile, id] = href.split("#");
    const target = maybeFile === "" ? file : maybeFile.split("/").pop();
    if (id) out.push({ target, id });
  }
  return out;
}

const results = [];
const record = (file, ok, title, detail, raw) =>
  results.push({ file, ok, title, detail, raw: raw ?? null });

const chromium = await loadChromium();
/* 自带的 chromium 可能没下载（新装的 playwright 常见）⇒ 依次退化到本机
   Chrome / Edge，只要有一个能起来就行 —— 自检只依赖 DOM 几何，不挑浏览器。 */
let browser = null;
const launchErrors = [];
for (const opt of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
  try {
    browser = await chromium.launch(opt);
    break;
  } catch (e) {
    launchErrors.push(
      `${JSON.stringify(opt)}: ${String(e.message).split("\n")[0]}`,
    );
  }
}
if (!browser) {
  console.error(
    "✗ 没有可用的浏览器。请跑 `npx playwright install chromium`，或装好本机 Chrome / Edge。\n" +
      launchErrors.join("\n"),
  );
  process.exit(2);
}
const page = await browser.newPage({ viewport: VIEWPORT });

for (const file of files) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const jsErrors = [];
  page.removeAllListeners?.("pageerror");
  page.on("pageerror", (e) => jsErrors.push(String(e.message)));
  await page.goto(
    new URL(`file:///${join(ROOT, file).replace(/\\/g, "/")}`).href,
    {
      waitUntil: "load",
    },
  );
  await page.waitForTimeout(file.startsWith("proto") ? 700 : 120);

  /* 1 + 2 —— 几何 */
  const geo = await page.evaluate((TOL) => {
    const out = {
      clipping: [],
      horizontalOverflow: [],
      docScroll: 0,
      vw: window.innerWidth,
    };
    out.docScroll = document.documentElement.scrollWidth;
    document.querySelectorAll(".screen").forEach((s, i) => {
      const sr = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      const innerBottom = sr.bottom - parseFloat(cs.borderBottomWidth || 0);
      const innerRight = sr.right - parseFloat(cs.borderRightWidth || 0);
      let worstB = { over: 0, sel: "" };
      let worstR = { over: 0, sel: "" };
      s.querySelectorAll("*").forEach((el) => {
        const cs2 = getComputedStyle(el);
        if (cs2.display === "none" || cs2.visibility === "hidden") return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        const ob = r.bottom - innerBottom;
        const or = r.right - innerRight;
        const label =
          (el.tagName.toLowerCase() + "." + (el.className || "")).slice(0, 46) +
          ' · "' +
          (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 22) +
          '"';
        if (ob > worstB.over)
          worstB = { over: ob, sel: label, top: r.top, bottom: r.bottom };
        if (or > worstR.over) worstR = { over: or, sel: label, right: r.right };
      });
      const id = s.id || s.className.split(" ").slice(-1)[0] || "#" + i;
      const box = {
        screen: id,
        cls: s.className,
        w: Math.round(sr.width),
        h: Math.round(sr.height),
        innerBottom: Math.round(innerBottom),
        innerRight: Math.round(innerRight),
      };
      if (worstB.over > TOL)
        out.clipping.push(
          Object.assign({}, box, {
            px: Math.round(worstB.over),
            sel: worstB.sel,
            dir: "下边界",
            elTop: Math.round(worstB.top),
            elBottom: Math.round(worstB.bottom),
          }),
        );
      if (worstR.over > TOL)
        out.clipping.push(
          Object.assign({}, box, {
            px: Math.round(worstR.over),
            sel: worstR.sel,
            dir: "右边界",
            elRight: Math.round(worstR.right),
          }),
        );
    });
    if (out.docScroll > out.vw + TOL)
      out.horizontalOverflow.push(
        `scrollWidth=${out.docScroll} > viewport=${out.vw}`,
      );
    return out;
  }, TOL);

  if (geo.clipping.length === 0) record(file, true, "画布裁切", "无子元素越界");
  else
    for (const c of geo.clipping)
      record(
        file,
        false,
        "画布裁切",
        `${c.screen}（${c.cls} ${c.w}×${c.h}）${c.dir}溢出 ${c.px}px ← ${c.sel}`,
        c,
      );

  record(
    file,
    geo.horizontalOverflow.length === 0,
    "横向溢出",
    geo.horizontalOverflow.length
      ? geo.horizontalOverflow.join("; ")
      : `scrollWidth=${geo.docScroll} ≤ ${geo.vw}`,
  );

  /* 3 —— 锚点（本页内的 + 跨页的）
     目标可以是 .html（校验 id 是否存在），也可以是 .md / .css 等（只校验文件在不在） */
  const bad = [];
  const anchors = anchorsOf(file, html);
  for (const a of anchors) {
    const ids = idsByFile.get(a.target);
    if (ids) {
      if (!ids.has(a.id)) bad.push(`${a.target}#${a.id} → 目标 id 不存在`);
    } else if (!existsSync(join(ROOT, a.target))) {
      bad.push(`${a.target}#${a.id} → 目标文件不存在`);
    }
  }
  record(
    file,
    bad.length === 0,
    "锚点可达",
    bad.length ? bad.join("; ") : `${anchors.length} 个锚点全部命中`,
  );

  /* 4 —— 原型页额外断言 */
  if (file.startsWith("proto")) {
    record(
      file,
      jsErrors.length === 0,
      "JS 无报错",
      jsErrors.join(" | ") || "0 个 pageerror",
    );
    const alarmOn = await page.evaluate(() => {
      const a = document.getElementById("alarm");
      return a ? a.classList.contains("on") : null;
    });
    record(
      file,
      alarmOn === false,
      "红线告警未误报",
      alarmOn === null
        ? "页面无 #alarm（跳过）"
        : alarmOn
          ? "静止状态就报警 ⇒ 误报"
          : "静止状态未报警",
    );

    /* C15 —— 伪按钮：点了没反应，比没有按钮更伤体验（第九轮 R32）
       规则：原型页里每个 .btn 要么自己（或祖先）有 onclick，要么显式标 data-noop。 */
    const deadButtons = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll(".btn").forEach((el) => {
        if (el.hasAttribute("data-noop")) return;
        if (el.closest("[onclick]")) return;
        if (el.closest("a")) return;
        bad.push((el.textContent || "").trim().slice(0, 16) || "(无文案)");
      });
      return bad;
    });
    record(
      file,
      deadButtons.length === 0,
      "无伪按钮",
      deadButtons.length
        ? `${deadButtons.length} 个 .btn 既无 onclick 也无 data-noop（点了没反应）：${deadButtons.join(" / ")}`
        : "全部 .btn 均可点或已显式标 data-noop",
    );
  }
}

await browser.close();

/* ---------- 输出 ---------- */
writeFileSync(
  join(HERE, "selfcheck-report.json"),
  JSON.stringify({ viewport: VIEWPORT, files, results }, null, 1),
);

let fail = 0;
let lastFile = "";
for (const r of results) {
  if (!r.ok) fail++;
  if (r.file !== lastFile) {
    console.log(`\n== ${r.file} ==`);
    lastFile = r.file;
  }
  console.log(
    `  ${r.ok ? "PASS" : "FAIL"}  ${r.title.padEnd(10, "　")} ${r.detail}`,
  );
}
console.log(
  `\n${fail === 0 ? "✅ 全部通过" : `❌ ${fail} 项未通过`}（${files.length} 个页面，viewport ${VIEWPORT.width}×${VIEWPORT.height}）`,
);
process.exit(fail === 0 ? 0 : 1);
