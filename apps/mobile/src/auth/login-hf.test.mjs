import assert from "node:assert/strict";
import { AUTH_MODES, LOGIN_HF, authTitle } from "./login-hf.mjs";

assert.equal(LOGIN_HF.brandTitle, "远程桌面");
assert.equal(LOGIN_HF.accountLabel, "手机号 / 邮箱");
assert.equal(LOGIN_HF.smsLogin, "验证码登录");
assert.equal(LOGIN_HF.forgot, "忘记密码");
assert.equal(LOGIN_HF.register, "注册");
assert.equal(LOGIN_HF.bioTitle, "生物识别进入");
assert.equal(LOGIN_HF.loginFailed, "账号或密码不对");
assert.equal(authTitle(AUTH_MODES.password), "登录");
assert.equal(authTitle(AUTH_MODES.sms), "验证码登录");
assert.equal(authTitle(AUTH_MODES.register), "注册");
assert.equal(authTitle(AUTH_MODES.forgot), "重置密码");

console.log("mobile login-hf ok");
