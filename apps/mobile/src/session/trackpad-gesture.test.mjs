import assert from "node:assert/strict";
import {
  POINTER_BUTTON_LEFT,
  POINTER_BUTTON_RIGHT,
  classifyTrackpadStroke,
} from "./trackpad-gesture.mjs";

assert.equal(POINTER_BUTTON_LEFT, 0);
assert.equal(POINTER_BUTTON_RIGHT, 1);

assert.deepEqual(
  classifyTrackpadStroke({
    touchCount: 1,
    stepDx: 4,
    stepDy: -2,
    totalDx: 4,
    totalDy: -2,
    durationMs: 40,
    phase: "move",
  }),
  { kind: "move", deltaX: 4, deltaY: -2 },
);

assert.deepEqual(
  classifyTrackpadStroke({
    touchCount: 1,
    stepDx: 0,
    stepDy: 0,
    totalDx: 3,
    totalDy: 2,
    durationMs: 120,
    phase: "end",
  }),
  { kind: "leftClick" },
);

assert.deepEqual(
  classifyTrackpadStroke({
    touchCount: 2,
    stepDx: 0,
    stepDy: -18,
    totalDx: 2,
    totalDy: -40,
    durationMs: 200,
    phase: "move",
  }),
  { kind: "wheel", delta: 36 },
);

assert.deepEqual(
  classifyTrackpadStroke({
    touchCount: 2,
    stepDx: 0,
    stepDy: 0,
    totalDx: 4,
    totalDy: 3,
    durationMs: 160,
    phase: "end",
  }),
  { kind: "rightClick" },
);

console.log("mobile trackpad gesture ok");
