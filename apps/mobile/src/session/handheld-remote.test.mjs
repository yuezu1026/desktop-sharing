import assert from "node:assert/strict";
import { applyRemoteSessionState, createSession } from "./handheld.mjs";

const idle = createSession();
assert.equal(applyRemoteSessionState(idle, { state: "awaiting_host_consent" }).notice, "等待被控端确认");
assert.equal(applyRemoteSessionState(idle, { state: "rejected" }).notice, "被控端已拒绝");
assert.equal(
  applyRemoteSessionState(idle, { state: "active", ticket: "t".repeat(24) }).notice,
  "中继票已就绪",
);
assert.equal(applyRemoteSessionState(idle, { state: "active", ticket: "short" }).notice, "中继票未就绪");
assert.equal(applyRemoteSessionState(idle, { state: "relay_stopped" }).viewOnly, "resource");

console.log("mobile handheld remote-state ok");
