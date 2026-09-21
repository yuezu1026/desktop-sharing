/**
 * 触控板手势分类：单指移动/轻点左键，双指滚动/轻点右键。
 * 协议按钮：0 左 · 1 右 · 2 中（与 Web / 被控端 inject 一致）。
 */

export const POINTER_BUTTON_LEFT = 0;
export const POINTER_BUTTON_RIGHT = 1;
export const TRACKPAD_TAP_SLOP_PX = 12;
export const TRACKPAD_TAP_MAX_MS = 280;
export const TRACKPAD_WHEEL_SCALE = 2;

/**
 * @param {{
 *   touchCount: number,
 *   stepDx?: number,
 *   stepDy?: number,
 *   totalDx?: number,
 *   totalDy?: number,
 *   durationMs?: number,
 *   phase: "move" | "end",
 * }} input
 */
export function classifyTrackpadStroke(input) {
  const touchCount = input.touchCount | 0;
  const stepDx = input.stepDx | 0;
  const stepDy = input.stepDy | 0;
  const totalDx = input.totalDx | 0;
  const totalDy = input.totalDy | 0;
  const durationMs = input.durationMs | 0;
  const distance = Math.hypot(totalDx, totalDy);

  if (touchCount >= 2) {
    if (
      input.phase === "end" &&
      distance <= TRACKPAD_TAP_SLOP_PX &&
      durationMs <= TRACKPAD_TAP_MAX_MS
    ) {
      return { kind: "rightClick" };
    }
    if (input.phase === "move" && (Math.abs(stepDy) >= 1 || Math.abs(stepDx) >= 1)) {
      const delta = Math.round(-(stepDy || 0) * TRACKPAD_WHEEL_SCALE);
      if (delta !== 0) return { kind: "wheel", delta };
    }
    return { kind: "ignore" };
  }

  if (touchCount === 1) {
    if (input.phase === "move" && (Math.abs(stepDx) >= 1 || Math.abs(stepDy) >= 1)) {
      return { kind: "move", deltaX: stepDx, deltaY: stepDy };
    }
    if (
      input.phase === "end" &&
      distance <= TRACKPAD_TAP_SLOP_PX &&
      durationMs <= TRACKPAD_TAP_MAX_MS
    ) {
      return { kind: "leftClick" };
    }
  }

  return { kind: "ignore" };
}
