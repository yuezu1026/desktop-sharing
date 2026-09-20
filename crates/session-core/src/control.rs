//! 会话控制载荷。不含画面与键鼠。

pub const CONTROL_REQUEST_KEYFRAME: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlMessage {
    RequestKeyframe,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlError {
    Truncated,
    UnknownKind,
}

pub fn encode_control(message: ControlMessage) -> Vec<u8> {
    match message {
        ControlMessage::RequestKeyframe => vec![CONTROL_REQUEST_KEYFRAME],
    }
}

pub fn decode_control(bytes: &[u8]) -> Result<ControlMessage, ControlError> {
    if bytes.is_empty() {
        return Err(ControlError::Truncated);
    }
    match bytes[0] {
        CONTROL_REQUEST_KEYFRAME => Ok(ControlMessage::RequestKeyframe),
        _ => Err(ControlError::UnknownKind),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_keyframe_roundtrip() {
        let bytes = encode_control(ControlMessage::RequestKeyframe);
        assert_eq!(bytes, vec![1]);
        assert_eq!(
            decode_control(&bytes).expect("decode"),
            ControlMessage::RequestKeyframe
        );
    }

    #[test]
    fn rejects_unknown() {
        assert_eq!(decode_control(&[9]), Err(ControlError::UnknownKind));
        assert_eq!(decode_control(&[]), Err(ControlError::Truncated));
    }
}
