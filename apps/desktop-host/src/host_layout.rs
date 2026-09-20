//! 被控端布局单一来源。
//! 绘制、命中检测、原生子按钮创建都必须读这里的矩形，禁止在调用方另写坐标。

#![allow(dead_code)]

use crate::ui_theme::DESKTOP_MIN_PX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub const fn from_xywh(left: i32, top: i32, width: i32, height: i32) -> Self {
        Self {
            left,
            top,
            right: left + width,
            bottom: top + height,
        }
    }

    pub const fn width(self) -> i32 {
        self.right - self.left
    }

    pub const fn height(self) -> i32 {
        self.bottom - self.top
    }

    pub const fn contains(self, click_x: i32, click_y: i32) -> bool {
        click_x >= self.left && click_x < self.right && click_y >= self.top && click_y < self.bottom
    }
}

/// 原生子按钮：几何唯一，文案由调用方挂 `host_hf` 标签。
#[derive(Clone, Copy, Debug)]
pub struct NativeButton {
    pub rect: Rect,
}

pub const MAIN_WIDTH: i32 = 920;
pub const MAIN_HEIGHT: i32 = 640;
pub const CONFIRM_WIDTH: i32 = 640;
pub const CONFIRM_HEIGHT: i32 = 560;

pub const LEFT_PANEL: Rect = Rect {
    left: 20,
    top: 20,
    right: 340,
    bottom: 560,
};
pub const RIGHT_STATUS: Rect = Rect {
    left: 360,
    top: 20,
    right: 880,
    bottom: 160,
};
pub const RIGHT_SWITCHES: Rect = Rect {
    left: 360,
    top: 176,
    right: 880,
    bottom: 330,
};
pub const RIGHT_FRAUD: Rect = Rect {
    left: 360,
    top: 346,
    right: 880,
    bottom: 470,
};

pub const LABEL_CODE: Rect = Rect::from_xywh(40, 36, 280, 22);
pub const VALUE_CODE: Rect = Rect::from_xywh(40, 64, 170, 36);
pub const LABEL_PASSWORD: Rect = Rect::from_xywh(40, 126, 280, 22);
pub const VALUE_PASSWORD: Rect = Rect::from_xywh(40, 154, 170, 30);
pub const PASSWORD_HINT: Rect = Rect::from_xywh(40, 196, 280, 56);

pub const ACCEPT_SWITCH_TRACK: Rect = Rect::from_xywh(40, 300, 48, 26);
pub const ACCEPT_SWITCH_HIT: Rect = Rect::from_xywh(40, 300, 180, 40);
pub const ACCEPT_SWITCH_LABEL: Rect = Rect::from_xywh(96, 302, 180, 24);

pub const STATUS_TITLE: Rect = Rect::from_xywh(380, 36, 460, 24);
pub const STATUS_PILL: Rect = Rect::from_xywh(380, 72, 120, 28);
pub const STATUS_HINT: Rect = Rect::from_xywh(380, 112, 460, 36);

pub const SWITCHES_TITLE: Rect = Rect::from_xywh(380, 192, 460, 24);
pub const SWITCH_ROW_1: Rect = Rect::from_xywh(380, 228, 460, 24);
pub const SWITCH_ROW_2: Rect = Rect::from_xywh(380, 262, 460, 24);
pub const SWITCH_ROW_3: Rect = Rect::from_xywh(380, 296, 460, 24);
pub const SWITCH_ROW_PILL_OFFSET_X: i32 = 400;

pub const FRAUD_TITLE: Rect = Rect::from_xywh(380, 362, 460, 28);
pub const FRAUD_BODY: Rect = Rect::from_xywh(380, 398, 460, 56);

pub const BTN_COPY: NativeButton = NativeButton {
    rect: Rect::from_xywh(220, 78, 90, DESKTOP_MIN_PX),
};
pub const BTN_ROTATE: NativeButton = NativeButton {
    rect: Rect::from_xywh(220, 168, 90, DESKTOP_MIN_PX),
};
pub const BTN_STOP: NativeButton = NativeButton {
    rect: Rect::from_xywh(360, 490, 120, DESKTOP_MIN_PX),
};
pub const BTN_VIEW_ONLY: NativeButton = NativeButton {
    rect: Rect::from_xywh(500, 490, 180, DESKTOP_MIN_PX),
};
pub const BTN_RESTORE_INPUT: NativeButton = NativeButton {
    rect: Rect::from_xywh(700, 490, 120, DESKTOP_MIN_PX),
};

pub const CONFIRM_CARD: Rect = Rect {
    left: 20,
    top: 20,
    right: 600,
    bottom: 430,
};
pub const CONFIRM_TITLE: Rect = Rect::from_xywh(40, 36, 540, 32);
pub const CONFIRM_AVATAR: Rect = Rect::from_xywh(40, 84, 44, 44);
pub const CONFIRM_WHO: Rect = Rect::from_xywh(100, 84, 340, 24);
pub const CONFIRM_DEVICE_NOTE: Rect = Rect::from_xywh(100, 112, 340, 24);
pub const CONFIRM_PILL: Rect = Rect::from_xywh(450, 92, 120, 28);
pub const CONFIRM_CAN_LABEL: Rect = Rect::from_xywh(40, 156, 540, 22);
pub const CONFIRM_CAN_FIRST: Rect = Rect::from_xywh(40, 186, 540, 22);
pub const CONFIRM_CAN_LINE_STEP: i32 = 24;
pub const CONFIRM_FRAUD_PANEL: Rect = Rect {
    left: 40,
    top: 270,
    right: 580,
    bottom: 420,
};
pub const CONFIRM_FRAUD_TITLE: Rect = Rect::from_xywh(56, 284, 500, 24);
pub const CONFIRM_FRAUD_FIRST: Rect = Rect::from_xywh(56, 318, 500, 28);
pub const CONFIRM_FRAUD_LINE_STEP: i32 = 30;

pub const CONFIRM_ALLOW: NativeButton = NativeButton {
    rect: Rect::from_xywh(40, 460, 160, DESKTOP_MIN_PX),
};
pub const CONFIRM_REFUSE: NativeButton = NativeButton {
    rect: Rect::from_xywh(220, 460, 160, DESKTOP_MIN_PX),
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 主界面按钮互不重叠() {
        let buttons = [
            BTN_COPY.rect,
            BTN_ROTATE.rect,
            BTN_STOP.rect,
            BTN_VIEW_ONLY.rect,
            BTN_RESTORE_INPUT.rect,
        ];
        for (index, left) in buttons.iter().enumerate() {
            for right in buttons.iter().skip(index + 1) {
                let overlap_x = left.left < right.right && right.left < left.right;
                let overlap_y = left.top < right.bottom && right.top < left.bottom;
                assert!(!(overlap_x && overlap_y), "按钮矩形重叠: {:?} vs {:?}", left, right);
            }
        }
    }

    #[test]
    fn 确认页允许与拒绝命中互斥() {
        let sample_x = CONFIRM_ALLOW.rect.left + 10;
        let sample_y = CONFIRM_ALLOW.rect.top + 10;
        assert!(CONFIRM_ALLOW.rect.contains(sample_x, sample_y));
        assert!(!CONFIRM_REFUSE.rect.contains(sample_x, sample_y));
    }

    #[test]
    fn 开关命中区覆盖轨道() {
        assert!(ACCEPT_SWITCH_HIT.contains(ACCEPT_SWITCH_TRACK.left + 2, ACCEPT_SWITCH_TRACK.top + 2));
        assert!(!ACCEPT_SWITCH_HIT.contains(ACCEPT_SWITCH_HIT.left - 1, ACCEPT_SWITCH_TRACK.top + 2));
    }
}
