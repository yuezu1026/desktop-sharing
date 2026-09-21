//! Direct2D + DirectWrite 被控端绘制层。
//! 工厂 OnceLock 缓存；每帧 CreateDCRenderTarget → BindDC → BeginDraw/EndDraw。

use std::sync::OnceLock;

use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Direct2D::Common::{
    D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_PIXEL_FORMAT, D2D_RECT_F,
};
use windows::Win32::Graphics::Direct2D::{
    D2D1CreateFactory, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE, D2D1_DRAW_TEXT_OPTIONS_NONE,
    D2D1_FACTORY_TYPE_SINGLE_THREADED, D2D1_FEATURE_LEVEL_DEFAULT, D2D1_RENDER_TARGET_PROPERTIES,
    D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1_RENDER_TARGET_USAGE_NONE, D2D1_ROUNDED_RECT,
    D2D1_TEXT_ANTIALIAS_MODE_CLEARTYPE, ID2D1DCRenderTarget, ID2D1Factory, ID2D1SolidColorBrush,
};
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL,
    DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT, DWRITE_FONT_WEIGHT_NORMAL,
    DWRITE_FONT_WEIGHT_SEMI_BOLD, DWRITE_MEASURING_MODE_NATURAL,
    DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_PARAGRAPH_ALIGNMENT_NEAR, DWRITE_TEXT_ALIGNMENT_CENTER,
    DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_WORD_WRAPPING_NO_WRAP, DWRITE_WORD_WRAPPING_WRAP,
    IDWriteFactory, IDWriteTextFormat,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Gdi::HDC;
use windows::core::{Result as WinResult, w};

use crate::host_hf::{self, HostConfirmView, HostMainView};
use crate::host_layout::{self, Rect as LayoutRect};
use crate::ui_theme::{
    COLOR_BG, COLOR_BRAND, COLOR_LINE, COLOR_LINE2, COLOR_OK, COLOR_OK_SOFT, COLOR_ON_SOLID, COLOR_SURFACE,
    COLOR_SURFACE2, COLOR_SURFACE3, COLOR_SWITCH_OFF, COLOR_TEXT, COLOR_TEXT2, COLOR_TEXT3,
};

const PANEL_RADIUS: f32 = 14.0;
const PILL_RADIUS: f32 = 14.0;
const BUTTON_RADIUS: f32 = 10.0;
const FRAUD_RADIUS: f32 = 12.0;

static D2D_FACTORY: OnceLock<WinResult<ID2D1Factory>> = OnceLock::new();
static DWRITE_FACTORY: OnceLock<WinResult<IDWriteFactory>> = OnceLock::new();

fn d2d_factory() -> WinResult<&'static ID2D1Factory> {
    D2D_FACTORY
        .get_or_init(|| unsafe { D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None) })
        .as_ref()
        .map_err(|error| error.clone())
}

fn dwrite_factory() -> WinResult<&'static IDWriteFactory> {
    DWRITE_FACTORY
        .get_or_init(|| unsafe { DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED) })
        .as_ref()
        .map_err(|error| error.clone())
}

/// COLORREF(BGR) → D2D1_COLOR_F（0..=1）。
pub fn colorref_to_d2d(colorref: u32, alpha: f32) -> D2D1_COLOR_F {
    let red = (colorref & 0xff) as f32 / 255.0;
    let green = ((colorref >> 8) & 0xff) as f32 / 255.0;
    let blue = ((colorref >> 16) & 0xff) as f32 / 255.0;
    D2D1_COLOR_F {
        r: red,
        g: green,
        b: blue,
        a: alpha.clamp(0.0, 1.0),
    }
}

fn to_d2d_rect(rect: LayoutRect) -> D2D_RECT_F {
    D2D_RECT_F {
        left: rect.left as f32,
        top: rect.top as f32,
        right: rect.right as f32,
        bottom: rect.bottom as f32,
    }
}

fn rounded(rect: LayoutRect, radius: f32) -> D2D1_ROUNDED_RECT {
    let width = rect.width().max(0) as f32;
    let height = rect.height().max(0) as f32;
    let capped = radius.min(width * 0.5).min(height * 0.5).max(0.0);
    D2D1_ROUNDED_RECT {
        rect: to_d2d_rect(rect),
        radiusX: capped,
        radiusY: capped,
    }
}

/// 单帧 DC 绑定目标；`end()` 提交，未提交则 Drop 时尝试 EndDraw 以免卡在绘制态。
pub struct DcFrame {
    target: ID2D1DCRenderTarget,
    finished: bool,
}

impl DcFrame {
    pub fn begin(device_context: HDC, width: i32, height: i32) -> WinResult<Self> {
        let factory = d2d_factory()?;
        let properties = D2D1_RENDER_TARGET_PROPERTIES {
            r#type: D2D1_RENDER_TARGET_TYPE_DEFAULT,
            pixelFormat: D2D1_PIXEL_FORMAT {
                format: DXGI_FORMAT_B8G8R8A8_UNORM,
                alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
            },
            dpiX: 0.0,
            dpiY: 0.0,
            usage: D2D1_RENDER_TARGET_USAGE_NONE,
            minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
        };
        let target = unsafe { factory.CreateDCRenderTarget(&properties)? };
        let bind_rect = RECT {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
        };
        unsafe {
            target.BindDC(device_context, &bind_rect)?;
            target.SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
            target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_CLEARTYPE);
            target.BeginDraw();
        }
        Ok(Self {
            target,
            finished: false,
        })
    }

    pub fn end(mut self) -> WinResult<()> {
        self.finished = true;
        unsafe { self.target.EndDraw(None, None) }
    }

    fn solid_brush(&self, colorref: u32, alpha: f32) -> WinResult<ID2D1SolidColorBrush> {
        let color = colorref_to_d2d(colorref, alpha);
        unsafe { self.target.CreateSolidColorBrush(&color, None) }
    }

    pub fn clear(&self, colorref: u32) -> WinResult<()> {
        let color = colorref_to_d2d(colorref, 1.0);
        unsafe {
            self.target.Clear(Some(&color));
        }
        Ok(())
    }

    pub fn fill_round_rect(&self, rect: LayoutRect, colorref: u32, radius: f32) -> WinResult<()> {
        self.fill_round_rect_alpha(rect, colorref, 1.0, radius)
    }

    pub fn fill_round_rect_alpha(
        &self,
        rect: LayoutRect,
        colorref: u32,
        alpha: f32,
        radius: f32,
    ) -> WinResult<()> {
        if rect.width() <= 0 || rect.height() <= 0 {
            return Ok(());
        }
        let brush = self.solid_brush(colorref, alpha)?;
        let rounded_rect = rounded(rect, radius);
        unsafe {
            self.target.FillRoundedRectangle(&rounded_rect, &brush);
        }
        Ok(())
    }

    pub fn stroke_round_rect(
        &self,
        rect: LayoutRect,
        colorref: u32,
        radius: f32,
        stroke_width: f32,
    ) -> WinResult<()> {
        if rect.width() <= 0 || rect.height() <= 0 {
            return Ok(());
        }
        let brush = self.solid_brush(colorref, 1.0)?;
        let rounded_rect = rounded(rect, radius);
        unsafe {
            self.target
                .DrawRoundedRectangle(&rounded_rect, &brush, stroke_width, None);
        }
        Ok(())
    }

    /// 正圆：用全圆角矩形代替 FillEllipse，避免额外依赖 windows_numerics。
    pub fn fill_ellipse(&self, rect: LayoutRect, colorref: u32) -> WinResult<()> {
        let radius = (rect.width().min(rect.height()) as f32) * 0.5;
        self.fill_round_rect(rect, colorref, radius)
    }

    /// h2 `.panel`：白底 + 1px line，无投影。
    pub fn panel(&self, rect: LayoutRect, fill: u32, border: u32) -> WinResult<()> {
        self.fill_round_rect(rect, fill, PANEL_RADIUS)?;
        self.stroke_round_rect(rect, border, PANEL_RADIUS, 1.0)?;
        Ok(())
    }

    pub fn draw_text(
        &self,
        text: &str,
        rect: LayoutRect,
        style: TextStyle,
        align: TextAlign,
    ) -> WinResult<()> {
        if text.is_empty() || rect.width() <= 0 || rect.height() <= 0 {
            return Ok(());
        }
        let (colorref, face, size, weight, wrap) = match style {
            TextStyle::Title => (COLOR_TEXT, Face::YaHei, 20.0, DWRITE_FONT_WEIGHT_SEMI_BOLD, false),
            TextStyle::Label => (COLOR_TEXT3, Face::YaHei, 12.0, DWRITE_FONT_WEIGHT_NORMAL, false),
            TextStyle::Body => (COLOR_TEXT, Face::YaHei, 15.0, DWRITE_FONT_WEIGHT_NORMAL, true),
            TextStyle::Bold => (COLOR_TEXT, Face::YaHei, 15.0, DWRITE_FONT_WEIGHT_SEMI_BOLD, true),
            TextStyle::Muted => (COLOR_TEXT2, Face::YaHei, 13.0, DWRITE_FONT_WEIGHT_NORMAL, true),
            TextStyle::Mono { size } => (COLOR_TEXT, Face::Consolas, size, DWRITE_FONT_WEIGHT_SEMI_BOLD, false),
            TextStyle::Button => (COLOR_TEXT, Face::YaHei, 13.0, DWRITE_FONT_WEIGHT_SEMI_BOLD, false),
            TextStyle::ButtonOnSolid => (COLOR_ON_SOLID, Face::YaHei, 13.0, DWRITE_FONT_WEIGHT_SEMI_BOLD, false),
            TextStyle::Pill { color } => (color, Face::YaHei, 12.0, DWRITE_FONT_WEIGHT_SEMI_BOLD, false),
            TextStyle::Avatar => (COLOR_ON_SOLID, Face::YaHei, 16.0, DWRITE_FONT_WEIGHT_SEMI_BOLD, false),
        };
        let format = make_text_format(face, size, weight, align, wrap)?;
        let brush = self.solid_brush(colorref, 1.0)?;
        // 仅识别码做字距；临时密码用自然宽度，避免「w 2 f 8 x d」过疏挤到说明。
        if matches!(style, TextStyle::Mono { size } if size >= 24.0) && !wrap {
            let tracking = size * 0.08;
            let mut cursor_x = rect.left as f32;
            for character in text.chars() {
                let mut utf16_buf = [0u16; 2];
                let piece = character.encode_utf16(&mut utf16_buf);
                let advance = if character == ' ' {
                    size * 0.35
                } else {
                    size * 0.55 + tracking
                };
                let cell = D2D_RECT_F {
                    left: cursor_x,
                    top: rect.top as f32,
                    right: cursor_x + advance,
                    bottom: rect.bottom as f32,
                };
                unsafe {
                    self.target.DrawText(
                        piece,
                        &format,
                        &cell,
                        &brush,
                        D2D1_DRAW_TEXT_OPTIONS_NONE,
                        DWRITE_MEASURING_MODE_NATURAL,
                    );
                }
                cursor_x += advance;
            }
            return Ok(());
        }
        let layout_rect = to_d2d_rect(rect);
        let wide: Vec<u16> = text.encode_utf16().collect();
        unsafe {
            self.target.DrawText(
                &wide,
                &format,
                &layout_rect,
                &brush,
                D2D1_DRAW_TEXT_OPTIONS_NONE,
                DWRITE_MEASURING_MODE_NATURAL,
            );
        }
        Ok(())
    }
}

impl Drop for DcFrame {
    fn drop(&mut self) {
        if !self.finished {
            let _ = unsafe { self.target.EndDraw(None, None) };
        }
    }
}

#[derive(Clone, Copy)]
enum Face {
    YaHei,
    Consolas,
}

#[derive(Clone, Copy)]
pub enum TextAlign {
    Left,
    Center,
}

#[derive(Clone, Copy)]
pub enum TextStyle {
    Title,
    Label,
    Body,
    Bold,
    Muted,
    Mono { size: f32 },
    Button,
    ButtonOnSolid,
    Pill { color: u32 },
    Avatar,
}

fn make_text_format(
    face: Face,
    size: f32,
    weight: DWRITE_FONT_WEIGHT,
    align: TextAlign,
    wrap: bool,
) -> WinResult<IDWriteTextFormat> {
    let factory = dwrite_factory()?;
    let family = match face {
        Face::YaHei => w!("Microsoft YaHei UI"),
        Face::Consolas => w!("Consolas"),
    };
    let format = unsafe {
        factory.CreateTextFormat(
            family,
            None,
            weight,
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            size,
            w!("zh-cn"),
        )?
    };
    unsafe {
        match align {
            TextAlign::Left => {
                format.SetTextAlignment(DWRITE_TEXT_ALIGNMENT_LEADING)?;
                format.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR)?;
            }
            TextAlign::Center => {
                format.SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER)?;
                format.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER)?;
            }
        }
        if wrap {
            format.SetWordWrapping(DWRITE_WORD_WRAPPING_WRAP)?;
        } else {
            format.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP)?;
        }
    }
    Ok(format)
}

#[derive(Clone, Copy)]
enum PillKind {
    Neutral,
    Ok,
    Fact,
}

fn paint_pill(frame: &DcFrame, left: i32, top: i32, label: &str, kind: PillKind) -> WinResult<()> {
    let width = (label.encode_utf16().count() as i32 * 11 + 18).max(48);
    let height = 22;
    let rect = LayoutRect::from_xywh(left, top, width, height);
    let text_color = match kind {
        PillKind::Neutral => {
            frame.fill_round_rect(rect, COLOR_SURFACE3, PILL_RADIUS)?;
            COLOR_TEXT2
        }
        PillKind::Ok => {
            frame.fill_round_rect(rect, COLOR_OK_SOFT, PILL_RADIUS)?;
            COLOR_OK
        }
        PillKind::Fact => {
            frame.fill_round_rect(rect, COLOR_TEXT, PILL_RADIUS)?;
            let inset = LayoutRect {
                left: rect.left + 1,
                top: rect.top + 1,
                right: rect.right - 1,
                bottom: rect.bottom - 1,
            };
            frame.fill_round_rect(inset, COLOR_SURFACE, (PILL_RADIUS - 1.0).max(1.0))?;
            COLOR_TEXT
        }
    };
    frame.draw_text(
        label,
        rect,
        TextStyle::Pill { color: text_color },
        TextAlign::Center,
    )?;
    Ok(())
}

fn paint_outline_button(frame: &DcFrame, rect: LayoutRect, label: &str) -> WinResult<()> {
    frame.fill_round_rect(rect, COLOR_SURFACE, BUTTON_RADIUS)?;
    frame.stroke_round_rect(rect, COLOR_LINE2, BUTTON_RADIUS, 1.0)?;
    frame.draw_text(label, rect, TextStyle::Button, TextAlign::Center)?;
    Ok(())
}

fn paint_accept_switch(frame: &DcFrame, accepting: bool) -> WinResult<()> {
    let track = host_layout::ACCEPT_SWITCH_TRACK;
    let track_color = if accepting { COLOR_BRAND } else { COLOR_SWITCH_OFF };
    let track_radius = track.height() as f32 / 2.0;
    frame.fill_round_rect(track, track_color, track_radius)?;

    let thumb_size = track.height() - 4;
    let thumb_left = if accepting {
        track.right - thumb_size - 2
    } else {
        track.left + 2
    };
    let thumb = LayoutRect::from_xywh(thumb_left, track.top + 2, thumb_size, thumb_size);
    frame.fill_ellipse(thumb, COLOR_ON_SOLID)?;
    Ok(())
}

fn paint_switch_row(frame: &DcFrame, row: LayoutRect, label: &str, value: &str, on: bool) -> WinResult<()> {
    frame.draw_text(label, row, TextStyle::Body, TextAlign::Left)?;
    paint_pill(
        frame,
        row.left + host_layout::SWITCH_ROW_PILL_OFFSET_X,
        row.top - 1,
        value,
        if on { PillKind::Ok } else { PillKind::Neutral },
    )?;
    Ok(())
}

fn paint_main_actions(frame: &DcFrame, view: &HostMainView) -> WinResult<()> {
    let copy_label = host_hf::copy_button_label(view.copy_feedback);
    if view.copy_feedback {
        frame.fill_round_rect(host_layout::BTN_COPY.rect, COLOR_OK_SOFT, BUTTON_RADIUS)?;
        frame.stroke_round_rect(host_layout::BTN_COPY.rect, COLOR_OK, BUTTON_RADIUS, 1.0)?;
        frame.draw_text(
            copy_label,
            host_layout::BTN_COPY.rect,
            TextStyle::Pill { color: COLOR_OK },
            TextAlign::Center,
        )?;
    } else {
        paint_outline_button(frame, host_layout::BTN_COPY.rect, copy_label)?;
    }
    paint_outline_button(frame, host_layout::BTN_ROTATE.rect, host_hf::BTN_ROTATE)?;
    if !view.show_session_actions {
        return Ok(());
    }
    paint_outline_button(frame, host_layout::BTN_STOP.rect, host_hf::BTN_STOP)?;
    paint_outline_button(frame, host_layout::BTN_VIEW_ONLY.rect, host_hf::BTN_VIEW_ONLY)?;
    paint_outline_button(frame, host_layout::BTN_RESTORE_INPUT.rect, host_hf::BTN_RESTORE_INPUT)?;
    Ok(())
}

/// 主界面完整 D2D 重绘。失败由调用方走 GDI+ fallback。
pub unsafe fn paint_main_shell(device_context: HDC, view: &HostMainView) -> WinResult<()> {
    let frame = DcFrame::begin(device_context, host_layout::MAIN_WIDTH, host_layout::MAIN_HEIGHT)?;
    // h2 `.host` 底是 surface2，不是页面 bg。
    frame.clear(COLOR_SURFACE2)?;
    frame.panel(host_layout::LEFT_PANEL, COLOR_SURFACE, COLOR_LINE)?;
    frame.panel(host_layout::RIGHT_STATUS, COLOR_SURFACE, COLOR_LINE)?;
    frame.panel(host_layout::RIGHT_SWITCHES, COLOR_SURFACE, COLOR_LINE)?;
    // h2 `.fraud`：白底 + 2px text 描边。
    frame.fill_round_rect(host_layout::RIGHT_FRAUD, COLOR_SURFACE, FRAUD_RADIUS)?;
    frame.stroke_round_rect(host_layout::RIGHT_FRAUD, COLOR_TEXT, FRAUD_RADIUS, 2.0)?;

    frame.draw_text(
        host_hf::LABEL_DEVICE_CODE,
        host_layout::LABEL_CODE,
        TextStyle::Label,
        TextAlign::Left,
    )?;
    frame.draw_text(
        &view.code_text,
        host_layout::VALUE_CODE,
        TextStyle::Mono { size: 28.0 },
        TextAlign::Left,
    )?;
    frame.draw_text(
        host_hf::LABEL_TEMP_PASSWORD,
        host_layout::LABEL_PASSWORD,
        TextStyle::Label,
        TextAlign::Left,
    )?;
    frame.draw_text(
        &view.password_text,
        host_layout::VALUE_PASSWORD,
        TextStyle::Mono { size: 20.0 },
        TextAlign::Left,
    )?;
    frame.draw_text(
        host_hf::PASSWORD_HINT,
        host_layout::PASSWORD_HINT,
        TextStyle::Muted,
        TextAlign::Left,
    )?;

    paint_accept_switch(&frame, view.accepting)?;
    frame.draw_text(
        host_hf::SWITCH_ALLOW,
        host_layout::ACCEPT_SWITCH_LABEL,
        TextStyle::Body,
        TextAlign::Left,
    )?;

    frame.draw_text(
        host_hf::STATUS_TITLE,
        host_layout::STATUS_TITLE,
        TextStyle::Bold,
        TextAlign::Left,
    )?;
    paint_pill(
        &frame,
        host_layout::STATUS_PILL.left,
        host_layout::STATUS_PILL.top,
        &view.status_pill,
        PillKind::Neutral,
    )?;
    frame.draw_text(
        &view.status_hint,
        host_layout::STATUS_HINT,
        TextStyle::Muted,
        TextAlign::Left,
    )?;

    frame.draw_text(
        host_hf::SWITCHES_TITLE,
        host_layout::SWITCHES_TITLE,
        TextStyle::Bold,
        TextAlign::Left,
    )?;
    paint_switch_row(
        &frame,
        host_layout::SWITCH_ROW_1,
        host_hf::SWITCH_AUTO_START,
        host_hf::SWITCH_ON,
        true,
    )?;
    paint_switch_row(
        &frame,
        host_layout::SWITCH_ROW_2,
        host_hf::SWITCH_IDLE_ZERO,
        host_hf::SWITCH_ON,
        true,
    )?;
    paint_switch_row(
        &frame,
        host_layout::SWITCH_ROW_3,
        host_hf::SWITCH_RESOURCE,
        host_hf::SWITCH_BALANCED,
        false,
    )?;

    frame.draw_text(
        host_hf::FRAUD_TITLE,
        host_layout::FRAUD_TITLE,
        TextStyle::Bold,
        TextAlign::Left,
    )?;
    frame.draw_text(
        host_hf::FRAUD_BODY,
        host_layout::FRAUD_BODY,
        TextStyle::Muted,
        TextAlign::Left,
    )?;

    paint_main_actions(&frame, view)?;
    frame.end()
}

/// 确认页完整 D2D 重绘。
pub unsafe fn paint_confirm_shell(device_context: HDC, view: &HostConfirmView) -> WinResult<()> {
    let frame = DcFrame::begin(
        device_context,
        host_layout::CONFIRM_WIDTH,
        host_layout::CONFIRM_HEIGHT,
    )?;
    frame.clear(COLOR_SURFACE2)?;
    frame.panel(host_layout::CONFIRM_CARD, COLOR_SURFACE, COLOR_LINE)?;

    frame.draw_text(
        host_hf::CONFIRM_TITLE,
        host_layout::CONFIRM_TITLE,
        TextStyle::Title,
        TextAlign::Left,
    )?;

    // h2 `.who` 浅底身份块。
    frame.fill_round_rect(host_layout::CONFIRM_WHO_PANEL, COLOR_BG, 12.0)?;

    frame.fill_ellipse(host_layout::CONFIRM_AVATAR, COLOR_BRAND)?;
    let avatar_letter = view
        .controller_line
        .chars()
        .find(|ch| ch.is_ascii_digit() || ('\u{4e00}'..='\u{9fff}').contains(ch))
        .map(|ch| ch.to_string())
        .unwrap_or_else(|| "客".to_string());
    frame.draw_text(
        &avatar_letter,
        host_layout::CONFIRM_AVATAR,
        TextStyle::Avatar,
        TextAlign::Center,
    )?;

    frame.draw_text(
        &view.controller_line,
        host_layout::CONFIRM_WHO,
        TextStyle::Bold,
        TextAlign::Left,
    )?;
    frame.draw_text(
        &view.device_note,
        host_layout::CONFIRM_DEVICE_NOTE,
        TextStyle::Muted,
        TextAlign::Left,
    )?;
    paint_pill(
        &frame,
        host_layout::CONFIRM_PILL.left,
        host_layout::CONFIRM_PILL.top,
        host_hf::connection_pill(view.first_connection),
        PillKind::Fact,
    )?;

    frame.draw_text(
        host_hf::CONFIRM_CAN_LABEL,
        host_layout::CONFIRM_CAN_LABEL,
        TextStyle::Label,
        TextAlign::Left,
    )?;
    let mut can_top = host_layout::CONFIRM_CAN_FIRST.top;
    for line in host_hf::confirm_can_lines() {
        let line_rect = LayoutRect::from_xywh(
            host_layout::CONFIRM_CAN_FIRST.left,
            can_top,
            host_layout::CONFIRM_CAN_FIRST.width(),
            host_layout::CONFIRM_CAN_FIRST.height(),
        );
        frame.draw_text(line, line_rect, TextStyle::Body, TextAlign::Left)?;
        can_top += host_layout::CONFIRM_CAN_LINE_STEP;
    }

    frame.fill_round_rect(host_layout::CONFIRM_FRAUD_PANEL, COLOR_SURFACE, FRAUD_RADIUS)?;
    frame.stroke_round_rect(host_layout::CONFIRM_FRAUD_PANEL, COLOR_TEXT, FRAUD_RADIUS, 2.0)?;
    frame.draw_text(
        host_hf::CONFIRM_FRAUD_TITLE,
        host_layout::CONFIRM_FRAUD_TITLE,
        TextStyle::Bold,
        TextAlign::Left,
    )?;
    let mut fraud_top = host_layout::CONFIRM_FRAUD_FIRST.top;
    for (index, line) in host_hf::confirm_fraud_lines().iter().enumerate() {
        let numbered = format!("{}. {line}", index + 1);
        let line_rect = LayoutRect::from_xywh(
            host_layout::CONFIRM_FRAUD_FIRST.left,
            fraud_top,
            host_layout::CONFIRM_FRAUD_FIRST.width(),
            host_layout::CONFIRM_FRAUD_FIRST.height(),
        );
        frame.draw_text(&numbered, line_rect, TextStyle::Muted, TextAlign::Left)?;
        fraud_top += host_layout::CONFIRM_FRAUD_LINE_STEP;
    }

    let refuse = host_layout::CONFIRM_REFUSE.rect;
    frame.fill_round_rect(refuse, COLOR_TEXT, BUTTON_RADIUS)?;
    frame.draw_text(
        host_hf::CONFIRM_REFUSE,
        refuse,
        TextStyle::ButtonOnSolid,
        TextAlign::Center,
    )?;
    paint_outline_button(&frame, host_layout::CONFIRM_ALLOW.rect, host_hf::CONFIRM_ALLOW)?;

    frame.end()
}

#[cfg(test)]
mod tests {
    use super::colorref_to_d2d;

    #[test]
    fn colorref_bgr_拆成_rgb() {
        // COLOR_BRAND = 0x00ED6F2F → BGR：B=0xED G=0x6F R=0x2F
        let color = colorref_to_d2d(0x00ED6F2F, 1.0);
        assert!((color.r - 47.0 / 255.0).abs() < 0.001);
        assert!((color.g - 111.0 / 255.0).abs() < 0.001);
        assert!((color.b - 237.0 / 255.0).abs() < 0.001);
        assert!((color.a - 1.0).abs() < 0.001);
    }
}
