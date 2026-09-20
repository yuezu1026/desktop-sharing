import assert from "node:assert/strict";
import { colors, linkToneColor, modeSelectedStyle, resolveColors, solidFill, space, hit } from "./theme.mjs";
import { light as generatedLight } from "./theme.generated.mjs";

assert.equal(solidFill("ok"), colors.ok);
assert.equal(solidFill("brand"), colors.brand);
assert.equal(solidFill(undefined), colors.brand);
assert.equal(linkToneColor("● 直连"), colors.ok);
assert.equal(linkToneColor("中继"), colors.warn);
assert.equal(linkToneColor("未知"), colors.text2);
assert.equal(modeSelectedStyle().backgroundColor, colors.brandSoft);

const darkPalette = resolveColors("dark");
assert.equal(darkPalette.bg, "#0b101e");
assert.equal(solidFill("ok", darkPalette), darkPalette.ok);
assert.equal(linkToneColor("直连", darkPalette), darkPalette.ok);
assert.equal(resolveColors("light").brand, colors.brand);
assert.equal(colors.brand, generatedLight.brand);
assert.equal(space["4"], 16);
assert.equal(hit.touchMinPx, 44);

console.log("theme.test.mjs ok");
