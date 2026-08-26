use crate::ethereum::{BASE_USDC, CHAIN_ID, PreparedTransfer, checksum_address};
use crate::protocol::{AgentResult, ErrorCode};

#[cfg(target_os = "macos")]
pub fn approve(intent: &PreparedTransfer) -> AgentResult<()> {
    use std::fs::OpenOptions;
    use std::io::{Read, Write};
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::OpenOptionsExt;

    let mut tty = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOCTTY | libc::O_CLOEXEC)
        .open("/dev/tty")
        .map_err(|_| ErrorCode::TtyUnavailable)?;
    let fd = tty.as_raw_fd();
    if unsafe { libc::isatty(fd) } != 1 {
        return Err(ErrorCode::TtyUnavailable);
    }
    let terminal_group = unsafe { libc::tcgetpgrp(fd) };
    if terminal_group <= 0 || terminal_group != unsafe { libc::getpgrp() } {
        return Err(ErrorCode::TtyNotForeground);
    }

    let phrase = intent.approval_phrase();
    let display = format!(
        "\nAgent Payment Node native approval\n\
         Profile: {}\n\
         Operation: {}\n\
         Chain: Base ({})\n\
         Token: {}\n\
         Sender: {}\n\
         Recipient: {}\n\
         Amount: {} USDC ({} atomic)\n\
         Nonce: {}\n\
         Gas limit: {}\n\
         Max fee per gas: {} wei\n\
         Max priority fee per gas: {} wei\n\
         Expires: {}\n\
         Fingerprint: {}\n\
         Type exactly: {}\n> ",
        intent.profile,
        intent.operation_id,
        CHAIN_ID,
        BASE_USDC,
        checksum_address(&intent.wallet_address),
        checksum_address(&intent.recipient),
        intent.amount_decimal,
        intent.amount_atomic,
        decimal_string(&intent.nonce),
        decimal_string(&intent.gas_limit),
        decimal_string(&intent.max_fee_per_gas),
        decimal_string(&intent.max_priority_fee_per_gas),
        intent.expires_at,
        intent.fingerprint,
        phrase,
    );
    tty.write_all(display.as_bytes())
        .and_then(|_| tty.flush())
        .map_err(|_| ErrorCode::TtyUnavailable)?;

    let mut line = Vec::with_capacity(96);
    let mut byte = [0_u8; 1];
    loop {
        wait_until_readable(fd, intent.expires_at_unix)?;
        let count = tty
            .read(&mut byte)
            .map_err(|_| ErrorCode::ApprovalRefused)?;
        if count == 0 {
            return Err(ErrorCode::ApprovalRefused);
        }
        if byte[0] == b'\n' {
            break;
        }
        if byte[0] == b'\r' || byte[0].is_ascii_control() || line.len() >= 127 {
            return Err(ErrorCode::ApprovalRefused);
        }
        line.push(byte[0]);
    }
    let supplied = std::str::from_utf8(&line).map_err(|_| ErrorCode::ApprovalRefused)?;
    verify_phrase(&phrase, supplied)?;
    intent.ensure_live(now_unix()?)
}

#[cfg(not(target_os = "macos"))]
pub fn approve(_intent: &PreparedTransfer) -> AgentResult<()> {
    Err(ErrorCode::TtyUnavailable)
}

fn decimal_string(value: &crate::ethereum::Uint256) -> String {
    let mut decimal = vec![0_u8];
    for byte in value.clone().to_be_bytes() {
        let mut carry = u16::from(byte);
        for digit in decimal.iter_mut().rev() {
            let next = u16::from(*digit) * 256 + carry;
            *digit = (next % 10) as u8;
            carry = next / 10;
        }
        while carry != 0 {
            decimal.insert(0, (carry % 10) as u8);
            carry /= 10;
        }
    }
    decimal
        .into_iter()
        .map(|digit| char::from(b'0' + digit))
        .collect()
}

fn verify_phrase(expected: &str, supplied: &str) -> AgentResult<()> {
    if supplied.as_bytes() == expected.as_bytes() {
        Ok(())
    } else {
        Err(ErrorCode::ApprovalRefused)
    }
}

#[cfg(target_os = "macos")]
fn wait_until_readable(fd: libc::c_int, expires_at_unix: i64) -> AgentResult<()> {
    loop {
        let now = now_unix()?;
        if now >= expires_at_unix {
            return Err(ErrorCode::Expired);
        }
        let remaining_ms = expires_at_unix
            .saturating_sub(now)
            .saturating_mul(1_000)
            .clamp(1, i64::from(i32::MAX)) as i32;
        let mut descriptor = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        let result = unsafe { libc::poll(&mut descriptor, 1, remaining_ms) };
        if result == 0 {
            return Err(ErrorCode::Expired);
        }
        if result < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(ErrorCode::TtyUnavailable);
        }
        if descriptor.revents & libc::POLLIN != 0 {
            return Ok(());
        }
        return Err(ErrorCode::ApprovalRefused);
    }
}

#[cfg(target_os = "macos")]
fn now_unix() -> AgentResult<i64> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ErrorCode::Internal)?;
    i64::try_from(duration.as_secs()).map_err(|_| ErrorCode::Internal)
}

#[cfg(test)]
pub(crate) fn approve_with_test_input(
    intent: &PreparedTransfer,
    supplied: &str,
) -> AgentResult<()> {
    verify_phrase(&intent.approval_phrase(), supplied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_never_accepts_partial_casefolded_or_whitespace_variants() {
        let expected = "APPROVE APN TRANSFER 0123456789abcdef";
        assert!(verify_phrase(expected, expected).is_ok());
        assert_eq!(
            verify_phrase(expected, "0123456789abcdef"),
            Err(ErrorCode::ApprovalRefused)
        );
        assert_eq!(
            verify_phrase(expected, "approve apn transfer 0123456789abcdef"),
            Err(ErrorCode::ApprovalRefused)
        );
        assert_eq!(
            verify_phrase(expected, "APPROVE APN TRANSFER 0123456789abcdef "),
            Err(ErrorCode::ApprovalRefused)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn expired_prompt_timeout_fails_before_reading() {
        assert_eq!(wait_until_readable(-1, 0), Err(ErrorCode::Expired));
    }
}
