//! 信令交换与打洞探测。探测失败只记结果，不弹窗，也不停中继。

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, UdpSocket};
use std::time::{Duration, Instant};

use serde::Deserialize;
use session_core::{ticket_looks_usable, RelayRole, TicketError};

const PUNCH_MAGIC: &[u8] = b"RDS1PUNCH";
const JOIN_ROUNDS: u32 = 20;
const JOIN_WAIT: Duration = Duration::from_millis(400);
const PROBE_WAIT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SignalError {
    Address,
    Ticket(TicketError),
    Role,
    Http,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PunchOutcome {
    pub reached: bool,
    /// 与控制面打洞分桶一致：home_home / one_hard_nat / both_hard_nat / udp_blocked
    pub bucket: &'static str,
    pub result: &'static str,
    /// 探测成功时对端地址，供后续握手与直连传帧。
    pub peer: Option<SocketAddr>,
}

#[derive(Deserialize)]
struct JoinOk {
    ok: bool,
    #[serde(rename = "remoteSessionId")]
    remote_session_id: Option<String>,
    #[serde(rename = "peerCandidates")]
    peer_candidates: Option<Vec<String>>,
}

/// 绑定本机 UDP，返回「host:port」候选。只报内网可达地址，不做 STUN。
pub fn bind_local_candidate() -> Result<(UdpSocket, String), SignalError> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|_| SignalError::Address)?;
    socket
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|_| SignalError::Address)?;
    let port = socket.local_addr().map_err(|_| SignalError::Address)?.port();
    Ok((socket, format!("127.0.0.1:{port}")))
}

/// 向信令登记本端候选，并轮询直到拿到对端候选或超时。
pub fn exchange_candidates(
    signal_origin: &str,
    ticket: &str,
    role: RelayRole,
    fingerprint: &str,
    candidates: &[String],
) -> Result<(String, Vec<String>), SignalError> {
    ticket_looks_usable(ticket).map_err(SignalError::Ticket)?;
    let mut last_session = String::new();
    for _round in 0..JOIN_ROUNDS {
        let joined = join_once(signal_origin, ticket, role, fingerprint, candidates)?;
        if !joined.1.is_empty() {
            return Ok(joined);
        }
        last_session = joined.0;
        std::thread::sleep(JOIN_WAIT);
    }
    Ok((last_session, Vec::new()))
}

fn join_once(
    signal_origin: &str,
    ticket: &str,
    role: RelayRole,
    fingerprint: &str,
    candidates: &[String],
) -> Result<(String, Vec<String>), SignalError> {
    let payload = serde_json::json!({
        "ticket": ticket,
        "role": role.as_str(),
        "fingerprint": fingerprint,
        "candidates": candidates,
    })
    .to_string();
    let body = http_post_json(signal_origin, "/v1/candidates", &payload)?;
    let parsed: JoinOk = serde_json::from_str(&body).map_err(|_| SignalError::Http)?;
    if !parsed.ok {
        return Err(SignalError::Http);
    }
    Ok((
        parsed.remote_session_id.unwrap_or_default(),
        parsed.peer_candidates.unwrap_or_default(),
    ))
}

/// 对对端候选发短探测。超时记 udp_blocked；本机环回通了记 home_home。
pub fn probe_direct(socket: &UdpSocket, peer_candidates: &[String]) -> PunchOutcome {
    let peers: Vec<SocketAddr> = peer_candidates.iter().filter_map(|item| parse_candidate(item)).collect();
    if peers.is_empty() {
        return PunchOutcome {
            reached: false,
            bucket: "udp_blocked",
            result: "no_peer",
            peer: None,
        };
    }
    let deadline = Instant::now() + PROBE_WAIT;
    let mut buffer = [0u8; 32];
    while Instant::now() < deadline {
        for peer in &peers {
            let _ = socket.send_to(PUNCH_MAGIC, peer);
        }
        match socket.recv_from(&mut buffer) {
            Ok((count, from)) if count >= PUNCH_MAGIC.len() && &buffer[..PUNCH_MAGIC.len()] == PUNCH_MAGIC => {
                let _ = socket.send_to(PUNCH_MAGIC, from);
                return PunchOutcome {
                    reached: true,
                    bucket: "home_home",
                    result: "ok",
                    peer: Some(from),
                };
            }
            Ok(_) => {}
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock || error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(_) => {
                return PunchOutcome {
                    reached: false,
                    bucket: "udp_blocked",
                    result: "socket",
                    peer: None,
                };
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    PunchOutcome {
        reached: false,
        bucket: "udp_blocked",
        result: "timeout",
        peer: None,
    }
}

fn parse_candidate(raw: &str) -> Option<SocketAddr> {
    let trimmed = raw.trim().strip_prefix("udp:").unwrap_or(raw.trim());
    trimmed.parse().ok()
}

fn http_post_json(origin: &str, path: &str, payload: &str) -> Result<String, SignalError> {
    let (host, port) = split_origin(origin).ok_or(SignalError::Address)?;
    let mut stream = TcpStream::connect(format!("{host}:{port}")).map_err(|_| SignalError::Http)?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| SignalError::Http)?;
    let request = format!(
        "POST {path} HTTP/1.1\r\nhost: {host}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
        payload.len()
    );
    stream.write_all(request.as_bytes()).map_err(|_| SignalError::Http)?;
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer).map_err(|_| SignalError::Closed)?;
    let text = String::from_utf8_lossy(&buffer);
    Ok(text.split("\r\n\r\n").nth(1).unwrap_or("").to_string())
}

fn split_origin(origin: &str) -> Option<(&str, u16)> {
    let rest = origin.strip_prefix("http://")?;
    let (host, port_text) = rest.split_once(':')?;
    let port = port_text.parse().ok()?;
    if host.is_empty() {
        None
    } else {
        Some((host, port))
    }
}
