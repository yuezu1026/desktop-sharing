/** 手持会话壳文案，对齐 W6-02 / W6-03。额度数字默认不常驻，点「免费中继时长」才展开。 */

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
  zoom: "缩放",
  rotate: "旋转",
};

/** 仅查看（W6-03 权限式 / 资源式共用壳）。不得写成开通会员即可控制。 */
export const VIEW_ONLY_HF = {
  badge: "仅查看",
  bannerTitle: "当前为「仅查看」",
  permissionBody: "你可以看到对方的屏幕，但不会影响对方的操作。",
  resourceBody: "画面已停在最后一帧，暂时无法继续。",
  permissionPictureHint: "画面正常播放（实时）\n你的操作不会作用于对方",
  askControl: "请求控制",
  waitingControl: "等待对方确认",
  openWays: "还有什么办法",
};

/** 仅查看态禁写的催费文案。 */
export const VIEW_ONLY_FORBIDDEN = ["开通会员即可控制", "开通会员就能控制"];

/** 沉浸式手持（W6-09）：角标常驻，退出必须两条路径。 */
export const IMMERSIVE_HF = {
  exitBar: "退出沉浸式",
  keyboard: "键盘",
  pointer: "指针",
  disconnect: "断开",
  badgePrefix: "● ",
};

export const IMMERSIVE_EXIT_PATHS = ["bar", "back"];

/**
 * @param {string[]} paths
 */
export function hasDualImmersiveExitPaths(paths) {
  const list = Array.isArray(paths) ? paths : [];
  return IMMERSIVE_EXIT_PATHS.every((path) => list.includes(path));
}

/**
 * @param {string} linkLabel
 */
export function immersiveBadgeLabel(linkLabel) {
  return IMMERSIVE_HF.badgePrefix + String(linkLabel ?? "");
}

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

/**
 * @param {{ frozen?: boolean, requestControl?: boolean, controlAsked?: boolean }|null|undefined} viewOnly
 */
export function viewOnlyBanner(viewOnly) {
  if (!viewOnly) return null;
  return {
    title: VIEW_ONLY_HF.bannerTitle,
    body: viewOnly.frozen ? VIEW_ONLY_HF.resourceBody : VIEW_ONLY_HF.permissionBody,
  };
}

/**
 * @param {string} text
 */
export function findForbiddenViewOnlyPhrases(text) {
  const source = String(text ?? "");
  return VIEW_ONLY_FORBIDDEN.filter((phrase) => source.includes(phrase));
}
