import assert from "node:assert/strict";
import {
  applyBalance,
  applyNativeRelayEvent,
  applyRemoteSessionState,
  createSession,
  sessionChrome,
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
assert.equal(framed.surfaceVideo, false);

const surfaceFramed = applyNativeRelayEvent(connected, { type: "frame", width: 1920, height: 1080, surface: true });
assert.equal(surfaceFramed.notice, "已收到画面");
assert.equal(surfaceFramed.pictureWidth, 1920);
assert.equal(surfaceFramed.frameUri, "");
assert.equal(surfaceFramed.surfaceVideo, true);

const kept = applyBalance({ ...framed, notice: "正在解 H264" }, { showBalance: true, displayMinutes: 12 });
assert.equal(kept.notice, "正在解 H264");
assert.equal(kept.displayMinutes, 12);

const chromeHidden = sessionChrome(createSession());
assert.equal(chromeHidden.quotaNumber, null);
const chromeShown = sessionChrome(
  applyBalance(createSession(), {
    showBalance: true,
    displayMinutes: 18,
    footnote: "按当前画质估算 · 切换画质会变",
  }),
);
assert.equal(chromeShown.quotaNumber, 18);
assert.equal(chromeShown.quotaFootnote, "按当前画质估算 · 切换画质会变");

const polled = applyRemoteSessionState(
  { ...framed, notice: "已收到画面", ticket: "t".repeat(24) },
  { state: "active", remoteSessionId: "11111111-1111-1111-1111-111111111111" },
);
assert.equal(polled.notice, "已收到画面");

console.log("mobile handheld remote-state ok");
