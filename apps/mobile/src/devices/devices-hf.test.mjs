import assert from "node:assert/strict";
import { DEVICES_HF, deviceSubtitle, filterDeviceRows, platformLabel } from "./devices-hf.mjs";

assert.equal(DEVICES_HF.title, "我的设备");
assert.equal(DEVICES_HF.searchPlaceholder, "搜索设备");
assert.equal(DEVICES_HF.connect, "连接");

assert.equal(platformLabel("windows"), "Windows");
assert.equal(platformLabel("macOS"), "macOS");
assert.equal(platformLabel("android"), "Android");
assert.equal(platformLabel(""), "");

assert.equal(deviceSubtitle({ platform: "windows", statusText: "在线" }), "Windows · 在线");
assert.equal(deviceSubtitle({ platform: "windows", statusText: "离线" }), "Windows · 离线");
assert.equal(deviceSubtitle({ platform: "android", statusText: "从未连接" }), "从未连接");

const rows = [
  { displayName: "我的台式机", platform: "windows", statusText: "在线" },
  { displayName: "旧手机", platform: "android", statusText: "从未连接" },
];
assert.equal(filterDeviceRows(rows, "").length, 2);
assert.equal(filterDeviceRows(rows, "台式")[0].displayName, "我的台式机");
assert.equal(filterDeviceRows(rows, "从未").length, 1);
assert.equal(filterDeviceRows(rows, "mac").length, 0);

console.log("devices-hf.test.mjs ok");
