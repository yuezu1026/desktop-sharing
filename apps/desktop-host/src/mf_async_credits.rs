//! 异步 MFT 的 NeedInput 积分。纯状态，不碰 COM，方便单测。

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct AsyncInputCredits {
    available: u32,
}

impl AsyncInputCredits {
    pub fn new() -> Self {
        Self { available: 0 }
    }

    pub fn on_need_input(&mut self) {
        self.available = self.available.saturating_add(1);
    }

    pub fn available(&self) -> u32 {
        self.available
    }

    /// 有积分才允许 ProcessInput；成功则扣 1。
    pub fn try_take(&mut self) -> bool {
        if self.available == 0 {
            return false;
        }
        self.available -= 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cannot_take_without_credit() {
        let mut credits = AsyncInputCredits::new();
        assert!(!credits.try_take());
        assert_eq!(credits.available(), 0);
    }

    #[test]
    fn need_input_then_take() {
        let mut credits = AsyncInputCredits::new();
        credits.on_need_input();
        credits.on_need_input();
        assert_eq!(credits.available(), 2);
        assert!(credits.try_take());
        assert_eq!(credits.available(), 1);
        assert!(credits.try_take());
        assert!(!credits.try_take());
    }
}
