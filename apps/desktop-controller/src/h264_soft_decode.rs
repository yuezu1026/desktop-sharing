//! OpenH264 软解。输入 Annex-B，输出 BGR。

use std::sync::Mutex;

use openh264::decoder::{Decoder, DecoderConfig};
use openh264::formats::YUVSource;
use openh264::OpenH264API;

static DECODER: Mutex<Option<Decoder>> = Mutex::new(None);

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
