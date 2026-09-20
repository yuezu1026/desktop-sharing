/**
 * 将 tokens.json 同步到 mobile theme.generated.mjs 与各桌面端 ui_theme.rs。
 * 用法：
 *   node tools/sync-tokens.mjs --write
 *   node tools/sync-tokens.mjs --check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../../../..");
const tokensPath = path.join(scriptDir, "..", "tokens.json");
const mobileOut = path.join(root, "apps/mobile/src/theme.generated.mjs");
const rustThemeOuts = [
  path.join(root, "apps/desktop-host/src/ui_theme.rs"),
  path.join(root, "apps/desktop-controller/src/ui_theme.rs"),
];

const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--write") ? "write" : null;
if (!mode) {
  console.error("用法: node tools/sync-tokens.mjs --write | --check");
  process.exit(2);
}

const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf8"));

function hexToRgb(hex) {
  const normalized = hex.replace("#", "").toLowerCase();
  if (normalized.length !== 6) throw new Error(`非法色值: ${hex}`);
  return {
    red: parseInt(normalized.slice(0, 2), 16),
    green: parseInt(normalized.slice(2, 4), 16),
    blue: parseInt(normalized.slice(4, 6), 16),
  };
}

/** Win32 COLORREF = 0x00BBGGRR */
function hexToColorRef(hex) {
  const { red, green, blue } = hexToRgb(hex);
  const value = (blue << 16) | (green << 8) | red;
  return `0x${value.toString(16).padStart(8, "0").toUpperCase()}`;
}

function paletteObjectLiteral(palette, indent) {
  const pad = " ".repeat(indent);
  return Object.entries(palette)
    .map(([key, value]) => `${pad}${key}: "${value}",`)
    .join("\n");
}

function buildMobileSource() {
  return `/* 由 docs/design/high-fidelity/tools/sync-tokens.mjs 生成，勿手改。 */
export const light = {
${paletteObjectLiteral(tokens.light, 2)}
};

export const dark = {
${paletteObjectLiteral(tokens.dark, 2)}
};

export const space = ${JSON.stringify(tokens.space, null, 2)};

export const radius = ${JSON.stringify(tokens.radius, null, 2)};

export const hit = ${JSON.stringify(tokens.hit, null, 2)};
`;
}

function buildRustTheme() {
  const light = tokens.light;
  return `//! 由 docs/design/high-fidelity/tools/sync-tokens.mjs 生成，勿手改。
//! 色值对齐 tokens.json 亮色主题（Win32 COLORREF = BGR）。

#![allow(dead_code)]

pub const COLOR_BRAND: u32 = ${hexToColorRef(light.brand)};
pub const COLOR_BRAND_HOVER: u32 = ${hexToColorRef(light.brandHover)};
pub const COLOR_BRAND_SOFT: u32 = ${hexToColorRef(light.brandSoft)};
pub const COLOR_OK: u32 = ${hexToColorRef(light.ok)};
pub const COLOR_OK_SOFT: u32 = ${hexToColorRef(light.okSoft)};
pub const COLOR_WARN: u32 = ${hexToColorRef(light.warn)};
pub const COLOR_ERR: u32 = ${hexToColorRef(light.err)};
pub const COLOR_TEXT: u32 = ${hexToColorRef(light.text)};
pub const COLOR_TEXT2: u32 = ${hexToColorRef(light.text2)};
pub const COLOR_TEXT3: u32 = ${hexToColorRef(light.text3)};
pub const COLOR_LINE: u32 = ${hexToColorRef(light.line)};
pub const COLOR_LINE2: u32 = ${hexToColorRef(light.line2)};
pub const COLOR_SURFACE: u32 = ${hexToColorRef(light.surface)};
pub const COLOR_SURFACE2: u32 = ${hexToColorRef(light.surface2)};
pub const COLOR_SURFACE3: u32 = ${hexToColorRef(light.surface3)};
pub const COLOR_BG: u32 = ${hexToColorRef(light.bg)};
pub const COLOR_ON_SOLID: u32 = ${hexToColorRef(light.onSolid)};
pub const COLOR_SWITCH_OFF: u32 = ${hexToColorRef(light.line2)};

pub const TOUCH_MIN_PX: i32 = ${tokens.hit.touchMinPx};
pub const DESKTOP_MIN_PX: i32 = ${tokens.hit.desktopMinPx};
`;
}

function ensureMatch(filePath, expected) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (current.replace(/\r\n/g, "\n") !== expected.replace(/\r\n/g, "\n")) {
    console.error(`漂移: ${path.relative(root, filePath)}`);
    return false;
  }
  return true;
}

const mobileSource = buildMobileSource();
const rustSource = buildRustTheme();

if (mode === "write") {
  fs.writeFileSync(mobileOut, mobileSource, "utf8");
  for (const outPath of rustThemeOuts) {
    fs.writeFileSync(outPath, rustSource, "utf8");
  }
  console.log("已写入:");
  console.log(" -", path.relative(root, mobileOut));
  for (const outPath of rustThemeOuts) {
    console.log(" -", path.relative(root, outPath));
  }
  process.exit(0);
}

let allOk = ensureMatch(mobileOut, mobileSource);
for (const outPath of rustThemeOuts) {
  if (!ensureMatch(outPath, rustSource)) allOk = false;
}
if (!allOk) {
  console.error("请运行: node docs/design/high-fidelity/tools/sync-tokens.mjs --write");
  process.exit(1);
}
console.log("tokens 同步检查通过");
