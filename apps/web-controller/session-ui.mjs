/** Web 控制端会话展示状态。不登录；解码与真 TLS 进中继另刀。 */

export const PHASE = {
  idle: "idle",
  awaitingConsent: "awaiting_consent",
  rejected: "rejected",
  ticketReady: "ticket_ready",
  relayPlaceholder: "relay_placeholder",
  failed: "failed",
};

/**
 * 根据兑换/轮询结果推进相位。
 * @param {string} current
 * @param {{ state?: string | null, ticket?: string | null, error?: string | null }} event
 */
export function nextPhase(current, event) {
  if (event.error) return PHASE.failed;
  const state = event.state ?? "";
  if (state === "rejected") return PHASE.rejected;
  if (state === "awaiting_host_consent") return PHASE.awaitingConsent;
  if (state === "active" || state === "relay_stopped") {
    if (event.ticket && String(event.ticket).length >= 20) {
      return PHASE.relayPlaceholder;
    }
    return PHASE.ticketReady;
  }
  return current === PHASE.idle ? PHASE.idle : current;
}

export function badgeText(phase) {
  switch (phase) {
    case PHASE.awaitingConsent:
      return "等待确认";
    case PHASE.rejected:
      return "已拒绝";
    case PHASE.ticketReady:
      return "中继票已就绪";
    case PHASE.relayPlaceholder:
      return "中继";
    case PHASE.failed:
      return "未接通";
    default:
      return "等待链路";
  }
}

export function pictureText(phase) {
  switch (phase) {
    case PHASE.awaitingConsent:
      return "等待被控端确认";
    case PHASE.rejected:
      return "被控端已拒绝";
    case PHASE.ticketReady:
      return "中继票已就绪";
    case PHASE.relayPlaceholder:
      return "已接通中继（占位画面）";
    case PHASE.failed:
      return "连接失败";
    default:
      return "等待画面";
  }
}

export function shouldPoll(phase) {
  return phase === PHASE.awaitingConsent;
}
