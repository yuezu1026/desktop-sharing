//! 直连传帧。打洞成功后先换公钥，再用 session-core 的端到端密钥封帧。
//! 大帧按 UDP 分片；明文帧不经中继。

use std::collections::HashMap;
use std::net::{SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use session_core::{
    decode_frame, encode_frame, DirectCipher, EndpointRole, Frame, FrameError, HandshakeOffer,
};

const HS_MAGIC: &[u8] = b"RDS1HS1";
const FRAG_MAGIC: &[u8] = b"RDF1";
const FRAG_HEADER: usize = 12;
const MAX_CHUNK: usize = 1200;
const HS_WAIT: Duration = Duration::from_secs(4);
const REASSEMBLE_LIMIT: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectError {
    Handshake,
    Crypto,
    Frame(FrameError),
    Io,
    Closed,
}

pub struct DirectLink {
    socket: UdpSocket,
    peer: SocketAddr,
    cipher: DirectCipher,
    next_message_id: u32,
    pending: HashMap<u32, PendingMessage>,
}

struct PendingMessage {
    total: u16,
    parts: Vec<Option<Vec<u8>>>,
    received: u16,
}

impl DirectLink {
    /// 在已打通的 UDP 上完成密钥协商。失败时调用方继续走中继。
    pub fn handshake(socket: UdpSocket, peer: SocketAddr, role: EndpointRole) -> Result<Self, DirectError> {
        socket
            .set_read_timeout(Some(Duration::from_millis(200)))
            .map_err(|_| DirectError::Io)?;
        let offer = HandshakeOffer::generate();
        let mut packet = Vec::with_capacity(HS_MAGIC.len() + 32);
        packet.extend_from_slice(HS_MAGIC);
        packet.extend_from_slice(&offer.public_bytes());

        let deadline = Instant::now() + HS_WAIT;
        let mut buffer = [0u8; 64];
        let mut peer_key: Option<[u8; 32]> = None;
        while Instant::now() < deadline {
            let _ = socket.send_to(&packet, peer);
            match socket.recv_from(&mut buffer) {
                Ok((count, from)) if from == peer && count >= HS_MAGIC.len() + 32 && &buffer[..HS_MAGIC.len()] == HS_MAGIC => {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&buffer[HS_MAGIC.len()..HS_MAGIC.len() + 32]);
                    peer_key = Some(key);
                    let _ = socket.send_to(&packet, peer);
                    break;
                }
                Ok(_) => {}
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock || error.kind() == std::io::ErrorKind::TimedOut => {}
                Err(_) => return Err(DirectError::Io),
            }
            std::thread::sleep(Duration::from_millis(40));
        }
        let peer_key = peer_key.ok_or(DirectError::Handshake)?;
        let cipher = offer
            .finish(&peer_key, role)
            .map_err(|_| DirectError::Handshake)?
            .into_cipher();
        Ok(Self {
            socket,
            peer,
            cipher,
            next_message_id: 1,
            pending: HashMap::new(),
        })
    }

    pub fn send_frame(&mut self, frame: &Frame) -> Result<(), DirectError> {
        let plaintext = encode_frame(frame).map_err(DirectError::Frame)?;
        let sealed = self.cipher.seal(&plaintext).map_err(|_| DirectError::Crypto)?;
        let message_id = self.next_message_id;
        self.next_message_id = self.next_message_id.wrapping_add(1).max(1);
        let chunk_count = sealed.len().div_ceil(MAX_CHUNK).max(1) as u16;
        for (index, chunk) in sealed.chunks(MAX_CHUNK).enumerate() {
            let mut datagram = Vec::with_capacity(FRAG_HEADER + chunk.len());
            datagram.extend_from_slice(FRAG_MAGIC);
            datagram.extend_from_slice(&message_id.to_be_bytes());
            datagram.extend_from_slice(&(index as u16).to_be_bytes());
            datagram.extend_from_slice(&chunk_count.to_be_bytes());
            datagram.extend_from_slice(chunk);
            self.socket
                .send_to(&datagram, self.peer)
                .map_err(|_| DirectError::Io)?;
        }
        Ok(())
    }

    /// 读到完整一帧则返回；暂时没有则 Ok(None)。
    pub fn try_recv_frame(&mut self) -> Result<Option<Frame>, DirectError> {
        let mut buffer = [0u8; 1500];
        match self.socket.recv_from(&mut buffer) {
            Ok((count, from)) if from == self.peer && count >= FRAG_HEADER && &buffer[..4] == FRAG_MAGIC => {
                let message_id = u32::from_be_bytes([buffer[4], buffer[5], buffer[6], buffer[7]]);
                let index = u16::from_be_bytes([buffer[8], buffer[9]]);
                let total = u16::from_be_bytes([buffer[10], buffer[11]]);
                if total == 0 || index >= total {
                    return Ok(None);
                }
                let chunk = buffer[FRAG_HEADER..count].to_vec();
                if let Some(sealed) = self.take_complete(message_id, index, total, chunk) {
                    let plaintext = self.cipher.open(&sealed).map_err(|_| DirectError::Crypto)?;
                    let frame = decode_frame(&plaintext).map_err(DirectError::Frame)?;
                    return Ok(Some(frame));
                }
                Ok(None)
            }
            Ok(_) => Ok(None),
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock || error.kind() == std::io::ErrorKind::TimedOut =>
            {
                Ok(None)
            }
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => Err(DirectError::Closed),
            Err(_) => Err(DirectError::Io),
        }
    }

    fn take_complete(&mut self, message_id: u32, index: u16, total: u16, chunk: Vec<u8>) -> Option<Vec<u8>> {
        if self.pending.len() >= REASSEMBLE_LIMIT && !self.pending.contains_key(&message_id) {
            self.pending.clear();
        }
        let entry = self.pending.entry(message_id).or_insert_with(|| PendingMessage {
            total,
            parts: vec![None; total as usize],
            received: 0,
        });
        if entry.total != total || entry.parts.len() != total as usize {
            return None;
        }
        if entry.parts[index as usize].is_none() {
            entry.parts[index as usize] = Some(chunk);
            entry.received += 1;
        }
        if entry.received != entry.total {
            return None;
        }
        let finished = self.pending.remove(&message_id)?;
        let mut sealed = Vec::new();
        for part in finished.parts {
            sealed.extend(part?);
        }
        Some(sealed)
    }
}
