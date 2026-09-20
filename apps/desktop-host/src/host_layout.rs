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

/// 对齐 h2 `.host`：padding 20 · 左栏 340 · gap 16 · 右栏弹性。
pub const MAIN_WIDTH: i32 = 900;
/// 空闲态贴齐卡片底；底行仅留给会话三钮（空闲不绘制）。
pub const MAIN_HEIGHT: i32 = 476;
pub const CONFIRM_WIDTH: i32 = 640;
pub const CONFIRM_HEIGHT: i32 = 560;

pub const LEFT_PANEL: Rect = Rect {
    left: 20,
    top: 20,
    right: 360,
    bottom: 420,
};
pub const RIGHT_STATUS: Rect = Rect {
    left: 376,
    top: 20,
    right: 880,
    bottom: 128,
};
pub const RIGHT_SWITCHES: Rect = Rect {
    left: 376,
    top: 140,
    right: 880,
    bottom: 276,
};
pub const RIGHT_FRAUD: Rect = Rect {
    left: 376,
    top: 288,
    right: 880,
    bottom: 420,
};

pub const LABEL_CODE: Rect = Rect::from_xywh(40, 40, 220, 18);
pub const VALUE_CODE: Rect = Rect::from_xywh(40, 64, 220, 34);
pub const LABEL_PASSWORD: Rect = Rect::from_xywh(40, 118, 220, 18);
pub const VALUE_PASSWORD: Rect = Rect::from_xywh(40, 142, 200, 32);
/// 与密码行留出呼吸距；宽度吃满左栏内边，避免「荐）。」孤行。
pub const PASSWORD_HINT: Rect = Rect::from_xywh(40, 186, 304, 52);

/// 开关贴左栏底部，消除大块空白。
pub const ACCEPT_SWITCH_TRACK: Rect = Rect::from_xywh(40, 372, 44, 26);
pub const ACCEPT_SWITCH_HIT: Rect = Rect::from_xywh(40, 368, 200, 36);
pub const ACCEPT_SWITCH_LABEL: Rect = Rect::from_xywh(94, 372, 220, 26);

pub const STATUS_TITLE: Rect = Rect::from_xywh(396, 36, 460, 22);
pub const STATUS_PILL: Rect = Rect::from_xywh(396, 66, 120, 22);
pub const STATUS_HINT: Rect = Rect::from_xywh(396, 96, 460, 24);

pub const SWITCHES_TITLE: Rect = Rect::from_xywh(396, 156, 460, 22);
pub const SWITCH_ROW_1: Rect = Rect::from_xywh(396, 188, 320, 24);
pub const SWITCH_ROW_2: Rect = Rect::from_xywh(396, 220, 320, 24);
pub const SWITCH_ROW_3: Rect = Rect::from_xywh(396, 252, 320, 24);
/// pill 右缘靠近右栏内边距（880 - 16 - pill宽）。
pub const SWITCH_ROW_PILL_OFFSET_X: i32 = 400;

pub const FRAUD_TITLE: Rect = Rect::from_xywh(396, 306, 460, 26);
pub const FRAUD_BODY: Rect = Rect::from_xywh(396, 338, 460, 60);

/// h2 `.btn` min-height=36。
pub const BTN_COPY: NativeButton = NativeButton {
    rect: Rect::from_xywh(276, 64, 68, 36),
};
pub const BTN_ROTATE: NativeButton = NativeButton {
    rect: Rect::from_xywh(276, 142, 68, 36),
};
pub const BTN_STOP: NativeButton = NativeButton {
    rect: Rect::from_xywh(376, 428, 120, DESKTOP_MIN_PX),
};
pub const BTN_VIEW_ONLY: NativeButton = NativeButton {
    rect: Rect::from_xywh(512, 428, 180, DESKTOP_MIN_PX),
};
pub const BTN_RESTORE_INPUT: NativeButton = NativeButton {
    rect: Rect::from_xywh(708, 428, 120, DESKTOP_MIN_PX),
};

/// 主界面可点动作（与布局矩形一一对应）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MainAction {
    Copy,
    Rotate,
    Stop,
    ViewOnly,
    RestoreInput,
}

pub fn hit_main_action(click_x: i32, click_y: i32, session_actions: bool) -> Option<MainAction> {
    if BTN_COPY.rect.contains(click_x, click_y) {
        return Some(MainAction::Copy);
    }
    if BTN_ROTATE.rect.contains(click_x, click_y) {
        return Some(MainAction::Rotate);
    }
    if !session_actions {
        return None;
    }
    if BTN_STOP.rect.contains(click_x, click_y) {
        return Some(MainAction::Stop);
    }
    if BTN_VIEW_ONLY.rect.contains(click_x, click_y) {
        return Some(MainAction::ViewOnly);
    }
    if BTN_RESTORE_INPUT.rect.contains(click_x, click_y) {
        return Some(MainAction::RestoreInput);
    }
    None
}

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
    fn 主界面五钮命中互斥() {
        assert_eq!(
            hit_main_action(BTN_COPY.rect.left + 2, BTN_COPY.rect.top + 2, true),
            Some(MainAction::Copy)
        );
        assert_eq!(
            hit_main_action(BTN_ROTATE.rect.left + 2, BTN_ROTATE.rect.top + 2, false),
            Some(MainAction::Rotate)
        );
        assert_eq!(
            hit_main_action(BTN_STOP.rect.left + 2, BTN_STOP.rect.top + 2, true),
            Some(MainAction::Stop)
        );
        assert_eq!(
            hit_main_action(BTN_VIEW_ONLY.rect.left + 2, BTN_VIEW_ONLY.rect.top + 2, true),
            Some(MainAction::ViewOnly)
        );
        assert_eq!(
            hit_main_action(BTN_RESTORE_INPUT.rect.left + 2, BTN_RESTORE_INPUT.rect.top + 2, true),
            Some(MainAction::RestoreInput)
        );
        assert_eq!(hit_main_action(BTN_STOP.rect.left + 2, BTN_STOP.rect.top + 2, false), None);
        assert_eq!(hit_main_action(0, 0, true), None);
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

    #[test]
    fn 主界面高度对齐_h2_host() {
        // 对照用户截图：h2 整窗约 506；客户区卡片底对齐，左栏无大块留白。
        assert_eq!(MAIN_HEIGHT, 476);
        assert_eq!(LEFT_PANEL.bottom, RIGHT_FRAUD.bottom);
        assert!(ACCEPT_SWITCH_TRACK.bottom <= LEFT_PANEL.bottom - 12);
        assert!(RIGHT_FRAUD.bottom < BTN_STOP.rect.top);
        assert!(BTN_STOP.rect.bottom <= MAIN_HEIGHT);
        assert_eq!(LEFT_PANEL.width(), 340);
        assert_eq!(RIGHT_STATUS.left - LEFT_PANEL.right, 16);
    }

    #[test]
    fn 临时密码与说明不挤在一起() {
        let gap = PASSWORD_HINT.top - VALUE_PASSWORD.bottom;
        assert!(gap >= 10, "密码与说明间距应 ≥ 10，实际 {gap}");
        assert!(PASSWORD_HINT.width() >= 300, "说明应尽量吃满左栏宽度");
        assert!(PASSWORD_HINT.right <= LEFT_PANEL.right - 12);
    }
}
