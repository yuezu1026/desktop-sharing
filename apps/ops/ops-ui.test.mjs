import assert from "node:assert/strict";
import {
  confirmTotpOutcome,
  formatMeterForOps,
  loginOutcome,
  whitelistRequest,
} from "./ops-ui.mjs";

assert.equal(
  loginOutcome({ setupRequired: true, totpSecret: "SECRETBASE32", setupToken: "tok" }, true).kind,
  "setup",
);
assert.ok(
  loginOutcome({ setupRequired: true, totpSecret: "SECRETBASE32", setupToken: "tok" }, true).hint.includes("只出现这一次"),
);
assert.equal(loginOutcome({ token: "staff" }, true).kind, "ready");
assert.equal(loginOutcome({ message: "邮箱或密码不正确" }, false).kind, "error");
assert.equal(confirmTotpOutcome({ ok: true }, true).kind, "confirmed");
assert.equal(confirmTotpOutcome({ message: "动态码不正确" }, false).kind, "error");

const meter = formatMeterForOps({
  ok: true,
  grants: [{ kind: "free", bytesTotal: 2_000_000_000, remaining: 500_000_000 }],
  ledger: [{ bytes: 1000, createdAt: "2026-01-01T00:00:00.000Z", remoteSessionId: "s1", kind: "free" }],
});
assert.equal(meter.ok, true);
assert.equal(meter.title, "额度（与用户侧同一账本）");
assert.ok(!JSON.stringify(meter).includes("免费中继时长"));
assert.equal(meter.grants[0].kindLabel, "免费额度");
assert.equal(meter.grants[0].remainingBytes, 500_000_000);

assert.equal(
  whitelistRequest({
    hostDeviceId: "11111111-1111-1111-1111-111111111111",
    controllerAccountId: "22222222-2222-2222-2222-222222222222",
    reason: "家庭互助例外",
    fraudAcknowledged: false,
  }).ok,
  false,
);
assert.deepEqual(
  whitelistRequest({
    hostDeviceId: "11111111-1111-1111-1111-111111111111",
    controllerAccountId: "22222222-2222-2222-2222-222222222222",
    reason: "家庭互助例外",
    fraudAcknowledged: true,
  }),
  {
    ok: true,
    body: {
      hostDeviceId: "11111111-1111-1111-1111-111111111111",
      controllerAccountId: "22222222-2222-2222-2222-222222222222",
      reason: "家庭互助例外",
      fraudAcknowledged: true,
    },
  },
);

console.log("ops-ui ok");
