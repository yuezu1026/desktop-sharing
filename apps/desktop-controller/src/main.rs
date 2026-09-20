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
    use std::sync::mpsc::{self, Sender};
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
        SWP_FRAMECHANGED, SWP_SHOWWINDOW, WINDOW_EX_STYLE, WINDOWPLACEMENT, WINDOWPLACEMENT_FLAGS, WM_CREATE, WM_DESTROY,
        WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL,
        WM_PAINT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SIZE, WM_TIMER, WNDCLASSW, WS_OVERLAPPEDWINDOW, WS_POPUP, WS_VISIBLE,
    };

    const PICTURE_WIDTH: i32 = 16;
    const PICTURE_HEIGHT: i32 = 9;
    const TOOLBAR_HEIGHT: i32 = 48;
    const BADGE_HEIGHT: i32 = 28;
    const HIDE_TIMER: usize = 1;
    const METER_TIMER: usize = 2;
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
        show_balance: bool,
        display_minutes: Option<i64>,
        footnote: String,
        notice: String,
        view_only: String,
        ways_open: bool,
        way_titles: Vec<(String, bool)>,
        subscription_badge: String,
        real_name_message: String,
        picture_bgr: Option<Vec<u8>>,
        picture_width: i32,
        picture_height: i32,
    }

    unsafe impl Send for Model {}

    static MODEL: Mutex<Option<Model>> = Mutex::new(None);
    static INPUT_TX: Mutex<Option<Sender<session_core::InputEvent>>> = Mutex::new(None);

    pub fn run() -> windows::core::Result<()> {
        let link_direct = std::env::var("CONTROLLER_LINK").ok().as_deref() == Some("direct");
        *lock_model() = Some(Model {
            main_window: HWND::default(),
            fullscreen: false,
            toolbar_visible: true,
            link_direct,
            saved_style: 0,
            saved_placement: empty_placement(),
            show_balance: false,
            display_minutes: None,
            footnote: String::new(),
            notice: String::new(),
            view_only: String::new(),
            ways_open: false,
            way_titles: Vec::new(),
            subscription_badge: String::new(),
            real_name_message: String::new(),
            picture_bgr: None,
            picture_width: PICTURE_WIDTH,
            picture_height: PICTURE_HEIGHT,
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
                if std::env::var("CONTROLLER_TOKEN").ok().filter(|value| !value.is_empty()).is_some() {
                    let _ = windows::Win32::UI::WindowsAndMessaging::SetTimer(Some(window), METER_TIMER, 5000, None);
                    poll_meter();
                    start_remote_if_configured();
                }
                LRESULT(0)
            }
            WM_SIZE | WM_MOUSEMOVE => {
                if message == WM_MOUSEMOVE {
                    reveal_toolbar(window);
                    queue_pointer(window, lparam, PointerAction::Move);
                }
                let _ = InvalidateRect(Some(window), None, false);
                LRESULT(0)
            }
            WM_TIMER => {
                if wparam.0 == HIDE_TIMER {
                    hide_toolbar_if_fullscreen();
                    let _ = InvalidateRect(Some(window), None, false);
                }
                if wparam.0 == METER_TIMER {
                    poll_meter();
                    let _ = InvalidateRect(Some(window), None, false);
                }
                LRESULT(0)
            }
            WM_LBUTTONDOWN => {
                queue_pointer(window, lparam, PointerAction::Down(0));
                LRESULT(0)
            }
            WM_RBUTTONDOWN => {
                queue_pointer(window, lparam, PointerAction::Down(1));
                LRESULT(0)
            }
            WM_MBUTTONDOWN => {
                queue_pointer(window, lparam, PointerAction::Down(2));
                LRESULT(0)
            }
            WM_LBUTTONUP => {
                let packed = lparam.0 as u32;
                let click_x = (packed & 0xffff) as i16 as i32;
                let click_y = ((packed >> 16) & 0xffff) as i16 as i32;
                if toolbar_hit(window, click_x, click_y) {
                    toggle_fullscreen(window);
                } else if ways_hit(click_x, click_y) {
                    if let Some(model) = lock_model().as_mut() {
                        if model.view_only == "resource" {
                            model.ways_open = !model.ways_open;
                        }
                    }
                } else {
                    queue_pointer(window, lparam, PointerAction::Up(0));
                }
                LRESULT(0)
            }
            WM_RBUTTONUP => {
                queue_pointer(window, lparam, PointerAction::Up(1));
                LRESULT(0)
            }
            WM_MBUTTONUP => {
                queue_pointer(window, lparam, PointerAction::Up(2));
                LRESULT(0)
            }
            WM_MOUSEWHEEL => {
                queue_wheel(window, wparam, lparam);
                LRESULT(0)
            }
            WM_KEYDOWN => {
                if wparam.0 as u16 == KEY_ESCAPE {
                    let fullscreen = lock_model().as_ref().map(|model| model.fullscreen).unwrap_or(false);
                    if fullscreen {
                        exit_fullscreen(window);
                        return LRESULT(0);
                    }
                }
                queue_key(wparam.0 as u32, true);
                LRESULT(0)
            }
            WM_KEYUP => {
                queue_key(wparam.0 as u32, false);
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

    enum PointerAction {
        Move,
        Down(u8),
        Up(u8),
    }

    fn input_blocked() -> bool {
        lock_model()
            .as_ref()
            .map(|model| model.view_only == "resource" || model.view_only == "permission")
            .unwrap_or(false)
    }

    fn queue_input(event: session_core::InputEvent) {
        if input_blocked() {
            return;
        }
        if let Ok(guard) = INPUT_TX.lock() {
            if let Some(sender) = guard.as_ref() {
                let _ = sender.send(event);
            }
        }
    }

    fn queue_key(key_code: u32, down: bool) {
        if down {
            queue_input(session_core::InputEvent::KeyDown { key_code });
        } else {
            queue_input(session_core::InputEvent::KeyUp { key_code });
        }
    }

    fn queue_pointer(window: HWND, lparam: LPARAM, action: PointerAction) {
        let packed = lparam.0 as u32;
        let click_x = (packed & 0xffff) as i16 as i32;
        let click_y = ((packed >> 16) & 0xffff) as i16 as i32;
        if toolbar_hit(window, click_x, click_y) {
            return;
        }
        let view_only = lock_model()
            .as_ref()
            .map(|model| model.view_only.clone())
            .unwrap_or_default();
        if view_only == "resource" && ways_hit(click_x, click_y) {
            return;
        }
        let Some((picture_x, picture_y)) = client_to_picture(window, click_x, click_y) else {
            return;
        };
        let event = match action {
            PointerAction::Move => session_core::InputEvent::PointerMove {
                x: picture_x,
                y: picture_y,
            },
            PointerAction::Down(button) => session_core::InputEvent::PointerDown {
                x: picture_x,
                y: picture_y,
                button,
            },
            PointerAction::Up(button) => session_core::InputEvent::PointerUp {
                x: picture_x,
                y: picture_y,
                button,
            },
        };
        queue_input(event);
    }

    fn queue_wheel(window: HWND, wparam: WPARAM, lparam: LPARAM) {
        let delta = (wparam.0 as u32 >> 16) as i16;
        let screen_x = (lparam.0 as u32 & 0xffff) as i16 as i32;
        let screen_y = ((lparam.0 as u32 >> 16) & 0xffff) as i16 as i32;
        let mut point = POINT {
            x: screen_x,
            y: screen_y,
        };
        unsafe {
            let _ = windows::Win32::Graphics::Gdi::ScreenToClient(window, &mut point);
        }
        let Some((picture_x, picture_y)) = client_to_picture(window, point.x, point.y) else {
            return;
        };
        queue_input(session_core::InputEvent::Wheel {
            x: picture_x,
            y: picture_y,
            delta,
        });
    }

    fn client_to_picture(window: HWND, client_x: i32, client_y: i32) -> Option<(i32, i32)> {
        let mut client = RECT::default();
        let Ok(()) = (unsafe { GetClientRect(window, &mut client) }) else {
            return None;
        };
        let (toolbar_visible, picture_width, picture_height) = lock_model()
            .as_ref()
            .map(|model| (model.toolbar_visible, model.picture_width, model.picture_height))
            .unwrap_or((true, PICTURE_WIDTH, PICTURE_HEIGHT));
        if picture_width <= 0 || picture_height <= 0 {
            return None;
        }
        let client_width = client.right - client.left;
        let client_height = client.bottom - client.top;
        let picture_bottom = if toolbar_visible {
            client_height - TOOLBAR_HEIGHT
        } else {
            client_height
        };
        let picture = letterbox(client_width, picture_bottom.max(0), picture_width, picture_height);
        if picture.width <= 0 || picture.height <= 0 {
            return None;
        }
        if client_x < picture.left
            || client_y < picture.top
            || client_x >= picture.left + picture.width
            || client_y >= picture.top + picture.height
        {
            return None;
        }
        let picture_x = (client_x - picture.left) * picture_width / picture.width;
        let picture_y = (client_y - picture.top) * picture_height / picture.height;
        Some((
            picture_x.clamp(0, picture_width - 1),
            picture_y.clamp(0, picture_height - 1),
        ))
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
            let (toolbar_visible, link_direct, subscription_badge, picture_bgr, picture_width, picture_height) =
                lock_model()
                    .as_ref()
                    .map(|model| {
                        (
                            model.toolbar_visible,
                            model.link_direct,
                            model.subscription_badge.clone(),
                            model.picture_bgr.clone(),
                            model.picture_width,
                            model.picture_height,
                        )
                    })
                    .unwrap_or((true, false, String::new(), None, PICTURE_WIDTH, PICTURE_HEIGHT));
            let picture_bottom = if toolbar_visible { client_height - TOOLBAR_HEIGHT } else { client_height };
            fill(&client, device_context, COLOR_BLACK);
            let picture = letterbox(client_width, picture_bottom.max(0), picture_width, picture_height);
            if let Some(pixels) = picture_bgr.as_ref() {
                paint_picture(device_context, &picture, picture_width, picture_height, pixels);
            } else {
                fill_frame(&picture, device_context, COLOR_PICTURE);
                SetBkMode(device_context, TRANSPARENT);
                let _ = SetTextColor(device_context, COLORREF(0x00E7_EFF3));
                let waiting = wide_chars("等待画面");
                draw_text(device_context, &waiting, picture.left, picture.top, picture.width, picture.height, true);
            }
            paint_badge(device_context, client_width, link_direct);
            if !subscription_badge.is_empty() {
                paint_subscription_badge(device_context, client_width, &subscription_badge);
            }
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
            paint_meter(device_context, client_width);
        }
        let _ = EndPaint(window, &paint_struct);
    }

    unsafe fn paint_picture(
        device_context: windows::Win32::Graphics::Gdi::HDC,
        target: &FrameRect,
        width: i32,
        height: i32,
        bgr: &[u8],
    ) {
        use std::mem::size_of;
        use windows::Win32::Graphics::Gdi::{SetDIBitsToDevice, StretchDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY};
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 24,
                biCompression: BI_RGB.0 as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        let stride = ((width * 3 + 3) & !3) as usize;
        let mut padded = if stride == width as usize * 3 {
            bgr.to_vec()
        } else {
            let mut bytes = vec![0u8; stride * height as usize];
            for row in 0..height as usize {
                let source = row * width as usize * 3;
                let destination = row * stride;
                bytes[destination..destination + width as usize * 3]
                    .copy_from_slice(&bgr[source..source + width as usize * 3]);
            }
            bytes
        };
        if target.width == width && target.height == height {
            let _ = SetDIBitsToDevice(
                device_context,
                target.left,
                target.top,
                width as u32,
                height as u32,
                0,
                0,
                0,
                height as u32,
                padded.as_ptr().cast(),
                &info,
                DIB_RGB_COLORS,
            );
        } else {
            let _ = StretchDIBits(
                device_context,
                target.left,
                target.top,
                target.width,
                target.height,
                0,
                0,
                width,
                height,
                Some(padded.as_mut_ptr().cast()),
                &info,
                DIB_RGB_COLORS,
                SRCCOPY,
            );
        }
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

    unsafe fn paint_subscription_badge(device_context: windows::Win32::Graphics::Gdi::HDC, client_width: i32, label_text: &str) {
        let badge = FrameRect {
            left: client_width - 236,
            top: 12,
            width: 128,
            height: BADGE_HEIGHT,
        };
        fill_frame(&badge, device_context, COLOR_PAPER);
        let _ = SetTextColor(device_context, COLORREF(COLOR_INK));
        let label = wide_chars(label_text);
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

    unsafe fn paint_meter(device_context: windows::Win32::Graphics::Gdi::HDC, client_width: i32) {
        let snapshot = lock_model().as_ref().map(|model| {
            (
                model.show_balance,
                model.display_minutes,
                model.footnote.clone(),
                model.notice.clone(),
                model.view_only.clone(),
                model.ways_open,
                model.way_titles.clone(),
                model.real_name_message.clone(),
            )
        });
        let Some((show_balance, display_minutes, footnote, notice, view_only, ways_open, way_titles, real_name_message)) = snapshot else { return };
        SetBkMode(device_context, TRANSPARENT);
        let _ = SetTextColor(device_context, COLORREF(0x00E7_EFF3));
        let mut top = 48;
        if show_balance {
            if let Some(minutes) = display_minutes {
                let line = wide_chars(&format!("免费中继时长剩余约 {minutes} 分钟"));
                draw_text(device_context, &line, 16, top, client_width - 120, 24, false);
                top += 24;
                if !footnote.is_empty() {
                    let note = wide_chars(&footnote);
                    draw_text(device_context, &note, 16, top, client_width - 120, 20, false);
                    top += 22;
                }
            }
        }
        if !notice.is_empty() {
            let line = wide_chars(&notice);
            draw_text(device_context, &line, 16, top, client_width - 32, 24, false);
            top += 28;
        }
        if !real_name_message.is_empty() {
            let line = wide_chars(&real_name_message);
            draw_text(device_context, &line, 16, top, client_width - 32, 48, false);
            top += 52;
        }
        if view_only == "resource" {
            let frozen = wide_chars("画面已停在最后一帧，暂时无法继续");
            draw_text(device_context, &frozen, 16, top, client_width - 32, 24, false);
            let opener = wide_chars("还有什么办法");
            let button = ways_button();
            draw_text(device_context, &opener, button.left, button.top, button.width, button.height, false);
            if ways_open {
                let mut row = button.top + button.height + 8;
                for (title, paid) in &way_titles {
                    let prefix = if *paid { "付费" } else { "免费" };
                    let line = wide_chars(&format!("{prefix}  {title}"));
                    draw_text(device_context, &line, 16, row, client_width - 32, 22, false);
                    row += 24;
                }
            }
        } else if view_only == "permission" {
            let moving = wide_chars("画面仍在实时更新，只是你的键盘鼠标不再发送到对方电脑。");
            draw_text(device_context, &moving, 16, top, client_width - 32, 40, false);
            let restore = wide_chars("请求恢复控制");
            draw_text(device_context, &restore, 16, top + 44, 160, 24, false);
        }
    }

    fn ways_button() -> FrameRect {
        FrameRect { left: 16, top: 150, width: 140, height: 28 }
    }

    fn ways_hit(click_x: i32, click_y: i32) -> bool {
        let button = ways_button();
        click_x >= button.left && click_x < button.left + button.width && click_y >= button.top && click_y < button.top + button.height
    }

    fn poll_meter() {
        let Some(token) = std::env::var("CONTROLLER_TOKEN").ok().filter(|value| !value.is_empty()) else { return };
        let origin = std::env::var("CONTROL_PLANE_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
        let Ok(body) = get_json(&origin, "/v1/relay-balance", &token) else { return };
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body) else { return };
        if parsed.get("ok").and_then(|value| value.as_bool()) != Some(true) {
            return;
        }
        let mut way_titles = Vec::new();
        if let Some(ways) = parsed.get("ways").and_then(|value| value.as_array()) {
            for item in ways {
                let Some(title) = item.get("title").and_then(|value| value.as_str()) else { continue };
                let paid = item.get("paid").and_then(|value| value.as_bool()).unwrap_or(false);
                way_titles.push((title.to_string(), paid));
            }
        }
        if let Some(model) = lock_model().as_mut() {
            model.show_balance = parsed.get("showBalance").and_then(|value| value.as_bool()).unwrap_or(false);
            model.display_minutes = parsed.get("displayMinutes").and_then(|value| value.as_i64());
            model.footnote = parsed.get("footnote").and_then(|value| value.as_str()).unwrap_or("").to_string();
            model.notice = parsed.get("notice").and_then(|value| value.as_str()).unwrap_or("").to_string();
            model.view_only = parsed.get("viewOnly").and_then(|value| value.as_str()).unwrap_or("").to_string();
            model.way_titles = way_titles;
            model.subscription_badge = parsed
                .get("subscriptionBadge")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            model.real_name_message = parsed
                .get("realName")
                .and_then(|value| value.get("message"))
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_string();
            if model.view_only != "resource" {
                model.ways_open = false;
            }
        }
    }

    fn start_remote_if_configured() {
        let Some(token) = std::env::var("CONTROLLER_TOKEN").ok().filter(|value| !value.is_empty()) else { return };
        let Some(host_device_id) = std::env::var("CONTROLLER_HOST_DEVICE_ID").ok().filter(|value| !value.is_empty()) else {
            return;
        };
        let origin = std::env::var("CONTROL_PLANE_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
        let fingerprint = std::env::var("CONTROLLER_FINGERPRINT").unwrap_or_else(|_| {
            format!("win-controller-{}", std::process::id())
        });
        let payload = serde_json::json!({
            "hostDeviceId": host_device_id,
            "controllerFingerprint": fingerprint,
        })
        .to_string();
        let Ok(body) = post_json(&origin, "/v1/remote-sessions", &token, &payload) else { return };
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body) else { return };
        let Some(ticket) = parsed.get("ticket").and_then(|value| value.as_str()).map(str::to_string) else { return };
        let Some(remote_session_id) = parsed
            .get("remoteSessionId")
            .and_then(|value| value.as_str())
            .map(str::to_string)
        else {
            return;
        };
        if session_core::ticket_looks_usable(&ticket).is_err() {
            return;
        }
        let awaiting = parsed.get("state").and_then(|value| value.as_str()) == Some("awaiting_host_consent");
        if let Some(model) = lock_model().as_mut() {
            model.link_direct = false;
            model.notice = if awaiting {
                "等待被控端确认".to_string()
            } else {
                "中继票已就绪".to_string()
            };
        }
        std::thread::spawn(move || {
            run_controller_relay(origin, token, remote_session_id, ticket, fingerprint, awaiting);
        });
    }

    fn run_controller_relay(
        origin: String,
        token: String,
        remote_session_id: String,
        ticket: String,
        fingerprint: String,
        awaiting: bool,
    ) {
        if awaiting {
            for _attempt in 0..120 {
                let Ok(body) = get_json(&origin, &format!("/v1/remote-sessions/{remote_session_id}"), &token) else {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    continue;
                };
                let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&body) else {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    continue;
                };
                if parsed.get("state").and_then(|value| value.as_str()) == Some("active") {
                    if let Some(model) = lock_model().as_mut() {
                        model.notice = "中继票已就绪".to_string();
                    }
                    break;
                }
                if parsed.get("state").and_then(|value| value.as_str()) == Some("rejected") {
                    if let Some(model) = lock_model().as_mut() {
                        model.notice = "被控端已拒绝".to_string();
                    }
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        }
        let address = std::env::var("RELAY_ADDR").unwrap_or_else(|_| "127.0.0.1:8443".to_string());
        let Ok(mut session) = relay_client::RelaySession::connect(
            &address,
            &ticket,
            session_core::RelayRole::Controller,
            &fingerprint,
        ) else {
            if let Some(model) = lock_model().as_mut() {
                model.notice = "中继未接通".to_string();
            }
            return;
        };
        if let Some(model) = lock_model().as_mut() {
            model.link_direct = false;
            model.notice = "中继已接通".to_string();
        }
        let (input_sender, input_receiver) = mpsc::channel::<session_core::InputEvent>();
        if let Ok(mut guard) = INPUT_TX.lock() {
            *guard = Some(input_sender);
        }
        let (direct_sender, direct_receiver) = mpsc::sync_channel::<direct_client::DirectLink>(1);
        let punch_origin = origin.clone();
        let punch_token = token.clone();
        let punch_session = remote_session_id.clone();
        let punch_ticket = ticket.clone();
        let punch_fingerprint = fingerprint.clone();
        std::thread::spawn(move || {
            if let Some(link) = upgrade_controller_direct(
                punch_origin,
                punch_token,
                punch_session,
                punch_ticket,
                punch_fingerprint,
            ) {
                let _ = direct_sender.send(link);
            }
        });
        loop {
            if let Ok(link) = direct_receiver.try_recv() {
                drop(session);
                run_controller_direct(link, input_receiver);
                return;
            }
            let mut send_failed = false;
            while let Ok(event) = input_receiver.try_recv() {
                let payload = session_core::encode_input(&event);
                if session
                    .send_frame(&session_core::Frame {
                        kind: session_core::FrameKind::Input,
                        flags: 0,
                        payload,
                    })
                    .is_err()
                {
                    send_failed = true;
                    break;
                }
            }
            if send_failed {
                break;
            }
            match session.try_recv_frame() {
                Ok(Some(frame)) if frame.kind == session_core::FrameKind::Video => {
                    apply_video_frame(&frame.payload);
                }
                Ok(Some(_)) => {}
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(10)),
                Err(_) => break,
            }
        }
        if let Ok(mut guard) = INPUT_TX.lock() {
            *guard = None;
        }
        if let Some(model) = lock_model().as_mut() {
            model.notice = "会话已断开".to_string();
        }
    }

    fn run_controller_direct(
        mut link: direct_client::DirectLink,
        input_receiver: mpsc::Receiver<session_core::InputEvent>,
    ) {
        if let Some(model) = lock_model().as_mut() {
            model.link_direct = true;
            model.notice = "已升直连".to_string();
        }
        loop {
            let mut send_failed = false;
            while let Ok(event) = input_receiver.try_recv() {
                let payload = session_core::encode_input(&event);
                if link
                    .send_frame(&session_core::Frame {
                        kind: session_core::FrameKind::Input,
                        flags: 0,
                        payload,
                    })
                    .is_err()
                {
                    send_failed = true;
                    break;
                }
            }
            if send_failed {
                break;
            }
            match link.try_recv_frame() {
                Ok(Some(frame)) if frame.kind == session_core::FrameKind::Video => {
                    apply_video_frame(&frame.payload);
                }
                Ok(Some(_)) => {}
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(10)),
                Err(_) => break,
            }
        }
        if let Ok(mut guard) = INPUT_TX.lock() {
            *guard = None;
        }
        if let Some(model) = lock_model().as_mut() {
            model.link_direct = false;
            model.notice = "会话已断开".to_string();
        }
    }

    fn upgrade_controller_direct(
        origin: String,
        token: String,
        remote_session_id: String,
        ticket: String,
        fingerprint: String,
    ) -> Option<direct_client::DirectLink> {
        let signal_origin = std::env::var("SIGNAL_URL").unwrap_or_else(|_| "http://127.0.0.1:8081".to_string());
        let Ok((socket, candidates)) = signal_client::bind_local_candidates() else {
            return None;
        };
        let Ok((_session_id, peers)) = signal_client::exchange_candidates(
            &signal_origin,
            &ticket,
            session_core::RelayRole::Controller,
            &fingerprint,
            &candidates,
        ) else {
            return None;
        };
        let outcome = signal_client::probe_direct(&socket, &peers);
        if !outcome.reached {
            let payload = serde_json::json!({
                "event": "punch",
                "punchResult": outcome.result,
                "punchBucket": outcome.bucket,
            })
            .to_string();
            let _ = post_json(
                &origin,
                &format!("/v1/remote-sessions/{remote_session_id}/direct"),
                &token,
                &payload,
            );
            return None;
        }
        let peer = outcome.peer?;
        let Ok(link) = direct_client::DirectLink::handshake(socket, peer, session_core::EndpointRole::Controller) else {
            let payload = serde_json::json!({
                "event": "punch",
                "punchResult": "handshake",
                "punchBucket": outcome.bucket,
            })
            .to_string();
            let _ = post_json(
                &origin,
                &format!("/v1/remote-sessions/{remote_session_id}/direct"),
                &token,
                &payload,
            );
            return None;
        };
        let payload = serde_json::json!({
            "event": "start",
            "punchResult": outcome.result,
            "punchBucket": outcome.bucket,
        })
        .to_string();
        let _ = post_json(
            &origin,
            &format!("/v1/remote-sessions/{remote_session_id}/direct"),
            &token,
            &payload,
        );
        Some(link)
    }

    fn apply_video_frame(payload: &[u8]) {
        let Ok((width, height, _codec, jpeg)) = session_core::unpack_video(payload) else { return };
        if jpeg.is_empty() {
            return;
        }
        let Ok(decoded) = image::load_from_memory(jpeg) else { return };
        let rgb = decoded.to_rgb8();
        let mut bgr = Vec::with_capacity(rgb.len());
        for pixel in rgb.chunks_exact(3) {
            bgr.push(pixel[2]);
            bgr.push(pixel[1]);
            bgr.push(pixel[0]);
        }
        let window = {
            let mut guard = lock_model();
            let Some(model) = guard.as_mut() else { return };
            model.picture_width = width as i32;
            model.picture_height = height as i32;
            model.picture_bgr = Some(bgr);
            if !model.link_direct && model.notice != "已升直连" {
                model.notice = "已收到画面".to_string();
            }
            model.main_window
        };
        if !window.is_invalid() {
            unsafe {
                let _ = windows::Win32::Graphics::Gdi::InvalidateRect(Some(window), None, false);
            }
        }
    }

    fn post_json(origin: &str, path: &str, token: &str, payload: &str) -> Result<String, String> {
        use std::io::{Read, Write};
        use std::net::TcpStream;
        use std::time::Duration;
        let rest = origin.strip_prefix("http://").ok_or("控制面地址不正确")?;
        let (host, port_text) = rest.split_once(':').ok_or("控制面地址不正确")?;
        let port: u16 = port_text.parse().map_err(|_| "控制面地址不正确")?;
        let mut stream = TcpStream::connect(format!("{host}:{port}")).map_err(|_| "控制面不可达")?;
        stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
        let request = format!(
            "POST {path} HTTP/1.1\r\nhost: {host}\r\nauthorization: Bearer {token}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
            payload.len()
        );
        stream.write_all(request.as_bytes()).map_err(|_| "控制面不可达")?;
        let mut buffer = Vec::new();
        stream.read_to_end(&mut buffer).map_err(|_| "控制面不可达")?;
        let text = String::from_utf8_lossy(&buffer);
        Ok(text.split("\r\n\r\n").nth(1).unwrap_or("").to_string())
    }

    fn get_json(origin: &str, path: &str, token: &str) -> Result<String, String> {
        use std::io::{Read, Write};
        use std::net::TcpStream;
        use std::time::Duration;
        let rest = origin.strip_prefix("http://").ok_or("控制面地址不正确")?;
        let (host, port_text) = rest.split_once(':').ok_or("控制面地址不正确")?;
        let port: u16 = port_text.parse().map_err(|_| "控制面地址不正确")?;
        let mut stream = TcpStream::connect(format!("{host}:{port}")).map_err(|_| "控制面不可达")?;
        stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
        let request = format!(
            "GET {path} HTTP/1.1\r\nhost: {host}\r\nauthorization: Bearer {token}\r\nconnection: close\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).map_err(|_| "控制面不可达")?;
        let mut buffer = Vec::new();
        stream.read_to_end(&mut buffer).map_err(|_| "控制面不可达")?;
        let text = String::from_utf8_lossy(&buffer);
        Ok(text.split("\r\n\r\n").nth(1).unwrap_or("").to_string())
    }
}
