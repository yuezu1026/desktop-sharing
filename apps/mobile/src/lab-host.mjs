/**
 * 本机联调地址。
 * USB 巡检走 adb reverse：
 * - 控制面：手机 127.0.0.1:8080 → 本机 8080
 * - 中继：手机不能 reverse 特权口 443，改用 8443 → 本机 443（`adb reverse tcp:8443 tcp:443`）
 * Wi‑Fi 直连时再改回电脑局域网 IP。
 */
export const LAB_CONTROL_PLANE_ORIGIN = "http://127.0.0.1:8080";
export const LAB_RELAY_ADDRESS = "127.0.0.1:8443";
