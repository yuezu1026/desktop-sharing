import assert from "node:assert/strict";
import {
  INPUT_KEY_DOWN,
  INPUT_POINTER_DOWN,
  INPUT_POINTER_MOVE,
  encodeKey,
  encodePointer,
  encodeWheel,
  mapPointerToPicture,
} from "./input.mjs";

const move = encodePointer(INPUT_POINTER_MOVE, 100, 200);
assert.equal(move[0], 1);
assert.equal(move[4], 100);
assert.equal(move[8], 200);

const down = encodePointer(INPUT_POINTER_DOWN, 1, 2, 1);
assert.equal(down[0], 2);
assert.equal(down[9], 1);

const wheel = encodeWheel(10, 20, -120);
assert.equal(wheel.length, 12);
assert.equal(wheel[0], 4);
assert.equal(wheel[10], 0xff);
assert.equal(wheel[11], 0x88);

const key = encodeKey(INPUT_KEY_DOWN, 0x41);
assert.deepEqual([...key], [5, 0, 0, 0, 0x41]);

const mapped = mapPointerToPicture(60, 40, { left: 0, top: 0, width: 200, height: 100 }, 100, 50);
assert.ok(mapped);
assert.equal(mapped.x, 30);
assert.equal(mapped.y, 20);
assert.equal(mapPointerToPicture(5, 5, { left: 0, top: 0, width: 200, height: 100 }, 100, 100), null);

console.log("web-controller input ok");
