//! 电脑被控端用户态。只画识别码、临时密码和首次确认。
//! 空闲时不采集、不编码。界面不出现金额。服务态和提权代理不在这一刀。

fn main() {
    #[cfg(windows)]
    {
        if let Err(error) = windows_host::run() {
            eprintln!("desktop host failed: {error}");
            std::process::exit(1);
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("desktop host currently runs on Windows");
    }
}

#[cfg(windows)]
mod capture;

#[cfg(windows)]
mod color_nv12;

#[cfg(windows)]
mod dxgi;

#[cfg(windows)]
mod h264_encode;

#[cfg(windows)]
mod h264_soft;

#[cfg(windows)]
mod inject;
mod keyframe_schedule;

#[cfg(windows)]
mod mf_async_credits;

#[cfg(windows)]
mod mf_h264;

#[cfg(windows)]
mod windows_host {
    use std::sync::Mutex;

    use getrandom::getrandom;
    use serde::Deserialize;
    use sha2::{Digest, Sha256};
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        BeginPaint, CreateFontW, DeleteObject, DrawTextW, EndPaint, InvalidateRect, SelectObject, SetBkMode, CLIP_DEFAULT_PRECIS,
        HGDIOBJ,
        DEFAULT_CHARSET, DEFAULT_QUALITY, DT_LEFT, DT_WORDBREAK, OUT_DEFAULT_PRECIS, PAINTSTRUCT, TRANSPARENT,
    };
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos,
        GetMessageW, LoadIconW, PostQuitMessage, RegisterClassW, SetForegroundWindow, SetTimer,
        ShowWindow, TrackPopupMenu, TranslateMessage, BS_DEFPUSHBUTTON, BS_PUSHBUTTON, CW_USEDEFAULT, HICON, HMENU,
        IDI_APPLICATION, MF_GRAYED, MF_STRING, MSG, SW_SHOW, TPM_RIGHTALIGN, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLOSE,
        WM_COMMAND, WM_CREATE, WM_DESTROY, WM_KEYDOWN, WM_PAINT, WM_RBUTTONUP, WM_TIMER, WNDCLASSW, WS_CAPTION, WS_CHILD,
        WS_EX_TOPMOST, WS_OVERLAPPED, WS_SYSMENU, WS_VISIBLE,
    };

    const COPY_CODE: i32 = 101;
    const ROTATE_PASSWORD: i32 = 102;
    const TOGGLE_ACCEPT: i32 = 103;
    const STOP_CONTROL: i32 = 104;
    const REVOKE_INPUT: i32 = 105;
    const RESTORE_INPUT: i32 = 106;
    const ALLOW_ONCE: i32 = 201;
    const REFUSE: i32 = 202;
    const TRAY_OPEN: i32 = 301;
    const TRAY_EXIT: i32 = 302;
    const TRAY_MESSAGE: u32 = 0x8001;
    const POLL_TIMER: usize = 1;
    const KEY_RETURN: u16 = 0x0d;
    const KEY_ESCAPE: u16 = 0x1b;
    const CLIPBOARD_UNICODE: u32 = 13;
    const PASSWORD_ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";

    struct Model {
        device_code: String,
        temp_password: String,
        accepting: bool,
        status_line: String,
        main_window: HWND,
        confirm_window: HWND,
        incoming_id: Option<String>,
        incoming_who: String,
        token: Option<String>,
        origin: String,
        host_device_id: Option<String>,
        relay_ticket: Option<String>,
        remote_session_id: Option<String>,
        input_allowed: bool,
    }

    // 窗口句柄只在界面线程使用。HWND 本身不是 Send，模型不会跨线程。
    unsafe impl Send for Model {}

    static MODEL: Mutex<Option<Model>> = Mutex::new(None);

    pub fn run() -> windows::core::Result<()> {
        let token = std::env::var("HOST_TOKEN").ok().filter(|value| !value.is_empty());
        let origin = std::env::var("CONTROL_PLANE_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
        *lock_model() = Some(Model {
            device_code: random_digits(9),
            temp_password: random_password(),
            accepting: true,
            status_line: "未被连接".to_string(),
            main_window: HWND::default(),
            confirm_window: HWND::default(),
            incoming_id: None,
            incoming_who: String::new(),
            token,
            origin,
            host_device_id: None,
            relay_ticket: None,
            remote_session_id: None,
            input_allowed: true,
        });
        unsafe { message_loop() }
    }

    fn lock_model() -> std::sync::MutexGuard<'static, Option<Model>> {
        MODEL.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    unsafe fn message_loop() -> windows::core::Result<()> {
        let instance = GetModuleHandleW(None)?;
        let class_name = w!("DesktopHostWindow");
        let confirm_class = w!("DesktopHostConfirm");
        let main_class = WNDCLASSW {
            lpfnWndProc: Some(main_proc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            hIcon: LoadIconW(None, IDI_APPLICATION)?,
            ..Default::default()
        };
        let confirm = WNDCLASSW {
            lpfnWndProc: Some(confirm_proc),
            hInstance: instance.into(),
            lpszClassName: confirm_class,
            ..Default::default()
        };
        RegisterClassW(&main_class);
        RegisterClassW(&confirm);
        let window = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            w!("远程桌面 · 本机"),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            760,
            520,
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

    unsafe extern "system" fn main_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_CREATE => {
                create_buttons(window);
                add_tray(window);
                let _ = SetTimer(Some(window), POLL_TIMER, 2000, None);
                if let Some(model) = lock_model().as_mut() {
                    model.main_window = window;
                }
                register_device();
                LRESULT(0)
            }
            WM_COMMAND => {
                match (wparam.0 & 0xffff) as i32 {
                    COPY_CODE => copy_code(),
                    ROTATE_PASSWORD => rotate_password(),
                    TOGGLE_ACCEPT => toggle_accept(),
                    STOP_CONTROL => stop_now(),
                    REVOKE_INPUT => set_session_input(false),
                    RESTORE_INPUT => set_session_input(true),
                    TRAY_OPEN => {
                        let _ = ShowWindow(window, SW_SHOW);
                        let _ = SetForegroundWindow(window);
                    }
                    TRAY_EXIT => {
                        let _ = DestroyWindow(window);
                    }
                    _ => {}
                }
                refresh();
                LRESULT(0)
            }
            WM_TIMER => {
                poll_incoming();
                poll_host_attach();
                refresh();
                LRESULT(0)
            }
            WM_PAINT => {
                paint_main(window);
                LRESULT(0)
            }
            TRAY_MESSAGE => {
                if lparam.0 as u32 == WM_RBUTTONUP {
                    show_tray_menu(window);
                }
                if lparam.0 as u32 == 0x0201 {
                    let _ = ShowWindow(window, SW_SHOW);
                    let _ = SetForegroundWindow(window);
                }
                LRESULT(0)
            }
            WM_DESTROY => {
                remove_tray(window);
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(window, message, wparam, lparam),
        }
    }

    unsafe extern "system" fn confirm_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_CREATE => {
                create_button(window, "拒绝", 360, 280, 140, 36, REFUSE, true);
                create_button(window, "允许本次", 40, 280, 140, 36, ALLOW_ONCE, false);
                let _ = SetForegroundWindow(window);
                LRESULT(0)
            }
            WM_KEYDOWN => {
                let key = wparam.0 as u16;
                if key == KEY_RETURN || key == KEY_ESCAPE {
                    refuse();
                }
                LRESULT(0)
            }
            WM_COMMAND => {
                match (wparam.0 & 0xffff) as i32 {
                    ALLOW_ONCE => allow_once(),
                    REFUSE => refuse(),
                    _ => {}
                }
                LRESULT(0)
            }
            WM_CLOSE => {
                refuse();
                LRESULT(0)
            }
            WM_PAINT => {
                paint_confirm(window);
                LRESULT(0)
            }
            _ => DefWindowProcW(window, message, wparam, lparam),
        }
    }

    unsafe fn create_buttons(window: HWND) {
        create_button(window, "复制", 430, 78, 120, 32, COPY_CODE, false);
        create_button(window, "换一个", 430, 168, 120, 32, ROTATE_PASSWORD, false);
        create_button(window, "允许被连接", 430, 230, 120, 32, TOGGLE_ACCEPT, false);
        create_button(window, "停止被控", 430, 300, 120, 32, STOP_CONTROL, false);
        create_button(window, "仅查看（停键鼠）", 430, 340, 160, 32, REVOKE_INPUT, false);
        create_button(window, "恢复键鼠", 430, 380, 120, 32, RESTORE_INPUT, false);
    }

    unsafe fn create_button(parent: HWND, label: &str, left: i32, top: i32, width: i32, height: i32, command_id: i32, primary: bool) {
        let wide = wide_string(label);
        let button_style = WINDOW_STYLE(if primary { BS_DEFPUSHBUTTON as u32 } else { BS_PUSHBUTTON as u32 });
        let style = WS_CHILD | WS_VISIBLE | button_style;
        let _ = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("BUTTON"),
            PCWSTR(wide.as_ptr()),
            style,
            left,
            top,
            width,
            height,
            Some(parent),
            Some(HMENU(command_id as isize as *mut core::ffi::c_void)),
            None,
            None,
        );
    }

    unsafe fn paint_main(window: HWND) {
        let mut paint = PAINTSTRUCT::default();
        let device_context = BeginPaint(window, &mut paint);
        SetBkMode(device_context, TRANSPARENT);
        let snapshot = lock_model().as_ref().map(|model| {
            (
                display_code(&model.device_code),
                model.temp_password.clone(),
                model.accepting,
                model.status_line.clone(),
                model.input_allowed,
            )
        });
        if let Some((code_text, password_text, accepting, status_line, input_allowed)) = snapshot {
            let code = wide_chars(&format!("本机识别码    {code_text}"));
            let password = wide_chars(&format!("临时密码    {password_text}"));
            let accept = wide_chars(if accepting { "● 允许被连接" } else { "不允许被连接" });
            let status = wide_chars(&format!("当前状态    {status_line}"));
            let input = wide_chars(if input_allowed {
                "键鼠    对方可操作"
            } else {
                "键鼠    仅查看中（对方键鼠已停）"
            });
            let safety = wide_chars("安全提示：只把识别码与密码告诉你信任的人。任何人以「客服/公检法需要看屏幕」为由索要，都是诈骗。");
            draw_code(device_context, &code, 24, 70, 390, 40);
            draw_line(device_context, &password, 24, 160, 390, 36);
            draw_line(device_context, &accept, 24, 230, 360, 28);
            draw_line(device_context, &status, 24, 300, 360, 28);
            draw_line(device_context, &input, 24, 330, 390, 28);
            draw_line(device_context, &safety, 24, 380, 680, 64);
        }
        let _ = EndPaint(window, &paint);
    }

    unsafe fn paint_confirm(window: HWND) {
        let mut paint = PAINTSTRUCT::default();
        let device_context = BeginPaint(window, &mut paint);
        SetBkMode(device_context, TRANSPARENT);
        let who = lock_model().as_ref().map(|model| model.incoming_who.clone()).unwrap_or_default();
        let title = wide_chars("有人请求控制本设备");
        let person = wide_chars(&who);
        let can = wide_chars("允许后，对方可以：看到你屏幕上的所有内容；操作你的鼠标与键盘。");
        let line1 = wide_chars("① 你正在允许对方控制本设备");
        let line2 = wide_chars("② 对方能看到并操作你屏幕上的一切");
        let line3 = wide_chars("③ 不要向陌生人开启；任何自称「客服 / 公检法」要求你打开屏幕的，都是诈骗");
        draw_line(device_context, &title, 24, 24, 500, 32);
        draw_line(device_context, &person, 24, 64, 500, 48);
        draw_line(device_context, &can, 24, 120, 500, 48);
        draw_line(device_context, &line1, 24, 180, 500, 24);
        draw_line(device_context, &line2, 24, 206, 500, 24);
        draw_line(device_context, &line3, 24, 232, 500, 40);
        let _ = EndPaint(window, &paint);
    }

    unsafe fn draw_code(device_context: windows::Win32::Graphics::Gdi::HDC, text: &[u16], left: i32, top: i32, width: i32, height: i32) {
        let face = wide_string("Consolas");
        let font = CreateFontW(
            28,
            0,
            0,
            0,
            400,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            DEFAULT_QUALITY,
            1,
            PCWSTR(face.as_ptr()),
        );
        let previous = SelectObject(device_context, HGDIOBJ::from(font));
        draw_line(device_context, text, left, top, width, height);
        SelectObject(device_context, previous);
        let _ = DeleteObject(HGDIOBJ::from(font));
    }

    unsafe fn draw_line(device_context: windows::Win32::Graphics::Gdi::HDC, text: &[u16], left: i32, top: i32, width: i32, height: i32) {
        let mut owned = text.to_vec();
        let mut rect = windows::Win32::Foundation::RECT {
            left,
            top,
            right: left + width,
            bottom: top + height,
        };
        DrawTextW(device_context, &mut owned, &mut rect, DT_LEFT | DT_WORDBREAK);
    }

    unsafe fn add_tray(window: HWND) {
        let mut tip = [0u16; 128];
        let label = wide_string("远程桌面（本机）");
        let copy_len = label.len().min(127);
        tip[..copy_len].copy_from_slice(&label[..copy_len]);
        let icon = LoadIconW(None, IDI_APPLICATION).unwrap_or(HICON(std::ptr::null_mut()));
        let data = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: window,
            uID: 1,
            uFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP,
            uCallbackMessage: TRAY_MESSAGE,
            hIcon: icon,
            szTip: tip,
            ..Default::default()
        };
        let _ = Shell_NotifyIconW(NIM_ADD, &data);
    }

    unsafe fn remove_tray(window: HWND) {
        let data = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: window,
            uID: 1,
            ..Default::default()
        };
        let _ = Shell_NotifyIconW(NIM_DELETE, &data);
    }

    unsafe fn show_tray_menu(window: HWND) {
        let Ok(menu) = CreatePopupMenu() else { return };
        let accepting = lock_model().as_ref().map(|model| model.accepting).unwrap_or(false);
        let echo = wide_string(if accepting { "可被连接" } else { "不允许被连接" });
        let stop = wide_string("停止被控");
        let revoke = wide_string("仅查看（停键鼠）");
        let restore = wide_string("恢复键鼠");
        let copy = wide_string("复制本机识别码");
        let open = wide_string("打开主界面");
        let exit_label = wide_string("退出");
        let _ = AppendMenuW(menu, MF_GRAYED | MF_STRING, 0, PCWSTR(echo.as_ptr()));
        let _ = AppendMenuW(menu, MF_STRING, STOP_CONTROL as usize, PCWSTR(stop.as_ptr()));
        let _ = AppendMenuW(menu, MF_STRING, REVOKE_INPUT as usize, PCWSTR(revoke.as_ptr()));
        let _ = AppendMenuW(menu, MF_STRING, RESTORE_INPUT as usize, PCWSTR(restore.as_ptr()));
        let _ = AppendMenuW(menu, MF_STRING, COPY_CODE as usize, PCWSTR(copy.as_ptr()));
        let _ = AppendMenuW(menu, MF_STRING, TRAY_OPEN as usize, PCWSTR(open.as_ptr()));
        let _ = AppendMenuW(menu, MF_STRING, TRAY_EXIT as usize, PCWSTR(exit_label.as_ptr()));
        let mut point = POINT::default();
        if GetCursorPos(&mut point).is_err() {
            return;
        }
        let _ = SetForegroundWindow(window);
        let _ = TrackPopupMenu(menu, TPM_RIGHTALIGN, point.x, point.y, Some(0), window, None);
    }

    fn copy_code() {
        let code = lock_model().as_ref().map(|model| display_code(&model.device_code)).unwrap_or_default();
        unsafe { set_clipboard(&code) };
    }

    fn rotate_password() {
        let next = random_password();
        let snapshot = {
            let mut guard = lock_model();
            let Some(model) = guard.as_mut() else { return };
            model.temp_password = next;
            (
                password_hash(&model.temp_password),
                model.origin.clone(),
                model.token.clone(),
                model.host_device_id.clone(),
                compact_digits(&model.device_code),
            )
        };
        let (hash, origin, token, device_id, code) = snapshot;
        if let (Some(token), Some(device_id)) = (token, device_id) {
            let _ = post_json(
                &origin,
                &format!("/v1/host-devices/{device_id}/credentials"),
                &token,
                &serde_json::json!({ "deviceCode": code, "tempPasswordHash": hash }).to_string(),
            );
        }
    }

    fn toggle_accept() {
        let turning_off = lock_model().as_ref().map(|model| model.accepting).unwrap_or(true);
        if turning_off {
            stop_now();
            return;
        }
        let snapshot = {
            let mut guard = lock_model();
            let Some(model) = guard.as_mut() else { return };
            model.accepting = true;
            model.status_line = "未被连接".to_string();
            (model.origin.clone(), model.token.clone(), model.host_device_id.clone())
        };
        let (origin, token, device_id) = snapshot;
        if let (Some(token), Some(device_id)) = (token, device_id) {
            let _ = post_json(&origin, &format!("/v1/host-devices/{device_id}/accepting"), &token, r#"{"accepting":true}"#);
        }
    }

    fn stop_now() {
        let snapshot = {
            let mut guard = lock_model();
            let Some(model) = guard.as_mut() else { return };
            model.accepting = false;
            model.incoming_id = None;
            model.input_allowed = true;
            model.status_line = "不允许被连接".to_string();
            let confirm = model.confirm_window;
            model.confirm_window = HWND::default();
            (model.origin.clone(), model.token.clone(), model.host_device_id.clone(), confirm)
        };
        let (origin, token, device_id, confirm) = snapshot;
        crate::inject::set_input_allowed(false);
        if let (Some(token), Some(device_id)) = (token, device_id) {
            let _ = post_json(&origin, &format!("/v1/host-devices/{device_id}/stop"), &token, "{}");
        }
        if !confirm.is_invalid() {
            unsafe { let _ = DestroyWindow(confirm); }
        }
    }

    /// 权限式仅查看：画面不停，键鼠由被控端丢掉。服务端记 input_revoked，控制端轮询后不再发送。
    fn set_session_input(allowed: bool) {
        let snapshot = {
            let mut guard = lock_model();
            let Some(model) = guard.as_mut() else { return };
            let Some(session_id) = model.remote_session_id.clone() else {
                model.status_line = "当前没有会话".to_string();
                return;
            };
            model.input_allowed = allowed;
            if model.relay_ticket.is_some() {
                model.status_line = if allowed {
                    "已被连接".to_string()
                } else {
                    "仅查看中".to_string()
                };
            }
            (model.origin.clone(), model.token.clone(), session_id)
        };
        crate::inject::set_input_allowed(allowed);
        let (origin, token, session_id) = snapshot;
        if let Some(token) = token {
            let body = if allowed {
                r#"{"allowed":true}"#
            } else {
                r#"{"allowed":false}"#
            };
            let _ = post_json(
                &origin,
                &format!("/v1/remote-sessions/{session_id}/input"),
                &token,
                body,
            );
        }
    }

    fn allow_once() {
        let snapshot = {
            let mut guard = lock_model();
            let Some(model) = guard.as_mut() else { return };
            let session_id = model.incoming_id.clone();
            let origin = model.origin.clone();
            let token = model.token.clone();
            model.incoming_id = None;
            model.status_line = "已被连接".to_string();
            let confirm = model.confirm_window;
            model.confirm_window = HWND::default();
            (origin, token, session_id, confirm)
        };
        let (origin, token, session_id, confirm) = snapshot;
        if let (Some(token), Some(session_id)) = (token, session_id) {
            if let Ok(body) = post_json(
                &origin,
                &format!("/v1/remote-sessions/{session_id}/consent"),
                &token,
                r#"{"confirmedOnHost":true}"#,
            ) {
                if let Ok(parsed) = serde_json::from_str::<RelayTicketBody>(&body) {
                    remember_relay_ticket(parsed.ticket, parsed.remote_session_id);
                }
            }
        }
        rotate_password();
        if !confirm.is_invalid() {
            unsafe { let _ = DestroyWindow(confirm); }
        }
    }

    fn refuse() {
        let snapshot = {
            let mut guard = lock_model();
            let Some(model) = guard.as_mut() else { return };
            let session_id = model.incoming_id.clone();
            let origin = model.origin.clone();
            let token = model.token.clone();
            let accepting = model.accepting;
            model.incoming_id = None;
            model.status_line = if accepting { "未被连接".to_string() } else { "不允许被连接".to_string() };
            let confirm = model.confirm_window;
            model.confirm_window = HWND::default();
            (origin, token, session_id, confirm)
        };
        let (origin, token, session_id, confirm) = snapshot;
        if let (Some(token), Some(session_id)) = (token, session_id) {
            let _ = post_json(&origin, &format!("/v1/remote-sessions/{session_id}/reject"), &token, "{}");
        }
        if !confirm.is_invalid() {
            unsafe { let _ = DestroyWindow(confirm); }
        }
    }

    fn poll_incoming() {
        let (origin, token) = {
            let guard = lock_model();
            let Some(model) = guard.as_ref() else { return };
            if !model.accepting || model.token.is_none() {
                return;
            }
            (model.origin.clone(), model.token.clone().unwrap_or_default())
        };
        let Ok(body) = get_json(&origin, "/v1/remote-sessions/incoming", &token) else { return };
        let Ok(parsed) = serde_json::from_str::<IncomingList>(&body) else { return };
        let Some(first) = parsed.incoming.into_iter().next() else { return };
        let parent = {
            let mut guard = lock_model();
            let Some(model) = guard.as_mut() else { return };
            if model.incoming_id.as_deref() == Some(first.remote_session_id.as_str()) {
                return;
            }
            model.incoming_id = Some(first.remote_session_id);
            let who = first.controller_phone_mask.unwrap_or_else(|| "未知账号".to_string());
            let first_label = if first.first_connection { "首次连接" } else { "再次连接" };
            model.incoming_who = format!("账号 {who} · {first_label}");
            model.status_line = "有人请求控制".to_string();
            model.main_window
        };
        unsafe { open_confirm(parent) };
    }

    fn poll_host_attach() {
        let (origin, token) = {
            let guard = lock_model();
            let Some(model) = guard.as_ref() else { return };
            if model.token.is_none() || model.relay_ticket.is_some() {
                return;
            }
            (model.origin.clone(), model.token.clone().unwrap_or_default())
        };
        let Ok(body) = get_json(&origin, "/v1/remote-sessions/host-attach", &token) else { return };
        let Ok(parsed) = serde_json::from_str::<HostAttachBody>(&body) else { return };
        remember_relay_ticket(parsed.ticket, parsed.remote_session_id);
    }

    fn remember_relay_ticket(ticket: Option<String>, remote_session_id: Option<String>) {
        let Some(ticket) = ticket.filter(|value| !value.is_empty()) else { return };
        if session_core::ticket_looks_usable(&ticket).is_err() {
            return;
        }
        let fingerprint = machine_fingerprint();
        if session_core::encode_relay_hello(&ticket, session_core::RelayRole::Host, &fingerprint).is_err() {
            return;
        }
        let (origin, token, session_id) = {
            let mut guard = lock_model();
            let Some(model) = guard.as_mut() else { return };
            if model.relay_ticket.is_some() {
                return;
            }
            model.relay_ticket = Some(ticket.clone());
            model.input_allowed = true;
            if let Some(session_id) = remote_session_id.clone() {
                model.remote_session_id = Some(session_id);
            }
            model.status_line = "中继票已就绪".to_string();
            crate::inject::set_input_allowed(true);
            (
                model.origin.clone(),
                model.token.clone().unwrap_or_default(),
                model.remote_session_id.clone().unwrap_or_default(),
            )
        };
        refresh();
        std::thread::spawn(move || {
            run_host_relay(ticket, fingerprint, origin, token, session_id);
        });
    }

    fn run_host_relay(ticket: String, fingerprint: String, origin: String, token: String, remote_session_id: String) {
        let address = std::env::var("RELAY_ADDR").unwrap_or_else(|_| "127.0.0.1:8443".to_string());
        let Ok(mut session) = relay_client::RelaySession::connect(
            &address,
            &ticket,
            session_core::RelayRole::Host,
            &fingerprint,
        ) else {
            if let Some(model) = lock_model().as_mut() {
                model.status_line = "中继未接通".to_string();
            }
            refresh();
            return;
        };
        if let Some(model) = lock_model().as_mut() {
            model.status_line = "中继已接通".to_string();
        }
        refresh();
        let (direct_sender, direct_receiver) = std::sync::mpsc::sync_channel::<direct_client::DirectLink>(1);
        if !remote_session_id.is_empty() && !token.is_empty() {
            let punch_ticket = ticket.clone();
            let punch_fingerprint = fingerprint.clone();
            let punch_origin = origin.clone();
            let punch_token = token.clone();
            let punch_session = remote_session_id.clone();
            std::thread::spawn(move || {
                if let Some(link) = probe_and_upgrade_direct(
                    punch_origin,
                    punch_token,
                    punch_session,
                    punch_ticket,
                    session_core::RelayRole::Host,
                    session_core::EndpointRole::Host,
                    punch_fingerprint,
                ) {
                    let _ = direct_sender.send(link);
                }
            });
        }
        let mut grabber = crate::capture::ScreenGrabber::new();
        let mut frame_width = 640;
        let mut frame_height = 360;
        crate::inject::set_input_allowed(true);
        'relay: loop {
            if let Ok(link) = direct_receiver.try_recv() {
                drop(session);
                run_host_direct(
                    link,
                    grabber,
                    frame_width,
                    frame_height,
                    origin.clone(),
                    token.clone(),
                    remote_session_id.clone(),
                );
                return;
            }
            if let Some(frame) = grabber.grab_jpeg_frame() {
                if let Ok((width, height, _, _)) = session_core::unpack_video(&frame.payload) {
                    frame_width = width as i32;
                    frame_height = height as i32;
                }
                if session.send_frame(&frame).is_err() {
                    break;
                }
            }
            let mut saw_input = false;
            loop {
                match session.try_recv_frame() {
                    Ok(Some(frame)) if frame.kind == session_core::FrameKind::Input => {
                        saw_input = true;
                        if let Ok(event) = session_core::decode_input(&frame.payload) {
                            crate::inject::apply_input(&event, frame_width, frame_height);
                        }
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(_) => break 'relay,
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(if saw_input { 5 } else { 30 }));
        }
        crate::inject::set_input_allowed(false);
        finish_host_relay();
    }

    fn run_host_direct(
        mut link: direct_client::DirectLink,
        mut grabber: crate::capture::ScreenGrabber,
        mut frame_width: i32,
        mut frame_height: i32,
        origin: String,
        token: String,
        remote_session_id: String,
    ) {
        if let Some(model) = lock_model().as_mut() {
            model.status_line = "已升直连".to_string();
        }
        refresh();
        loop {
            if let Some(frame) = grabber.grab_jpeg_frame() {
                if let Ok((width, height, _, _)) = session_core::unpack_video(&frame.payload) {
                    frame_width = width as i32;
                    frame_height = height as i32;
                }
                if link.send_frame(&frame).is_err() {
                    break;
                }
            }
            let mut saw_input = false;
            loop {
                match link.try_recv_frame() {
                    Ok(Some(frame)) if frame.kind == session_core::FrameKind::Input => {
                        saw_input = true;
                        if let Ok(event) = session_core::decode_input(&frame.payload) {
                            crate::inject::apply_input(&event, frame_width, frame_height);
                        }
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(_) => {
                        report_direct_stop(&origin, &token, &remote_session_id);
                        crate::inject::set_input_allowed(false);
                        finish_host_relay();
                        return;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(if saw_input { 5 } else { 30 }));
        }
        report_direct_stop(&origin, &token, &remote_session_id);
        crate::inject::set_input_allowed(false);
        finish_host_relay();
    }

    fn finish_host_relay() {
        if let Some(model) = lock_model().as_mut() {
            model.status_line = "会话已断开".to_string();
            model.relay_ticket = None;
            model.input_allowed = true;
        }
        refresh();
    }

    fn report_direct_stop(origin: &str, token: &str, remote_session_id: &str) {
        if origin.is_empty() || token.is_empty() || remote_session_id.is_empty() {
            return;
        }
        let payload = r#"{"event":"stop"}"#;
        let _ = post_json(
            origin,
            &format!("/v1/remote-sessions/{remote_session_id}/direct"),
            token,
            payload,
        );
    }

    /// 后台打洞并握手。失败只记分桶，不弹窗，不停中继；成功则把直连句柄交回主循环。
    fn probe_and_upgrade_direct(
        origin: String,
        token: String,
        remote_session_id: String,
        ticket: String,
        relay_role: session_core::RelayRole,
        endpoint_role: session_core::EndpointRole,
        fingerprint: String,
    ) -> Option<direct_client::DirectLink> {
        let signal_origin = std::env::var("SIGNAL_URL").unwrap_or_else(|_| "http://127.0.0.1:8081".to_string());
        let Ok((socket, candidates)) = signal_client::bind_local_candidates() else {
            return None;
        };
        let Ok((_session_id, peers)) =
            signal_client::exchange_candidates(&signal_origin, &ticket, relay_role, &fingerprint, &candidates)
        else {
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
        let Ok(link) = direct_client::DirectLink::handshake(socket, peer, endpoint_role) else {
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

    unsafe fn open_confirm(parent: HWND) {
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let window = CreateWindowExW(
            WS_EX_TOPMOST,
            w!("DesktopHostConfirm"),
            w!("远程桌面 · 本机"),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            560,
            380,
            Some(parent),
            None,
            Some(instance.into()),
            None,
        );
        if let Ok(window) = window {
            if let Some(model) = lock_model().as_mut() {
                model.confirm_window = window;
            }
            let _ = ShowWindow(window, SW_SHOW);
            let _ = SetForegroundWindow(window);
        }
    }

    fn register_device() {
        let (origin, token, code, password) = {
            let guard = lock_model();
            let Some(model) = guard.as_ref() else { return };
            let Some(token) = model.token.clone() else { return };
            (model.origin.clone(), token, compact_digits(&model.device_code), model.temp_password.clone())
        };
        let fingerprint = machine_fingerprint();
        let created = post_json(
            &origin,
            "/v1/host-devices",
            &token,
            &serde_json::json!({
                "displayName": "本机",
                "platform": "windows",
                "hardwareFingerprint": fingerprint,
            })
            .to_string(),
        );
        let Ok(created_body) = created else { return };
        let Ok(parsed) = serde_json::from_str::<CreatedDevice>(&created_body) else { return };
        let Some(host_device_id) = parsed.host_device_id else { return };
        let mut code = code;
        let hash = password_hash(&password);
        for _attempt in 0..4 {
            let published = post_json(
                &origin,
                &format!("/v1/host-devices/{host_device_id}/credentials"),
                &token,
                &serde_json::json!({ "deviceCode": code, "tempPasswordHash": hash }).to_string(),
            );
            let taken = published.as_ref().map(|body| body.contains("device_code_taken")).unwrap_or(false);
            if !taken {
                break;
            }
            code = random_digits(9);
        }
        if let Some(model) = lock_model().as_mut() {
            model.device_code = code.clone();
            model.host_device_id = Some(host_device_id.clone());
        }
        let _ = post_json(&origin, &format!("/v1/host-devices/{host_device_id}/confirm"), &token, r#"{"confirmedOnHost":true}"#);
        let _ = post_json(&origin, &format!("/v1/host-devices/{host_device_id}/presence"), &token, r#"{"state":"online"}"#);
    }

    fn refresh() {
        let window = lock_model().as_ref().map(|model| model.main_window).unwrap_or_default();
        if window.is_invalid() {
            return;
        }
        unsafe {
            let _ = InvalidateRect(Some(window), None, true);
        }
    }

    #[derive(Deserialize)]
    struct CreatedDevice {
        #[serde(rename = "hostDeviceId")]
        host_device_id: Option<String>,
    }

    #[derive(Deserialize)]
    struct IncomingList {
        incoming: Vec<IncomingItem>,
    }

    #[derive(Deserialize)]
    struct IncomingItem {
        #[serde(rename = "remoteSessionId")]
        remote_session_id: String,
        #[serde(rename = "controllerPhoneMask")]
        controller_phone_mask: Option<String>,
        #[serde(rename = "firstConnection")]
        first_connection: bool,
    }

    #[derive(Deserialize)]
    struct RelayTicketBody {
        ticket: Option<String>,
        #[serde(rename = "remoteSessionId")]
        remote_session_id: Option<String>,
    }

    #[derive(Deserialize)]
    struct HostAttachBody {
        ticket: Option<String>,
        #[serde(rename = "remoteSessionId")]
        remote_session_id: Option<String>,
    }

    fn display_code(code: &str) -> String {
        let digits: String = code.chars().filter(|digit| digit.is_ascii_digit()).collect();
        if digits.len() != 9 {
            return code.to_string();
        }
        format!("{} {} {}", &digits[0..3], &digits[3..6], &digits[6..9])
    }

    fn compact_digits(code: &str) -> String {
        code.chars().filter(|digit| digit.is_ascii_digit()).collect()
    }

    fn random_digits(count: usize) -> String {
        let mut bytes = vec![0u8; count];
        let _ = getrandom(&mut bytes);
        bytes.into_iter().map(|byte| char::from(b'0' + (byte % 10))).collect()
    }

    fn random_password() -> String {
        let mut bytes = [0u8; 6];
        let _ = getrandom(&mut bytes);
        bytes
            .into_iter()
            .map(|byte| PASSWORD_ALPHABET[(byte as usize) % PASSWORD_ALPHABET.len()] as char)
            .collect()
    }

    fn password_hash(password: &str) -> String {
        let digest = Sha256::digest(password.as_bytes());
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn machine_fingerprint() -> String {
        let name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "windows-host".to_string());
        format!("win-{name}")
    }

    fn wide_string(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn wide_chars(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    fn post_json(origin: &str, path: &str, token: &str, payload: &str) -> Result<String, String> {
        http(origin, "POST", path, Some(token), Some(payload))
    }

    fn get_json(origin: &str, path: &str, token: &str) -> Result<String, String> {
        http(origin, "GET", path, Some(token), None)
    }

    fn http(origin: &str, method: &str, path: &str, token: Option<&str>, payload: Option<&str>) -> Result<String, String> {
        use std::io::{Read, Write};
        use std::net::TcpStream;
        use std::time::Duration;
        let rest = origin.strip_prefix("http://").ok_or("控制面地址不正确")?;
        let (host, port_text) = rest.split_once(':').ok_or("控制面地址不正确")?;
        let port: u16 = port_text.parse().map_err(|_| "控制面地址不正确")?;
        let mut stream = TcpStream::connect(format!("{host}:{port}")).map_err(|_| "控制面不可达")?;
        stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
        let body = payload.unwrap_or("");
        let auth = token.map(|value| format!("authorization: Bearer {value}\r\n")).unwrap_or_default();
        let request = format!(
            "{method} {path} HTTP/1.1\r\nhost: {host}\r\ncontent-type: application/json\r\n{auth}content-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).map_err(|_| "控制面不可达")?;
        let mut buffer = Vec::new();
        stream.read_to_end(&mut buffer).map_err(|_| "控制面不可达")?;
        let text = String::from_utf8_lossy(&buffer);
        Ok(text.split("\r\n\r\n").nth(1).unwrap_or("").to_string())
    }

    unsafe fn set_clipboard(text: &str) {
        let wide = wide_string(text);
        if OpenClipboard(None).is_err() {
            return;
        }
        let _ = EmptyClipboard();
        let Ok(global) = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2) else {
            let _ = CloseClipboard();
            return;
        };
        let pointer = GlobalLock(global);
        if !pointer.is_null() {
            std::ptr::copy_nonoverlapping(wide.as_ptr(), pointer.cast::<u16>(), wide.len());
            let _ = GlobalUnlock(global);
            let _ = SetClipboardData(CLIPBOARD_UNICODE, Some(HANDLE(global.0)));
        }
        let _ = CloseClipboard();
    }
}
