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

/** 成本测算表 §0 P5 码率档位 → 界面档位文案（W1-05c 必须写到具体档）。 */
const QUALITY_TIERS: ReadonlyArray<{ kbps: number; label: string }> = [
  { kbps: 2_000, label: "720p/30" },
  { kbps: 4_000, label: "1080p/30" },
  { kbps: 8_000, label: "1080p/60" },
  { kbps: 12_000, label: "2K/60" },
  { kbps: 20_000, label: "4K/60" },
];

export function qualityLabel(kbps: number): string {
  const hit = QUALITY_TIERS.find((tier) => tier.kbps === kbps);
  return hit ? hit.label : formatRate(kbps);
}

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
      notice: `画质已降低：${qualityLabel(input.bitrateKbps)} → ${qualityLabel(degradeTarget)}`,
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
