/** 安卓被控端连接确认（W7-07）。拒绝是唯一实心主按钮。 */

import { HOST_CONFIRM_HF } from "./host-hf.mjs";

/**
 * @param {{
 *   accountMask: string,
 *   displayName?: string,
 *   deviceName: string,
 *   platform?: string,
 *   region?: string,
 *   firstConnection?: boolean,
 *   priorCount?: number,
 *   priorDaysAgo?: number,
 * }} input
 */
export function createHostConsent(input) {
  return {
    accountMask: String(input.accountMask || ""),
    displayName: String(input.displayName || ""),
    deviceName: String(input.deviceName || ""),
    platform: String(input.platform || ""),
    region: String(input.region || ""),
    firstConnection: input.firstConnection !== false,
    priorCount: Number(input.priorCount) || 0,
    priorDaysAgo: Number(input.priorDaysAgo) || 0,
    decision: "",
  };
}

/**
 * @param {ReturnType<typeof createHostConsent>} consent
 */
export function refuseHostConsent(consent) {
  if (!consent || consent.decision) return consent;
  return { ...consent, decision: "refused" };
}

/**
 * @param {ReturnType<typeof createHostConsent>} consent
 * @param {"control" | "viewOnly"} [mode]
 */
export function allowHostConsent(consent, mode = "control") {
  if (!consent || consent.decision) return consent;
  return { ...consent, decision: mode === "viewOnly" ? "viewOnly" : "allowed" };
}

/**
 * @param {ReturnType<typeof createHostConsent>} consent
 */
export function hostConsentChrome(consent) {
  const closed = Boolean(consent.decision);
  const prior =
    !consent.firstConnection && consent.priorCount > 0
      ? `上次连接：${consent.priorDaysAgo} 天前 · 已连过 ${consent.priorCount} 次`
      : "";
  const namePart = consent.displayName ? `（${consent.displayName}）` : "";
  return {
    title: HOST_CONFIRM_HF.title,
    subtitle: HOST_CONFIRM_HF.subtitle,
    whoLabel: HOST_CONFIRM_HF.whoLabel,
    accountLine: `账号 ${consent.accountMask}${namePart}`,
    deviceLine: `设备：${consent.deviceName}${consent.platform ? ` · ${consent.platform}` : ""}`,
    regionLine: consent.region ? `来自 ${consent.region}` : "",
    priorLine: prior,
    pill: consent.firstConnection ? HOST_CONFIRM_HF.pillFirst : HOST_CONFIRM_HF.pillAgain,
    canLabel: HOST_CONFIRM_HF.canLabel,
    canLines: [HOST_CONFIRM_HF.canSee, HOST_CONFIRM_HF.canInput, HOST_CONFIRM_HF.canFiles],
    fraudTitle: HOST_CONFIRM_HF.fraudTitle,
    fraudLines: HOST_CONFIRM_HF.fraudLines,
    allowLabel: HOST_CONFIRM_HF.allow,
    allowViewOnlyLabel: HOST_CONFIRM_HF.allowViewOnly,
    refuseLabel: HOST_CONFIRM_HF.refuse,
    footnote: HOST_CONFIRM_HF.footnote,
    refusePrimary: true,
    allowPrimary: false,
    closed,
    decision: consent.decision || "",
  };
}
