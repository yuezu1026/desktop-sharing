//! H264 编码入口：优先 Media Foundation（硬编枚举 → 系统 MFT），再 OpenH264，契约仍是 Annex-B。

use crate::h264_soft::SoftH264Encoder;
use crate::mf_h264::MfH264Encoder;

enum Backend {
    MediaFoundation(MfH264Encoder),
    Software(SoftH264Encoder),
}

pub struct H264Encoder {
    backend: Backend,
}

impl H264Encoder {
    pub fn open(width: u32, height: u32) -> Option<Self> {
        if let Some(mf) = MfH264Encoder::open(width, height) {
            return Some(Self {
                backend: Backend::MediaFoundation(mf),
            });
        }
        let soft = SoftH264Encoder::open(width, height)?;
        Some(Self {
            backend: Backend::Software(soft),
        })
    }

    pub fn is_hardware(&self) -> bool {
        match &self.backend {
            Backend::MediaFoundation(encoder) => encoder.is_hardware(),
            Backend::Software(_) => false,
        }
    }

    pub fn encode_bgr(&mut self, width: u32, height: u32, bgr: &[u8]) -> Option<Vec<u8>> {
        match &mut self.backend {
            Backend::MediaFoundation(encoder) => match encoder.encode_bgr(width, height, bgr) {
                Some(bytes) => Some(bytes),
                None => {
                    let mut soft = SoftH264Encoder::open(width, height)?;
                    let bytes = soft.encode_bgr(width, height, bgr)?;
                    self.backend = Backend::Software(soft);
                    Some(bytes)
                }
            },
            Backend::Software(encoder) => encoder.encode_bgr(width, height, bgr),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use session_core::{annex_b_has_idr, pack_video, unpack_video, VIDEO_CODEC_H264};

    #[test]
    fn prefer_path_emits_annex_b_idr_payload() {
        let width = 64u32;
        let height = 48u32;
        let mut encoder = H264Encoder::open(width, height).expect("encoder");
        let mut bgr = vec![0u8; (width * height * 3) as usize];
        for pixel in bgr.chunks_exact_mut(3) {
            pixel[0] = 40;
            pixel[1] = 80;
            pixel[2] = 160;
        }
        // MF 首帧偶发空包，多推几帧直到出 IDR
        let mut annex_b = None;
        for _ in 0..8 {
            if let Some(bytes) = encoder.encode_bgr(width, height, &bgr) {
                if session_core::looks_like_annex_b(&bytes) {
                    annex_b = Some(bytes);
                    if annex_b_has_idr(annex_b.as_ref().unwrap()) {
                        break;
                    }
                }
            }
        }
        let annex_b = annex_b.expect("annex-b");
        assert!(session_core::looks_like_annex_b(&annex_b));
        let packed = pack_video(width as u16, height as u16, VIDEO_CODEC_H264, &annex_b);
        let (out_w, out_h, codec, body) = unpack_video(&packed).expect("unpack");
        assert_eq!((out_w, out_h, codec), (width as u16, height as u16, VIDEO_CODEC_H264));
        assert_eq!(body, annex_b.as_slice());
    }

    #[test]
    fn hardware_flag_is_queryable() {
        let encoder = H264Encoder::open(64, 48).expect("encoder");
        let _ = encoder.is_hardware();
    }
}
