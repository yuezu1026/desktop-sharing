/** 输入事件编码。与 session-core / Web 控制端字节布局一致。 */

export const INPUT_POINTER_MOVE = 1;
export const INPUT_POINTER_DOWN = 2;
export const INPUT_POINTER_UP = 3;
export const INPUT_WHEEL = 4;
export const FRAME_KIND_INPUT = 2;

/**
 * @param {number} kind
 * @param {number} x
 * @param {number} y
 * @param {number} [button]
 */
export function encodePointer(kind, x, y, button = 0) {
  const out = new Uint8Array(10);
  out[0] = kind;
  writeI32(out, 1, x | 0);
  writeI32(out, 5, y | 0);
  out[9] = button & 0xff;
  return out;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} delta
 */
export function encodeWheel(x, y, delta) {
  const out = new Uint8Array(12);
  out.set(encodePointer(INPUT_WHEEL, x, y, 0), 0);
  const clipped = Math.max(-32768, Math.min(32767, delta | 0));
  out[10] = (clipped >> 8) & 0xff;
  out[11] = clipped & 0xff;
  return out;
}

/**
 * @param {number} kind
 * @param {Uint8Array} payload
 */
export function packInputFrame(payload) {
  const out = new Uint8Array(12 + payload.length);
  out[0] = 0x52;
  out[1] = 0x44;
  out[2] = 0x53;
  out[3] = 0x31;
  out[4] = 1;
  out[5] = FRAME_KIND_INPUT;
  const length = payload.length;
  out[8] = (length >>> 24) & 0xff;
  out[9] = (length >>> 16) & 0xff;
  out[10] = (length >>> 8) & 0xff;
  out[11] = length & 0xff;
  out.set(payload, 12);
  return out;
}

/**
 * 触控板相对位移落到画面像素光标。
 * @param {{ cursorX?: number, cursorY?: number, pictureWidth: number, pictureHeight: number }} session
 * @param {number} deltaX
 * @param {number} deltaY
 */
export function moveCursorByDelta(session, deltaX, deltaY) {
  const width = Math.max(1, session.pictureWidth | 0);
  const height = Math.max(1, session.pictureHeight | 0);
  const nextX = Math.min(width - 1, Math.max(0, Math.floor((session.cursorX ?? width / 2) + deltaX)));
  const nextY = Math.min(height - 1, Math.max(0, Math.floor((session.cursorY ?? height / 2) + deltaY)));
  return { ...session, cursorX: nextX, cursorY: nextY };
}

/**
 * 直接触摸的绝对坐标夹紧到画面。
 * @param {number} pictureX
 * @param {number} pictureY
 * @param {number} pictureWidth
 * @param {number} pictureHeight
 */
export function clampPicturePoint(pictureX, pictureY, pictureWidth, pictureHeight) {
  const width = Math.max(1, pictureWidth | 0);
  const height = Math.max(1, pictureHeight | 0);
  return {
    x: Math.min(width - 1, Math.max(0, pictureX | 0)),
    y: Math.min(height - 1, Math.max(0, pictureY | 0)),
  };
}

function writeI32(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

/**
 * Uint8Array → 无换行 base64（RN 原生侧解码）。
 * @param {Uint8Array} bytes
 */
export function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}
