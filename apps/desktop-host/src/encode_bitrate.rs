//! 编码码率。kbps 由服务端下发；这里只做单位换算与编码器安全上下限，不写产品档位。

/// 服务端字段缺失时的技术回退，不是对外主张的免费档。
pub const FALLBACK_BITRATE_KBPS: u32 = 900;

const MIN_BITRATE_BPS: u32 = 64_000;
const MAX_BITRATE_BPS: u32 = 50_000_000;

/// 把服务端 kbps 换成编码器 bps，并夹在可编码区间。
pub fn bitrate_bps_from_kbps(kbps: u32) -> u32 {
    kbps.saturating_mul(1_000).clamp(MIN_BITRATE_BPS, MAX_BITRATE_BPS)
}

/// 解析服务端字段；缺省或 0 时用技术回退。
pub fn resolve_bitrate_kbps(server_kbps: Option<u32>) -> u32 {
    match server_kbps {
        Some(value) if value > 0 => value,
        _ => FALLBACK_BITRATE_KBPS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_kbps_to_bps() {
        assert_eq!(bitrate_bps_from_kbps(4_000), 4_000_000);
        assert_eq!(bitrate_bps_from_kbps(900), 900_000);
    }

    #[test]
    fn clamps_extreme_values() {
        assert_eq!(bitrate_bps_from_kbps(1), MIN_BITRATE_BPS);
        assert_eq!(bitrate_bps_from_kbps(u32::MAX), MAX_BITRATE_BPS);
    }

    #[test]
    fn missing_or_zero_uses_fallback() {
        assert_eq!(resolve_bitrate_kbps(None), FALLBACK_BITRATE_KBPS);
        assert_eq!(resolve_bitrate_kbps(Some(0)), FALLBACK_BITRATE_KBPS);
        assert_eq!(resolve_bitrate_kbps(Some(2_000)), 2_000);
    }
}
