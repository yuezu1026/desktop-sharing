import assert from "node:assert/strict";
import {
  FRAME_KIND_VIDEO,
  VIDEO_CODEC_JPEG,
  frameKind,
  framePayload,
  takeFrame,
  unpackVideo,
} from "./frame.mjs";

function packFrame(kind, payload) {
  const header = new Uint8Array(12);
  header.set([0x52, 0x44, 0x53, 0x31, 1, kind, 0, 0]);
  const length = payload.length;
  header[8] = (length >>> 24) & 0xff;
  header[9] = (length >>> 16) & 0xff;
  header[10] = (length >>> 8) & 0xff;
  header[11] = length & 0xff;
  const out = new Uint8Array(12 + payload.length);
  out.set(header, 0);
  out.set(payload, 12);
  return out;
}

function packVideo(width, height, codec, body) {
  const out = new Uint8Array(6 + body.length);
  out[0] = (width >> 8) & 0xff;
  out[1] = width & 0xff;
  out[2] = (height >> 8) & 0xff;
  out[3] = height & 0xff;
  out[4] = codec;
  out[5] = 0;
  out.set(body, 6);
  return out;
}

const jpegBody = new TextEncoder().encode("fake-jpeg");
const video = packVideo(640, 360, VIDEO_CODEC_JPEG, jpegBody);
const frameBytes = packFrame(FRAME_KIND_VIDEO, video);
const padded = new Uint8Array(frameBytes.length + 3);
padded.set(frameBytes, 0);

const taken = takeFrame(padded);
assert.ok(taken);
assert.equal(frameKind(taken.frame), FRAME_KIND_VIDEO);
assert.equal(taken.rest.length, 3);
const unpacked = unpackVideo(framePayload(taken.frame));
assert.ok(unpacked);
assert.equal(unpacked.width, 640);
assert.equal(unpacked.height, 360);
assert.equal(unpacked.codec, VIDEO_CODEC_JPEG);
assert.deepEqual(Array.from(unpacked.body), Array.from(jpegBody));

assert.equal(takeFrame(frameBytes.subarray(0, 10)), null);

console.log("web-controller frame ok");
