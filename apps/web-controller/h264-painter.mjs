/** 浏览器侧 H264 播放：Annex-B → WebCodecs → canvas。 */

import {
  annexBHasIdr,
  annexBToLengthPrefixed,
  buildAvcC,
  codecStringFromSps,
  findSpsPps,
} from "/web/h264.mjs";

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createH264Painter(canvas) {
  const context = canvas.getContext("2d");
  /** @type {VideoDecoder | null} */
  let decoder = null;
  let configured = false;
  let timestamp = 0;

  function ensureDecoder() {
    if (decoder) return decoder;
    if (typeof VideoDecoder === "undefined") return null;
    decoder = new VideoDecoder({
      output: (frame) => {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
        context.drawImage(frame, 0, 0);
        frame.close();
        canvas.style.display = "block";
      },
      error: () => {
        configured = false;
        decoder = null;
      },
    });
    return decoder;
  }

  /**
   * @param {Uint8Array} annexB
   * @returns {boolean} 是否已投递解码
   */
  function pushAnnexB(annexB) {
    const active = ensureDecoder();
    if (!active) return false;

    if (!configured) {
      const pair = findSpsPps(annexB);
      if (!pair) return false;
      const codec = codecStringFromSps(pair.sps);
      const description = buildAvcC(pair.sps, pair.pps);
      if (!codec || !description) return false;
      try {
        active.configure({
          codec,
          description,
          optimizeForLatency: true,
        });
        configured = true;
      } catch {
        configured = false;
        decoder = null;
        return false;
      }
    }

    if (!annexBHasIdr(annexB) && active.decodeQueueSize > 4) {
      return true;
    }
    const payload = annexBToLengthPrefixed(annexB);
    if (!payload) return false;
    try {
      active.decode(
        new EncodedVideoChunk({
          type: annexBHasIdr(annexB) ? "key" : "delta",
          timestamp: timestamp++,
          data: payload,
        }),
      );
      return true;
    } catch {
      configured = false;
      try {
        active.reset();
      } catch {
        /* ignore */
      }
      decoder = null;
      return false;
    }
  }

  function close() {
    if (decoder) {
      try {
        decoder.close();
      } catch {
        /* ignore */
      }
      decoder = null;
    }
    configured = false;
  }

  return { pushAnnexB, close, supported: typeof VideoDecoder !== "undefined" };
}
