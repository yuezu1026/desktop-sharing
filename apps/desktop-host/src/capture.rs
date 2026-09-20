//! 会话进行中才采集。空闲不占编码器。优先 DXGI；编码优先 MF（硬编/系统 MFT）再 OpenH264，失败回退 JPEG。

use std::mem::size_of;

use image::codecs::jpeg::JpegEncoder;
use image::{ColorType, ImageEncoder};
use session_core::{pack_video, Frame, FrameKind, VIDEO_CODEC_H264, VIDEO_CODEC_JPEG};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

use crate::dxgi::DxgiGrabber;
use crate::encode_bitrate::{resolve_bitrate_kbps, resolve_capture_max_width};
use crate::h264_encode::H264Encoder;

const JPEG_QUALITY: u8 = 75;
/// JPEG 联调路径用更密的抽样，减少「画面动了但哈希未变」造成的迟滞感。
const JPEG_HASH_STRIDE: usize = 16;
const H264_HASH_STRIDE: usize = 64;

pub struct ScreenGrabber {
    last_hash: u64,
    dxgi: Option<DxgiGrabber>,
    prefer_dxgi: bool,
    h264: Option<H264Encoder>,
    bitrate_kbps: u32,
    max_width: i32,
    /// 内网中继或点对点直连时不按码率档限宽。
    uncapped_resolution: bool,
}

impl ScreenGrabber {
    pub fn new(bitrate_kbps: Option<u32>, uncapped_resolution: bool) -> Self {
        let dxgi = DxgiGrabber::open();
        let resolved = resolve_bitrate_kbps(bitrate_kbps);
        Self {
            last_hash: 0,
            prefer_dxgi: dxgi.is_some(),
            dxgi,
            h264: None,
            bitrate_kbps: resolved,
            max_width: resolve_capture_max_width(resolved, uncapped_resolution),
            uncapped_resolution,
        }
    }

    /// 服务端降档后换码率；内网/直连仍不按档位砍分辨率。
    pub fn set_bitrate_kbps(&mut self, bitrate_kbps: Option<u32>) {
        let resolved = resolve_bitrate_kbps(bitrate_kbps);
        let width = resolve_capture_max_width(resolved, self.uncapped_resolution);
        if resolved == self.bitrate_kbps && width == self.max_width {
            return;
        }
        self.bitrate_kbps = resolved;
        self.max_width = width;
        self.h264 = None;
        self.last_hash = 0;
    }

    /// 升直连：点对点不再按公网中继的码率档限分辨率。
    pub fn enable_peer_native_resolution(&mut self) {
        if self.uncapped_resolution {
            return;
        }
        self.uncapped_resolution = true;
        self.max_width = resolve_capture_max_width(self.bitrate_kbps, true);
        self.h264 = None;
        self.last_hash = 0;
    }

    /// 控制端请求关键帧：下一拍 H264 强制 IDR；JPEG 路径清哈希以便立刻再送一帧。
    pub fn request_keyframe(&mut self) {
        if let Some(encoder) = self.h264.as_mut() {
            encoder.request_keyframe();
        }
        self.last_hash = 0;
    }

    pub fn bitrate_kbps(&self) -> u32 {
        self.bitrate_kbps
    }

    pub fn max_width(&self) -> i32 {
        self.max_width
    }

    /// 静止画面不重复送。失败时返回 None，调用方跳过这一拍。
    pub fn grab_jpeg_frame(&mut self) -> Option<Frame> {
        let (width, height, bgr) = self.grab_bgr_scaled()?;
        // 紧急联调：仅当 DESKTOP_HOST_FORCE_JPEG=1 时跳过 H264。默认走 H264，JPEG 只作编码失败回退。
        let force_jpeg = std::env::var("DESKTOP_HOST_FORCE_JPEG")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let hash = fnv1a(&bgr, if force_jpeg { JPEG_HASH_STRIDE } else { H264_HASH_STRIDE });
        if hash == self.last_hash {
            return None;
        }
        self.last_hash = hash;
        if !force_jpeg {
            if let Some(frame) = self.try_h264_frame(width, height, &bgr) {
                return Some(frame);
            }
        }
        let jpeg = encode_jpeg_bgr(width as u32, height as u32, &bgr)?;
        let payload = pack_video(width as u16, height as u16, VIDEO_CODEC_JPEG, &jpeg);
        Some(Frame {
            kind: FrameKind::Video,
            flags: 0,
            payload,
        })
    }

    fn try_h264_frame(&mut self, width: i32, height: i32, bgr: &[u8]) -> Option<Frame> {
        if self.h264.is_none() {
            self.h264 = H264Encoder::open(width as u32, height as u32, self.bitrate_kbps);
        }
        let encoder = self.h264.as_mut()?;
        let annex_b = encoder.encode_bgr(width as u32, height as u32, bgr)?;
        let payload = pack_video(width as u16, height as u16, VIDEO_CODEC_H264, &annex_b);
        Some(Frame {
            kind: FrameKind::Video,
            flags: 0,
            payload,
        })
    }

    fn grab_bgr_scaled(&mut self) -> Option<(i32, i32, Vec<u8>)> {
        let max_width = self.max_width;
        if self.prefer_dxgi {
            if self.dxgi.is_none() {
                self.dxgi = DxgiGrabber::open();
            }
            if let Some(grabber) = self.dxgi.as_mut() {
                match grabber.grab_bgr_scaled(max_width) {
                    Ok(Some(frame)) => return Some(frame),
                    Ok(None) => return None,
                    Err(()) => {
                        self.dxgi = None;
                    }
                }
            }
        }
        unsafe { capture_bgr_scaled_gdi(max_width) }
    }
}

fn encode_jpeg_bgr(width: u32, height: u32, bgr: &[u8]) -> Option<Vec<u8>> {
    let mut rgb = Vec::with_capacity(bgr.len());
    for pixel in bgr.chunks_exact(3) {
        rgb.push(pixel[2]);
        rgb.push(pixel[1]);
        rgb.push(pixel[0]);
    }
    let mut jpeg = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY);
    encoder.write_image(&rgb, width, height, ColorType::Rgb8.into()).ok()?;
    Some(jpeg)
}

fn fnv1a(bytes: &[u8], stride: usize) -> u64 {
    let step = stride.max(1);
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes.iter().step_by(step).copied() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash ^= bytes.len() as u64;
    hash
}

unsafe fn capture_bgr_scaled_gdi(max_width: i32) -> Option<(i32, i32, Vec<u8>)> {
    let screen_width = GetSystemMetrics(SM_CXSCREEN);
    let screen_height = GetSystemMetrics(SM_CYSCREEN);
    if screen_width <= 0 || screen_height <= 0 {
        return None;
    }
    let target_width = session_core::align_h264_dimension(screen_width.min(max_width));
    let raw_height = ((screen_height as i64 * target_width as i64) / screen_width as i64).max(1) as i32;
    let target_height = session_core::align_h264_dimension(raw_height);
    let screen_dc = GetDC(None);
    if screen_dc.is_invalid() {
        return None;
    }
    let memory_dc = CreateCompatibleDC(Some(screen_dc));
    if memory_dc.is_invalid() {
        let _ = ReleaseDC(None, screen_dc);
        return None;
    }
    let bitmap = CreateCompatibleBitmap(screen_dc, target_width, target_height);
    if bitmap.is_invalid() {
        let _ = DeleteDC(memory_dc);
        let _ = ReleaseDC(None, screen_dc);
        return None;
    }
    let old = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
    let stretched = StretchBlt(
        memory_dc,
        0,
        0,
        target_width,
        target_height,
        Some(screen_dc),
        0,
        0,
        screen_width,
        screen_height,
        SRCCOPY,
    );
    if !stretched.as_bool() {
        let _ = BitBlt(memory_dc, 0, 0, target_width, target_height, Some(screen_dc), 0, 0, SRCCOPY);
    }
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: target_width,
            biHeight: -target_height,
            biPlanes: 1,
            biBitCount: 24,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        },
        ..Default::default()
    };
    let stride = ((target_width * 3 + 3) & !3) as usize;
    let mut pixels = vec![0u8; stride * target_height as usize];
    let copied = GetDIBits(
        memory_dc,
        bitmap,
        0,
        target_height as u32,
        Some(pixels.as_mut_ptr().cast()),
        &mut info,
        DIB_RGB_COLORS,
    );
    let _ = SelectObject(memory_dc, old);
    let _ = DeleteObject(HGDIOBJ(bitmap.0));
    let _ = DeleteDC(memory_dc);
    let _ = ReleaseDC(None, screen_dc);
    if copied == 0 {
        return None;
    }
    if stride == target_width as usize * 3 {
        return Some((target_width, target_height, pixels));
    }
    let mut compact = Vec::with_capacity((target_width * target_height * 3) as usize);
    for row in 0..target_height as usize {
        let start = row * stride;
        compact.extend_from_slice(&pixels[start..start + target_width as usize * 3]);
    }
    Some((target_width, target_height, compact))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_bitrate_rebuilds_encoder_slot() {
        let mut grabber = ScreenGrabber {
            last_hash: 1,
            dxgi: None,
            prefer_dxgi: false,
            h264: None,
            bitrate_kbps: 900,
            max_width: 960,
            uncapped_resolution: false,
        };
        grabber.set_bitrate_kbps(Some(4_000));
        assert_eq!(grabber.bitrate_kbps(), 4_000);
        assert_eq!(grabber.max_width(), 1920);
        assert_eq!(grabber.last_hash, 0);
        grabber.set_bitrate_kbps(Some(4_000));
        assert_eq!(grabber.bitrate_kbps(), 4_000);
        assert_eq!(grabber.max_width(), 1920);
    }

    #[test]
    fn intranet_keeps_native_cap_after_bitrate_change() {
        let mut grabber = ScreenGrabber::new(Some(900), true);
        assert_eq!(grabber.max_width(), crate::encode_bitrate::INTRANET_CAPTURE_WIDTH_CAP);
        grabber.set_bitrate_kbps(Some(4_000));
        assert_eq!(grabber.max_width(), crate::encode_bitrate::INTRANET_CAPTURE_WIDTH_CAP);
    }

    #[test]
    fn peer_direct_lifts_width_cap() {
        let mut grabber = ScreenGrabber::new(Some(4_000), false);
        assert_eq!(grabber.max_width(), 1920);
        grabber.enable_peer_native_resolution();
        assert_eq!(grabber.max_width(), crate::encode_bitrate::INTRANET_CAPTURE_WIDTH_CAP);
        grabber.set_bitrate_kbps(Some(900));
        assert_eq!(grabber.max_width(), crate::encode_bitrate::INTRANET_CAPTURE_WIDTH_CAP);
    }
}

