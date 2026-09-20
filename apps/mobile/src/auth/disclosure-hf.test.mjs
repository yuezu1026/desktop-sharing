import assert from "node:assert/strict";
import {
  DISCLOSURE_HF,
  assertDisclosureCopySafe,
  findForbiddenDisclosurePhrases,
} from "./disclosure-hf.mjs";

assert.equal(DISCLOSURE_HF.headline, "连接前，有两件事需要你知道");
assert.equal(DISCLOSURE_HF.accept, "我知道了");
assert.ok(DISCLOSURE_HF.relayTitle.includes("中继"));
assert.ok(DISCLOSURE_HF.directTitle.includes("直连"));

assert.deepEqual(assertDisclosureCopySafe(DISCLOSURE_HF), []);
assert.deepEqual(findForbiddenDisclosurePhrases("军工级加密"), ["军工级"]);
assert.ok(findForbiddenDisclosurePhrases("这是端到端加密").includes("端到端加密"));

console.log("disclosure-hf.test.mjs ok");
