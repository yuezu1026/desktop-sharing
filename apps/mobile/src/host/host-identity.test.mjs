import assert from "node:assert/strict";
import {
  compactDeviceCode,
  displayDeviceCode,
  generateDeviceCode,
  generateTempPassword,
  isValidDeviceCode,
  isValidTempPassword,
} from "./host-identity.mjs";
import {
  createHostSession,
  ensureHostIdentity,
  hostChrome,
  rotateTempPassword,
  setCopyFeedback,
} from "./host-session.mjs";

assert.equal(displayDeviceCode("123456789"), "123 456 789");
assert.equal(compactDeviceCode("123 456 789"), "123456789");
assert.equal(isValidDeviceCode("123456789"), true);
assert.equal(isValidDeviceCode("12345678"), false);

const code = generateDeviceCode(() => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
assert.equal(code, "123456789");
assert.equal(isValidDeviceCode(code), true);

const password = generateTempPassword(() => new Uint8Array([0, 1, 2, 3, 4, 5]));
assert.equal(password, "abcdef");
assert.equal(isValidTempPassword(password), true);

let session = ensureHostIdentity(createHostSession(), {
  nextCode: () => "987654321",
  nextPassword: () => "a7k2f9",
});
assert.equal(session.deviceCode, "987654321");
assert.equal(session.tempPassword, "a7k2f9");
assert.equal(hostChrome(session).deviceCodeDisplay, "987 654 321");

const rotated = rotateTempPassword(session, () => "xyz234");
assert.equal(rotated.tempPassword, "xyz234");
assert.equal(rotated.deviceCode, "987654321");

const copied = setCopyFeedback(session, true);
assert.equal(hostChrome(copied).copyLabel, "已复制");
assert.equal(hostChrome(setCopyFeedback(copied, false)).copyLabel, "复制");

console.log("mobile host identity ok");
