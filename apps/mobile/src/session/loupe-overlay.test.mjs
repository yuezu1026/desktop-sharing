import assert from "node:assert/strict";
import { loupeOverlayLayout } from "./loupe-overlay.mjs";

const layout = loupeOverlayLayout({
  sample: { sampleLeft: 100, sampleTop: 50, sampleSide: 200 },
  pictureWidth: 400,
  pictureHeight: 300,
  pictureFrame: { left: 10, top: 20, width: 200, height: 150 },
  stageWidth: 360,
  stageHeight: 640,
  zoom: 2,
});

assert.equal(layout.visible, true);
assert.ok(layout.window.width >= 96);
assert.equal(layout.window.width, layout.window.height);
assert.ok(layout.window.left >= 0);
assert.ok(layout.window.top >= 0);
assert.ok(layout.window.left + layout.window.width <= 360);
assert.ok(layout.window.top + layout.window.height <= 640);

// 取样区在画面帧内按比例放大后铺满 loupe 窗
assert.ok(layout.crop.imageWidth > layout.window.width);
assert.ok(layout.crop.imageHeight > layout.window.height);
assert.ok(layout.crop.imageLeft <= 0);
assert.ok(layout.crop.imageTop <= 0);

const off = loupeOverlayLayout({
  sample: null,
  pictureWidth: 400,
  pictureHeight: 300,
  pictureFrame: { left: 0, top: 0, width: 200, height: 150 },
  stageWidth: 360,
  stageHeight: 640,
});
assert.equal(off.visible, false);

console.log("mobile loupe overlay ok");
