/** 控制面地址。模拟器访问本机用 10.0.2.2；真机填局域网 IP 或设 CONTROL_PLANE_URL。 */

/**
 * @param {{
 *   envOrigin?: string | null,
 *   platformOS?: string | null,
 *   androidEmulatorHost?: string | null,
 * }} [options]
 */
export function resolveControlPlaneOrigin(options = {}) {
  const fromEnv = typeof options.envOrigin === "string" ? options.envOrigin.trim() : "";
  if (fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  if (options.platformOS === "android") {
    const host =
      typeof options.androidEmulatorHost === "string" && options.androidEmulatorHost.trim()
        ? options.androidEmulatorHost.trim()
        : "10.0.2.2";
    return `http://${host}:8080`;
  }
  return "http://127.0.0.1:8080";
}

/**
 * 中继 TLS 地址。模拟器默认 10.0.2.2:443。
 * @param {{
 *   envAddress?: string | null,
 *   platformOS?: string | null,
 *   androidEmulatorHost?: string | null,
 * }} [options]
 */
export function resolveRelayAddress(options = {}) {
  const fromEnv = typeof options.envAddress === "string" ? options.envAddress.trim() : "";
  if (fromEnv.length > 0) return fromEnv.replace(/^\/+|\/+$/g, "");
  if (options.platformOS === "android") {
    const host =
      typeof options.androidEmulatorHost === "string" && options.androidEmulatorHost.trim()
        ? options.androidEmulatorHost.trim()
        : "10.0.2.2";
    return `${host}:443`;
  }
  return "127.0.0.1:443";
}
