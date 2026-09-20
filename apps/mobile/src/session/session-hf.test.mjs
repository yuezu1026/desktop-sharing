import assert from "node:assert/strict";
import { EXIT_PATHS } from "./handheld.mjs";
import {
  IMMERSIVE_EXIT_PATHS,
  IMMERSIVE_HF,
  SESSION_HF,
  VIEW_ONLY_HF,
  findForbiddenViewOnlyPhrases,
  hasDualImmersiveExitPaths,
  immersiveBadgeLabel,
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

assert.equal(VIEW_ONLY_HF.badge, "仅查看");
assert.equal(viewOnlyBanner({ frozen: false }).body, VIEW_ONLY_HF.permissionBody);
assert.equal(viewOnlyBanner({ frozen: true }).body, VIEW_ONLY_HF.resourceBody);
assert.deepEqual(findForbiddenViewOnlyPhrases("开通会员即可控制"), ["开通会员即可控制"]);

assert.equal(IMMERSIVE_HF.exitBar, "退出沉浸式");
assert.equal(immersiveBadgeLabel("中继"), "● 中继");
assert.equal(hasDualImmersiveExitPaths(EXIT_PATHS), true);
assert.equal(hasDualImmersiveExitPaths(["bar"]), false);
assert.deepEqual(IMMERSIVE_EXIT_PATHS, ["bar", "back"]);

console.log("session-hf.test.mjs ok");
