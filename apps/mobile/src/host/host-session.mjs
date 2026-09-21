/** 安卓被控端会话状态。界面层只读 chrome，不在这里碰录屏/无障碍。 */

import { HOST_HF, hostSelfCheckRows } from "./host-hf.mjs";

/**
 * @returns {{
 *   acceptConnections: boolean,
 *   deviceCode: string,
 *   tempPassword: string,
 *   peerLabel: string,
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
    selfCheck: {
      screenCapture: "need",
      accessibility: "need",
      batteryWhitelist: "unset",
      notification: "need",
    },
  };
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
    tempPasswordLabel: HOST_HF.tempPasswordLabel,
    tempPassword: session.tempPassword,
    tempPasswordHint: HOST_HF.tempPasswordHint,
    statusLabel: connected ? session.peerLabel : HOST_HF.idleStatus,
    statusHint: connected ? "" : HOST_HF.connectedHint,
    selfCheckTitle: HOST_HF.selfCheckTitle,
    selfCheck: hostSelfCheckRows(session.selfCheck),
    fraudTitle: HOST_HF.fraudTitle,
    fraudBody: HOST_HF.fraudBody,
    tabs: [HOST_HF.tabHost, HOST_HF.tabPeers, HOST_HF.tabSettings],
    // 可观察红线：被控端 chrome 禁止金额相关字段
    moneyForbidden: true,
  };
}
