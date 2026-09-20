//! 画面载荷封装。编解码器本身不在这里，只约定字节布局。

pub const VIDEO_CODEC_JPEG: u8 = 1;
const HEADER_BYTES: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VideoError {
    Truncated,
    UnknownCodec,
}

/// 布局：宽 u16 · 高 u16 · 编解码 u8 · 保留 u8 · 载荷。
pub fn pack_video(width: u16, height: u16, codec: u8, body: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_BYTES + body.len());
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.push(codec);
    bytes.push(0);
    bytes.extend_from_slice(body);
    bytes
}

pub fn unpack_video(payload: &[u8]) -> Result<(u16, u16, u8, &[u8]), VideoError> {
    if payload.len() < HEADER_BYTES {
        return Err(VideoError::Truncated);
    }
    let width = u16::from_be_bytes([payload[0], payload[1]]);
    let height = u16::from_be_bytes([payload[2], payload[3]]);
    let codec = payload[4];
    if codec != VIDEO_CODEC_JPEG {
        return Err(VideoError::UnknownCodec);
    }
    Ok((width, height, codec, &payload[HEADER_BYTES..]))
}
