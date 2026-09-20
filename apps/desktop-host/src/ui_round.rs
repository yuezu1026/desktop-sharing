//! GDI+ 抗锯齿圆角填充。被控端面板 / 按钮 / 开关 / pill 用这一层，避免 GDI RoundRect 锯齿。

use std::sync::Once;

use windows::Win32::Graphics::Gdi::HDC;
use windows::Win32::Graphics::GdiPlus::{
    GdipAddPathArc, GdipClosePathFigure, GdipCreateFromHDC, GdipCreatePath, GdipCreatePen1, GdipCreateSolidFill,
    GdipDeleteBrush, GdipDeleteGraphics, GdipDeletePath, GdipDeletePen, GdipDrawPath, GdipFillPath,
    GdipSetSmoothingMode, GdiplusStartup, GdiplusStartupInput, FillModeAlternate, GpBrush, GpGraphics, GpPath,
    GpPen, GpSolidFill, SmoothingModeAntiAlias, Status, UnitPixel,
};

use crate::host_layout::Rect as LayoutRect;

static START: Once = Once::new();
static mut STARTUP_TOKEN: usize = 0;

fn ensure_started() {
    START.call_once(|| {
        let input = GdiplusStartupInput {
            GdiplusVersion: 1,
            DebugEventCallback: 0,
            SuppressBackgroundThread: false.into(),
            SuppressExternalCodecs: false.into(),
        };
        let mut token = 0usize;
        let status = unsafe { GdiplusStartup(&mut token, &input, std::ptr::null_mut()) };
        if status == Status(0) {
            unsafe { STARTUP_TOKEN = token };
        }
    });
}

/// COLORREF(BGR) → GDI+ ARGB。
fn argb_from_colorref(colorref: u32, alpha: u8) -> u32 {
    let red = colorref & 0xff;
    let green = (colorref >> 8) & 0xff;
    let blue = (colorref >> 16) & 0xff;
    (u32::from(alpha) << 24) | (red << 16) | (green << 8) | blue
}

unsafe fn add_round_rect_path(path: *mut GpPath, rect: LayoutRect, radius: f32) {
    let left = rect.left as f32;
    let top = rect.top as f32;
    let width = rect.width() as f32;
    let height = rect.height() as f32;
    let diameter = (radius * 2.0).min(width).min(height);
    let _ = GdipAddPathArc(path, left, top, diameter, diameter, 180.0, 90.0);
    let _ = GdipAddPathArc(path, left + width - diameter, top, diameter, diameter, 270.0, 90.0);
    let _ = GdipAddPathArc(
        path,
        left + width - diameter,
        top + height - diameter,
        diameter,
        diameter,
        0.0,
        90.0,
    );
    let _ = GdipAddPathArc(path, left, top + height - diameter, diameter, diameter, 90.0, 90.0);
    let _ = GdipClosePathFigure(path);
}

pub unsafe fn fill_round_rect_aa(device_context: HDC, rect: LayoutRect, colorref: u32, radius: i32) {
    if rect.width() <= 0 || rect.height() <= 0 {
        return;
    }
    ensure_started();
    let mut graphics: *mut GpGraphics = std::ptr::null_mut();
    if GdipCreateFromHDC(device_context, &mut graphics) != Status(0) || graphics.is_null() {
        return;
    }
    let _ = GdipSetSmoothingMode(graphics, SmoothingModeAntiAlias);

    let mut path: *mut GpPath = std::ptr::null_mut();
    if GdipCreatePath(FillModeAlternate, &mut path) != Status(0) || path.is_null() {
        let _ = GdipDeleteGraphics(graphics);
        return;
    }
    add_round_rect_path(path, rect, radius.max(1) as f32);

    let mut brush: *mut GpSolidFill = std::ptr::null_mut();
    if GdipCreateSolidFill(argb_from_colorref(colorref, 255), &mut brush) == Status(0) && !brush.is_null() {
        let _ = GdipFillPath(graphics, brush as *mut GpBrush, path);
        let _ = GdipDeleteBrush(brush as *mut GpBrush);
    }

    let _ = GdipDeletePath(path);
    let _ = GdipDeleteGraphics(graphics);
}

pub unsafe fn stroke_round_rect_aa(
    device_context: HDC,
    rect: LayoutRect,
    colorref: u32,
    radius: i32,
    stroke_width: f32,
) {
    if rect.width() <= 0 || rect.height() <= 0 {
        return;
    }
    ensure_started();
    let mut graphics: *mut GpGraphics = std::ptr::null_mut();
    if GdipCreateFromHDC(device_context, &mut graphics) != Status(0) || graphics.is_null() {
        return;
    }
    let _ = GdipSetSmoothingMode(graphics, SmoothingModeAntiAlias);

    let mut path: *mut GpPath = std::ptr::null_mut();
    if GdipCreatePath(FillModeAlternate, &mut path) != Status(0) || path.is_null() {
        let _ = GdipDeleteGraphics(graphics);
        return;
    }
    // 描边内缩半线宽，避免糊出边界。
    let inset = (stroke_width / 2.0).ceil() as i32;
    let stroke_rect = LayoutRect {
        left: rect.left + inset,
        top: rect.top + inset,
        right: rect.right - inset,
        bottom: rect.bottom - inset,
    };
    add_round_rect_path(path, stroke_rect, radius.max(1) as f32);

    let mut pen: *mut GpPen = std::ptr::null_mut();
    if GdipCreatePen1(argb_from_colorref(colorref, 255), stroke_width, UnitPixel, &mut pen) == Status(0)
        && !pen.is_null()
    {
        let _ = GdipDrawPath(graphics, pen, path);
        let _ = GdipDeletePen(pen);
    }

    let _ = GdipDeletePath(path);
    let _ = GdipDeleteGraphics(graphics);
}
