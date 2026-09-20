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
