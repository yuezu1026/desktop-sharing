//! 打洞分桶。四个值与控制面一致：home_home / one_hard_nat / both_hard_nat / udp_blocked。

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

/// 探测成功：能通就记家庭对家庭（易 NAT / 局域网）。
pub fn bucket_on_success(_from: SocketAddr) -> &'static str {
    "home_home"
}

/// 探测失败：按双方是否拿出公网候选区分硬 NAT 与封 UDP。
pub fn bucket_on_failure(local_has_public: bool, peer_has_public: bool) -> &'static str {
    match (local_has_public, peer_has_public) {
        (false, false) => "udp_blocked",
        (true, true) => "both_hard_nat",
        _ => "one_hard_nat",
    }
}

pub fn candidate_looks_public(raw: &str) -> bool {
    let Some(address) = parse_socket(raw) else {
        return false;
    };
    match address.ip() {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(_) => false,
    }
}

pub fn any_public_candidate(candidates: &[String]) -> bool {
    candidates.iter().any(|item| candidate_looks_public(item))
}

fn parse_socket(raw: &str) -> Option<SocketAddr> {
    let trimmed = raw.trim().strip_prefix("udp:").unwrap_or(raw.trim());
    trimmed.parse().ok()
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() || ip.is_link_local() || ip.is_broadcast() {
        return false;
    }
    if ip.is_private() {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failure_neither_public_is_udp_blocked() {
        assert_eq!(bucket_on_failure(false, false), "udp_blocked");
    }

    #[test]
    fn failure_both_public_is_both_hard_nat() {
        assert_eq!(bucket_on_failure(true, true), "both_hard_nat");
    }

    #[test]
    fn failure_one_side_public_is_one_hard_nat() {
        assert_eq!(bucket_on_failure(true, false), "one_hard_nat");
        assert_eq!(bucket_on_failure(false, true), "one_hard_nat");
    }

    #[test]
    fn success_is_home_home() {
        let address: SocketAddr = "192.168.1.2:4000".parse().unwrap();
        assert_eq!(bucket_on_success(address), "home_home");
    }

    #[test]
    fn detects_public_and_private_candidates() {
        assert!(candidate_looks_public("203.0.113.10:3478"));
        assert!(!candidate_looks_public("192.168.0.8:3478"));
        assert!(!candidate_looks_public("127.0.0.1:3478"));
        assert!(!candidate_looks_public("10.0.0.3:3478"));
    }
}
