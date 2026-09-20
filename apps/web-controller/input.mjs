/** 输入事件编码。与 session-core 字节布局一致；坐标是画面像素。 */

export const INPUT_POINTER_MOVE = 1;
export const INPUT_POINTER_DOWN = 2;
export const INPUT_POINTER_UP = 3;
export const INPUT_WHEEL = 4;
export const INPUT_KEY_DOWN = 5;
export const INPUT_KEY_UP = 6;

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
 * @param {number} keyCode
 */
export function encodeKey(kind, keyCode) {
  const out = new Uint8Array(5);
  out[0] = kind;
  const value = keyCode >>> 0;
  out[1] = (value >>> 24) & 0xff;
  out[2] = (value >>> 16) & 0xff;
  out[3] = (value >>> 8) & 0xff;
  out[4] = value & 0xff;
  return out;
}

/**
 * 把元素内点击映射到等比留边后的画面像素；点在黑边上返回 null。
 * @param {number} clientX
 * @param {number} clientY
 * @param {DOMRect} rect
 * @param {number} pictureWidth
 * @param {number} pictureHeight
 */
export function mapPointerToPicture(clientX, clientY, rect, pictureWidth, pictureHeight) {
  if (pictureWidth <= 0 || pictureHeight <= 0 || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const scale = Math.min(rect.width / pictureWidth, rect.height / pictureHeight);
  const drawWidth = pictureWidth * scale;
  const drawHeight = pictureHeight * scale;
  const offsetX = (rect.width - drawWidth) / 2;
  const offsetY = (rect.height - drawHeight) / 2;
  const localX = clientX - rect.left - offsetX;
  const localY = clientY - rect.top - offsetY;
  if (localX < 0 || localY < 0 || localX > drawWidth || localY > drawHeight) {
    return null;
  }
  return {
    x: Math.min(pictureWidth - 1, Math.max(0, Math.floor(localX / scale))),
    y: Math.min(pictureHeight - 1, Math.max(0, Math.floor(localY / scale))),
  };
}

function writeI32(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}
