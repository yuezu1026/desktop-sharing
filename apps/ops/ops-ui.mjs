/** 运营台登录与首次动态码绑定文案。 */

/**
 * @param {{ setupRequired?: boolean, totpSecret?: string, setupToken?: string, token?: string, message?: string } | null} body
 * @param {boolean} ok
 */
export function loginOutcome(body, ok) {
  if (body?.setupRequired === true && body.totpSecret && body.setupToken) {
    return {
      kind: "setup",
      totpSecret: body.totpSecret,
      setupToken: body.setupToken,
      hint: "首次进入要先保存动态码密钥，用验证器生成码确认后再登录。密钥只出现这一次。",
    };
  }
  if (ok && body?.token) {
    return { kind: "ready", token: body.token, hint: "" };
  }
  return { kind: "error", hint: body?.message || "登录失败" };
}

/**
 * @param {{ ok?: boolean, message?: string } | null} body
 * @param {boolean} ok
 */
export function confirmTotpOutcome(body, ok) {
  if (ok && body?.ok === true) {
    return { kind: "confirmed", hint: "动态码已绑定。请用验证器里的码重新登录。" };
  }
  return { kind: "error", hint: body?.message || "动态码确认失败" };
}
