// harness-route.mjs — 改动前的阅读路由。
//
// 目的：频繁改文档时，禁止把整库再读一遍。调用方只拿「这一题该打开的节」，
// 路径在 Node 里解析，不要把中文路径交给 PowerShell 5.1 拼命令行。
//
//   node tools/harness-route.mjs <topic|Dxx>          打印预算（不吐正文）
//   node tools/harness-route.mjs <topic> --text       只吐该节正文
//   node tools/harness-route.mjs --check              路由表指向的文件和 § 必须还在
//
// stdout 说明用英文。正文原样输出（调用方要的就是那段中文）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const SECTION_TOKEN_CAP = 8000;

/** @type {{ id: string, keys: string[], read: { rel: string, section?: string }[], deny: string[] }[]} */
export const ROUTES = [
  {
    id: "number",
    keys: ["number", "ssot", "price", "quota", "数值", "价格", "额度"],
    read: [{ rel: "docs/成本测算表.md", section: "0" }],
    deny: ["rest of that file", "docs/archive"],
  },
  {
    id: "scope",
    keys: ["scope", "p0", "priority", "范围", "优先级"],
    read: [{ rel: "docs/需求规划-v2-P0P3重构.md", section: "1" }],
    deny: ["whole requirements doc", "docs/archive"],
  },
  {
    id: "plan",
    keys: ["plan", "plans", "计划"],
    read: [{ rel: "docs/plans/README.md" }],
    deny: ["whole requirements doc"],
  },
  {
    id: "mvp",
    keys: ["mvp"],
    read: [{ rel: "docs/plans/MVP.md" }],
    deny: ["docs/plans/S1.md", "docs/需求规划-v2-P0P3重构.md"],
  },
  {
    id: "s1",
    keys: ["s1"],
    read: [{ rel: "docs/plans/S1.md" }],
    deny: ["docs/plans/MVP.md whole unless the change crosses the gate"],
  },
  {
    id: "s2",
    keys: ["s2"],
    read: [{ rel: "docs/plans/S2.md" }],
    deny: ["docs/需求规划-v2-P0P3重构.md"],
  },
  {
    id: "s3",
    keys: ["s3"],
    read: [{ rel: "docs/plans/S3.md" }],
    deny: ["docs/plans/S4.md"],
  },
  {
    id: "s4",
    keys: ["s4"],
    read: [{ rel: "docs/plans/S4.md" }],
    deny: ["do not schedule this phase"],
  },
  {
    id: "tech",
    keys: ["tech", "stack", "rust", "tauri", "技术"],
    read: [{ rel: "docs/plans/技术方案.md" }],
    deny: ["whole requirements doc", "whole billing doc"],
  },
  {
    id: "billing",
    keys: ["billing", "pay", "meter", "计费", "支付"],
    read: [{ rel: "docs/商业化与计费设计.md", section: "6" }],
    deny: ["rest of that file", "docs/archive"],
  },
  {
    id: "account",
    keys: ["account", "login", "账号", "登录"],
    read: [{ rel: "docs/账号与管理系统设计.md", section: "0" }],
    deny: ["rest of that file unless the section pointer says so"],
  },
  {
    id: "wire",
    keys: ["wire", "wireframe", "线框"],
    read: [
      { rel: "docs/design/wireframe/README.md", section: "5" },
      { rel: "docs/design/wireframe/README.md", section: "12" },
    ],
    deny: ["whole wireframe README", "docs/archive"],
  },
  {
    id: "high",
    keys: ["high", "hifi", "高保真"],
    read: [{ rel: "docs/design/high/README.md" }],
    deny: ["docs/design/high/评审.md unless reviewing"],
  },
  {
    id: "code",
    keys: ["code", "dev", "开发"],
    read: [
      { rel: "docs/plans/技术方案.md", section: "1" },
      { rel: "docs/plans/MVP.md" },
    ],
    deny: ["whole requirements doc", "docs/archive", "do not scaffold every app at once"],
  },
];

const HEADING_NUM = /^(?:§\s*)?(\d+(?:\.\d+)*)(?!\d)(?!\.\d)/;

function estimateTokens(text) {
  return Math.ceil(text.length / 2);
}

function readRepoFile(repoRoot, relPath) {
  const absolute = path.join(repoRoot, relPath);
  if (!fs.existsSync(absolute)) return null;
  return fs.readFileSync(absolute, "utf8");
}

function parseHeadings(text) {
  const lines = text.split(/\r?\n/);
  const headings = [];
  lines.forEach((line, index) => {
    const mark = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!mark) return;
    const num = HEADING_NUM.exec(mark[2].trim());
    headings.push({
      level: mark[1].length,
      num: num ? num[1] : null,
      from: index + 1,
    });
  });
  return { lines, headings };
}

function sectionSpan(parsed, section) {
  const index = parsed.headings.findIndex((heading) => heading.num === section);
  if (index < 0) return null;
  const heading = parsed.headings[index];
  let end = parsed.lines.length;
  for (let next = index + 1; next < parsed.headings.length; next += 1) {
    if (parsed.headings[next].level <= heading.level) {
      end = parsed.headings[next].from - 1;
      break;
    }
  }
  return { from: heading.from, to: end };
}

/**
 * @param {string} repoRoot
 * @param {typeof ROUTES} [routes]
 * @returns {string[]} 空数组 = 通过
 */
export function findRouteErrors(repoRoot, routes = ROUTES) {
  const errors = [];
  const seen = new Set();
  for (const route of routes) {
    if (seen.has(route.id)) errors.push(`duplicate id ${route.id}`);
    seen.add(route.id);
    for (const item of route.read) {
      if (item.rel.includes("archive/") || item.rel.includes("archive\\")) {
        errors.push(`${route.id} points into archive`);
      }
      const text = readRepoFile(repoRoot, item.rel);
      if (text === null) {
        errors.push(`${route.id} missing file ${item.rel}`);
        continue;
      }
      if (!item.section) continue;
      const span = sectionSpan(parseHeadings(text), item.section);
      if (!span) errors.push(`${route.id} missing section ${item.section} in ${item.rel}`);
    }
  }
  const impact = readRepoFile(repoRoot, "docs/IMPACT.md");
  if (impact === null) errors.push("docs/IMPACT.md missing");
  return errors;
}

function findRoute(topic) {
  const normalized = topic.trim().toLowerCase();
  const byId = ROUTES.find((route) => route.id === normalized);
  if (byId) return byId;
  return ROUTES.find((route) => route.keys.some((key) => key.toLowerCase() === normalized)) ?? null;
}

function sliceDecision(impactText, code) {
  const lines = impactText.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`### \`${code}\``));
  if (start < 0) return null;
  const chunk = [];
  for (let index = start; index < lines.length; index += 1) {
    if (index > start && lines[index].startsWith("### `D")) break;
    chunk.push(lines[index]);
  }
  return chunk.join("\n");
}

function printBudget(route) {
  console.log(`topic: ${route.id}`);
  console.log("budget: open only the listed targets; do not open docs/archive; do not reread OUTLINE.md or IMPACT.md after regenerating");
  console.log("read:");
  for (const item of route.read) {
    const section = item.section ? ` section=${item.section}` : " whole-file";
    console.log(`  - ${item.rel}${section}`);
  }
  console.log("deny:");
  for (const item of route.deny) console.log(`  - ${item}`);
  console.log("text: rerun this command with --text");
  console.log("after:");
  console.log("  node tools/doc-outline.mjs");
  console.log("  node tools/impact-index.mjs");
}

function printSectionText(repoRoot, item) {
  const text = readRepoFile(repoRoot, item.rel);
  if (text === null) {
    console.log(`FAIL missing ${item.rel}`);
    return false;
  }
  if (!item.section) {
    const tokens = estimateTokens(text);
    if (tokens > SECTION_TOKEN_CAP) {
      console.log(`FAIL ${item.rel} is ${tokens} tok; pass a section, do not dump the file`);
      return false;
    }
    console.log(`FILE ${item.rel}  tokens~${tokens}`);
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    return true;
  }
  const span = sectionSpan(parseHeadings(text), item.section);
  if (!span) {
    console.log(`FAIL section ${item.section} not in ${item.rel}`);
    return false;
  }
  const body = text.split(/\r?\n/).slice(span.from - 1, span.to).join("\n");
  const tokens = estimateTokens(body);
  console.log(`FILE ${item.rel}  section=${item.section}  lines=${span.from}-${span.to}  tokens~${tokens}`);
  if (tokens > SECTION_TOKEN_CAP) {
    console.log("FAIL section over cap; narrow the topic instead of dumping it");
    return false;
  }
  process.stdout.write(`${body}\n`);
  return true;
}

function isDirectRun() {
  const self = path.resolve(fileURLToPath(import.meta.url));
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return self.toLowerCase() === invoked.toLowerCase();
}

function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--text");
  const wantText = process.argv.includes("--text");
  if (args.includes("--check") || args.length === 0) {
    if (args.includes("--check")) {
      const errors = findRouteErrors(REPO_ROOT);
      if (errors.length) {
        console.log("FAIL harness routes");
        for (const error of errors) console.log(`  ${error}`);
        process.exit(1);
      }
      console.log(`PASS harness routes (${ROUTES.length} topics)`);
      process.exit(0);
    }
    console.log("usage: node tools/harness-route.mjs <topic|Dxx> [--text]");
    console.log(`topics: ${ROUTES.map((route) => route.id).join(" ")}`);
    process.exit(1);
  }

  const topic = args[0];
  const decision = /^d(\d+(?:-\d+)?)$/i.exec(topic.trim());
  if (decision) {
    const code = `D${decision[1]}`;
    const impact = readRepoFile(REPO_ROOT, "docs/IMPACT.md");
    if (impact === null) {
      console.log("FAIL docs/IMPACT.md missing");
      process.exit(1);
    }
    const slice = sliceDecision(impact, code);
    if (slice === null) {
      console.log(`FAIL ${code} not in IMPACT`);
      process.exit(1);
    }
    console.log(`topic: decision ${code}`);
    console.log("budget: this slice only; do not open the rest of IMPACT.md; do not open docs/archive");
    process.stdout.write(`${slice}\n`);
    process.exit(0);
  }

  const route = findRoute(topic);
  if (!route) {
    console.log(`FAIL unknown topic: ${topic}`);
    console.log(`topics: ${ROUTES.map((item) => item.id).join(" ")}`);
    process.exit(1);
  }
  if (!wantText) {
    printBudget(route);
    process.exit(0);
  }
  let ok = true;
  for (const item of route.read) {
    if (!printSectionText(REPO_ROOT, item)) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

if (isDirectRun()) main();
