//! 中继 hello：4 字节大端长度 + JSON。与 services/relay 读法一致。

use crate::ticket::{ticket_looks_usable, TicketError};

const HELLO_LIMIT: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelayRole {
    Controller,
    Host,
}

impl RelayRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Controller => "controller",
            Self::Host => "host",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HelloError {
    Ticket(TicketError),
    Fingerprint,
    Role,
    TooLarge,
}

/// 编码中继入口 hello。调用方再把它写进 TLS 流。
pub fn encode_relay_hello(ticket: &str, role: RelayRole, fingerprint: &str) -> Result<Vec<u8>, HelloError> {
    ticket_looks_usable(ticket).map_err(HelloError::Ticket)?;
    let trimmed_fingerprint = fingerprint.trim();
    if trimmed_fingerprint.len() < 8 || trimmed_fingerprint.len() > 200 {
        return Err(HelloError::Fingerprint);
    }
    let body = format!(
        "{{\"ticket\":{},\"role\":{},\"fingerprint\":{}}}",
        json_string(ticket.trim()),
        json_string(role.as_str()),
        json_string(trimmed_fingerprint),
    );
    if body.len() > HELLO_LIMIT {
        return Err(HelloError::TooLarge);
    }
    let mut packet = Vec::with_capacity(4 + body.len());
    packet.extend_from_slice(&(body.len() as u32).to_be_bytes());
    packet.extend_from_slice(body.as_bytes());
    Ok(packet)
}

fn json_string(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len() + 2);
    escaped.push('"');
    for ch in value.chars() {
        match ch {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            other => escaped.push(other),
        }
    }
    escaped.push('"');
    escaped
}
