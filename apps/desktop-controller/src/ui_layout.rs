//! 控制端会话画布几何：letterbox、工具条、角标与基础 GDI 填充。
//! 不碰解码与中继；改版布局优先改本文件。

use windows::Win32::Foundation::{COLORREF, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, FillRect, GetDC,
    ReleaseDC, SelectObject, SetTextColor, DT_CENTER, DT_SINGLELINE, DT_VCENTER, HDC, HGDIOBJ,
};
use windows::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, HICON, ICONINFO};

use crate::ui_theme::{COLOR_BRAND, COLOR_OK, COLOR_ON_SOLID, COLOR_SURFACE2, COLOR_TEXT, COLOR_WARN};

pub const TOOLBAR_HEIGHT: i32 = 48;
pub const BADGE_HEIGHT: i32 = 28;
pub const BADGE_TOP: i32 = 12;
pub const LINK_BADGE_WIDTH: i32 = 80;
pub const SUBSCRIPTION_BADGE_WIDTH: i32 = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameRect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

/// 把远端画面放进窗口，多出来的地方留黑边。不改画面自身的宽高比。
pub fn letterbox(
    container_width: i32,
    container_height: i32,
    picture_width: i32,
    picture_height: i32,
) -> FrameRect {
    if container_width <= 0 || container_height <= 0 || picture_width <= 0 || picture_height <= 0 {
        return FrameRect {
            left: 0,
            top: 0,
            width: 0,
            height: 0,
        };
    }
    let scaled_width = container_height.saturating_mul(picture_width) / picture_height;
    if scaled_width <= container_width {
        FrameRect {
            left: (container_width - scaled_width) / 2,
            top: 0,
            width: scaled_width,
            height: container_height,
        }
    } else {
        let scaled_height = container_width.saturating_mul(picture_height) / picture_width;
        FrameRect {
            left: 0,
            top: (container_height - scaled_height) / 2,
            width: container_width,
            height: scaled_height,
        }
    }
}

pub fn fullscreen_button(client_width: i32, client_height: i32) -> FrameRect {
    let _ = client_width;
    FrameRect {
        left: 16,
        top: client_height - TOOLBAR_HEIGHT + 8,
        width: 96,
        height: 32,
    }
}

pub fn ways_button() -> FrameRect {
    FrameRect {
        left: 16,
        top: 150,
        width: 140,
        height: 28,
    }
}

pub fn restore_button() -> FrameRect {
    FrameRect {
        left: 16,
        top: 220,
        width: 160,
        height: 28,
    }
}

/// 连接方式角标：钉在客户区右上，与工具条显隐无关（MVP §4 / h1 note）。
pub fn link_badge_rect(client_width: i32) -> FrameRect {
    FrameRect {
        left: (client_width - LINK_BADGE_WIDTH - 16).max(0),
        top: BADGE_TOP,
        width: LINK_BADGE_WIDTH,
        height: BADGE_HEIGHT,
    }
}

pub fn subscription_badge_rect(client_width: i32) -> FrameRect {
    let link = link_badge_rect(client_width);
    FrameRect {
        left: (link.left - SUBSCRIPTION_BADGE_WIDTH - 12).max(0),
        top: BADGE_TOP,
        width: SUBSCRIPTION_BADGE_WIDTH,
        height: BADGE_HEIGHT,
    }
}

pub fn hit_frame(click_x: i32, click_y: i32, frame: &FrameRect) -> bool {
    click_x >= frame.left
        && click_x < frame.left + frame.width
        && click_y >= frame.top
        && click_y < frame.top + frame.height
}

pub unsafe fn fill(bounds: &RECT, device_context: HDC, color: u32) {
    let brush = CreateSolidBrush(COLORREF(color));
    FillRect(device_context, bounds, brush);
    let _ = DeleteObject(HGDIOBJ::from(brush));
}

pub unsafe fn fill_frame(frame: &FrameRect, device_context: HDC, color: u32) {
    let bounds = RECT {
        left: frame.left,
        top: frame.top,
        right: frame.left + frame.width,
        bottom: frame.top + frame.height,
    };
    fill(&bounds, device_context, color);
}

pub unsafe fn draw_text(
    device_context: HDC,
    text: &[u16],
    left: i32,
    top: i32,
    width: i32,
    height: i32,
    centered: bool,
) {
    let mut owned = text.to_vec();
    let mut bounds = RECT {
        left,
        top,
        right: left + width,
        bottom: top + height,
    };
    let format = if centered {
        DT_CENTER | DT_VCENTER | DT_SINGLELINE
    } else {
        DT_SINGLELINE
    };
    DrawTextW(device_context, &mut owned, &mut bounds, format);
}

pub unsafe fn paint_badge(device_context: HDC, client_width: i32, link_direct: bool) {
    let badge = link_badge_rect(client_width);
    fill_frame(
        &badge,
        device_context,
        if link_direct { COLOR_OK } else { COLOR_WARN },
    );
    let _ = SetTextColor(device_context, COLORREF(COLOR_ON_SOLID));
    let label = wide_chars(if link_direct { "● 直连" } else { "● 中继" });
    draw_text(
        device_context,
        &label,
        badge.left,
        badge.top,
        badge.width,
        badge.height,
        true,
    );
}

pub unsafe fn paint_subscription_badge(device_context: HDC, client_width: i32, label_text: &str) {
    let badge = subscription_badge_rect(client_width);
    fill_frame(&badge, device_context, COLOR_SURFACE2);
    let _ = SetTextColor(device_context, COLORREF(COLOR_TEXT));
    let label = wide_chars(label_text);
    draw_text(
        device_context,
        &label,
        badge.left,
        badge.top,
        badge.width,
        badge.height,
        true,
    );
}

fn wide_chars(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

/// 双视口品牌标（对齐高保真 h0），与被控端同构图。
pub unsafe fn create_brand_icon(size: i32) -> windows::core::Result<HICON> {
    let screen = GetDC(None);
    let color_dc = CreateCompatibleDC(Some(screen));
    let color_bitmap = CreateCompatibleBitmap(screen, size, size);
    let old_color = SelectObject(color_dc, HGDIOBJ::from(color_bitmap));

    let full = RECT {
        left: 0,
        top: 0,
        right: size,
        bottom: size,
    };
    let brand_brush = CreateSolidBrush(COLORREF(COLOR_BRAND));
    FillRect(color_dc, &full, brand_brush);
    let _ = DeleteObject(HGDIOBJ::from(brand_brush));

    let scale = size as f32 / 64.0;
    let far = RECT {
        left: (10.0 * scale) as i32,
        top: (13.0 * scale) as i32,
        right: (40.0 * scale) as i32,
        bottom: (36.0 * scale) as i32,
    };
    let light_brush = CreateSolidBrush(COLORREF(0x00FF_F1EA));
    FillRect(color_dc, &far, light_brush);
    let _ = DeleteObject(HGDIOBJ::from(light_brush));
    let inset = ((2.0 * scale).round() as i32).max(1);
    let far_hole = RECT {
        left: far.left + inset,
        top: far.top + inset,
        right: far.right - inset,
        bottom: far.bottom - inset,
    };
    let hole_brush = CreateSolidBrush(COLORREF(COLOR_BRAND));
    FillRect(color_dc, &far_hole, hole_brush);
    let _ = DeleteObject(HGDIOBJ::from(hole_brush));

    let near = RECT {
        left: (23.0 * scale) as i32,
        top: (27.0 * scale) as i32,
        right: (54.0 * scale) as i32,
        bottom: (50.0 * scale) as i32,
    };
    let white_brush = CreateSolidBrush(COLORREF(COLOR_ON_SOLID));
    FillRect(color_dc, &near, white_brush);
    let _ = DeleteObject(HGDIOBJ::from(white_brush));

    let bar = RECT {
        left: (28.0 * scale) as i32,
        top: (43.0 * scale) as i32,
        right: (49.0 * scale) as i32,
        bottom: ((43.0 + 2.8) * scale) as i32,
    };
    let bar_brush = CreateSolidBrush(COLORREF(COLOR_BRAND));
    FillRect(color_dc, &bar, bar_brush);
    let _ = DeleteObject(HGDIOBJ::from(bar_brush));

    let _ = SelectObject(color_dc, old_color);

    let mask_dc = CreateCompatibleDC(Some(screen));
    let mask_bitmap = CreateCompatibleBitmap(screen, size, size);
    let old_mask = SelectObject(mask_dc, HGDIOBJ::from(mask_bitmap));
    let black_brush = CreateSolidBrush(COLORREF(0));
    FillRect(mask_dc, &full, black_brush);
    let _ = DeleteObject(HGDIOBJ::from(black_brush));
    let _ = SelectObject(mask_dc, old_mask);

    let info = ICONINFO {
        fIcon: true.into(),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask_bitmap,
        hbmColor: color_bitmap,
    };
    let icon = CreateIconIndirect(&info)?;
    let _ = DeleteObject(HGDIOBJ::from(color_bitmap));
    let _ = DeleteObject(HGDIOBJ::from(mask_bitmap));
    let _ = DeleteDC(color_dc);
    let _ = DeleteDC(mask_dc);
    let _ = ReleaseDC(None, screen);
    Ok(icon)
}

#[cfg(test)]
mod tests {
    use super::{
        fullscreen_button, hit_frame, letterbox, link_badge_rect, subscription_badge_rect, FrameRect,
        BADGE_TOP, TOOLBAR_HEIGHT,
    };

    #[test]
    fn letterbox_宽屏容器左右留黑边() {
        let frame = letterbox(1920, 1080, 16, 9);
        assert_eq!(frame.left, 0);
        assert_eq!(frame.top, 0);
        assert_eq!(frame.width, 1920);
        assert_eq!(frame.height, 1080);
    }

    #[test]
    fn letterbox_窄屏容器上下留黑边() {
        let frame = letterbox(800, 800, 16, 9);
        assert_eq!(frame.width, 800);
        assert!(frame.height < 800);
        assert_eq!(frame.left, 0);
        assert_eq!(frame.top, (800 - frame.height) / 2);
    }

    #[test]
    fn hit_frame_边界半开() {
        let frame = FrameRect {
            left: 10,
            top: 20,
            width: 30,
            height: 40,
        };
        assert!(hit_frame(10, 20, &frame));
        assert!(!hit_frame(40, 20, &frame));
        assert!(!hit_frame(10, 60, &frame));
    }

    #[test]
    fn 藏工具条时链路角标仍在右上() {
        // 角标几何不吃 TOOLBAR_HEIGHT，藏条后仍钉在客户区顶部。
        let client_width = 1100;
        let client_height = 680;
        let badge = link_badge_rect(client_width);
        assert_eq!(badge.top, BADGE_TOP);
        assert_eq!(badge, link_badge_rect(client_width));
        assert!(badge.left + badge.width <= client_width);
        let bar_button = fullscreen_button(client_width, client_height);
        assert!(badge.top + badge.height < client_height - TOOLBAR_HEIGHT);
        assert!(badge.top + badge.height < bar_button.top);
        let sub = subscription_badge_rect(client_width);
        assert_eq!(sub.top, BADGE_TOP);
        assert!(sub.left + sub.width <= badge.left);
    }
}
