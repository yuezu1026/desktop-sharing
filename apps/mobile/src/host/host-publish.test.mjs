import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashTempPasswordWith, nextCredentialPublish } from "./host-publish.mjs";
import { generateTempPassword } from "./host-identity.mjs";

const password = generateTempPassword(() => new Uint8Array([0, 1, 2, 3, 4, 5]));
const expected = createHash("sha256").update(password, "utf8").digest("hex");
assert.equal(hashTempPasswordWith(password, (text) => createHash("sha256").update(text, "utf8").digest("hex")), expected);
assert.equal(expected.length, 64);

assert.deepEqual(nextCredentialPublish({ taken: false, deviceCode: "123456789" }), {
  retry: false,
  deviceCode: "123456789",
});
const regenerated = nextCredentialPublish({
  taken: true,
  deviceCode: "123456789",
  regenerate: () => "987654321",
});
assert.deepEqual(regenerated, { retry: true, deviceCode: "987654321" });

console.log("mobile host publish ok");
