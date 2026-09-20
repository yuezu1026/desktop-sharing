import { LAB_CONTROL_PLANE_ORIGIN, LAB_RELAY_ADDRESS } from "./lab-host.mjs";

/** 控制面地址。优先 lab-host / 环境变量；否则模拟器 10.0.2.2，其它回环。 */

/**
 * @param {{
 *   envOrigin?: string | null,
 *   labOrigin?: string | null,
 *   platformOS?: string | null,
 *   androidEmulatorHost?: string | null,
 * }} [options]
 */
export function resolveControlPlaneOrigin(options = {}) {
  const fromEnv = typeof options.envOrigin === "string" ? options.envOrigin.trim() : "";
  if (fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  const fromLab = typeof options.labOrigin === "string" ? options.labOrigin.trim() : "";
  if (fromLab.length > 0) return fromLab.replace(/\/$/, "");
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
 * 中继 TLS 地址。优先 lab-host / 环境变量；否则模拟器 10.0.2.2:443。
 * @param {{
 *   envAddress?: string | null,
 *   labAddress?: string | null,
 *   platformOS?: string | null,
 *   androidEmulatorHost?: string | null,
 * }} [options]
 */
export function resolveRelayAddress(options = {}) {
  const fromEnv = typeof options.envAddress === "string" ? options.envAddress.trim() : "";
  if (fromEnv.length > 0) return fromEnv.replace(/^\/+|\/+$/g, "");
  const fromLab = typeof options.labAddress === "string" ? options.labAddress.trim() : "";
  if (fromLab.length > 0) return fromLab.replace(/^\/+|\/+$/g, "");
  if (options.platformOS === "android") {
    const host =
      typeof options.androidEmulatorHost === "string" && options.androidEmulatorHost.trim()
        ? options.androidEmulatorHost.trim()
        : "10.0.2.2";
    return `${host}:443`;
  }
  return "127.0.0.1:443";
}

export { LAB_CONTROL_PLANE_ORIGIN, LAB_RELAY_ADDRESS };
