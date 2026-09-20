import assert from "node:assert/strict";
import { expiryHint, maskGrantCode } from "./grant-ui.mjs";

assert.equal(maskGrantCode("abcdefghijklmnop"), "abcd····mnop");
assert.equal(maskGrantCode("short"), "");
assert.equal(expiryHint("2026-09-20T13:00:00.000Z", Date.parse("2026-09-20T12:30:00.000Z")), "约 30 分钟内有效，只用一次");
assert.equal(expiryHint("2026-09-20T12:00:00.000Z", Date.parse("2026-09-20T13:00:00.000Z")), "已过期，请重新生成");

console.log("web-controller grant-ui ok");
