//! 被控端开关与确认页的命中区 / 绘制 / 品牌图标。
//! 布局常量集中于此，便于改版时不动会话与采集逻辑。

use windows::Win32::Foundation::{COLORREF, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW, FillRect, GetDC,
    ReleaseDC, SelectObject, SetTextColor, DT_LEFT, DT_WORDBREAK, HDC, HGDIOBJ,
};
use windows::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, HICON, ICONINFO};

use crate::ui_theme::{COLOR_BRAND, COLOR_ON_SOLID, COLOR_SWITCH_OFF, COLOR_TEXT, DESKTOP_MIN_PX};

pub const SWITCH_LEFT: i32 = 24;
pub const SWITCH_TOP: i32 = 232;
pub const SWITCH_TRACK_W: i32 = 48;
pub const SWITCH_TRACK_H: i32 = 26;
pub const SWITCH_HIT_RIGHT: i32 = 220;
pub const SWITCH_HIT_BOTTOM: i32 = 262;
pub const CONFIRM_ALLOW_LEFT: i32 = 40;
pub const CONFIRM_REFUSE_LEFT: i32 = 360;
pub const CONFIRM_BTN_TOP: i32 = 280;
pub const CONFIRM_BTN_W: i32 = 140;
pub const CONFIRM_BTN_H: i32 = DESKTOP_MIN_PX;

const COLOR_THUMB: u32 = COLOR_ON_SOLID;

pub fn hit_rect(click_x: i32, click_y: i32, left: i32, top: i32, width: i32, height: i32) -> bool {
    click_x >= left && click_x < left + width && click_y >= top && click_y < top + height
}

pub fn hit_confirm_refuse(click_x: i32, click_y: i32) -> bool {
    hit_rect(
        click_x,
        click_y,
        CONFIRM_REFUSE_LEFT,
        CONFIRM_BTN_TOP,
        CONFIRM_BTN_W,
        CONFIRM_BTN_H,
    )
}

pub fn hit_confirm_allow(click_x: i32, click_y: i32) -> bool {
    hit_rect(
        click_x,
        click_y,
        CONFIRM_ALLOW_LEFT,
        CONFIRM_BTN_TOP,
        CONFIRM_BTN_W,
        CONFIRM_BTN_H,
    )
}

pub fn hit_accept_switch(click_x: i32, click_y: i32) -> bool {
    click_x >= SWITCH_LEFT
        && click_x <= SWITCH_HIT_RIGHT
        && click_y >= SWITCH_TOP
        && click_y <= SWITCH_HIT_BOTTOM
}

/// 「拒绝」实心主按钮；「允许本次」同尺寸描边。
pub unsafe fn paint_confirm_buttons(device_context: HDC) {
    let refuse = RECT {
        left: CONFIRM_REFUSE_LEFT,
        top: CONFIRM_BTN_TOP,
        right: CONFIRM_REFUSE_LEFT + CONFIRM_BTN_W,
        bottom: CONFIRM_BTN_TOP + CONFIRM_BTN_H,
    };
    let refuse_brush = CreateSolidBrush(COLORREF(COLOR_TEXT));
    FillRect(device_context, &refuse, refuse_brush);
    let _ = DeleteObject(HGDIOBJ::from(refuse_brush));
    let _ = SetTextColor(device_context, COLORREF(COLOR_ON_SOLID));
    let refuse_label = wide_chars("拒绝");
    draw_line(
        device_context,
        &refuse_label,
        CONFIRM_REFUSE_LEFT,
        CONFIRM_BTN_TOP + 8,
        CONFIRM_BTN_W,
        20,
    );

    let allow = RECT {
        left: CONFIRM_ALLOW_LEFT,
        top: CONFIRM_BTN_TOP,
        right: CONFIRM_ALLOW_LEFT + CONFIRM_BTN_W,
        bottom: CONFIRM_BTN_TOP + CONFIRM_BTN_H,
    };
    let border_brush = CreateSolidBrush(COLORREF(COLOR_TEXT));
    FillRect(device_context, &allow, border_brush);
    let _ = DeleteObject(HGDIOBJ::from(border_brush));
    let inset = RECT {
        left: allow.left + 2,
        top: allow.top + 2,
        right: allow.right - 2,
        bottom: allow.bottom - 2,
    };
    let inset_brush = CreateSolidBrush(COLORREF(COLOR_ON_SOLID));
    FillRect(device_context, &inset, inset_brush);
    let _ = DeleteObject(HGDIOBJ::from(inset_brush));
    let _ = SetTextColor(device_context, COLORREF(COLOR_TEXT));
    let allow_label = wide_chars("允许本次");
    draw_line(
        device_context,
        &allow_label,
        CONFIRM_ALLOW_LEFT,
        CONFIRM_BTN_TOP + 8,
        CONFIRM_BTN_W,
        20,
    );
}

pub unsafe fn paint_accept_switch(device_context: HDC, accepting: bool) {
    let track = RECT {
        left: SWITCH_LEFT,
        top: SWITCH_TOP,
        right: SWITCH_LEFT + SWITCH_TRACK_W,
        bottom: SWITCH_TOP + SWITCH_TRACK_H,
    };
    let track_color = if accepting { COLOR_BRAND } else { COLOR_SWITCH_OFF };
    let track_brush = CreateSolidBrush(COLORREF(track_color));
    FillRect(device_context, &track, track_brush);
    let _ = DeleteObject(HGDIOBJ::from(track_brush));

    let thumb_size = SWITCH_TRACK_H - 4;
    let thumb_left = if accepting {
        SWITCH_LEFT + SWITCH_TRACK_W - thumb_size - 2
    } else {
        SWITCH_LEFT + 2
    };
    let thumb = RECT {
        left: thumb_left,
        top: SWITCH_TOP + 2,
        right: thumb_left + thumb_size,
        bottom: SWITCH_TOP + 2 + thumb_size,
    };
    let thumb_brush = CreateSolidBrush(COLORREF(COLOR_THUMB));
    FillRect(device_context, &thumb, thumb_brush);
    let _ = DeleteObject(HGDIOBJ::from(thumb_brush));
}

/// 双视口品牌标（对齐高保真 h0），供窗体与托盘使用。
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

unsafe fn draw_line(device_context: HDC, text: &[u16], left: i32, top: i32, width: i32, height: i32) {
    let mut owned = text.to_vec();
    let mut rect = RECT {
        left,
        top,
        right: left + width,
        bottom: top + height,
    };
    DrawTextW(device_context, &mut owned, &mut rect, DT_LEFT | DT_WORDBREAK);
}

fn wide_chars(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

#[cfg(test)]
mod tests {
    use super::{
        hit_accept_switch, hit_confirm_allow, hit_confirm_refuse, CONFIRM_ALLOW_LEFT, CONFIRM_BTN_H, CONFIRM_BTN_TOP,
        CONFIRM_BTN_W, CONFIRM_REFUSE_LEFT, SWITCH_HIT_BOTTOM, SWITCH_HIT_RIGHT, SWITCH_LEFT, SWITCH_TOP,
    };

    #[test]
    fn 开关命中含轨道与标签() {
        assert!(hit_accept_switch(SWITCH_LEFT + 4, SWITCH_TOP + 4));
        assert!(hit_accept_switch(SWITCH_HIT_RIGHT - 4, SWITCH_HIT_BOTTOM - 4));
        assert!(!hit_accept_switch(SWITCH_LEFT - 2, SWITCH_TOP + 4));
        assert!(!hit_accept_switch(SWITCH_LEFT + 4, SWITCH_TOP - 2));
    }

    #[test]
    fn 确认页拒绝为默认命中区() {
        assert!(hit_confirm_refuse(CONFIRM_REFUSE_LEFT + 10, CONFIRM_BTN_TOP + 10));
        assert!(hit_confirm_allow(CONFIRM_ALLOW_LEFT + 10, CONFIRM_BTN_TOP + 10));
        assert!(!hit_confirm_refuse(CONFIRM_ALLOW_LEFT + 10, CONFIRM_BTN_TOP + 10));
        assert!(!hit_confirm_allow(
            CONFIRM_REFUSE_LEFT + 10,
            CONFIRM_BTN_TOP + CONFIRM_BTN_H + 2
        ));
        let _ = CONFIRM_BTN_W;
    }
}
