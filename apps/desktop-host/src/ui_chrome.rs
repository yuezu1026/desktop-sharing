//! 被控端绘制与命中：只消费 `host_layout` 矩形 + `host_hf` 快照。
//! 禁止在本文件另写页面坐标。

use windows::Win32::Foundation::{COLORREF, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleBitmap, CreateCompatibleDC, CreateFontW, CreateSolidBrush, DeleteDC, DeleteObject, DrawTextW,
    FillRect, GetDC, ReleaseDC, SelectObject, SetBkMode, SetTextCharacterExtra, SetTextColor, CLIP_DEFAULT_PRECIS,
    DEFAULT_CHARSET, DEFAULT_QUALITY, DT_CENTER, DT_LEFT, DT_SINGLELINE, DT_VCENTER, DT_WORDBREAK, HDC, HGDIOBJ,
    OUT_DEFAULT_PRECIS, TRANSPARENT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AdjustWindowRectEx, CreateIconIndirect, HICON, ICONINFO, WINDOW_EX_STYLE, WINDOW_STYLE,
};
use windows::core::PCWSTR;

use crate::host_hf::{self, HostConfirmView, HostMainView};
use crate::host_layout::{self, Rect as LayoutRect};
use crate::ui_d2d;
use crate::ui_round::{fill_round_rect_aa, stroke_round_rect_aa};
use crate::ui_theme::{
    COLOR_BG, COLOR_BRAND, COLOR_LINE, COLOR_LINE2, COLOR_OK, COLOR_OK_SOFT, COLOR_ON_SOLID, COLOR_SURFACE,
    COLOR_SURFACE2, COLOR_SURFACE3, COLOR_SWITCH_OFF, COLOR_TEXT, COLOR_TEXT2, COLOR_TEXT3,
};

const COLOR_THUMB: u32 = COLOR_ON_SOLID;
const PANEL_RADIUS: i32 = 14;
const PILL_RADIUS: i32 = 14;
const BUTTON_RADIUS: i32 = 10;
const FRAUD_RADIUS: i32 = 12;

pub use host_layout::{CONFIRM_HEIGHT, CONFIRM_WIDTH, MAIN_HEIGHT, MAIN_WIDTH};

/// CreateWindow 的宽高是外框；布局常量是客户区。换算后再开窗，避免底部按钮被裁切。
pub fn outer_size_for_client(
    client_width: i32,
    client_height: i32,
    style: WINDOW_STYLE,
    ex_style: WINDOW_EX_STYLE,
) -> (i32, i32) {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: client_width,
        bottom: client_height,
    };
    let _ = unsafe { AdjustWindowRectEx(&mut rect, style, false, ex_style) };
    (rect.right - rect.left, rect.bottom - rect.top)
}

fn to_gdi(rect: LayoutRect) -> RECT {
    RECT {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    }
}

pub fn hit_confirm_refuse(click_x: i32, click_y: i32) -> bool {
    host_layout::CONFIRM_REFUSE.rect.contains(click_x, click_y)
}

pub fn hit_confirm_allow(click_x: i32, click_y: i32) -> bool {
    host_layout::CONFIRM_ALLOW.rect.contains(click_x, click_y)
}

pub fn hit_accept_switch(click_x: i32, click_y: i32) -> bool {
    host_layout::ACCEPT_SWITCH_HIT.contains(click_x, click_y)
}

pub unsafe fn paint_main_shell(device_context: HDC, view: &HostMainView) {
    if ui_d2d::paint_main_shell(device_context, view).is_ok() {
        return;
    }
    paint_main_shell_gdi(device_context, view);
}

unsafe fn paint_main_shell_gdi(device_context: HDC, view: &HostMainView) {
    fill_bg(device_context, host_layout::MAIN_WIDTH, host_layout::MAIN_HEIGHT, COLOR_SURFACE2);
    fill_panel(device_context, host_layout::LEFT_PANEL, COLOR_SURFACE, COLOR_LINE);
    fill_panel(device_context, host_layout::RIGHT_STATUS, COLOR_SURFACE, COLOR_LINE);
    fill_panel(device_context, host_layout::RIGHT_SWITCHES, COLOR_SURFACE, COLOR_LINE);
    fill_round_rect_aa(device_context, host_layout::RIGHT_FRAUD, COLOR_SURFACE, FRAUD_RADIUS);
    stroke_round_rect_aa(device_context, host_layout::RIGHT_FRAUD, COLOR_TEXT, FRAUD_RADIUS, 2.0);
    SetBkMode(device_context, TRANSPARENT);

    draw_in(device_context, host_hf::LABEL_DEVICE_CODE, host_layout::LABEL_CODE, DrawStyle::Label);
    draw_mono_in(device_context, &view.code_text, host_layout::VALUE_CODE, 28);
    draw_in(device_context, host_hf::LABEL_TEMP_PASSWORD, host_layout::LABEL_PASSWORD, DrawStyle::Label);
    draw_mono_in(device_context, &view.password_text, host_layout::VALUE_PASSWORD, 20);
    draw_in(device_context, host_hf::PASSWORD_HINT, host_layout::PASSWORD_HINT, DrawStyle::Muted);

    paint_accept_switch(device_context, view.accepting);
    draw_in(
        device_context,
        host_hf::SWITCH_ALLOW,
        host_layout::ACCEPT_SWITCH_LABEL,
        DrawStyle::Body,
    );

    draw_in(device_context, host_hf::STATUS_TITLE, host_layout::STATUS_TITLE, DrawStyle::Bold);
    paint_pill_at(
        device_context,
        host_layout::STATUS_PILL.left,
        host_layout::STATUS_PILL.top,
        &view.status_pill,
        PillKind::Neutral,
    );
    draw_in(device_context, &view.status_hint, host_layout::STATUS_HINT, DrawStyle::Muted);

    draw_in(device_context, host_hf::SWITCHES_TITLE, host_layout::SWITCHES_TITLE, DrawStyle::Bold);
    draw_switch_row(device_context, host_layout::SWITCH_ROW_1, host_hf::SWITCH_AUTO_START, host_hf::SWITCH_ON, true);
    draw_switch_row(device_context, host_layout::SWITCH_ROW_2, host_hf::SWITCH_IDLE_ZERO, host_hf::SWITCH_ON, true);
    draw_switch_row(
        device_context,
        host_layout::SWITCH_ROW_3,
        host_hf::SWITCH_RESOURCE,
        host_hf::SWITCH_BALANCED,
        false,
    );

    draw_in(device_context, host_hf::FRAUD_TITLE, host_layout::FRAUD_TITLE, DrawStyle::Bold);
    draw_in(device_context, host_hf::FRAUD_BODY, host_layout::FRAUD_BODY, DrawStyle::Muted);

    paint_main_actions(device_context, view.show_session_actions);
}

unsafe fn paint_main_actions(device_context: HDC, show_session_actions: bool) {
    paint_outline_button(device_context, host_layout::BTN_COPY.rect, host_hf::BTN_COPY);
    paint_outline_button(device_context, host_layout::BTN_ROTATE.rect, host_hf::BTN_ROTATE);
    if !show_session_actions {
        return;
    }
    paint_outline_button(device_context, host_layout::BTN_STOP.rect, host_hf::BTN_STOP);
    paint_outline_button(device_context, host_layout::BTN_VIEW_ONLY.rect, host_hf::BTN_VIEW_ONLY);
    paint_outline_button(device_context, host_layout::BTN_RESTORE_INPUT.rect, host_hf::BTN_RESTORE_INPUT);
}

unsafe fn paint_outline_button(device_context: HDC, rect: LayoutRect, label: &str) {
    fill_round_rect_aa(device_context, rect, COLOR_SURFACE, BUTTON_RADIUS);
    stroke_round_rect_aa(device_context, rect, COLOR_LINE2, BUTTON_RADIUS, 1.0);
    let _ = SetTextColor(device_context, COLORREF(COLOR_TEXT));
    with_font(device_context, "Microsoft YaHei UI", 13, 600, || {
        draw_text(device_context, label, rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    });
}

pub unsafe fn paint_confirm_shell(device_context: HDC, view: &HostConfirmView) {
    if ui_d2d::paint_confirm_shell(device_context, view).is_ok() {
        return;
    }
    paint_confirm_shell_gdi(device_context, view);
}

unsafe fn paint_confirm_shell_gdi(device_context: HDC, view: &HostConfirmView) {
    fill_bg(device_context, host_layout::CONFIRM_WIDTH, host_layout::CONFIRM_HEIGHT, COLOR_SURFACE2);
    fill_panel(device_context, host_layout::CONFIRM_CARD, COLOR_SURFACE, COLOR_LINE);
    SetBkMode(device_context, TRANSPARENT);

    draw_in(device_context, host_hf::CONFIRM_TITLE, host_layout::CONFIRM_TITLE, DrawStyle::Title);
    fill_round_rect_aa(device_context, host_layout::CONFIRM_WHO_PANEL, COLOR_BG, 12);

    let avatar = to_gdi(host_layout::CONFIRM_AVATAR);
    let avatar_brush = CreateSolidBrush(COLORREF(COLOR_BRAND));
    FillRect(device_context, &avatar, avatar_brush);
    let _ = DeleteObject(HGDIOBJ::from(avatar_brush));
    let _ = SetTextColor(device_context, COLORREF(COLOR_ON_SOLID));
    let avatar_letter = view
        .controller_line
        .chars()
        .find(|ch| ch.is_ascii_digit() || ('\u{4e00}'..='\u{9fff}').contains(ch))
        .map(|ch| ch.to_string())
        .unwrap_or_else(|| "客".to_string());
    draw_centered_in(device_context, &avatar_letter, host_layout::CONFIRM_AVATAR);

    draw_in(device_context, &view.controller_line, host_layout::CONFIRM_WHO, DrawStyle::Bold);
    draw_in(device_context, &view.device_note, host_layout::CONFIRM_DEVICE_NOTE, DrawStyle::Muted);
    paint_pill_at(
        device_context,
        host_layout::CONFIRM_PILL.left,
        host_layout::CONFIRM_PILL.top,
        host_hf::connection_pill(view.first_connection),
        PillKind::Fact,
    );

    draw_in(device_context, host_hf::CONFIRM_CAN_LABEL, host_layout::CONFIRM_CAN_LABEL, DrawStyle::Label);
    let mut can_top = host_layout::CONFIRM_CAN_FIRST.top;
    for line in host_hf::confirm_can_lines() {
        let line_rect = LayoutRect::from_xywh(
            host_layout::CONFIRM_CAN_FIRST.left,
            can_top,
            host_layout::CONFIRM_CAN_FIRST.width(),
            host_layout::CONFIRM_CAN_FIRST.height(),
        );
        draw_in(device_context, line, line_rect, DrawStyle::Body);
        can_top += host_layout::CONFIRM_CAN_LINE_STEP;
    }

    fill_round_rect_aa(device_context, host_layout::CONFIRM_FRAUD_PANEL, COLOR_SURFACE, FRAUD_RADIUS);
    stroke_round_rect_aa(device_context, host_layout::CONFIRM_FRAUD_PANEL, COLOR_TEXT, FRAUD_RADIUS, 2.0);
    draw_in(
        device_context,
        host_hf::CONFIRM_FRAUD_TITLE,
        host_layout::CONFIRM_FRAUD_TITLE,
        DrawStyle::Bold,
    );
    let mut fraud_top = host_layout::CONFIRM_FRAUD_FIRST.top;
    for (index, line) in host_hf::confirm_fraud_lines().iter().enumerate() {
        let numbered = format!("{}. {line}", index + 1);
        let line_rect = LayoutRect::from_xywh(
            host_layout::CONFIRM_FRAUD_FIRST.left,
            fraud_top,
            host_layout::CONFIRM_FRAUD_FIRST.width(),
            host_layout::CONFIRM_FRAUD_FIRST.height(),
        );
        draw_in(device_context, &numbered, line_rect, DrawStyle::Muted);
        fraud_top += host_layout::CONFIRM_FRAUD_LINE_STEP;
    }

    paint_confirm_buttons(device_context);
}

/// 「拒绝」实心主按钮；「允许本次」同尺寸描边。
pub unsafe fn paint_confirm_buttons(device_context: HDC) {
    let refuse = host_layout::CONFIRM_REFUSE.rect;
    fill_round_rect_aa(device_context, refuse, COLOR_TEXT, BUTTON_RADIUS);
    let _ = SetTextColor(device_context, COLORREF(COLOR_ON_SOLID));
    with_font(device_context, "Microsoft YaHei UI", 13, 600, || {
        draw_text(device_context, host_hf::CONFIRM_REFUSE, refuse, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    });

    paint_outline_button(device_context, host_layout::CONFIRM_ALLOW.rect, host_hf::CONFIRM_ALLOW);
}

pub unsafe fn paint_accept_switch(device_context: HDC, accepting: bool) {
    let track = host_layout::ACCEPT_SWITCH_TRACK;
    let track_color = if accepting { COLOR_BRAND } else { COLOR_SWITCH_OFF };
    let track_radius = track.height() / 2;
    fill_round_rect(device_context, track, track_color, track_radius);

    let thumb_size = track.height() - 4;
    let thumb_left = if accepting {
        track.right - thumb_size - 2
    } else {
        track.left + 2
    };
    let thumb = LayoutRect::from_xywh(thumb_left, track.top + 2, thumb_size, thumb_size);
    fill_round_rect(device_context, thumb, COLOR_THUMB, thumb_size / 2);
}

unsafe fn fill_bg(device_context: HDC, width: i32, height: i32, color: u32) {
    let full = RECT {
        left: 0,
        top: 0,
        right: width,
        bottom: height,
    };
    let brush = CreateSolidBrush(COLORREF(color));
    FillRect(device_context, &full, brush);
    let _ = DeleteObject(HGDIOBJ::from(brush));
}

unsafe fn fill_panel(device_context: HDC, panel: LayoutRect, fill: u32, border: u32) {
    fill_round_rect_aa(device_context, panel, fill, PANEL_RADIUS);
    stroke_round_rect_aa(device_context, panel, border, PANEL_RADIUS, 1.0);
}

unsafe fn fill_round_rect(device_context: HDC, rect: LayoutRect, fill: u32, radius: i32) {
    fill_round_rect_aa(device_context, rect, fill, radius);
}

#[derive(Clone, Copy)]
enum PillKind {
    /// 状态「未被连接」、资源「均衡」
    Neutral,
    /// 「开」
    Ok,
    /// 「首次连接」描边事实标
    Fact,
}

unsafe fn paint_pill_at(device_context: HDC, left: i32, top: i32, label: &str, kind: PillKind) {
    let width = (label.encode_utf16().count() as i32 * 11 + 18).max(48);
    let height = 22;
    let rect = LayoutRect::from_xywh(left, top, width, height);
    match kind {
        PillKind::Neutral => {
            fill_round_rect(device_context, rect, COLOR_SURFACE3, PILL_RADIUS);
            let _ = SetTextColor(device_context, COLORREF(COLOR_TEXT2));
        }
        PillKind::Ok => {
            fill_round_rect(device_context, rect, COLOR_OK_SOFT, PILL_RADIUS);
            let _ = SetTextColor(device_context, COLORREF(COLOR_OK));
        }
        PillKind::Fact => {
            fill_round_rect(device_context, rect, COLOR_TEXT, PILL_RADIUS);
            let inset = LayoutRect {
                left: rect.left + 1,
                top: rect.top + 1,
                right: rect.right - 1,
                bottom: rect.bottom - 1,
            };
            fill_round_rect(device_context, inset, COLOR_SURFACE, PILL_RADIUS.saturating_sub(1));
            let _ = SetTextColor(device_context, COLORREF(COLOR_TEXT));
        }
    }
    with_font(device_context, "Microsoft YaHei UI", 12, 650, || {
        draw_text(device_context, label, rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    });
}

unsafe fn draw_switch_row(device_context: HDC, row: LayoutRect, label: &str, value: &str, on: bool) {
    draw_in(device_context, label, row, DrawStyle::Body);
    paint_pill_at(
        device_context,
        row.left + host_layout::SWITCH_ROW_PILL_OFFSET_X,
        row.top - 1,
        value,
        if on { PillKind::Ok } else { PillKind::Neutral },
    );
}

enum DrawStyle {
    Title,
    Label,
    Body,
    Bold,
    Muted,
}

unsafe fn draw_in(device_context: HDC, text: &str, rect: LayoutRect, style: DrawStyle) {
    let (color, size, weight, format) = match style {
        DrawStyle::Title => (COLOR_TEXT, 20, 600, DT_LEFT | DT_SINGLELINE),
        DrawStyle::Label => (COLOR_TEXT3, 12, 400, DT_LEFT | DT_SINGLELINE),
        DrawStyle::Body => (COLOR_TEXT, 15, 400, DT_LEFT | DT_WORDBREAK),
        DrawStyle::Bold => (COLOR_TEXT, 15, 600, DT_LEFT | DT_WORDBREAK),
        DrawStyle::Muted => (COLOR_TEXT2, 13, 400, DT_LEFT | DT_WORDBREAK),
    };
    let _ = SetTextColor(device_context, COLORREF(color));
    with_font(device_context, "Microsoft YaHei UI", size, weight, || {
        draw_text(device_context, text, rect, format);
    });
}

unsafe fn draw_mono_in(device_context: HDC, text: &str, rect: LayoutRect, size: i32) {
    let _ = SetTextColor(device_context, COLORREF(COLOR_TEXT));
    // 仅识别码加大字距；临时密码保持自然宽度。
    let extra = if size >= 24 {
        (size as f32 * 0.08).round() as i32
    } else {
        0
    };
    let previous = SetTextCharacterExtra(device_context, extra);
    with_font(device_context, "Consolas", size, 600, || {
        draw_text(device_context, text, rect, DT_LEFT | DT_SINGLELINE);
    });
    let _ = SetTextCharacterExtra(device_context, previous);
}

unsafe fn draw_centered_in(device_context: HDC, text: &str, rect: LayoutRect) {
    with_font(device_context, "Microsoft YaHei UI", 16, 600, || {
        draw_text(device_context, text, rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
    });
}

unsafe fn with_font<F: FnOnce()>(device_context: HDC, face: &str, size: i32, weight: i32, paint: F) {
    let face_wide = wide_z(face);
    let font = CreateFontW(
        size,
        0,
        0,
        0,
        weight,
        0,
        0,
        0,
        DEFAULT_CHARSET,
        OUT_DEFAULT_PRECIS,
        CLIP_DEFAULT_PRECIS,
        DEFAULT_QUALITY,
        1,
        PCWSTR(face_wide.as_ptr()),
    );
    let previous = SelectObject(device_context, HGDIOBJ::from(font));
    paint();
    SelectObject(device_context, previous);
    let _ = DeleteObject(HGDIOBJ::from(font));
}

unsafe fn draw_text(
    device_context: HDC,
    text: &str,
    rect: LayoutRect,
    format: windows::Win32::Graphics::Gdi::DRAW_TEXT_FORMAT,
) {
    let mut owned = wide_chars(text);
    let mut gdi_rect = to_gdi(rect);
    DrawTextW(device_context, &mut owned, &mut gdi_rect, format);
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

fn wide_chars(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn wide_z(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::{hit_accept_switch, hit_confirm_allow, hit_confirm_refuse, outer_size_for_client};
    use crate::host_layout;
    use windows::Win32::UI::WindowsAndMessaging::{
        WINDOW_EX_STYLE, WS_CAPTION, WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU,
    };

    #[test]
    fn 开关命中含轨道与标签() {
        let track = host_layout::ACCEPT_SWITCH_TRACK;
        assert!(hit_accept_switch(track.left + 4, track.top + 4));
        assert!(hit_accept_switch(
            host_layout::ACCEPT_SWITCH_HIT.right - 4,
            host_layout::ACCEPT_SWITCH_HIT.bottom - 4
        ));
        assert!(!hit_accept_switch(track.left - 2, track.top + 4));
    }

    #[test]
    fn 确认页拒绝为默认命中区() {
        let refuse = host_layout::CONFIRM_REFUSE.rect;
        let allow = host_layout::CONFIRM_ALLOW.rect;
        assert!(hit_confirm_refuse(refuse.left + 10, refuse.top + 10));
        assert!(hit_confirm_allow(allow.left + 10, allow.top + 10));
        assert!(!hit_confirm_refuse(allow.left + 10, allow.top + 10));
        assert!(!hit_confirm_allow(refuse.left + 10, refuse.bottom + 2));
    }

    #[test]
    fn 外框尺寸大于客户区() {
        let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
        let (outer_width, outer_height) =
            outer_size_for_client(host_layout::MAIN_WIDTH, host_layout::MAIN_HEIGHT, style, WINDOW_EX_STYLE::default());
        assert!(outer_width >= host_layout::MAIN_WIDTH);
        assert!(outer_height > host_layout::MAIN_HEIGHT);
        let (confirm_width, confirm_height) = outer_size_for_client(
            host_layout::CONFIRM_WIDTH,
            host_layout::CONFIRM_HEIGHT,
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU,
            WINDOW_EX_STYLE::default(),
        );
        assert!(confirm_width >= host_layout::CONFIRM_WIDTH);
        assert!(confirm_height > host_layout::CONFIRM_HEIGHT);
    }
}
