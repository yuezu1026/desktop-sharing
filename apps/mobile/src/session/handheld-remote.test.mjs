import assert from "node:assert/strict";
import {
  applyNativeRelayEvent,
  applyRemoteSessionState,
  createSession,
  shouldAttachRelay,
} from "./handheld.mjs";

const idle = createSession();
assert.equal(applyRemoteSessionState(idle, { state: "awaiting_host_consent" }).notice, "等待被控端确认");
assert.equal(applyRemoteSessionState(idle, { state: "rejected" }).notice, "被控端已拒绝");
assert.equal(
  applyRemoteSessionState(idle, { state: "active", ticket: "t".repeat(24) }).notice,
  "中继票已就绪",
);
assert.equal(applyRemoteSessionState(idle, { state: "active", ticket: "short" }).notice, "中继票未就绪");
assert.equal(applyRemoteSessionState(idle, { state: "relay_stopped" }).viewOnly, "resource");

const ready = applyRemoteSessionState(idle, { state: "active", ticket: "t".repeat(24) });
assert.equal(shouldAttachRelay(ready), true);
assert.equal(shouldAttachRelay({ ...ready, relayAttached: true }), false);
assert.equal(shouldAttachRelay(applyRemoteSessionState(idle, { state: "awaiting_host_consent", ticket: "t".repeat(24) })), false);

const connected = applyNativeRelayEvent(ready, { type: "connected" });
assert.equal(connected.notice, "中继已接通");
assert.equal(connected.relayAttached, true);
const framed = applyNativeRelayEvent(connected, { type: "frame", width: 320, height: 180, jpegBase64: "qq" });
assert.equal(framed.notice, "已收到画面");
assert.equal(framed.pictureWidth, 320);
assert.equal(framed.frameUri, "data:image/jpeg;base64,qq");

console.log("mobile handheld remote-state ok");
