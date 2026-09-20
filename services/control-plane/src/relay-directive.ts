/** 中继心跳降级裁决：纯函数，便于四态单测。客户端只展示，不在这里算钱。 */

export type RelayDirective = "continue" | "warn" | "suggest_direct" | "degraded" | "stop_relay";

export type HeartbeatDecision = {
  directive: RelayDirective;
  notice: string | null;
  bitrateKbps: number;
};

export type HeartbeatDecisionInput = {
  remainingBytes: number;
  totalBytes: number;
  bitrateKbps: number;
  freeBitrateKbps: number;
  /** 免费档已触顶时再降一档的地板（对齐展示分钟地板，不另写产品数）。 */
  degradeFloorKbps: number;
  acceptDegrade: boolean;
  stopNotice: string | null;
};

export function decideRelayHeartbeat(input: HeartbeatDecisionInput): HeartbeatDecision {
  if (input.remainingBytes <= 0) {
    return {
      directive: "stop_relay",
      notice: "中继已停，会话还在。可以改走直连",
      bitrateKbps: input.bitrateKbps,
    };
  }
  if (input.stopNotice) {
    return {
      directive: "stop_relay",
      notice: input.stopNotice,
      bitrateKbps: input.bitrateKbps,
    };
  }

  const usedRatio = input.totalBytes <= 0 ? 1 : (input.totalBytes - input.remainingBytes) / input.totalBytes;
  const degradeTarget =
    input.bitrateKbps > input.freeBitrateKbps ? input.freeBitrateKbps : input.degradeFloorKbps;

  if (input.acceptDegrade && usedRatio >= 0.8 && input.bitrateKbps > degradeTarget) {
    return {
      directive: "degraded",
      notice: `画质已降低到 ${formatRate(degradeTarget)}`,
      bitrateKbps: degradeTarget,
    };
  }
  if (usedRatio >= 0.95) {
    return {
      directive: "suggest_direct",
      notice: "免费中继时长将尽，可以重新尝试直连",
      bitrateKbps: input.bitrateKbps,
    };
  }
  if (usedRatio >= 0.8) {
    return {
      directive: "warn",
      notice: "免费中继时长已用到约八成",
      bitrateKbps: input.bitrateKbps,
    };
  }
  return { directive: "continue", notice: null, bitrateKbps: input.bitrateKbps };
}

export function formatRate(kbps: number): string {
  if (kbps % 1000 === 0) return `${kbps / 1000} Mbps`;
  return `${kbps} kbps`;
}
