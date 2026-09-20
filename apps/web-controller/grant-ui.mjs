/** 网页授权码签发页的展示文案。 */

/**
 * @param {string | null | undefined} expiresAtIso
 * @param {number} nowMs
 */
export function expiryHint(expiresAtIso, nowMs = Date.now()) {
  if (!expiresAtIso) return "有效期未知";
  const expiresAt = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresAt)) return "有效期未知";
  const remainMs = expiresAt - nowMs;
  if (remainMs <= 0) return "已过期，请重新生成";
  const minutes = Math.max(1, Math.ceil(remainMs / 60_000));
  return `约 ${minutes} 分钟内有效，只用一次`;
}

/**
 * @param {string | null | undefined} code
 */
export function maskGrantCode(code) {
  const trimmed = typeof code === "string" ? code.trim() : "";
  if (trimmed.length < 8) return "";
  return `${trimmed.slice(0, 4)}····${trimmed.slice(-4)}`;
}
