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
}
