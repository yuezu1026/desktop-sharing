//! H264 码流辅助。只处理 Annex-B 字节约定，不碰编码器句柄。

/// 是否像 Annex-B（以 00 00 01 或 00 00 00 01 开头）。
pub fn looks_like_annex_b(bytes: &[u8]) -> bool {
    if bytes.len() >= 4 && bytes[0] == 0 && bytes[1] == 0 && bytes[2] == 0 && bytes[3] == 1 {
        return true;
    }
    if bytes.len() >= 3 && bytes[0] == 0 && bytes[1] == 0 && bytes[2] == 1 {
        return true;
    }
    false
}

/// 扫描 Annex-B，找到第一个 VCL NAL 的 nal_unit_type（低 5 位）。找不到返回 None。
pub fn first_vcl_nal_type(bytes: &[u8]) -> Option<u8> {
    let mut index = 0usize;
    while index + 3 < bytes.len() {
        let start = if bytes[index] == 0
            && bytes[index + 1] == 0
            && bytes[index + 2] == 0
            && index + 4 < bytes.len()
            && bytes[index + 3] == 1
        {
            index + 4
        } else if bytes[index] == 0 && bytes[index + 1] == 0 && bytes[index + 2] == 1 {
            index + 3
        } else {
            index += 1;
            continue;
        };
        if start >= bytes.len() {
            return None;
        }
        let nal_type = bytes[start] & 0x1f;
        // 1–5 为 VCL；5 为 IDR
        if (1..=5).contains(&nal_type) {
            return Some(nal_type);
        }
        index = start + 1;
    }
    None
}

pub fn annex_b_has_idr(bytes: &[u8]) -> bool {
    first_vcl_nal_type(bytes) == Some(5)
}

/// 采集宽高对齐到 H264 宏块（16 的倍数），避免部分安卓硬解因非对齐尺寸一直不出帧。
pub fn align_h264_dimension(value: i32) -> i32 {
    if value <= 0 {
        return 16;
    }
    let aligned = (value / 16) * 16;
    aligned.max(16)
}

/// 把 4 字节大端长度前缀的 AVCC 风格 NAL 串改成 Annex-B。已是 Annex-B 则原样拷贝。
pub fn ensure_annex_b(bytes: &[u8]) -> Option<Vec<u8>> {
    if looks_like_annex_b(bytes) {
        return Some(bytes.to_vec());
    }
    length_prefixed_to_annex_b(bytes)
}

/// 输入：连续的 `[u32 BE length][nal…]`；输出：带起始码的 Annex-B。
pub fn length_prefixed_to_annex_b(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.is_empty() {
        return None;
    }
    let mut index = 0usize;
    let mut out = Vec::with_capacity(bytes.len() + 16);
    while index + 4 <= bytes.len() {
        let length = u32::from_be_bytes([
            bytes[index],
            bytes[index + 1],
            bytes[index + 2],
            bytes[index + 3],
        ]) as usize;
        index += 4;
        if length == 0 || index + length > bytes.len() {
            return None;
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&bytes[index..index + length]);
        index += length;
    }
    if index != bytes.len() || out.is_empty() {
        return None;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_four_byte_start_code() {
        assert!(looks_like_annex_b(&[0, 0, 0, 1, 0x65]));
        assert!(!looks_like_annex_b(&[0, 0, 2, 1]));
        assert!(!looks_like_annex_b(&[]));
    }

    #[test]
    fn finds_idr_after_sps_pps() {
        let stream = [
            0, 0, 0, 1, 0x67, 0x42, // SPS
            0, 0, 0, 1, 0x68, 0xce, // PPS
            0, 0, 0, 1, 0x65, 0x88, // IDR
        ];
        assert!(annex_b_has_idr(&stream));
        assert_eq!(first_vcl_nal_type(&stream), Some(5));
    }

    #[test]
    fn non_idr_slice_is_not_keyframe() {
        let stream = [0, 0, 1, 0x41, 0x9a]; // type 1
        assert!(looks_like_annex_b(&stream));
        assert!(!annex_b_has_idr(&stream));
        assert_eq!(first_vcl_nal_type(&stream), Some(1));
    }

    #[test]
    fn length_prefixed_converts_to_annex_b() {
        let nal = [0x65u8, 0x88, 0x80];
        let mut avcc = Vec::new();
        avcc.extend_from_slice(&(nal.len() as u32).to_be_bytes());
        avcc.extend_from_slice(&nal);
        let annex = length_prefixed_to_annex_b(&avcc).expect("convert");
        assert_eq!(&annex[..4], &[0, 0, 0, 1]);
        assert_eq!(&annex[4..], &nal);
        assert!(annex_b_has_idr(&annex));
    }

    #[test]
    fn ensure_annex_b_passthrough() {
        let stream = [0, 0, 0, 1, 0x65, 0x00];
        let out = ensure_annex_b(&stream).expect("ok");
        assert_eq!(out, stream);
    }

    #[test]
    fn aligns_dimension_to_macroblock() {
        assert_eq!(align_h264_dimension(960), 960);
        assert_eq!(align_h264_dimension(540), 528);
        assert_eq!(align_h264_dimension(15), 16);
        assert_eq!(align_h264_dimension(0), 16);
    }
}
