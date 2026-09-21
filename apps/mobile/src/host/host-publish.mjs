/**
 * 被控端识别码上报：冲突时换码重试。
 */

/**
 * @param {string} password
 * @param {(text: string) => string} sha256Hex
 */
export function hashTempPasswordWith(password, sha256Hex) {
  return sha256Hex(String(password || ""));
}

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashTempPassword(password) {
  const text = String(password || "");
  if (typeof process !== "undefined" && process.versions && process.versions.node) {
    const { createHash } = await import("node:crypto");
    return createHash("sha256").update(text, "utf8").digest("hex");
  }
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error("缺少 SHA-256");
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * @param {{
 *   taken: boolean,
 *   deviceCode: string,
 *   regenerate?: () => string,
 * }} input
 */
export function nextCredentialPublish(input) {
  if (!input.taken) {
    return { retry: false, deviceCode: input.deviceCode };
  }
  const regenerate = typeof input.regenerate === "function" ? input.regenerate : null;
  if (!regenerate) {
    return { retry: false, deviceCode: input.deviceCode };
  }
  return { retry: true, deviceCode: regenerate() };
}
