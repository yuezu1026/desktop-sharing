/** Annex-B 拆包与 AVC 配置。供 WebCodecs VideoDecoder 使用。 */

/**
 * @param {Uint8Array} bytes
 * @returns {Uint8Array[]}
 */
export function splitAnnexB(bytes) {
  const nals = [];
  let index = 0;
  while (index + 3 < bytes.length) {
    let startCode = 0;
    if (bytes[index] === 0 && bytes[index + 1] === 0 && bytes[index + 2] === 1) {
      startCode = 3;
    } else if (
      index + 4 <= bytes.length &&
      bytes[index] === 0 &&
      bytes[index + 1] === 0 &&
      bytes[index + 2] === 0 &&
      bytes[index + 3] === 1
    ) {
      startCode = 4;
    } else {
      index += 1;
      continue;
    }
    const nalStart = index + startCode;
    let nalEnd = bytes.length;
    let scan = nalStart;
    while (scan + 3 < bytes.length) {
      if (bytes[scan] === 0 && bytes[scan + 1] === 0 && bytes[scan + 2] === 1) {
        nalEnd = scan;
        break;
      }
      if (
        scan + 4 <= bytes.length &&
        bytes[scan] === 0 &&
        bytes[scan + 1] === 0 &&
        bytes[scan + 2] === 0 &&
        bytes[scan + 3] === 1
      ) {
        nalEnd = scan;
        break;
      }
      scan += 1;
    }
    if (nalEnd > nalStart) {
      nals.push(bytes.subarray(nalStart, nalEnd));
    }
    index = nalEnd;
  }
  return nals;
}

export function nalType(nal) {
  return nal.length > 0 ? nal[0] & 0x1f : 0;
}

export function annexBHasIdr(bytes) {
  for (const nal of splitAnnexB(bytes)) {
    const type = nalType(nal);
    if (type === 5) return true;
  }
  return false;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ sps: Uint8Array, pps: Uint8Array } | null}
 */
export function findSpsPps(bytes) {
  let sps = null;
  let pps = null;
  for (const nal of splitAnnexB(bytes)) {
    const type = nalType(nal);
    if (type === 7 && !sps) sps = nal;
    if (type === 8 && !pps) pps = nal;
  }
  if (!sps || !pps) return null;
  return { sps, pps };
}

/**
 * 从 SPS 拼出 WebCodecs 用的 codec 字符串，例如 avc1.42C01E。
 * @param {Uint8Array} sps
 */
export function codecStringFromSps(sps) {
  if (sps.length < 4) return null;
  const profile = sps[1];
  const constraints = sps[2];
  const level = sps[3];
  const hex = (value) => value.toString(16).toUpperCase().padStart(2, "0");
  return `avc1.${hex(profile)}${hex(constraints)}${hex(level)}`;
}

/**
 * 组装 AVCDecoderConfigurationRecord（avcC）。
 * @param {Uint8Array} sps
 * @param {Uint8Array} pps
 */
export function buildAvcC(sps, pps) {
  if (sps.length < 4) return null;
  const out = new Uint8Array(11 + sps.length + pps.length);
  let offset = 0;
  out[offset++] = 1;
  out[offset++] = sps[1];
  out[offset++] = sps[2];
  out[offset++] = sps[3];
  out[offset++] = 0xff;
  out[offset++] = 0xe1;
  out[offset++] = (sps.length >> 8) & 0xff;
  out[offset++] = sps.length & 0xff;
  out.set(sps, offset);
  offset += sps.length;
  out[offset++] = 1;
  out[offset++] = (pps.length >> 8) & 0xff;
  out[offset++] = pps.length & 0xff;
  out.set(pps, offset);
  return out;
}

/**
 * Annex-B 访问单元 → AVCC（每 NAL 前加 4 字节大端长度）。
 * @param {Uint8Array} bytes
 */
export function annexBToLengthPrefixed(bytes) {
  const nals = splitAnnexB(bytes).filter((nal) => {
    const type = nalType(nal);
    return type !== 7 && type !== 8 && type !== 9;
  });
  if (nals.length === 0) return null;
  let total = 0;
  for (const nal of nals) total += 4 + nal.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const nal of nals) {
    out[offset++] = (nal.length >>> 24) & 0xff;
    out[offset++] = (nal.length >>> 16) & 0xff;
    out[offset++] = (nal.length >>> 8) & 0xff;
    out[offset++] = nal.length & 0xff;
    out.set(nal, offset);
    offset += nal.length;
  }
  return out;
}
