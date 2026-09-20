//! 控制面签发的 ticket 是不透明串。这里只拦明显不可用的形态，真伪由控制面验。

/// 与中继 hello 同一下限：短于此的串连过去也会被拒。
pub const MIN_TICKET_CHARS: usize = 20;
const MAX_TICKET_CHARS: usize = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TicketError {
    Empty,
    TooShort,
    TooLong,
    NotAscii,
}

/// 发给信令或中继之前，先看一眼是不是能用的串。
pub fn ticket_looks_usable(ticket: &str) -> Result<(), TicketError> {
    let trimmed = ticket.trim();
    if trimmed.is_empty() {
        return Err(TicketError::Empty);
    }
    if trimmed.len() < MIN_TICKET_CHARS {
        return Err(TicketError::TooShort);
    }
    if trimmed.len() > MAX_TICKET_CHARS {
        return Err(TicketError::TooLong);
    }
    if !trimmed.is_ascii() {
        return Err(TicketError::NotAscii);
    }
    Ok(())
}
