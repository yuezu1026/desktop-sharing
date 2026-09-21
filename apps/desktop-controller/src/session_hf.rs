//! 控制端会话窗文案契约，对齐高保真 h1 / W1-03 事实行。
//! 直连与中继两句都必须有；本层不写购买 / 会员。

#![allow(dead_code)]

/// 事实行主句（h1：直连绿语义 / 中继琥珀语义由绘制层上色）。
pub fn fact_title(link_direct: bool) -> &'static str {
    if link_direct {
        "本次连接：直连"
    } else {
        "本次连接：中继"
    }
}

/// 事实行副句：是否消耗免费中继时长。
pub fn fact_detail(link_direct: bool) -> &'static str {
    if link_direct {
        "不消耗免费中继时长"
    } else {
        "在消耗免费中继时长"
    }
}

#[cfg(test)]
mod tests {
    use super::{fact_detail, fact_title};

    #[test]
    fn 事实行直连与中继两句都有() {
        assert_eq!(fact_title(true), "本次连接：直连");
        assert_eq!(fact_detail(true), "不消耗免费中继时长");
        assert_eq!(fact_title(false), "本次连接：中继");
        assert_eq!(fact_detail(false), "在消耗免费中继时长");
        assert!(fact_detail(true).contains("不消耗"));
        assert!(fact_detail(false).contains("在消耗"));
    }

    #[test]
    fn 事实行不含购买会员() {
        for link_direct in [true, false] {
            let joined = format!("{} {}", fact_title(link_direct), fact_detail(link_direct));
            for forbidden in ["购买", "会员", "开通", "升级", "¥"] {
                assert!(!joined.contains(forbidden), "{joined} 含禁词 {forbidden}");
            }
        }
    }
}
