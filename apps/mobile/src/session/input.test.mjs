import assert from "node:assert/strict";
import {
  INPUT_KEY_DOWN,
  INPUT_POINTER_DOWN,
  INPUT_POINTER_MOVE,
  bytesToBase64,
  clampPicturePoint,
  encodeKey,
  encodePointer,
  moveCursorByDelta,
  packInputFrame,
  virtualKeyFromChar,
  virtualKeyFromKeyName,
} from "./input.mjs";

const move = encodePointer(INPUT_POINTER_MOVE, 100, 200);
assert.equal(move[0], 1);
assert.equal(move[4], 100);
assert.equal(move[8], 200);

const down = encodePointer(INPUT_POINTER_DOWN, 1, 2, 0);
assert.equal(down[0], 2);
assert.equal(down[9], 0);

const frame = packInputFrame(move);
assert.equal(frame[5], 2);
assert.equal(frame.length, 22);
assert.ok(bytesToBase64(frame).length > 20);

const moved = moveCursorByDelta({ pictureWidth: 100, pictureHeight: 50, cursorX: 10, cursorY: 10 }, 5, -3);
assert.equal(moved.cursorX, 15);
assert.equal(moved.cursorY, 7);
const clamped = clampPicturePoint(-3, 999, 100, 50);
assert.deepEqual(clamped, { x: 0, y: 49 });

assert.equal(virtualKeyFromChar("a"), 0x41);
assert.equal(virtualKeyFromChar("7"), 0x37);
assert.equal(virtualKeyFromKeyName("Enter"), 0x0d);
const key = encodeKey(INPUT_KEY_DOWN, 0x41);
assert.deepEqual([...key], [5, 0, 0, 0, 0x41]);

console.log("mobile input ok");
