/** 手持会话壳文案，对齐 W6-02。额度数字默认不常驻，点「免费中继时长」才展开。 */

export const SESSION_HF = {
  meterLink: "免费中继时长",
  gestureTitle: "当前手势",
  trackpad: "触控板模式",
  directTouch: "直接触摸",
  focusFollow: "焦点跟随",
  magnifier: "放大镜",
  keyboard: "键盘",
  shortcuts: "快捷键",
  fullscreen: "全屏",
  disconnect: "断开",
  exitImmersive: "退出沉浸式",
  back: "返回",
  picturePlaceholder: "被控端画面（等比缩放，不变形）",
  quotaPrefix: "免费中继时长剩余约 ",
  quotaSuffix: " 分钟",
};

/**
 * @param {string|null|undefined} deviceName
 */
export function sessionDeviceLabel(deviceName) {
  const name = String(deviceName ?? "").trim();
  return name || "未命名设备";
}

/**
 * 顶栏是否展示额度数字：仅 showBalance / meterOpen 后由 chrome.quotaNumber 带出。
 * @param {number|null|undefined} quotaNumber
 */
export function shouldShowQuotaDigits(quotaNumber) {
  return Number.isInteger(quotaNumber);
}
