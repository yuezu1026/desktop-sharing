//! 中继 TLS 校验模式。本地环回默认可跳过自签；上线地址默认严格校验。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsVerifyMode {
    /// 用公共根证书校验服务端。
    Strict,
    /// 接受任意证书。仅本地自签或显式打开。
    InsecureSkip,
}

/// `insecure_env` 对应 `RELAY_TLS_INSECURE`：1/true 强制跳过，0/false 强制严格，缺省则看主机是否环回。
pub fn resolve_tls_verify_mode(address_host: &str, insecure_env: Option<&str>) -> TlsVerifyMode {
    match insecure_env.map(str::trim) {
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES") => TlsVerifyMode::InsecureSkip,
        Some("0") | Some("false") | Some("FALSE") | Some("no") | Some("NO") => TlsVerifyMode::Strict,
        _ if is_loopback_host(address_host) => TlsVerifyMode::InsecureSkip,
        _ => TlsVerifyMode::Strict,
    }
}

/// 从 `host:port` 或纯主机名取出主机部分。
pub fn host_from_address(address: &str) -> &str {
    let trimmed = address.trim();
    if let Some(stripped) = trimmed.strip_prefix('[') {
        if let Some(end) = stripped.find(']') {
            return &stripped[..end];
        }
    }
    match trimmed.rfind(':') {
        Some(index) if trimmed[index + 1..].chars().all(|ch| ch.is_ascii_digit()) => &trimmed[..index],
        _ => trimmed,
    }
}

fn is_loopback_host(host: &str) -> bool {
    let lower = host.trim().to_ascii_lowercase();
    lower == "localhost" || lower == "127.0.0.1" || lower == "::1"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_defaults_to_insecure() {
        assert_eq!(
            resolve_tls_verify_mode("127.0.0.1", None),
            TlsVerifyMode::InsecureSkip
        );
        assert_eq!(
            resolve_tls_verify_mode("localhost", None),
            TlsVerifyMode::InsecureSkip
        );
    }

    #[test]
    fn public_host_defaults_to_strict() {
        assert_eq!(
            resolve_tls_verify_mode("relay.example.com", None),
            TlsVerifyMode::Strict
        );
    }

    #[test]
    fn env_can_force_either_way() {
        assert_eq!(
            resolve_tls_verify_mode("relay.example.com", Some("1")),
            TlsVerifyMode::InsecureSkip
        );
        assert_eq!(
            resolve_tls_verify_mode("127.0.0.1", Some("0")),
            TlsVerifyMode::Strict
        );
    }

    #[test]
    fn host_from_address_strips_port() {
        assert_eq!(host_from_address("127.0.0.1:8443"), "127.0.0.1");
        assert_eq!(host_from_address("relay.example.com:443"), "relay.example.com");
        assert_eq!(host_from_address("localhost"), "localhost");
    }
}
