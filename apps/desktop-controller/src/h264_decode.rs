//! H264 解码入口：优先 Media Foundation，失败回退 OpenH264。

use crate::h264_soft_decode;
use crate::mf_h264_decode;

/// 解出一帧 BGR；未出图返回 None（例如还缺 IDR）。
pub fn decode_annex_b_to_bgr(annex_b: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    if let Some(frame) = mf_h264_decode::try_decode_annex_b_to_bgr(annex_b) {
        return Some(frame);
    }
    h264_soft_decode::decode_annex_b_to_bgr(annex_b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use openh264::encoder::{BitRate, Encoder, EncoderConfig, IntraFramePeriod};
    use openh264::formats::{RgbSliceU8, YUVBuffer};
    use openh264::OpenH264API;

    #[test]
    fn prefer_path_roundtrip_small_frame() {
        let width = 64usize;
        let height = 48usize;
        let mut rgb = vec![0u8; width * height * 3];
        for pixel in rgb.chunks_exact_mut(3) {
            pixel[0] = 200;
            pixel[1] = 100;
            pixel[2] = 50;
        }
        let config = EncoderConfig::new()
            .bitrate(BitRate::from_bps(500_000))
            .intra_frame_period(IntraFramePeriod::from_num_frames(30));
        let mut encoder = Encoder::with_api_config(OpenH264API::from_source(), config).expect("enc");
        let yuv = YUVBuffer::from_rgb_source(RgbSliceU8::new(&rgb, (width, height)));
        let annex_b = encoder.encode(&yuv).expect("encode").to_vec();
        assert!(session_core::annex_b_has_idr(&annex_b));
        let (out_w, out_h, bgr) = decode_annex_b_to_bgr(&annex_b).expect("decode");
        assert_eq!((out_w, out_h), (width as u32, height as u32));
        assert_eq!(bgr.len(), width * height * 3);
    }
}
