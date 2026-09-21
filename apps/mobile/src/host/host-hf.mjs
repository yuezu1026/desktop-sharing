/** 安卓被控端文案（W7-02 / h6）。不得出现金额、余额、充值、免费中继时长。 */

export const HOST_HF = {
  title: "远程桌面 · 本机",
  acceptOn: "● 允许被连接",
  acceptOff: "○ 暂停被连接",
  deviceCodeLabel: "本机识别码",
  tempPasswordLabel: "临时密码",
  tempPasswordHint: "每次连接后自动更换；也可设为固定密码（不推荐）。",
  copy: "复制",
  rotatePassword: "换一个",
  idleStatus: "未被连接",
  connectedHint: "被连接时此处换成连接方",
  selfCheckTitle: "授权自检",
  statusOk: "正常",
  statusNeed: "需重新授权",
  statusUnset: "未设置",
  batteryUnsetHint: "不设置仍可被连接，只是息屏后可能被系统停掉。",
  fraudTitle: "只告诉信任的人",
  fraudBody: "任何人以「客服需要看屏幕」为由索要识别码，都是诈骗。",
  tabHost: "本机",
  tabPeers: "被谁连",
  tabSettings: "设置",
  screenCapture: "屏幕录制",
  accessibility: "无障碍服务",
  batteryWhitelist: "电池与自启白名单",
  notification: "通知权限",
};

/**
 * @param {{
 *   screenCapture: "ok" | "need" | "unset",
 *   accessibility: "ok" | "need" | "unset",
 *   batteryWhitelist: "ok" | "need" | "unset",
 *   notification: "ok" | "need" | "unset",
 * }} checks
 */
export function hostSelfCheckRows(checks) {
  const labelOf = (state) => {
    if (state === "ok") return HOST_HF.statusOk;
    if (state === "unset") return HOST_HF.statusUnset;
    return HOST_HF.statusNeed;
  };
  return [
    { key: "screenCapture", label: HOST_HF.screenCapture, status: checks.screenCapture, statusLabel: labelOf(checks.screenCapture), hint: "" },
    { key: "accessibility", label: HOST_HF.accessibility, status: checks.accessibility, statusLabel: labelOf(checks.accessibility), hint: "" },
    {
      key: "batteryWhitelist",
      label: HOST_HF.batteryWhitelist,
      status: checks.batteryWhitelist,
      statusLabel: labelOf(checks.batteryWhitelist),
      hint: checks.batteryWhitelist === "unset" ? HOST_HF.batteryUnsetHint : "",
    },
    { key: "notification", label: HOST_HF.notification, status: checks.notification, statusLabel: labelOf(checks.notification), hint: "" },
  ];
}
