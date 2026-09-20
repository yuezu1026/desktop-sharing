//! 输入事件。坐标是画面像素，不是窗口像素，方便和等比黑边对齐。

#[derive(Debug, Clone, PartialEq)]
pub enum InputEvent {
    PointerMove { x: i32, y: i32 },
    PointerDown { x: i32, y: i32, button: u8 },
    PointerUp { x: i32, y: i32, button: u8 },
    Wheel { x: i32, y: i32, delta: i16 },
    KeyDown { key_code: u32 },
    KeyUp { key_code: u32 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputError {
    Truncated,
    UnknownKind,
}

pub fn encode_input(event: &InputEvent) -> Vec<u8> {
    match event {
        InputEvent::PointerMove { x, y } => encode_xy(1, *x, *y, 0, 0),
        InputEvent::PointerDown { x, y, button } => encode_xy(2, *x, *y, *button, 0),
        InputEvent::PointerUp { x, y, button } => encode_xy(3, *x, *y, *button, 0),
        InputEvent::Wheel { x, y, delta } => {
            let mut bytes = encode_xy(4, *x, *y, 0, 0);
            bytes.extend_from_slice(&delta.to_be_bytes());
            bytes
        }
        InputEvent::KeyDown { key_code } => encode_key(5, *key_code),
        InputEvent::KeyUp { key_code } => encode_key(6, *key_code),
    }
}

pub fn decode_input(bytes: &[u8]) -> Result<InputEvent, InputError> {
    if bytes.is_empty() {
        return Err(InputError::Truncated);
    }
    match bytes[0] {
        1 => {
            let (x, y, _, _) = read_xy(bytes)?;
            Ok(InputEvent::PointerMove { x, y })
        }
        2 => {
            let (x, y, button, _) = read_xy(bytes)?;
            Ok(InputEvent::PointerDown { x, y, button })
        }
        3 => {
            let (x, y, button, _) = read_xy(bytes)?;
            Ok(InputEvent::PointerUp { x, y, button })
        }
        4 => {
            let (x, y, _, _) = read_xy(bytes)?;
            if bytes.len() < 12 {
                return Err(InputError::Truncated);
            }
            let delta = i16::from_be_bytes([bytes[10], bytes[11]]);
            Ok(InputEvent::Wheel { x, y, delta })
        }
        5 => Ok(InputEvent::KeyDown {
            key_code: read_key(bytes)?,
        }),
        6 => Ok(InputEvent::KeyUp {
            key_code: read_key(bytes)?,
        }),
        _ => Err(InputError::UnknownKind),
    }
}

fn encode_xy(kind: u8, x: i32, y: i32, button: u8, reserved: u8) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(10);
    bytes.push(kind);
    bytes.extend_from_slice(&x.to_be_bytes());
    bytes.extend_from_slice(&y.to_be_bytes());
    bytes.push(button);
    bytes.push(reserved);
    bytes
}

fn read_xy(bytes: &[u8]) -> Result<(i32, i32, u8, u8), InputError> {
    if bytes.len() < 10 {
        return Err(InputError::Truncated);
    }
    let x = i32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]);
    let y = i32::from_be_bytes([bytes[5], bytes[6], bytes[7], bytes[8]]);
    Ok((x, y, bytes[9], 0))
}

fn encode_key(kind: u8, key_code: u32) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(5);
    bytes.push(kind);
    bytes.extend_from_slice(&key_code.to_be_bytes());
    bytes
}

fn read_key(bytes: &[u8]) -> Result<u32, InputError> {
    if bytes.len() < 5 {
        return Err(InputError::Truncated);
    }
    Ok(u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]))
}
