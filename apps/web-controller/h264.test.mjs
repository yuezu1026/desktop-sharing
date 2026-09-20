import assert from "node:assert/strict";
import {
  annexBHasIdr,
  annexBToLengthPrefixed,
  buildAvcC,
  codecStringFromSps,
  findSpsPps,
  nalType,
  splitAnnexB,
} from "./h264.mjs";

function start4(...payload) {
  return new Uint8Array([0, 0, 0, 1, ...payload]);
}

const sps = start4(0x67, 0x42, 0xc0, 0x1e, 0xaa);
const pps = start4(0x68, 0xce, 0x06, 0xe2);
const idr = start4(0x65, 0x88, 0x80);
const slice = start4(0x41, 0x9a);
const stream = new Uint8Array([...sps, ...pps, ...idr]);

const nals = splitAnnexB(stream);
assert.equal(nals.length, 3);
assert.equal(nalType(nals[0]), 7);
assert.equal(nalType(nals[1]), 8);
assert.equal(nalType(nals[2]), 5);
assert.equal(annexBHasIdr(stream), true);
assert.equal(annexBHasIdr(new Uint8Array([...sps, ...pps, ...slice])), false);

const pair = findSpsPps(stream);
assert.ok(pair);
assert.equal(codecStringFromSps(pair.sps), "avc1.42C01E");
const avcc = buildAvcC(pair.sps, pair.pps);
assert.ok(avcc);
assert.equal(avcc[0], 1);
assert.equal(avcc[1], 0x42);
assert.equal(avcc[5] & 0x1f, 1);

const avc = annexBToLengthPrefixed(stream);
assert.ok(avc);
assert.equal(avc[0], 0);
assert.equal(avc[3], 3);
assert.equal(avc[4], 0x65);

console.log("web-controller h264 ok");
