/** RDS1 帧与画面载荷解包。与 session-core 字节布局一致。 */

export const FRAME_HEADER_BYTES = 12;
export const VIDEO_HEADER_BYTES = 6;
export const VIDEO_CODEC_JPEG = 1;
export const VIDEO_CODEC_H264 = 2;
export const FRAME_KIND_VIDEO = 1;

const MAGIC = [0x52, 0x44, 0x53, 0x31]; // RDS1
const MAX_PAYLOAD = 4 * 1024 * 1024;

/**
 * 从缓冲前端取出完整一帧；不够则返回 null。
 * @param {Uint8Array} buffer
 * @returns {{ frame: Uint8Array, rest: Uint8Array } | null}
 */
export function takeFrame(buffer) {
  if (buffer.length < FRAME_HEADER_BYTES) return null;
  if (
    buffer[0] !== MAGIC[0] ||
    buffer[1] !== MAGIC[1] ||
    buffer[2] !== MAGIC[2] ||
    buffer[3] !== MAGIC[3]
  ) {
    return null;
  }
  if (buffer[4] !== 1) return null;
  const payloadLength = (buffer[8] << 24) | (buffer[9] << 16) | (buffer[10] << 8) | buffer[11];
  if (payloadLength < 0 || payloadLength > MAX_PAYLOAD) return null;
  const total = FRAME_HEADER_BYTES + payloadLength;
  if (buffer.length < total) return null;
  return {
    frame: buffer.subarray(0, total),
    rest: buffer.subarray(total),
  };
}

export function frameKind(frame) {
  return frame[5];
}

export function framePayload(frame) {
  return frame.subarray(FRAME_HEADER_BYTES);
}

/**
 * @param {Uint8Array} payload
 * @returns {{ width: number, height: number, codec: number, body: Uint8Array } | null}
 */
export function unpackVideo(payload) {
  if (payload.length < VIDEO_HEADER_BYTES) return null;
  const width = (payload[0] << 8) | payload[1];
  const height = (payload[2] << 8) | payload[3];
  const codec = payload[4];
  if (codec !== VIDEO_CODEC_JPEG && codec !== VIDEO_CODEC_H264) return null;
  return {
    width,
    height,
    codec,
    body: payload.subarray(VIDEO_HEADER_BYTES),
  };
}
