//! 字节级帧格式。控制面不重复定义这一层。

pub const PROTOCOL_VERSION: u8 = 1;
const HEADER_BYTES: usize = 12;
const MAGIC: [u8; 4] = *b"RDS1";
const MAX_PAYLOAD_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameKind {
    /// 画面编码后的载荷。资源式「仅查看」停转后，控制端应保留最后一帧。
    Video = 1,
    /// 键鼠与触控。权限式「仅查看」时被控端解码后丢弃，不停画面。
    Input = 2,
    /// 会话控制，不含画面与输入。
    Control = 3,
}

impl FrameKind {
    fn from_byte(value: u8) -> Option<Self> {
        match value {
            1 => Some(Self::Video),
            2 => Some(Self::Input),
            3 => Some(Self::Control),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub kind: FrameKind,
    pub flags: u8,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameError {
    Truncated,
    BadMagic,
    BadVersion,
    UnknownKind,
    PayloadTooLarge,
}

/// 把一帧写成长度前缀的字节。中继路径上这些字节可被中继看见。
pub fn encode_frame(frame: &Frame) -> Result<Vec<u8>, FrameError> {
    if frame.payload.len() > MAX_PAYLOAD_BYTES {
        return Err(FrameError::PayloadTooLarge);
    }
    let mut bytes = Vec::with_capacity(HEADER_BYTES + frame.payload.len());
    bytes.extend_from_slice(&MAGIC);
    bytes.push(PROTOCOL_VERSION);
    bytes.push(frame.kind as u8);
    bytes.push(frame.flags);
    bytes.push(0);
    let length = frame.payload.len() as u32;
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.extend_from_slice(&frame.payload);
    Ok(bytes)
}

/// 从完整缓冲解出一帧。调用方负责按长度拼包。
pub fn decode_frame(bytes: &[u8]) -> Result<Frame, FrameError> {
    if bytes.len() < HEADER_BYTES {
        return Err(FrameError::Truncated);
    }
    if bytes[0..4] != MAGIC {
        return Err(FrameError::BadMagic);
    }
    if bytes[4] != PROTOCOL_VERSION {
        return Err(FrameError::BadVersion);
    }
    let kind = FrameKind::from_byte(bytes[5]).ok_or(FrameError::UnknownKind)?;
    let flags = bytes[6];
    let payload_length = u32::from_be_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
    if payload_length > MAX_PAYLOAD_BYTES {
        return Err(FrameError::PayloadTooLarge);
    }
    let end = HEADER_BYTES + payload_length;
    if bytes.len() < end {
        return Err(FrameError::Truncated);
    }
    Ok(Frame {
        kind,
        flags,
        payload: bytes[HEADER_BYTES..end].to_vec(),
    })
}
