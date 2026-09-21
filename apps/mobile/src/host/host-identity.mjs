/**
 * 安卓被控端识别码 / 临时密码，与桌面被控端规则对齐：
 * 识别码 9 位数字；临时密码 6 位，字母表去掉易混字符。
 */

export const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * @param {() => Uint8Array} [randomBytes]
 */
export function generateDeviceCode(randomBytes) {
  const bytes = typeof randomBytes === "function" ? randomBytes() : defaultRandomBytes(9);
  let out = "";
  for (let index = 0; index < 9; index += 1) {
    const value = bytes[index] ?? 0;
    out += String(value % 10);
  }
  return out;
}

/**
 * @param {() => Uint8Array} [randomBytes]
 */
export function generateTempPassword(randomBytes) {
  const bytes = typeof randomBytes === "function" ? randomBytes() : defaultRandomBytes(6);
  let out = "";
  for (let index = 0; index < 6; index += 1) {
    const value = bytes[index] ?? 0;
    out += PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length];
  }
  return out;
}

/**
 * @param {string} code
 */
export function displayDeviceCode(code) {
  const digits = compactDeviceCode(code);
  if (digits.length !== 9) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
}

/**
 * @param {string} code
 */
export function compactDeviceCode(code) {
  return String(code || "")
    .split("")
    .filter((ch) => ch >= "0" && ch <= "9")
    .join("");
}

/**
 * @param {string} code
 */
export function isValidDeviceCode(code) {
  return /^\d{9}$/.test(compactDeviceCode(code));
}

/**
 * @param {string} password
 */
export function isValidTempPassword(password) {
  if (typeof password !== "string" || password.length !== 6) return false;
  for (const ch of password) {
    if (!PASSWORD_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * @param {number} length
 */
function defaultRandomBytes(length) {
  const out = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(out);
    return out;
  }
  for (let index = 0; index < length; index += 1) {
    out[index] = Math.floor(Math.random() * 256);
  }
  return out;
}
