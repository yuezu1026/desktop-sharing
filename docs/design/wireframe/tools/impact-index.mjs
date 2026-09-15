#!/usr/bin/env node
/**
 * impact-index.mjs —— 生成 / 校验「决策影响面索引」（`docs/IMPACT.md`）
 *
 * 场景：改一个已拍板决策（`[D25]` 之类）时，它的落点散在 6~8 个文件里。
 *       现场 grep = 每轮重复付 token 且容易漏；这份索引把落点预先算好。
 *
 * 用法
 *   node tools/impact-index.mjs            # 重新生成 docs/IMPACT.md + ASCII 摘要
 *   node tools/impact-index.mjs --check    # 不写盘，只判是否过期（EXIT=1 = 过期）
 *   node tools/impact-index.mjs --print    # 只打 ASCII 摘要，不写盘
 *
 * 约定
 *   - stdout 一律 ASCII（终端是 PS 5.1 / GBK，中文会乱码）。
 *   - 本文件是生成物：改完文档忘了重跑，门禁会报 `C12` 过期。
 */

import { writeFileSync } from "node:fs";

import { IMPACT, scanDecisions, renderImpactMd, impactIsStale } from "./lib/impact-scan.mjs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const printOnly = args.includes("--print");

const scan = scanDecisions();
const body = renderImpactMd(scan);

/** ASCII 摘要：热点 top 榜 + 总量 */
const summary = () => {
  const top = [...scan.byCode.entries()]
    .map(([code, hits]) => ({ code, n: hits.length, files: new Set(hits.map((h) => h.rel)).size }))
    .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code))
    .slice(0, 12);
  console.log(`decisions=${scan.byCode.size}  refs=${scan.total}  files=${scan.files.length}`);
  console.log("hottest (code / refs / files):");
  for (const t of top) console.log(`  D${t.code.padEnd(6)} ${String(t.n).padStart(4)}  ${t.files}`);
};

if (printOnly) {
  summary();
  process.exit(0);
}

if (check) {
  const { stale } = impactIsStale();
  summary();
  if (stale) {
    console.log("FAIL: docs/IMPACT.md is stale (re-run: node tools/impact-index.mjs)");
    process.exit(1);
  }
  console.log("PASS: docs/IMPACT.md is up to date");
  process.exit(0);
}

writeFileSync(IMPACT, body, "utf8");
summary();
console.log("wrote docs/IMPACT.md");
