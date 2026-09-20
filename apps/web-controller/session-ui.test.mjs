import assert from "node:assert/strict";
import { badgeText, nextPhase, PHASE, pictureText, shouldPoll } from "./session-ui.mjs";

assert.equal(nextPhase(PHASE.idle, { state: "awaiting_host_consent" }), PHASE.awaitingConsent);
assert.equal(nextPhase(PHASE.awaitingConsent, { state: "rejected" }), PHASE.rejected);
assert.equal(
  nextPhase(PHASE.awaitingConsent, { state: "active", ticket: "t".repeat(24) }),
  PHASE.relayPlaceholder,
);
assert.equal(nextPhase(PHASE.awaitingConsent, { state: "active", ticket: "short" }), PHASE.ticketReady);
assert.equal(nextPhase(PHASE.idle, { error: "x" }), PHASE.failed);

assert.equal(badgeText(PHASE.awaitingConsent), "等待确认");
assert.equal(badgeText(PHASE.relayPlaceholder), "中继");
assert.equal(pictureText(PHASE.relayPlaceholder), "已接通中继（占位画面）");
assert.equal(shouldPoll(PHASE.awaitingConsent), true);
assert.equal(shouldPoll(PHASE.relayPlaceholder), false);

console.log("web-controller session-ui ok");
