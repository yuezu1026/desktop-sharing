//! STUN Binding（RFC 5389）。只解析 XOR-MAPPED-ADDRESS，不做 ICE。

use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::time::Duration;

const MAGIC_COOKIE: u32 = 0x2112_A442;
const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const ATTR_XOR_MAPPED_ADDRESS: u16 = 0x0020;
const HEADER_BYTES: usize = 20;
const TRANSACTION_BYTES: usize = 12;

/// 编一帧 Binding Request。`transaction_id` 须恰好 12 字节。
pub fn build_binding_request(transaction_id: &[u8; TRANSACTION_BYTES]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_BYTES);
    bytes.extend_from_slice(&BINDING_REQUEST.to_be_bytes());
    bytes.extend_from_slice(&0u16.to_be_bytes());
    bytes.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
    bytes.extend_from_slice(transaction_id);
    bytes
}

/// 从 Binding Success 里取出 XOR-MAPPED-ADDRESS（仅 IPv4）。
pub fn parse_xor_mapped_v4(response: &[u8]) -> Option<SocketAddrV4> {
    if response.len() < HEADER_BYTES {
        return None;
    }
    let message_type = u16::from_be_bytes([response[0], response[1]]);
    if message_type != BINDING_SUCCESS {
        return None;
    }
    let magic = u32::from_be_bytes([response[4], response[5], response[6], response[7]]);
    if magic != MAGIC_COOKIE {
        return None;
    }
    let transaction = &response[8..HEADER_BYTES];
    let body_length = u16::from_be_bytes([response[2], response[3]]) as usize;
    if response.len() < HEADER_BYTES + body_length {
        return None;
    }
    let mut offset = HEADER_BYTES;
    let end = HEADER_BYTES + body_length;
    while offset + 4 <= end {
        let attr_type = u16::from_be_bytes([response[offset], response[offset + 1]]);
        let attr_length = u16::from_be_bytes([response[offset + 2], response[offset + 3]]) as usize;
        let value_start = offset + 4;
        let value_end = value_start + attr_length;
        if value_end > end {
            return None;
        }
        if attr_type == ATTR_XOR_MAPPED_ADDRESS {
            return decode_xor_mapped_v4(&response[value_start..value_end], transaction);
        }
        // 属性按 4 字节对齐
        let padded = (attr_length + 3) & !3;
        offset = value_start + padded;
    }
    None
}

fn decode_xor_mapped_v4(value: &[u8], _transaction: &[u8]) -> Option<SocketAddrV4> {
    if value.len() < 8 {
        return None;
    }
    // reserved(1) + family(1) + port(2) + addr(4)
    if value[1] != 0x01 {
        return None;
    }
    let xport = u16::from_be_bytes([value[2], value[3]]);
    let port = xport ^ ((MAGIC_COOKIE >> 16) as u16);
    let xaddr = u32::from_be_bytes([value[4], value[5], value[6], value[7]]);
    let addr = xaddr ^ MAGIC_COOKIE;
    let ip = Ipv4Addr::from(addr.to_be_bytes());
    Some(SocketAddrV4::new(ip, port))
}

/// 向 STUN 服务器要公网映射；失败返回 None，不打断内网候选。
pub fn query_mapped_v4(socket: &UdpSocket, stun_addr: SocketAddr) -> Option<SocketAddrV4> {
    let mut transaction = [0u8; TRANSACTION_BYTES];
    getrandom_fill(&mut transaction);
    let request = build_binding_request(&transaction);
    socket.send_to(&request, stun_addr).ok()?;
    let previous = socket.read_timeout().ok().flatten();
    let _ = socket.set_read_timeout(Some(Duration::from_millis(800)));
    let mut buffer = [0u8; 512];
    let result = match socket.recv_from(&mut buffer) {
        Ok((count, _)) => {
            let response = &buffer[..count];
            if response.len() >= HEADER_BYTES && response[8..HEADER_BYTES] == transaction {
                parse_xor_mapped_v4(response)
            } else {
                None
            }
        }
        Err(_) => None,
    };
    let _ = socket.set_read_timeout(previous);
    result
}

fn getrandom_fill(bytes: &mut [u8]) {
    // 无额外依赖：用时间扰动凑事务号，STUN 不要求密码学随机。
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    for (index, slot) in bytes.iter_mut().enumerate() {
        *slot = ((nanos >> (index * 8)) as u8).wrapping_add(index as u8);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binding_request_has_fixed_header() {
        let transaction = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        let bytes = build_binding_request(&transaction);
        assert_eq!(bytes.len(), 20);
        assert_eq!(&bytes[0..2], &BINDING_REQUEST.to_be_bytes());
        assert_eq!(&bytes[2..4], &[0, 0]);
        assert_eq!(&bytes[4..8], &MAGIC_COOKIE.to_be_bytes());
        assert_eq!(&bytes[8..20], &transaction);
    }

    #[test]
    fn parses_xor_mapped_ipv4() {
        let transaction = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 11, 12];
        let ip = Ipv4Addr::new(203, 0, 113, 10);
        let port = 54320u16;
        let mut response = Vec::new();
        response.extend_from_slice(&BINDING_SUCCESS.to_be_bytes());
        response.extend_from_slice(&12u16.to_be_bytes()); // 属性头 4 + 值 8
        response.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        response.extend_from_slice(&transaction);
        response.extend_from_slice(&ATTR_XOR_MAPPED_ADDRESS.to_be_bytes());
        response.extend_from_slice(&8u16.to_be_bytes());
        response.push(0);
        response.push(0x01);
        let xport = port ^ ((MAGIC_COOKIE >> 16) as u16);
        response.extend_from_slice(&xport.to_be_bytes());
        let xaddr = u32::from_be_bytes(ip.octets()) ^ MAGIC_COOKIE;
        response.extend_from_slice(&xaddr.to_be_bytes());
        let mapped = parse_xor_mapped_v4(&response).expect("mapped");
        assert_eq!(*mapped.ip(), ip);
        assert_eq!(mapped.port(), port);
    }

    #[test]
    fn rejects_wrong_message_type() {
        let mut response = build_binding_request(&[0; 12]);
        response[0] = 0x01;
        response[1] = 0x01;
        // 无属性
        assert!(parse_xor_mapped_v4(&response).is_none());
    }
}
