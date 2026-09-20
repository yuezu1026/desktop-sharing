import assert from "node:assert/strict";
import {
  SESSION_HF,
  VIEW_ONLY_HF,
  findForbiddenViewOnlyPhrases,
  sessionDeviceLabel,
  shouldShowQuotaDigits,
  viewOnlyBanner,
} from "./session-hf.mjs";

assert.equal(SESSION_HF.meterLink, "免费中继时长");
assert.equal(SESSION_HF.trackpad, "触控板模式");
assert.equal(SESSION_HF.fullscreen, "全屏");
assert.equal(SESSION_HF.disconnect, "断开");
assert.equal(sessionDeviceLabel("我的台式机"), "我的台式机");
assert.equal(sessionDeviceLabel(""), "未命名设备");
assert.equal(shouldShowQuotaDigits(null), false);
assert.equal(shouldShowQuotaDigits(18), true);
assert.equal(shouldShowQuotaDigits(undefined), false);

assert.equal(VIEW_ONLY_HF.badge, "仅查看");
assert.equal(VIEW_ONLY_HF.askControl, "请求控制");
const permissionBanner = viewOnlyBanner({ frozen: false, requestControl: true });
assert.equal(permissionBanner.title, VIEW_ONLY_HF.bannerTitle);
assert.equal(permissionBanner.body, VIEW_ONLY_HF.permissionBody);
const resourceBanner = viewOnlyBanner({ frozen: true, requestControl: false });
assert.equal(resourceBanner.body, VIEW_ONLY_HF.resourceBody);
assert.equal(viewOnlyBanner(null), null);

assert.deepEqual(findForbiddenViewOnlyPhrases("开通会员即可控制"), ["开通会员即可控制"]);
assert.deepEqual(findForbiddenViewOnlyPhrases(VIEW_ONLY_HF.permissionBody), []);

console.log("session-hf.test.mjs ok");
