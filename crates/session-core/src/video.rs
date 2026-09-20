//! 画面载荷封装。编解码器本身不在这里，只约定字节布局。

pub const VIDEO_CODEC_JPEG: u8 = 1;
pub const VIDEO_CODEC_H264: u8 = 2;
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
    if !video_codec_known(codec) {
        return Err(VideoError::UnknownCodec);
    }
    Ok((width, height, codec, &payload[HEADER_BYTES..]))
}

pub fn video_codec_known(codec: u8) -> bool {
    codec == VIDEO_CODEC_JPEG || codec == VIDEO_CODEC_H264
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jpeg_roundtrip_keeps_body() {
        let body = b"fake-jpeg";
        let packed = pack_video(640, 360, VIDEO_CODEC_JPEG, body);
        let (width, height, codec, out) = unpack_video(&packed).expect("unpack");
        assert_eq!(width, 640);
        assert_eq!(height, 360);
        assert_eq!(codec, VIDEO_CODEC_JPEG);
        assert_eq!(out, body);
    }

    #[test]
    fn h264_roundtrip_keeps_annexb_body() {
        let body = b"\x00\x00\x00\x01\x67fake-sps";
        let packed = pack_video(1280, 720, VIDEO_CODEC_H264, body);
        let (width, height, codec, out) = unpack_video(&packed).expect("unpack h264");
        assert_eq!(width, 1280);
        assert_eq!(height, 720);
        assert_eq!(codec, VIDEO_CODEC_H264);
        assert_eq!(out, body);
    }

    #[test]
    fn unknown_codec_is_rejected() {
        let packed = pack_video(1, 1, 99, b"x");
        assert_eq!(unpack_video(&packed), Err(VideoError::UnknownCodec));
    }

    #[test]
    fn truncated_header_is_rejected() {
        assert_eq!(unpack_video(&[0, 1, 0, 1, 1]), Err(VideoError::Truncated));
    }
}
