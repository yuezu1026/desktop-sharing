import assert from "node:assert/strict";
import { SESSION_HF, sessionDeviceLabel, shouldShowQuotaDigits } from "./session-hf.mjs";

assert.equal(SESSION_HF.meterLink, "免费中继时长");
assert.equal(SESSION_HF.trackpad, "触控板模式");
assert.equal(SESSION_HF.fullscreen, "全屏");
assert.equal(SESSION_HF.disconnect, "断开");
assert.equal(sessionDeviceLabel("我的台式机"), "我的台式机");
assert.equal(sessionDeviceLabel(""), "未命名设备");
assert.equal(shouldShowQuotaDigits(null), false);
assert.equal(shouldShowQuotaDigits(18), true);
assert.equal(shouldShowQuotaDigits(undefined), false);

console.log("session-hf.test.mjs ok");
