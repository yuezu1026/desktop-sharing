//! 被控端文案与结构契约，对齐高保真 h2 / W2-01 / W2-02。
//! 界面禁止出现金额、余额、充值、会员。

#![allow(dead_code)]

pub const WINDOW_TITLE: &str = "远程桌面 · 本机";

pub const LABEL_DEVICE_CODE: &str = "本机识别码";
pub const LABEL_TEMP_PASSWORD: &str = "临时密码";
pub const PASSWORD_HINT: &str = "每次连接后自动更换；也可设为固定密码（不推荐）。";
pub const SWITCH_ALLOW: &str = "允许被连接";

pub const STATUS_TITLE: &str = "当前状态";
pub const STATUS_IDLE_HINT: &str = "现在没有人在看你的屏幕。";
pub const STATUS_IDLE_PILL: &str = "未被连接";

pub const SWITCHES_TITLE: &str = "常用开关";
pub const SWITCH_AUTO_START: &str = "开机自动启动";
pub const SWITCH_IDLE_ZERO: &str = "空闲时近零占用";
pub const SWITCH_RESOURCE: &str = "资源档位";
pub const SWITCH_ON: &str = "开";
pub const SWITCH_BALANCED: &str = "均衡";

pub const FRAUD_TITLE: &str = "只把识别码和密码告诉你信任的人";
pub const FRAUD_BODY: &str = "任何人以「客服 / 公检法需要看屏幕」为由索要，都是诈骗。";

pub const CONFIRM_TITLE: &str = "有人请求控制本设备";
pub const CONFIRM_CAN_LABEL: &str = "允许后，对方可以";
pub const CONFIRM_CAN_SEE: &str = "看到你屏幕上的所有内容";
pub const CONFIRM_CAN_INPUT: &str = "操作你的鼠标与键盘";
pub const CONFIRM_CAN_FILES: &str = "在你允许时传输文件";
pub const CONFIRM_FRAUD_TITLE: &str = "请确认你认识对方";
pub const CONFIRM_FRAUD_1: &str = "你正在允许对方控制本设备。";
pub const CONFIRM_FRAUD_2: &str = "对方能看到并操作你屏幕上的一切。";
pub const CONFIRM_FRAUD_3: &str = "不要向陌生人开启。自称客服或公检法、要求打开屏幕的，都是诈骗。";
pub const CONFIRM_ALLOW: &str = "允许本次";
pub const CONFIRM_REFUSE: &str = "拒绝";
pub const PILL_FIRST: &str = "首次连接";
pub const PILL_AGAIN: &str = "再次连接";

/// 确认页键盘：回车/Esc 一律拒绝，不得当成同意。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfirmKeyAction {
    Refuse,
}

pub fn confirm_key_action(virtual_key: u16) -> Option<ConfirmKeyAction> {
    const VIRTUAL_KEY_RETURN: u16 = 0x0d;
    const VIRTUAL_KEY_ESCAPE: u16 = 0x1b;
    if virtual_key == VIRTUAL_KEY_RETURN || virtual_key == VIRTUAL_KEY_ESCAPE {
        Some(ConfirmKeyAction::Refuse)
    } else {
        None
    }
}

pub const BTN_COPY: &str = "复制";
pub const BTN_ROTATE: &str = "换一个";
pub const BTN_STOP: &str = "停止被控";
pub const BTN_VIEW_ONLY: &str = "仅查看（停键鼠）";
pub const BTN_RESTORE_INPUT: &str = "恢复键鼠";

pub const TRAY_ACCEPTING: &str = "可被连接";
pub const TRAY_NOT_ACCEPTING: &str = "不允许被连接";
pub const TRAY_COPY_CODE: &str = "复制本机识别码";
pub const TRAY_OPEN: &str = "打开主界面";
/// W2-09：托盘「一键断开」与「退出」必须是两个菜单项。
pub const TRAY_DISCONNECT: &str = "一键断开";
pub const TRAY_EXIT: &str = "退出";

/// 仅会话进行中可点托盘断开；空闲态灰掉，不得与退出合并。
pub fn tray_disconnect_enabled(status_line: &str) -> bool {
    session_actions_visible(status_line)
}

/// 界面文案不得包含的催费词。
pub const FORBIDDEN_BILLING: &[&str] = &["余额", "充值", "会员", "开通", "¥", "元/月"];

pub fn confirm_can_lines() -> [&'static str; 3] {
    [CONFIRM_CAN_SEE, CONFIRM_CAN_INPUT, CONFIRM_CAN_FILES]
}

pub fn confirm_fraud_lines() -> [&'static str; 3] {
    [CONFIRM_FRAUD_1, CONFIRM_FRAUD_2, CONFIRM_FRAUD_3]
}

pub fn format_controller_line(phone_mask: &str) -> String {
    let mask = phone_mask.trim();
    if mask.is_empty() {
        "账号 未知".to_string()
    } else {
        format!("账号 {mask}")
    }
}

/// 确认页副行：服务端暂无控制端机型/城市时，用跨账号语义占位，不得编造机型。
pub fn format_device_note(cross_account: bool) -> String {
    if cross_account {
        "跨账号请求 · 请确认你认识对方".to_string()
    } else {
        "同账号请求".to_string()
    }
}

pub fn connection_pill(first_connection: bool) -> &'static str {
    if first_connection {
        PILL_FIRST
    } else {
        PILL_AGAIN
    }
}

pub fn find_forbidden_billing(text: &str) -> Vec<&'static str> {
    FORBIDDEN_BILLING
        .iter()
        .copied()
        .filter(|word| text.contains(word))
        .collect()
}

/// 主界面绘制快照：会话层组装，chrome 只渲染。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostMainView {
    pub code_text: String,
    pub password_text: String,
    pub accepting: bool,
    pub status_pill: String,
    pub status_hint: String,
    /// W2-01 空闲等待页不展示会话三钮；仅会话进行中才为 true。
    pub show_session_actions: bool,
}

/// 确认页绘制快照。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostConfirmView {
    pub controller_line: String,
    pub first_connection: bool,
    pub device_note: String,
}

/// 停止被控 / 仅查看 / 恢复键鼠：仅会话进行中出现。
pub fn session_actions_visible(status_line: &str) -> bool {
    status_line.contains("已被连接") || status_line.contains("仅查看")
}

pub fn build_main_view(
    code_text: impl Into<String>,
    password_text: impl Into<String>,
    accepting: bool,
    status_line: &str,
    input_allowed: bool,
) -> HostMainView {
    let idle = status_line.contains("未被连接");
    let status_pill = if idle {
        STATUS_IDLE_PILL.to_string()
    } else if status_line.contains("不允许被连接") {
        "不允许被连接".to_string()
    } else {
        status_line.to_string()
    };
    let status_hint = if idle {
        STATUS_IDLE_HINT.to_string()
    } else if status_line.contains("不允许被连接") {
        "已关闭被连接。".to_string()
    } else if input_allowed {
        "对方可以操作你的键鼠。".to_string()
    } else {
        "仅查看中：对方键鼠已停。".to_string()
    };
    HostMainView {
        code_text: code_text.into(),
        password_text: password_text.into(),
        accepting,
        status_pill,
        status_hint,
        show_session_actions: session_actions_visible(status_line),
    }
}

pub fn build_confirm_view(
    phone_mask: &str,
    first_connection: bool,
    cross_account: bool,
) -> HostConfirmView {
    HostConfirmView {
        controller_line: format_controller_line(phone_mask),
        first_connection,
        device_note: format_device_note(cross_account),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 主界面文案无金额() {
        let joined = [
            LABEL_DEVICE_CODE,
            LABEL_TEMP_PASSWORD,
            PASSWORD_HINT,
            SWITCH_ALLOW,
            STATUS_TITLE,
            STATUS_IDLE_HINT,
            SWITCHES_TITLE,
            FRAUD_TITLE,
            FRAUD_BODY,
        ]
        .join("\n");
        assert!(find_forbidden_billing(&joined).is_empty());
    }

    #[test]
    fn 确认页文案结构() {
        assert_eq!(CONFIRM_TITLE, "有人请求控制本设备");
        assert_eq!(CONFIRM_REFUSE, "拒绝");
        assert_eq!(CONFIRM_ALLOW, "允许本次");
        assert_eq!(confirm_can_lines().len(), 3);
        assert_eq!(confirm_fraud_lines().len(), 3);
        assert!(find_forbidden_billing(&confirm_fraud_lines().join("")).is_empty());
    }

    #[test]
    fn 确认页回车与Esc一律拒绝() {
        assert_eq!(confirm_key_action(0x0d), Some(ConfirmKeyAction::Refuse));
        assert_eq!(confirm_key_action(0x1b), Some(ConfirmKeyAction::Refuse));
        assert_eq!(confirm_key_action(0x20), None);
        assert_eq!(confirm_key_action(0x41), None);
    }

    #[test]
    fn 身份行与首次连接标签() {
        assert_eq!(format_controller_line("139****9000"), "账号 139****9000");
        assert_eq!(connection_pill(true), "首次连接");
        assert_eq!(connection_pill(false), "再次连接");
    }

    #[test]
    fn 主界面快照空闲态() {
        let view = build_main_view("123 456 789", "abcd1234", true, "未被连接", true);
        assert_eq!(view.status_pill, STATUS_IDLE_PILL);
        assert_eq!(view.status_hint, STATUS_IDLE_HINT);
        assert!(!view.show_session_actions);
        assert!(find_forbidden_billing(&view.status_hint).is_empty());
    }

    #[test]
    fn 会话态才展示底栏三钮() {
        assert!(!session_actions_visible("未被连接"));
        assert!(!session_actions_visible("不允许被连接"));
        assert!(!session_actions_visible("有人请求控制"));
        assert!(session_actions_visible("已被连接"));
        assert!(session_actions_visible("仅查看中"));
        let connected = build_main_view("1", "p", true, "已被连接", true);
        assert!(connected.show_session_actions);
    }

    #[test]
    fn 托盘断开与退出是两项() {
        assert_ne!(TRAY_DISCONNECT, TRAY_EXIT);
        assert!(!TRAY_DISCONNECT.contains("退出"));
        assert!(!TRAY_EXIT.contains("断开"));
        assert!(!tray_disconnect_enabled("未被连接"));
        assert!(tray_disconnect_enabled("已被连接"));
        assert!(tray_disconnect_enabled("仅查看中"));
    }

    #[test]
    fn 确认页快照组装() {
        let view = build_confirm_view("139****9000", true, false);
        assert_eq!(view.controller_line, "账号 139****9000");
        assert!(view.first_connection);
        assert_eq!(view.device_note, "同账号请求");
        let cross = build_confirm_view("139****9000", false, true);
        assert_eq!(cross.device_note, "跨账号请求 · 请确认你认识对方");
        assert!(!cross.first_connection);
    }
}
