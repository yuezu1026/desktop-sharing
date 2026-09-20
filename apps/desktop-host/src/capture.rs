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
use crate::h264_encode::H264Encoder;

const MAX_WIDTH: i32 = 640;
const JPEG_QUALITY: u8 = 50;

pub struct ScreenGrabber {
    last_hash: u64,
    dxgi: Option<DxgiGrabber>,
    prefer_dxgi: bool,
    h264: Option<H264Encoder>,
}

impl ScreenGrabber {
    pub fn new() -> Self {
        let dxgi = DxgiGrabber::open();
        Self {
            last_hash: 0,
            prefer_dxgi: dxgi.is_some(),
            dxgi,
            h264: None,
        }
    }

    /// 静止画面不重复送。失败时返回 None，调用方跳过这一拍。
    pub fn grab_jpeg_frame(&mut self) -> Option<Frame> {
        let (width, height, bgr) = self.grab_bgr_scaled()?;
        let hash = fnv1a(&bgr);
        if hash == self.last_hash {
            return None;
        }
        self.last_hash = hash;
        if let Some(frame) = self.try_h264_frame(width, height, &bgr) {
            return Some(frame);
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
            self.h264 = H264Encoder::open(width as u32, height as u32);
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
        if self.prefer_dxgi {
            if self.dxgi.is_none() {
                self.dxgi = DxgiGrabber::open();
            }
            if let Some(grabber) = self.dxgi.as_mut() {
                match grabber.grab_bgr_scaled(MAX_WIDTH) {
                    Ok(Some(frame)) => return Some(frame),
                    Ok(None) => return None,
                    Err(()) => {
                        self.dxgi = None;
                    }
                }
            }
        }
        unsafe { capture_bgr_scaled_gdi(MAX_WIDTH) }
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

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes.iter().step_by(64).copied() {
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
    let target_width = screen_width.min(max_width);
    let target_height = ((screen_height as i64 * target_width as i64) / screen_width as i64).max(1) as i32;
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
