//! 把控制端送来的画面坐标注到本机。权限式仅查看时丢掉，不停画面。

use std::mem::size_of;
use std::sync::atomic::{AtomicBool, Ordering};

use session_core::InputEvent;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, MOUSE_EVENT_FLAGS,
    MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

static INPUT_ALLOWED: AtomicBool = AtomicBool::new(true);

pub fn set_input_allowed(allowed: bool) {
    INPUT_ALLOWED.store(allowed, Ordering::Relaxed);
}

pub fn apply_input(event: &InputEvent, frame_width: i32, frame_height: i32) {
    if !INPUT_ALLOWED.load(Ordering::Relaxed) {
        return;
    }
    let frame_width = frame_width.max(1);
    let frame_height = frame_height.max(1);
    match event {
        InputEvent::PointerMove { x, y } => move_pointer(*x, *y, frame_width, frame_height),
        InputEvent::PointerDown { x, y, button } => {
            move_pointer(*x, *y, frame_width, frame_height);
            mouse_button(*button, true);
        }
        InputEvent::PointerUp { x, y, button } => {
            move_pointer(*x, *y, frame_width, frame_height);
            mouse_button(*button, false);
        }
        InputEvent::Wheel { x, y, delta } => {
            move_pointer(*x, *y, frame_width, frame_height);
            mouse_wheel(*delta);
        }
        InputEvent::KeyDown { key_code } => key_event(*key_code, false),
        InputEvent::KeyUp { key_code } => key_event(*key_code, true),
    }
}

fn move_pointer(picture_x: i32, picture_y: i32, frame_width: i32, frame_height: i32) {
    let screen_width = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(1);
    let screen_height = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(1);
    let screen_x = picture_x.clamp(0, frame_width - 1) * screen_width / frame_width;
    let screen_y = picture_y.clamp(0, frame_height - 1) * screen_height / frame_height;
    let absolute_x = (screen_x * 65535) / (screen_width - 1).max(1);
    let absolute_y = (screen_y * 65535) / (screen_height - 1).max(1);
    send_mouse(absolute_x, absolute_y, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, 0);
}

fn mouse_button(button: u8, down: bool) {
    let flag = match (button, down) {
        (0, true) => MOUSEEVENTF_LEFTDOWN,
        (0, false) => MOUSEEVENTF_LEFTUP,
        (1, true) => MOUSEEVENTF_RIGHTDOWN,
        (1, false) => MOUSEEVENTF_RIGHTUP,
        (2, true) => MOUSEEVENTF_MIDDLEDOWN,
        (2, false) => MOUSEEVENTF_MIDDLEUP,
        _ => return,
    };
    send_mouse(0, 0, flag, 0);
}

fn mouse_wheel(delta: i16) {
    send_mouse(0, 0, MOUSEEVENTF_WHEEL, delta as i32);
}

fn key_event(key_code: u32, up: bool) {
    if key_code > u16::MAX as u32 {
        return;
    }
    let mut input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: windows::Win32::UI::Input::KeyboardAndMouse::KEYBDINPUT {
                wVk: VIRTUAL_KEY(key_code as u16),
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        let _ = SendInput(std::slice::from_mut(&mut input), size_of::<INPUT>() as i32);
    }
}

fn send_mouse(absolute_x: i32, absolute_y: i32, flags: MOUSE_EVENT_FLAGS, mouse_data: i32) {
    let mut input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: absolute_x,
                dy: absolute_y,
                mouseData: mouse_data as u32,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    unsafe {
        let _ = SendInput(std::slice::from_mut(&mut input), size_of::<INPUT>() as i32);
    }
}
