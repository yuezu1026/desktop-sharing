//! 会话协议的唯一实现。桌面直接链接；手机经原生模块；Web 只取可编到 WASM 的部分。
//! 中继路上靠 TLS 做传输加密，帧明文可被中继看见；直连路上密钥只在两端。
//! 本阶段不做音频通道，也不做国密套件。

mod crypto;
mod frame;
mod h264;
mod input;
mod relay_hello;
mod ticket;
mod video;

pub use crypto::{DirectCipher, EndpointRole, HandshakeError, HandshakeOffer, SessionKeys};
pub use frame::{decode_frame, encode_frame, Frame, FrameError, FrameKind, PROTOCOL_VERSION};
pub use h264::{annex_b_has_idr, first_vcl_nal_type, looks_like_annex_b};
pub use input::{decode_input, encode_input, InputError, InputEvent};
pub use relay_hello::{encode_relay_hello, HelloError, RelayRole};
pub use ticket::{ticket_looks_usable, TicketError, MIN_TICKET_CHARS};
pub use video::{pack_video, unpack_video, video_codec_known, VideoError, VIDEO_CODEC_H264, VIDEO_CODEC_JPEG};
