/** 登录/注册页文案与模式，对齐高保真 h3 手机登录。 */
export const AUTH_MODES = {
  password: "password",
  sms: "sms",
  register: "register",
  forgot: "forgot",
};

export const LOGIN_HF = {
  brandTitle: "远程桌面",
  accountLabel: "手机号 / 邮箱",
  passwordLabel: "密码",
  smsCodeLabel: "短信验证码",
  smsCodePlaceholder: "6 位数字",
  fetchCode: "获取验证码",
  login: "登录",
  smsLogin: "验证码登录",
  passwordLogin: "密码登录",
  forgot: "忘记密码",
  register: "注册",
  noAccount: "没有账号？",
  hasAccount: "已有账号？",
  goLogin: "去登录",
  bioTitle: "生物识别进入",
  bioHint: "本机已绑定",
  bioAction: "进入",
  bioUnavailable: "本机尚未绑定生物识别，请用密码或验证码登录",
  setPassword: "设置密码",
  newPassword: "新密码",
  agree: "我已阅读并同意《用户协议》《隐私政策》",
  realNameNote: "关于实名：注册不需要实名。只有在使用中继、跨账号连接、或触发风控时，才会提示你完成实名。",
  resetPassword: "重置密码",
  loginFailed: "账号或密码不对",
};

/**
 * @param {"password"|"sms"|"register"|"forgot"} mode
 */
export function authTitle(mode) {
  if (mode === AUTH_MODES.register) return LOGIN_HF.register;
  if (mode === AUTH_MODES.forgot) return "重置密码";
  if (mode === AUTH_MODES.sms) return "验证码登录";
  return LOGIN_HF.login;
}
