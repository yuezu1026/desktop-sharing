import assert from "node:assert/strict";
import { HOST_HF, hostSelfCheckRows } from "./host-hf.mjs";
import { createHostSession, hostChrome, setAcceptConnections, setSelfCheck } from "./host-session.mjs";

assert.equal(HOST_HF.title, "远程桌面 · 本机");
assert.equal(HOST_HF.acceptOn, "● 允许被连接");
assert.equal(HOST_HF.acceptOff, "○ 暂停被连接");
assert.equal(HOST_HF.deviceCodeLabel, "本机识别码");
assert.equal(HOST_HF.tempPasswordLabel, "临时密码");
assert.equal(HOST_HF.idleStatus, "未被连接");
assert.ok(HOST_HF.fraudBody.includes("诈骗"));
assert.ok(HOST_HF.batteryUnsetHint.includes("仍可被连接"));
assert.ok(!Object.values(HOST_HF).join("").includes("余额"));
assert.ok(!Object.values(HOST_HF).join("").includes("免费中继"));
assert.ok(!Object.values(HOST_HF).join("").includes("充值"));

const rows = hostSelfCheckRows({
  screenCapture: "ok",
  accessibility: "ok",
  batteryWhitelist: "unset",
  notification: "ok",
});
assert.equal(rows.length, 4);
assert.equal(rows[2].label, "电池与自启白名单");
assert.equal(rows[2].statusLabel, "未设置");
assert.equal(rows[2].hint, HOST_HF.batteryUnsetHint);

const idle = createHostSession();
assert.equal(idle.acceptConnections, true);
assert.equal(hostChrome(idle).acceptLabel, HOST_HF.acceptOn);
assert.equal(hostChrome(idle).statusLabel, HOST_HF.idleStatus);
assert.equal(hostChrome(idle).moneyForbidden, true);

const paused = setAcceptConnections(idle, false);
assert.equal(hostChrome(paused).acceptLabel, HOST_HF.acceptOff);

const needAuth = setSelfCheck(idle, { screenCapture: "need" });
assert.equal(hostChrome(needAuth).selfCheck[0].statusLabel, "需重新授权");

const moneyBlob = JSON.stringify(hostChrome(idle));
assert.ok(!moneyBlob.includes("余额"));
assert.ok(!moneyBlob.includes("额度"));
assert.ok(!moneyBlob.includes("充值"));
assert.ok(!moneyBlob.includes("免费中继"));

console.log("mobile host session ok");
