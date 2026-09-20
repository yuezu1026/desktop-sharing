//! 中继媒体是否继续上送。资源式停转后被控端不再编码，控制端留最后一帧。

/// `session_state` 来自控制面远程会话状态。
pub fn should_send_relay_video(session_state: &str) -> bool {
    match session_state.trim() {
        "relay_stopped" | "closed" | "rejected" => false,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_keeps_sending() {
        assert!(should_send_relay_video("active"));
    }

    #[test]
    fn relay_stopped_stops_sending() {
        assert!(!should_send_relay_video("relay_stopped"));
        assert!(!should_send_relay_video("closed"));
        assert!(!should_send_relay_video("rejected"));
    }

    #[test]
    fn awaiting_still_allows_send() {
        assert!(should_send_relay_video("awaiting_host_consent"));
    }
}
