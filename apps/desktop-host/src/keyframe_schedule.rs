//! 关键帧调度。首帧必出，之后按周期请求，方便控制端中途入会起解。

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyframeSchedule {
    period: u32,
    frame_index: u64,
}

impl KeyframeSchedule {
    /// `period == 0` 时只强制首帧。
    pub fn new(period: u32) -> Self {
        Self {
            period,
            frame_index: 0,
        }
    }

    pub fn should_force(&self) -> bool {
        if self.frame_index == 0 {
            return true;
        }
        if self.period == 0 {
            return false;
        }
        self.frame_index % u64::from(self.period) == 0
    }

    pub fn advance(&mut self) {
        self.frame_index = self.frame_index.saturating_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_frame_always_forced() {
        let schedule = KeyframeSchedule::new(45);
        assert!(schedule.should_force());
    }

    #[test]
    fn period_45_forces_on_multiples() {
        let mut schedule = KeyframeSchedule::new(45);
        assert!(schedule.should_force());
        schedule.advance();
        for _ in 1..45 {
            assert!(!schedule.should_force());
            schedule.advance();
        }
        assert!(schedule.should_force());
    }

    #[test]
    fn zero_period_only_first() {
        let mut schedule = KeyframeSchedule::new(0);
        assert!(schedule.should_force());
        schedule.advance();
        assert!(!schedule.should_force());
        schedule.advance();
        assert!(!schedule.should_force());
    }
}
