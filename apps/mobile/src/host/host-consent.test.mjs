import assert from "node:assert/strict";
import { HOST_CONFIRM_HF } from "./host-hf.mjs";
import {
  allowHostConsent,
  createHostConsent,
  hostConsentChrome,
  refuseHostConsent,
} from "./host-consent.mjs";

assert.equal(HOST_CONFIRM_HF.refuse, "拒绝");
assert.equal(HOST_CONFIRM_HF.allow, "允许本次");
assert.equal(HOST_CONFIRM_HF.pillFirst, "首次连接");
assert.equal(HOST_CONFIRM_HF.pillAgain, "再次连接");

const first = createHostConsent({
  accountMask: "138****6721",
  displayName: "张三",
  deviceName: "我的台式机",
  platform: "Windows 11",
  region: "北京",
  firstConnection: true,
});
const chrome = hostConsentChrome(first);
assert.equal(chrome.refusePrimary, true);
assert.equal(chrome.allowPrimary, false);
assert.equal(chrome.pill, "首次连接");
assert.equal(chrome.refuseLabel, "拒绝");
assert.ok(chrome.fraudLines.length >= 3);

const refused = refuseHostConsent(first);
assert.equal(refused.decision, "refused");
assert.equal(hostConsentChrome(refused).closed, true);

const allowed = allowHostConsent(
  createHostConsent({
    accountMask: "138****6721",
    displayName: "张三",
    deviceName: "我的台式机",
    platform: "Windows 11",
    region: "北京",
    firstConnection: false,
    priorCount: 2,
    priorDaysAgo: 3,
  }),
);
assert.equal(allowed.decision, "allowed");
assert.equal(hostConsentChrome(allowed).pill, "再次连接");

console.log("mobile host consent ok");
