import assert from "node:assert/strict";
import {
  sessionLayoutBox,
  shouldHideSystemBars,
} from "./immersive-chrome.mjs";

assert.equal(shouldHideSystemBars(false), false);
assert.equal(shouldHideSystemBars(true), true);
assert.equal(shouldHideSystemBars(undefined), false);

const windowed = sessionLayoutBox({
  immersive: false,
  windowWidth: 360,
  windowHeight: 800,
  screenWidth: 360,
  screenHeight: 840,
});
assert.equal(windowed.containerWidth, 336);
assert.equal(windowed.containerHeight, 384);
assert.equal(windowed.hideSystemBars, false);

const immersive = sessionLayoutBox({
  immersive: true,
  windowWidth: 360,
  windowHeight: 800,
  screenWidth: 360,
  screenHeight: 840,
});
assert.equal(immersive.containerWidth, 360);
assert.equal(immersive.containerHeight, 840);
assert.equal(immersive.hideSystemBars, true);

console.log("mobile immersive chrome ok");
