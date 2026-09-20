import assert from "node:assert/strict";
import { resolveHitButtonBlock } from "./hit-button-layout.mjs";

assert.equal(resolveHitButtonBlock({ solid: true }), true);
assert.equal(resolveHitButtonBlock({ solid: false }), false);
assert.equal(resolveHitButtonBlock({}), false);
assert.equal(resolveHitButtonBlock({ solid: true, block: false }), false);
assert.equal(resolveHitButtonBlock({ solid: false, block: true }), true);

console.log("hit-button-layout.test.mjs ok");
