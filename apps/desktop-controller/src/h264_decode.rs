//! OpenH264 软解。输入 Annex-B，输出与 JPEG 路径相同的 BGR 位图。

use std::sync::Mutex;

use openh264::decoder::{Decoder, DecoderConfig};
use openh264::formats::YUVSource;
use openh264::OpenH264API;

static DECODER: Mutex<Option<Decoder>> = Mutex::new(None);

/// 解出一帧 BGR；未出图返回 None（例如还缺 IDR）。
pub fn decode_annex_b_to_bgr(annex_b: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    if !session_core::looks_like_annex_b(annex_b) {
        return None;
    }
    let mut guard = DECODER.lock().ok()?;
    if guard.is_none() {
        *guard = Decoder::with_api_config(OpenH264API::from_source(), DecoderConfig::new()).ok();
    }
    let decoder = guard.as_mut()?;
    let yuv = decoder.decode(annex_b).ok()??;
    let (width, height) = yuv.dimensions();
    let mut rgb = vec![0u8; width * height * 3];
    yuv.write_rgb8(&mut rgb);
    let mut bgr = Vec::with_capacity(rgb.len());
    for pixel in rgb.chunks_exact(3) {
        bgr.push(pixel[2]);
        bgr.push(pixel[1]);
        bgr.push(pixel[0]);
    }
    Some((width as u32, height as u32, bgr))
}

#[cfg(test)]
mod tests {
    use super::*;
    use openh264::encoder::{BitRate, Encoder, EncoderConfig, IntraFramePeriod};
    use openh264::formats::{RgbSliceU8, YUVBuffer};

    #[test]
    fn roundtrip_small_rgb_frame() {
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
