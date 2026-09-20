import assert from "node:assert/strict";
import { confirmTotpOutcome, loginOutcome } from "./ops-ui.mjs";

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

console.log("ops-ui ok");
