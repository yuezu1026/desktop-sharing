//! 编码码率。kbps 由服务端下发；这里只做单位换算与编码器安全上下限，不写产品档位。

use std::net::IpAddr;

/// 服务端字段缺失时的技术回退，不是对外主张的免费档。
pub const FALLBACK_BITRATE_KBPS: u32 = 900;

/// 内网采集宽度技术天花板（约 8K），实际还会被屏幕宽度截断。
pub const INTRANET_CAPTURE_WIDTH_CAP: i32 = 7680;

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

/// 按服务端码率选采集最大宽度。阈值对齐成本测算表 P5（720p≈2 Mbps、1080p≈4 Mbps），不另写产品数字。
pub fn max_capture_width_for_bitrate_kbps(kbps: u32) -> i32 {
    if kbps >= 4_000 {
        1920
    } else if kbps >= 2_000 {
        1280
    } else {
        960
    }
}

/// 中继/对端地址是否内网（环回或 RFC1918）。内网不按免费档限分辨率。
pub fn relay_address_is_intranet(address: &str) -> bool {
    if std::env::var("DESKTOP_HOST_NATIVE_RESOLUTION")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        return true;
    }
    let host = address
        .rsplit_once(':')
        .map(|(hostname, _port)| hostname)
        .unwrap_or(address)
        .trim();
    let host = host.trim_matches(|ch| ch == '[' || ch == ']');
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => v4.is_loopback() || v4.is_private(),
        Ok(IpAddr::V6(v6)) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00,
        Err(_) => false,
    }
}

/// 内网中继或点对点直连时不按码率档限宽；公网中继仍限宽。
pub fn resolve_capture_max_width(kbps: u32, uncapped_resolution: bool) -> i32 {
    if uncapped_resolution {
        INTRANET_CAPTURE_WIDTH_CAP
    } else {
        max_capture_width_for_bitrate_kbps(kbps)
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

    #[test]
    fn capture_width_follows_bitrate_tiers() {
        assert_eq!(max_capture_width_for_bitrate_kbps(4_000), 1920);
        assert_eq!(max_capture_width_for_bitrate_kbps(8_000), 1920);
        assert_eq!(max_capture_width_for_bitrate_kbps(2_000), 1280);
        assert_eq!(max_capture_width_for_bitrate_kbps(900), 960);
    }

    #[test]
    fn intranet_skips_bitrate_width_cap() {
        assert_eq!(resolve_capture_max_width(900, true), INTRANET_CAPTURE_WIDTH_CAP);
        assert_eq!(resolve_capture_max_width(4_000, false), 1920);
    }

    #[test]
    fn detects_private_relay_addresses() {
        assert!(relay_address_is_intranet("127.0.0.1:443"));
        assert!(relay_address_is_intranet("192.168.3.23:443"));
        assert!(relay_address_is_intranet("10.0.0.8:8443"));
        assert!(relay_address_is_intranet("172.16.1.2:443"));
        assert!(relay_address_is_intranet("localhost:443"));
        assert!(!relay_address_is_intranet("8.8.8.8:443"));
        assert!(!relay_address_is_intranet("turn.example.com:443"));
    }
}
