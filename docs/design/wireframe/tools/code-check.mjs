// code-check.mjs — 代码门禁。没有代码就通过；有了就必须编得过。
//
//   node tools/code-check.mjs --check
//
// stdout 用英文。仓库根禁止 package.json；Playwright 不得写进依赖。
// 类型检查只用服务目录里已安装的 tsc，不会触发 npm install。

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const CODE_ROOTS = ["crates", "apps", "services", "deploy"];
const SKIP_DIRS = new Set(["target", "node_modules", ".git", "dist"]);

/**
 * 只查布局，不启动编译器。测试用临时目录调用。
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function findLayoutErrors(repoRoot) {
  const errors = [];
  if (fs.existsSync(path.join(repoRoot, "package.json"))) {
    errors.push("repo root package.json is forbidden");
  }
  const controlPackage = path.join(repoRoot, "services", "control-plane", "package.json");
  if (fs.existsSync(controlPackage)) {
    const text = fs.readFileSync(controlPackage, "utf8");
    if (text.includes("playwright")) {
      errors.push("playwright must not be a dependency of control-plane");
    }
  }
  return errors;
}

function walkCargo(dir, found) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCargo(child, found);
      continue;
    }
    if (entry.name === "Cargo.toml") found.push(child);
  }
}

function cargoManifests(repoRoot) {
  const rootManifest = path.join(repoRoot, "Cargo.toml");
  if (fs.existsSync(rootManifest)) return [rootManifest];
  const found = [];
  for (const name of CODE_ROOTS) walkCargo(path.join(repoRoot, name), found);
  return found;
}

function runCargo(repoRoot, manifestPath) {
  const result = spawnSync(
    "cargo",
    ["check", "--manifest-path", manifestPath, "--quiet"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.error && result.error.code === "ENOENT") {
    return "cargo is not installed, but a Cargo.toml exists";
  }
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0];
    return `cargo check failed: ${manifestPath}${detail ? ` (${detail})` : ""}`;
  }
  return null;
}

function runControlPlaneTypecheck(repoRoot) {
  const dir = path.join(repoRoot, "services", "control-plane");
  const packagePath = path.join(dir, "package.json");
  if (!fs.existsSync(packagePath)) return null;
  const tsc = path.join(dir, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(tsc)) {
    return "control-plane package.json exists but typescript is not installed in that directory";
  }
  const result = spawnSync(process.execPath, [tsc, "--noEmit", "-p", dir], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0];
    return `tsc failed${detail ? `: ${detail}` : ""}`;
  }
  return null;
}

function isDirectRun() {
  const self = path.resolve(fileURLToPath(import.meta.url));
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return self.toLowerCase() === invoked.toLowerCase();
}

function main() {
  if (!process.argv.includes("--check")) {
    console.log("usage: node tools/code-check.mjs --check");
    process.exit(1);
  }
  const errors = findLayoutErrors(REPO_ROOT);
  for (const manifest of cargoManifests(REPO_ROOT)) {
    const problem = runCargo(REPO_ROOT, manifest);
    if (problem) errors.push(problem);
  }
  const typeError = runControlPlaneTypecheck(REPO_ROOT);
  if (typeError) errors.push(typeError);
  if (errors.length) {
    console.log("FAIL code check");
    for (const error of errors) console.log(`  ${error}`);
    process.exit(1);
  }
  const manifests = cargoManifests(REPO_ROOT).length;
  const hasControl = fs.existsSync(path.join(REPO_ROOT, "services", "control-plane", "package.json"));
  console.log(`PASS code check (cargo=${manifests} control-plane=${hasControl ? "yes" : "no"})`);
  process.exit(0);
}

if (isDirectRun()) main();
