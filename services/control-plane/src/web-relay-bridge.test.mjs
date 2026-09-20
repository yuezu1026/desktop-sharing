import assert from "node:assert/strict";
import { encodeRelayHello, takeFrame } from "../dist/web-relay-bridge.js";

const hello = encodeRelayHello("abcdefghijklmnopqrstuvwxyz0123456789", "controller", "fp-12345678");
assert.equal(hello.readUInt32BE(0), hello.length - 4);
const body = JSON.parse(hello.subarray(4).toString("utf8"));
assert.equal(body.role, "controller");
assert.equal(body.fingerprint, "fp-12345678");

const magic = Buffer.from("RDS1", "ascii");
const header = Buffer.alloc(12);
magic.copy(header, 0);
header[4] = 1;
header[5] = 1;
header.writeUInt32BE(3, 8);
const frame = Buffer.concat([header, Buffer.from([1, 2, 3]), Buffer.from([9, 9])]);
const taken = takeFrame(frame);
assert.ok(taken);
assert.equal(taken.frame.length, 15);
assert.deepEqual([...taken.rest], [9, 9]);
assert.equal(takeFrame(frame.subarray(0, 10)), null);

console.log("web-relay-bridge ok");
