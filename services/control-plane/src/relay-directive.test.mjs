import assert from "node:assert/strict";
import { decideRelayHeartbeat } from "../dist/relay-directive.js";

const freeBitrateKbps = 4000;
const degradeFloorKbps = 2000;
const totalBytes = 2_000_000_000;

function atUsedRatio(ratio, bitrateKbps, acceptDegrade) {
  const remainingBytes = Math.round(totalBytes * (1 - ratio));
  return decideRelayHeartbeat({
    remainingBytes,
    totalBytes,
    bitrateKbps,
    freeBitrateKbps,
    degradeFloorKbps,
    acceptDegrade,
    stopNotice: null,
  });
}

assert.equal(atUsedRatio(0.5, 4000, true).directive, "continue");

const warn = atUsedRatio(0.85, 2000, true);
assert.equal(warn.directive, "warn");
assert.match(warn.notice, /八成/);

const suggest = atUsedRatio(0.96, 2000, false);
assert.equal(suggest.directive, "suggest_direct");

const paidDegrade = atUsedRatio(0.85, 8000, true);
assert.equal(paidDegrade.directive, "degraded");
assert.equal(paidDegrade.bitrateKbps, 4000);
// W1-05c / MVP §5：必须写明降到哪一档，不能只报 Mbps。
assert.equal(paidDegrade.notice, "画质已降低：1080p/60 → 1080p/30");

const freeDegrade = atUsedRatio(0.85, 4000, true);
assert.equal(freeDegrade.directive, "degraded");
assert.equal(freeDegrade.bitrateKbps, 2000);
assert.equal(freeDegrade.notice, "画质已降低：1080p/30 → 720p/30");

const refused = atUsedRatio(0.85, 8000, false);
assert.equal(refused.directive, "warn");
assert.equal(refused.bitrateKbps, 8000);

const stopped = decideRelayHeartbeat({
  remainingBytes: 0,
  totalBytes,
  bitrateKbps: 4000,
  freeBitrateKbps,
  degradeFloorKbps,
  acceptDegrade: true,
  stopNotice: null,
});
assert.equal(stopped.directive, "stop_relay");

console.log("relay-directive ok");
