//! OpenH264 软编。产出 Annex-B；由 H264Encoder 在 MF 失败时回退到这里。

use openh264::encoder::{BitRate, Encoder, EncoderConfig, FrameRate, IntraFramePeriod};
use openh264::formats::{BgrSliceU8, YUVBuffer};
use openh264::OpenH264API;

use crate::encode_bitrate::bitrate_bps_from_kbps;
use crate::keyframe_schedule::KeyframeSchedule;

const KEYFRAME_PERIOD: u32 = 45;

pub struct SoftH264Encoder {
    encoder: Encoder,
    width: u32,
    height: u32,
    bitrate_kbps: u32,
    keyframes: KeyframeSchedule,
}

impl SoftH264Encoder {
    pub fn open(width: u32, height: u32, bitrate_kbps: u32) -> Option<Self> {
        if width < 16 || height < 16 {
            return None;
        }
        let config = EncoderConfig::new()
            .bitrate(BitRate::from_bps(bitrate_bps_from_kbps(bitrate_kbps)))
            .max_frame_rate(FrameRate::from_hz(20.0))
            .intra_frame_period(IntraFramePeriod::from_num_frames(KEYFRAME_PERIOD));
        let encoder = Encoder::with_api_config(OpenH264API::from_source(), config).ok()?;
        Some(Self {
            encoder,
            width,
            height,
            bitrate_kbps,
            keyframes: KeyframeSchedule::new(KEYFRAME_PERIOD),
        })
    }

    pub fn encode_bgr(&mut self, width: u32, height: u32, bgr: &[u8]) -> Option<Vec<u8>> {
        if width != self.width || height != self.height {
            *self = Self::open(width, height, self.bitrate_kbps)?;
        }
        let expected = (width as usize) * (height as usize) * 3;
        if bgr.len() < expected {
            return None;
        }
        if self.keyframes.should_force() {
            self.encoder.force_intra_frame();
        }
        self.keyframes.advance();
        let slice = BgrSliceU8::new(&bgr[..expected], (width as usize, height as usize));
        let yuv = YUVBuffer::from_rgb_source(slice);
        let bitstream = self.encoder.encode(&yuv).ok()?;
        let bytes = bitstream.to_vec();
        if !session_core::looks_like_annex_b(&bytes) {
            return None;
        }
        Some(bytes)
    }

    pub fn request_keyframe_soon(&mut self) {
        self.keyframes.request_now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use session_core::{annex_b_has_idr, pack_video, unpack_video, VIDEO_CODEC_H264};

    #[test]
    fn encodes_solid_frame_as_annex_b_h264_payload() {
        let width = 64u32;
        let height = 48u32;
        let mut encoder = SoftH264Encoder::open(width, height, 900).expect("encoder");
        let mut bgr = vec![0u8; (width * height * 3) as usize];
        for pixel in bgr.chunks_exact_mut(3) {
            pixel[0] = 40;
            pixel[1] = 80;
            pixel[2] = 160;
        }
        let annex_b = encoder.encode_bgr(width, height, &bgr).expect("encode");
        assert!(session_core::looks_like_annex_b(&annex_b));
        assert!(annex_b_has_idr(&annex_b));
        let packed = pack_video(width as u16, height as u16, VIDEO_CODEC_H264, &annex_b);
        let (out_w, out_h, codec, body) = unpack_video(&packed).expect("unpack");
        assert_eq!((out_w, out_h, codec), (width as u16, height as u16, VIDEO_CODEC_H264));
        assert_eq!(body, annex_b.as_slice());
    }
}
