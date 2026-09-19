//! 电脑控制端会话窗。默认窗口化，画面按比例留黑边。
//! 全屏只能用户自己开。工具条可以藏，连接方式角标留在画面上。
//! 这里不改被控端分辨率，也不采集、不编码。

fn main() {
    #[cfg(windows)]
    {
        if let Err(error) = windows_controller::run() {
            eprintln!("desktop controller failed: {error}");
            std::process::exit(1);
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("desktop controller currently runs on Windows");
    }
}

#[cfg(windows)]
mod windows_controller {
    use std::sync::Mutex;

    use windows::core::w;
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateSolidBrush, DeleteObject, DrawTextW, EndPaint, FillRect, GetMonitorInfoW, InvalidateRect,
        MonitorFromWindow, SetBkMode, SetTextColor, DT_CENTER, DT_SINGLELINE, DT_VCENTER, HGDIOBJ, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, PAINTSTRUCT, TRANSPARENT,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetMessageW, GetWindowLongPtrW,
        GetWindowPlacement, LoadIconW, PostQuitMessage, RegisterClassW, SetWindowLongPtrW, SetWindowPlacement,
        SetWindowPos, ShowWindow, TranslateMessage, CW_USEDEFAULT, GWL_STYLE, HWND_TOP, IDI_APPLICATION, MSG, SW_SHOW,
        SWP_FRAMECHANGED, SWP_SHOWWINDOW, WINDOW_EX_STYLE, WINDOWPLACEMENT, WINDOWPLACEMENT_FLAGS, WM_CREATE, WM_DESTROY, WM_KEYDOWN,
        WM_LBUTTONUP, WM_MOUSEMOVE, WM_PAINT, WM_SIZE, WM_TIMER, WNDCLASSW, WS_OVERLAPPEDWINDOW, WS_POPUP,
        WS_VISIBLE,
    };

    const PICTURE_WIDTH: i32 = 16;
    const PICTURE_HEIGHT: i32 = 9;
    const TOOLBAR_HEIGHT: i32 = 48;
    const BADGE_HEIGHT: i32 = 28;
    const HIDE_TIMER: usize = 1;
    const KEY_ESCAPE: u16 = 0x1b;
    const COLOR_BLACK: u32 = 0x0000_0000;
    const COLOR_PICTURE: u32 = 0x0017_1A1C;
    const COLOR_PAPER: u32 = 0x00E7_EFF3;
    const COLOR_INK: u32 = 0x0012_161A;
    const COLOR_TEAL: u32 = 0x005C_6E0F;
    const COLOR_AMBER: u32 = 0x000F_4E8A;

    struct FrameRect {
        left: i32,
        top: i32,
        width: i32,
        height: i32,
    }

    struct Model {
        main_window: HWND,
        fullscreen: bool,
        toolbar_visible: bool,
        link_direct: bool,
        saved_style: isize,
        saved_placement: WINDOWPLACEMENT,
    }

    unsafe impl Send for Model {}

    static MODEL: Mutex<Option<Model>> = Mutex::new(None);

    pub fn run() -> windows::core::Result<()> {
        let link_direct = std::env::var("CONTROLLER_LINK").ok().as_deref() == Some("direct");
        *lock_model() = Some(Model {
            main_window: HWND::default(),
            fullscreen: false,
            toolbar_visible: true,
            link_direct,
            saved_style: 0,
            saved_placement: empty_placement(),
        });
        unsafe { message_loop() }
    }

    fn lock_model() -> std::sync::MutexGuard<'static, Option<Model>> {
        MODEL.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    unsafe fn message_loop() -> windows::core::Result<()> {
        let instance = GetModuleHandleW(None)?;
        let class_name = w!("DesktopControllerWindow");
        let window_class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            hIcon: LoadIconW(None, IDI_APPLICATION)?,
            ..Default::default()
        };
        RegisterClassW(&window_class);
        let window = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            w!("远程桌面"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            1100,
            680,
            None,
            None,
            Some(instance.into()),
            None,
        )?;
        let _ = ShowWindow(window, SW_SHOW);
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).into() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        Ok(())
    }

    unsafe extern "system" fn window_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_CREATE => {
                if let Some(model) = lock_model().as_mut() {
                    model.main_window = window;
                }
                LRESULT(0)
            }
            WM_SIZE | WM_MOUSEMOVE => {
                if message == WM_MOUSEMOVE {
                    reveal_toolbar(window);
                }
                let _ = InvalidateRect(Some(window), None, false);
                LRESULT(0)
            }
            WM_TIMER => {
                if wparam.0 == HIDE_TIMER {
                    hide_toolbar_if_fullscreen();
                    let _ = InvalidateRect(Some(window), None, false);
                }
                LRESULT(0)
            }
            WM_LBUTTONUP => {
                let packed = lparam.0 as u32;
                let click_x = (packed & 0xffff) as i16 as i32;
                let click_y = ((packed >> 16) & 0xffff) as i16 as i32;
                if toolbar_hit(window, click_x, click_y) {
                    toggle_fullscreen(window);
                }
                LRESULT(0)
            }
            WM_KEYDOWN => {
                if wparam.0 as u16 == KEY_ESCAPE {
                    exit_fullscreen(window);
                }
                LRESULT(0)
            }
            WM_PAINT => {
                paint(window);
                LRESULT(0)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(window, message, wparam, lparam),
        }
    }

    fn reveal_toolbar(window: HWND) {
        let fullscreen = lock_model().as_ref().map(|model| model.fullscreen).unwrap_or(false);
        if let Some(model) = lock_model().as_mut() {
            model.toolbar_visible = true;
        }
        if fullscreen {
            unsafe {
                let _ = windows::Win32::UI::WindowsAndMessaging::SetTimer(Some(window), HIDE_TIMER, 2500, None);
            }
        }
    }

    fn hide_toolbar_if_fullscreen() {
        if let Some(model) = lock_model().as_mut() {
            if model.fullscreen {
                model.toolbar_visible = false;
            }
        }
    }

    fn toggle_fullscreen(window: HWND) {
        let fullscreen = lock_model().as_ref().map(|model| model.fullscreen).unwrap_or(false);
        if fullscreen {
            exit_fullscreen(window);
        } else {
            enter_fullscreen(window);
        }
    }

    fn enter_fullscreen(window: HWND) {
        unsafe {
            let mut placement = empty_placement();
            if GetWindowPlacement(window, &mut placement).is_err() {
                return;
            }
            let saved_style = GetWindowLongPtrW(window, GWL_STYLE);
            let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
            let mut monitor_info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                rcMonitor: RECT::default(),
                rcWork: RECT::default(),
                dwFlags: 0,
            };
            if !GetMonitorInfoW(monitor, &mut monitor_info).as_bool() {
                return;
            }
            if let Some(model) = lock_model().as_mut() {
                model.saved_style = saved_style;
                model.saved_placement = placement;
                model.fullscreen = true;
                model.toolbar_visible = false;
            }
            let popup = WS_POPUP.0 as isize | WS_VISIBLE.0 as isize;
            SetWindowLongPtrW(window, GWL_STYLE, popup);
            let bounds = monitor_info.rcMonitor;
            let _ = SetWindowPos(
                window,
                Some(HWND_TOP),
                bounds.left,
                bounds.top,
                bounds.right - bounds.left,
                bounds.bottom - bounds.top,
                SWP_SHOWWINDOW | SWP_FRAMECHANGED,
            );
        }
    }

    fn exit_fullscreen(window: HWND) {
        let snapshot = {
            let guard = lock_model();
            let Some(model) = guard.as_ref() else { return };
            if !model.fullscreen {
                return;
            }
            (model.saved_style, model.saved_placement)
        };
        let (saved_style, saved_placement) = snapshot;
        unsafe {
            SetWindowLongPtrW(window, GWL_STYLE, saved_style);
            let _ = SetWindowPlacement(window, &saved_placement);
        }
        if let Some(model) = lock_model().as_mut() {
            model.fullscreen = false;
            model.toolbar_visible = true;
        }
    }

    unsafe fn paint(window: HWND) {
        let mut paint_struct = PAINTSTRUCT::default();
        let device_context = BeginPaint(window, &mut paint_struct);
        let mut client = RECT::default();
        if GetClientRect(window, &mut client).is_ok() {
            let client_width = client.right - client.left;
            let client_height = client.bottom - client.top;
            let (toolbar_visible, link_direct) = lock_model()
                .as_ref()
                .map(|model| (model.toolbar_visible, model.link_direct))
                .unwrap_or((true, false));
            let picture_bottom = if toolbar_visible { client_height - TOOLBAR_HEIGHT } else { client_height };
            fill(&client, device_context, COLOR_BLACK);
            let picture = letterbox(client_width, picture_bottom.max(0), PICTURE_WIDTH, PICTURE_HEIGHT);
            fill_frame(&picture, device_context, COLOR_PICTURE);
            SetBkMode(device_context, TRANSPARENT);
            let _ = SetTextColor(device_context, COLORREF(0x00E7_EFF3));
            let waiting = wide_chars("等待画面");
            draw_text(device_context, &waiting, picture.left, picture.top, picture.width, picture.height, true);
            paint_badge(device_context, client_width, link_direct);
            if toolbar_visible {
                let toolbar = RECT {
                    left: 0,
                    top: picture_bottom,
                    right: client_width,
                    bottom: client_height,
                };
                fill(&toolbar, device_context, COLOR_PAPER);
                let _ = SetTextColor(device_context, COLORREF(COLOR_INK));
                let fullscreen = lock_model().as_ref().map(|model| model.fullscreen).unwrap_or(false);
                let action = wide_chars(if fullscreen { "退出全屏" } else { "全屏" });
                let button = fullscreen_button(client_width, client_height);
                draw_text(device_context, &action, button.left, button.top, button.width, button.height, true);
                let hint = wide_chars(if link_direct { "不消耗免费中继时长" } else { "在消耗免费中继时长" });
                draw_text(device_context, &hint, 140, picture_bottom, client_width - 160, TOOLBAR_HEIGHT, true);
            }
        }
        let _ = EndPaint(window, &paint_struct);
    }

    unsafe fn paint_badge(device_context: windows::Win32::Graphics::Gdi::HDC, client_width: i32, link_direct: bool) {
        let badge = FrameRect {
            left: client_width - 96,
            top: 12,
            width: 80,
            height: BADGE_HEIGHT,
        };
        fill_frame(&badge, device_context, if link_direct { COLOR_TEAL } else { COLOR_AMBER });
        let _ = SetTextColor(device_context, COLORREF(0x00F3_EFE7));
        let label = wide_chars(if link_direct { "● 直连" } else { "● 中继" });
        draw_text(device_context, &label, badge.left, badge.top, badge.width, badge.height, true);
    }

    unsafe fn fill(bounds: &RECT, device_context: windows::Win32::Graphics::Gdi::HDC, color: u32) {
        let brush = CreateSolidBrush(COLORREF(color));
        FillRect(device_context, bounds, brush);
        let _ = DeleteObject(HGDIOBJ::from(brush));
    }

    unsafe fn fill_frame(frame: &FrameRect, device_context: windows::Win32::Graphics::Gdi::HDC, color: u32) {
        let bounds = RECT {
            left: frame.left,
            top: frame.top,
            right: frame.left + frame.width,
            bottom: frame.top + frame.height,
        };
        fill(&bounds, device_context, color);
    }

    unsafe fn draw_text(
        device_context: windows::Win32::Graphics::Gdi::HDC,
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
        let format = if centered { DT_CENTER | DT_VCENTER | DT_SINGLELINE } else { DT_SINGLELINE };
        DrawTextW(device_context, &mut owned, &mut bounds, format);
    }

    fn toolbar_hit(window: HWND, click_x: i32, click_y: i32) -> bool {
        let toolbar_visible = lock_model().as_ref().map(|model| model.toolbar_visible).unwrap_or(false);
        if !toolbar_visible {
            return false;
        }
        let mut client = RECT::default();
        let Ok(()) = (unsafe { GetClientRect(window, &mut client) }) else { return false };
        let button = fullscreen_button(client.right - client.left, client.bottom - client.top);
        click_x >= button.left && click_x < button.left + button.width && click_y >= button.top && click_y < button.top + button.height
    }

    fn fullscreen_button(client_width: i32, client_height: i32) -> FrameRect {
        let _ = client_width;
        FrameRect {
            left: 16,
            top: client_height - TOOLBAR_HEIGHT + 8,
            width: 96,
            height: 32,
        }
    }

    /// 把远端画面放进窗口，多出来的地方留黑边。不改画面自身的宽高比。
    fn letterbox(container_width: i32, container_height: i32, picture_width: i32, picture_height: i32) -> FrameRect {
        if container_width <= 0 || container_height <= 0 || picture_width <= 0 || picture_height <= 0 {
            return FrameRect { left: 0, top: 0, width: 0, height: 0 };
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

    fn empty_placement() -> WINDOWPLACEMENT {
        WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            flags: WINDOWPLACEMENT_FLAGS(0),
            showCmd: 1,
            ptMinPosition: POINT::default(),
            ptMaxPosition: POINT::default(),
            rcNormalPosition: RECT::default(),
        }
    }

    fn wide_chars(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }
}
