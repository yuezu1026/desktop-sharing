/**
 * 本机联调地址。
 * USB 巡检优先走 adb reverse：手机访问 127.0.0.1:8080 → 本机控制面（当前常落在 8090，用 `adb reverse tcp:8080 tcp:8090`）。
 * Wi‑Fi 直连时再改回电脑局域网 IP。
 */
export const LAB_CONTROL_PLANE_ORIGIN = "http://127.0.0.1:8080";
export const LAB_RELAY_ADDRESS = "127.0.0.1:443";
