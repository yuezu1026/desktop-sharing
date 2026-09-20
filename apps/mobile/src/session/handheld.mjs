/** 手持控制端的布局规则。解码和注入不在这里做。外接大屏不在本阶段。 */

/** 点按区域下限。已定，不从界面缩小。 */
export const MIN_HIT_PX = 44;
/** 唤出条闲置后淡出。线框已写 3 秒。 */
export const SUMMON_IDLE_MS = 3000;
/** 退出沉浸式的两条路径。少一条就不算能退出。 */
export const EXIT_PATHS = ["bar", "back"];

const COMPUTER_PLATFORMS = new Set(["windows", "macos"]);

export function letterbox(containerWidth, containerHeight, pictureWidth, pictureHeight) {
  if (containerWidth <= 0 || containerHeight <= 0 || pictureWidth <= 0 || pictureHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scaledWidth = Math.floor((containerHeight * pictureWidth) / pictureHeight);
  if (scaledWidth <= containerWidth) {
    return {
      left: Math.floor((containerWidth - scaledWidth) / 2),
      top: 0,
      width: scaledWidth,
      height: containerHeight,
    };
  }
  const scaledHeight = Math.floor((containerWidth * pictureHeight) / pictureWidth);
  return {
    left: 0,
    top: Math.floor((containerHeight - scaledHeight) / 2),
    width: containerWidth,
    height: scaledHeight,
  };
}

export function keepsAspect(frameWidth, frameHeight, pictureWidth, pictureHeight) {
  if (frameWidth <= 0 || frameHeight <= 0 || pictureWidth <= 0 || pictureHeight <= 0) return false;
  const difference = Math.abs(frameWidth * pictureHeight - frameHeight * pictureWidth);
  return difference <= Math.max(pictureWidth, pictureHeight);
}

export function createSession() {
  return {
    screen: "devices",
    linkMode: "relay",
    immersive: false,
    summoned: false,
    pointerMode: "trackpad",
    magnifier: false,
    focusFollow: true,
    keyboardOpen: false,
    orientation: "portrait",
    orientationBefore: "portrait",
    viewOnly: "",
    meterOpen: false,
    showBalance: false,
    displayMinutes: null,
    notice: "",
    subscriptionBadge: "",
    realNameMessage: "",
    waysOpen: false,
    wayTitles: [],
    deviceName: "",
    pictureWidth: 16,
    pictureHeight: 9,
  };
}

export function linkLabel(linkMode) {
  return linkMode === "direct" ? "直连" : "中继";
}

export function deviceRows(payload) {
  const devices = Array.isArray(payload?.devices) ? payload.devices : [];
  const quota = Number.isInteger(payload?.deviceQuota) && payload.deviceQuota > 0 ? payload.deviceQuota : null;
  return {
    quotaText: quota === null ? null : `${devices.length} / ${quota}`,
    rows: devices.map((device) => {
      const platform = String(device.platform ?? "").trim().toLowerCase();
      const computer = COMPUTER_PLATFORMS.has(platform);
      const neverSeen = device.lastSeenAt == null;
      let statusText = "离线";
      if (neverSeen) statusText = "从未连接";
      else if (device.connectionState === "online") statusText = "在线";
      return {
        hostDeviceId: device.hostDeviceId,
        displayName: device.displayName,
        platform,
        statusText,
        connectable: computer,
        actionLabel: computer ? "连接" : "仅绑定",
        minHit: MIN_HIT_PX,
      };
    }),
  };
}

export function connectDevice(session, row) {
  if (!row?.connectable) return session;
  return {
    ...session,
    screen: "session",
    deviceName: row.displayName ?? "",
    immersive: false,
    viewOnly: "",
  };
}

/** 检测到外接显示也不改成桌面布局。这一阶段只有手持。 */
export function noticeExternalDisplay(session) {
  return session;
}

export function setPointerMode(session, pointerMode) {
  if (pointerMode !== "trackpad" && pointerMode !== "direct") return session;
  return { ...session, pointerMode };
}

export function toggleMagnifier(session) {
  return { ...session, magnifier: !session.magnifier };
}

export function toggleFocusFollow(session) {
  return { ...session, focusFollow: !session.focusFollow };
}

export function setKeyboardOpen(session, keyboardOpen) {
  return { ...session, keyboardOpen: keyboardOpen === true };
}

export function enterImmersive(session) {
  if (session.screen !== "session") return session;
  return {
    ...session,
    immersive: true,
    summoned: false,
    orientationBefore: session.orientation,
  };
}

export function leaveImmersive(session, path) {
  if (!session.immersive) return session;
  if (path !== "bar" && path !== "back") return session;
  return {
    ...session,
    immersive: false,
    summoned: false,
    orientation: session.orientationBefore,
  };
}

export function rotate(session, orientation) {
  if (orientation !== "portrait" && orientation !== "landscape") return session;
  return { ...session, orientation };
}

export function summonFromEdge(session, edge) {
  if (!session.immersive) return session;
  if (edge !== "bottom" && edge !== "right") return session;
  return { ...session, summoned: true };
}

export function hideSummonIfIdle(session, idleMs) {
  if (!session.summoned) return session;
  if (idleMs < SUMMON_IDLE_MS) return session;
  return { ...session, summoned: false };
}

export function gestureHint(pointerMode) {
  if (pointerMode === "direct") return "点在画面上的位置，就是对方电脑上的位置";
  return "单指移动光标 · 双指滚动 · 双指轻点 = 右键";
}

export function layoutPicture(input) {
  const keyboardHeight = input.keyboardOpen ? Math.max(0, input.keyboardHeight) : 0;
  const viewHeight = Math.max(0, input.containerHeight - keyboardHeight);
  const base = letterbox(input.containerWidth, viewHeight, input.pictureWidth, input.pictureHeight);
  const focus = input.focusRect;
  if (!input.focusFollow || !input.keyboardOpen || !focus || focus.width <= 0 || focus.height <= 0) {
    return {
      viewHeight,
      picture: base,
      pushed: keyboardHeight > 0,
    };
  }
  const upperHeight = Math.max(1, Math.floor(viewHeight / 2));
  const fitted = Math.min(upperHeight / focus.height, input.containerWidth / focus.width);
  const baseScale = input.pictureWidth > 0 ? base.width / input.pictureWidth : 1;
  const scale = Math.max(fitted, baseScale);
  const pictureWidth = Math.max(1, Math.floor(input.pictureWidth * scale));
  const pictureHeight = Math.max(1, Math.floor(input.pictureHeight * scale));
  const focusTop = Math.floor(focus.top * (pictureHeight / input.pictureHeight));
  const focusLeft = Math.floor(focus.left * (pictureWidth / input.pictureWidth));
  const focusWidth = Math.max(1, Math.floor(focus.width * (pictureWidth / input.pictureWidth)));
  return {
    viewHeight,
    picture: {
      left: Math.floor((input.containerWidth - focusWidth) / 2) - focusLeft,
      top: -focusTop,
      width: pictureWidth,
      height: pictureHeight,
    },
    pushed: true,
  };
}

export function magnifierSample(pictureWidth, pictureHeight, pointerX, pointerY) {
  const shortSide = Math.min(pictureWidth, pictureHeight);
  const sampleSide = Math.max(1, Math.floor(shortSide / 2));
  const maxLeft = Math.max(0, pictureWidth - sampleSide);
  const maxTop = Math.max(0, pictureHeight - sampleSide);
  const sampleLeft = Math.min(maxLeft, Math.max(0, pointerX - Math.floor(sampleSide / 2)));
  const sampleTop = Math.min(maxTop, Math.max(0, pointerY - Math.floor(sampleSide / 2)));
  return { sampleLeft, sampleTop, sampleSide };
}

export function mapTouch(pointerMode, touch, frame, pictureWidth, pictureHeight) {
  if (pointerMode === "trackpad") {
    return { kind: "relative", deltaX: touch.deltaX, deltaY: touch.deltaY };
  }
  const inside =
    touch.x >= frame.left &&
    touch.y >= frame.top &&
    touch.x < frame.left + frame.width &&
    touch.y < frame.top + frame.height;
  if (!inside || frame.width <= 0 || frame.height <= 0) return { kind: "ignored" };
  return {
    kind: "absolute",
    pictureX: Math.floor(((touch.x - frame.left) * pictureWidth) / frame.width),
    pictureY: Math.floor(((touch.y - frame.top) * pictureHeight) / frame.height),
  };
}

/** 采样结果交给原生会话模块。JavaScript 不编码，也不注入键鼠。 */
export function touchSample(mapped) {
  return { module: "session-core", mapped };
}

export function applyBalance(session, body) {
  const viewOnly = body?.viewOnly === "resource" || body?.viewOnly === "permission" ? body.viewOnly : "";
  const wayTitles = Array.isArray(body?.ways)
    ? body.ways.map((item) => item?.title).filter((title) => typeof title === "string")
    : [];
  return {
    ...session,
    showBalance: body?.showBalance === true,
    displayMinutes: Number.isInteger(body?.displayMinutes) ? body.displayMinutes : null,
    notice: typeof body?.notice === "string" ? body.notice : "",
    subscriptionBadge: typeof body?.subscriptionBadge === "string" ? body.subscriptionBadge : "",
    realNameMessage: typeof body?.realName?.message === "string" ? body.realName.message : "",
    viewOnly,
    wayTitles,
    waysOpen: viewOnly === "resource" ? session.waysOpen : false,
    linkMode: body?.linkMode === "direct" ? "direct" : session.linkMode,
  };
}

export function openMeter(session) {
  return { ...session, meterOpen: true };
}

export function openWays(session) {
  if (session.viewOnly !== "resource") return session;
  return { ...session, waysOpen: true };
}

/** 观看方可以提出请求。确认仍在对方电脑上，这里不代为同意。 */
export function askControl(session) {
  if (session.viewOnly !== "permission") return session;
  return { ...session, controlAsked: true };
}

export function sessionChrome(session) {
  const quotaNumber = session.meterOpen && session.showBalance ? session.displayMinutes : null;
  let viewOnly = null;
  if (session.viewOnly === "resource") {
    viewOnly = {
      frozen: true,
      requestControl: false,
      line: "画面已停在最后一帧，暂时无法继续",
    };
  } else if (session.viewOnly === "permission") {
    viewOnly = {
      frozen: false,
      requestControl: true,
      line: "画面仍在实时更新，只是你的操作不会发到对方电脑。",
      controlAsked: session.controlAsked === true,
    };
  }
  return {
    linkLabel: linkLabel(session.linkMode),
    badgeVisible: true,
    deviceName: session.deviceName,
    quotaNumber,
    waiting: "等待画面",
    viewOnly,
    pointerMode: session.pointerMode,
    magnifier: session.magnifier,
    focusFollow: session.focusFollow,
    immersive: session.immersive,
    summoned: session.summoned,
    summonAtBottom: true,
    exitPaths: EXIT_PATHS.slice(),
    externalDisplay: false,
    ways: session.waysOpen ? session.wayTitles.slice() : [],
    notice: session.notice,
    subscriptionBadge: session.subscriptionBadge,
    realNameMessage: session.realNameMessage,
    minHit: MIN_HIT_PX,
  };
}

export function disconnect() {
  return { ...createSession(), confirmAgain: false };
}
