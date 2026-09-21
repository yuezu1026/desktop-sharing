/** 安卓被控端会话状态。界面层只读 chrome，不在这里碰录屏/无障碍。 */

import { HOST_HF, hostSelfCheckRows } from "./host-hf.mjs";
import { displayDeviceCode, generateDeviceCode, generateTempPassword } from "./host-identity.mjs";

/**
 * @returns {{
 *   acceptConnections: boolean,
 *   deviceCode: string,
 *   tempPassword: string,
 *   peerLabel: string,
 *   copyFeedback: boolean,
 *   selfCheck: {
 *     screenCapture: "ok" | "need" | "unset",
 *     accessibility: "ok" | "need" | "unset",
 *     batteryWhitelist: "ok" | "need" | "unset",
 *     notification: "ok" | "need" | "unset",
 *   },
 * }}
 */
export function createHostSession() {
  return {
    acceptConnections: true,
    deviceCode: "",
    tempPassword: "",
    peerLabel: "",
    copyFeedback: false,
    selfCheck: {
      screenCapture: "need",
      accessibility: "need",
      batteryWhitelist: "unset",
      notification: "need",
    },
  };
}

/**
 * 首次进入本机页时补齐识别码与临时密码。
 * @param {ReturnType<typeof createHostSession>} session
 * @param {{ nextCode?: () => string, nextPassword?: () => string }} [rng]
 */
export function ensureHostIdentity(session, rng = {}) {
  if (session.deviceCode && session.tempPassword) return session;
  const nextCode = typeof rng.nextCode === "function" ? rng.nextCode : () => generateDeviceCode();
  const nextPassword =
    typeof rng.nextPassword === "function" ? rng.nextPassword : () => generateTempPassword();
  return {
    ...session,
    deviceCode: session.deviceCode || nextCode(),
    tempPassword: session.tempPassword || nextPassword(),
  };
}

/**
 * @param {ReturnType<typeof createHostSession>} session
 * @param {() => string} [nextPassword]
 */
export function rotateTempPassword(session, nextPassword) {
  const makePassword = typeof nextPassword === "function" ? nextPassword : () => generateTempPassword();
  return {
    ...session,
    tempPassword: makePassword(),
    copyFeedback: false,
  };
}

/**
 * @param {ReturnType<typeof createHostSession>} session
 * @param {boolean} copyFeedback
 */
export function setCopyFeedback(session, copyFeedback) {
  return { ...session, copyFeedback: copyFeedback === true };
}

/**
 * @param {ReturnType<typeof createHostSession>} session
 * @param {boolean} acceptConnections
 */
export function setAcceptConnections(session, acceptConnections) {
  return { ...session, acceptConnections: acceptConnections === true };
}

/**
 * @param {ReturnType<typeof createHostSession>} session
 * @param {Partial<ReturnType<typeof createHostSession>["selfCheck"]>} patch
 */
export function setSelfCheck(session, patch) {
  return {
    ...session,
    selfCheck: {
      ...session.selfCheck,
      ...patch,
    },
  };
}

/**
 * @param {ReturnType<typeof createHostSession>} session
 */
export function hostChrome(session) {
  const connected = typeof session.peerLabel === "string" && session.peerLabel.length > 0;
  return {
    title: HOST_HF.title,
    acceptLabel: session.acceptConnections ? HOST_HF.acceptOn : HOST_HF.acceptOff,
    acceptOn: session.acceptConnections === true,
    deviceCodeLabel: HOST_HF.deviceCodeLabel,
    deviceCode: session.deviceCode,
    deviceCodeDisplay: displayDeviceCode(session.deviceCode),
    tempPasswordLabel: HOST_HF.tempPasswordLabel,
    tempPassword: session.tempPassword,
    tempPasswordHint: HOST_HF.tempPasswordHint,
    copyLabel: session.copyFeedback ? HOST_HF.copied : HOST_HF.copy,
    rotatePasswordLabel: HOST_HF.rotatePassword,
    statusLabel: connected ? session.peerLabel : HOST_HF.idleStatus,
    statusHint: connected ? "" : HOST_HF.connectedHint,
    selfCheckTitle: HOST_HF.selfCheckTitle,
    selfCheck: hostSelfCheckRows(session.selfCheck),
    fraudTitle: HOST_HF.fraudTitle,
    fraudBody: HOST_HF.fraudBody,
    tabs: [HOST_HF.tabHost, HOST_HF.tabPeers, HOST_HF.tabSettings],
    moneyForbidden: true,
  };
}
