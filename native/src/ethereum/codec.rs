use super::{AgentResult, ErrorCode, Uint256};

pub(super) struct DecodedSigned {
    pub(super) fields: Vec<Vec<u8>>,
    pub(super) payloads: Vec<Vec<u8>>,
}

pub(super) fn decode_signed(raw: &[u8]) -> AgentResult<DecodedSigned> {
    if raw.first() != Some(&0x02) {
        return Err(ErrorCode::InvalidTransaction);
    }
    let (list_payload, consumed, is_list) = decode_rlp_item(&raw[1..])?;
    if !is_list || consumed != raw.len() - 1 {
        return Err(ErrorCode::InvalidTransaction);
    }
    let mut offset = 0;
    let mut fields = Vec::with_capacity(12);
    let mut payloads = Vec::with_capacity(12);
    while offset < list_payload.len() {
        let (payload, length, nested) = decode_rlp_item(&list_payload[offset..])?;
        if nested && fields.len() != 8 {
            return Err(ErrorCode::InvalidTransaction);
        }
        if !nested && fields.len() == 8 {
            return Err(ErrorCode::InvalidTransaction);
        }
        fields.push(list_payload[offset..offset + length].to_vec());
        payloads.push(payload.to_vec());
        offset += length;
    }
    if fields.len() != 12 {
        return Err(ErrorCode::InvalidTransaction);
    }
    Ok(DecodedSigned { fields, payloads })
}

fn decode_rlp_item(data: &[u8]) -> AgentResult<(&[u8], usize, bool)> {
    let first = *data.first().ok_or(ErrorCode::InvalidTransaction)?;
    match first {
        0x00..=0x7f => Ok((&data[..1], 1, false)),
        0x80..=0xb7 => {
            let length = usize::from(first - 0x80);
            let total = 1 + length;
            if data.len() < total || (length == 1 && data[1] < 0x80) {
                return Err(ErrorCode::InvalidTransaction);
            }
            Ok((&data[1..total], total, false))
        }
        0xb8..=0xbf => {
            let len_of_len = usize::from(first - 0xb7);
            let length = decode_length(&data[1..], len_of_len)?;
            let total = 1 + len_of_len + length;
            if length < 56 || data.len() < total {
                return Err(ErrorCode::InvalidTransaction);
            }
            Ok((&data[1 + len_of_len..total], total, false))
        }
        0xc0..=0xf7 => {
            let length = usize::from(first - 0xc0);
            let total = 1 + length;
            if data.len() < total {
                return Err(ErrorCode::InvalidTransaction);
            }
            Ok((&data[1..total], total, true))
        }
        0xf8..=0xff => {
            let len_of_len = usize::from(first - 0xf7);
            let length = decode_length(&data[1..], len_of_len)?;
            let total = 1 + len_of_len + length;
            if length < 56 || data.len() < total {
                return Err(ErrorCode::InvalidTransaction);
            }
            Ok((&data[1 + len_of_len..total], total, true))
        }
    }
}

fn decode_length(data: &[u8], count: usize) -> AgentResult<usize> {
    if count == 0 || count > std::mem::size_of::<usize>() || data.len() < count || data[0] == 0 {
        return Err(ErrorCode::InvalidTransaction);
    }
    let mut output = 0_usize;
    for byte in &data[..count] {
        output = output
            .checked_mul(256)
            .and_then(|value| value.checked_add(usize::from(*byte)))
            .ok_or(ErrorCode::InvalidTransaction)?;
    }
    Ok(output)
}

pub(super) fn decode_small_uint(bytes: &[u8]) -> AgentResult<u64> {
    if bytes.len() > 8 || (bytes.len() > 1 && bytes[0] == 0) {
        return Err(ErrorCode::InvalidTransaction);
    }
    let mut output = 0_u64;
    for byte in bytes {
        output = (output << 8) | u64::from(*byte);
    }
    Ok(output)
}

pub(super) fn uint_from_rlp(bytes: &[u8]) -> AgentResult<Uint256> {
    if bytes.len() > 32 || (bytes.len() > 1 && bytes[0] == 0) {
        return Err(ErrorCode::InvalidTransaction);
    }
    let mut output = [0_u8; 32];
    output[32 - bytes.len()..].copy_from_slice(bytes);
    Ok(Uint256(output))
}

pub(super) fn rlp_uint(value: &Uint256) -> Vec<u8> {
    rlp_bytes(value.significant_bytes())
}

pub(super) fn rlp_u64(value: u64) -> Vec<u8> {
    rlp_uint(&Uint256::from_u64(value))
}

pub(super) fn rlp_bytes(bytes: &[u8]) -> Vec<u8> {
    if bytes.len() == 1 && bytes[0] < 0x80 {
        return bytes.to_vec();
    }
    let mut output = rlp_prefix(bytes.len(), 0x80, 0xb7);
    output.extend_from_slice(bytes);
    output
}

pub(super) fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let length = items.iter().map(Vec::len).sum();
    let mut output = rlp_prefix(length, 0xc0, 0xf7);
    for item in items {
        output.extend_from_slice(item);
    }
    output
}

fn rlp_prefix(length: usize, short_base: u8, long_base: u8) -> Vec<u8> {
    if length < 56 {
        return vec![short_base + length as u8];
    }
    let length_bytes = length.to_be_bytes();
    let bytes = strip_leading_zeroes(&length_bytes);
    let mut output = Vec::with_capacity(1 + bytes.len());
    output.push(long_base + bytes.len() as u8);
    output.extend_from_slice(bytes);
    output
}

pub(super) fn strip_leading_zeroes(bytes: &[u8]) -> &[u8] {
    &bytes[bytes
        .iter()
        .position(|byte| *byte != 0)
        .unwrap_or(bytes.len())..]
}

pub fn parse_address(value: &str) -> AgentResult<[u8; 20]> {
    let bytes = decode_prefixed_hex(value, 20)?;
    bytes.try_into().map_err(|_| ErrorCode::InvalidTransaction)
}

pub fn decode_prefixed_hex(value: &str, exact_bytes: usize) -> AgentResult<Vec<u8>> {
    if value.len() != 2 + exact_bytes * 2 || !value.starts_with("0x") {
        return Err(ErrorCode::InvalidTransaction);
    }
    let mut output = Vec::with_capacity(exact_bytes);
    for pair in value.as_bytes()[2..].chunks_exact(2) {
        output.push((hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?);
    }
    Ok(output)
}

fn hex_nibble(byte: u8) -> AgentResult<u8> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(ErrorCode::InvalidTransaction),
    }
}

pub fn prefixed_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex_encode(bytes))
}

pub fn hex_encode(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[usize::from(byte >> 4)] as char);
        output.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    output
}

pub(super) fn is_hash64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(super) fn validate_amount_decimal(value: &str, amount: &Uint256) -> AgentResult<()> {
    let mut parts = value.split('.');
    let whole = parts.next().ok_or(ErrorCode::InvalidTransaction)?;
    let fraction = parts.next();
    if parts.next().is_some()
        || whole.is_empty()
        || (whole.len() > 1 && whole.starts_with('0'))
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(ErrorCode::InvalidTransaction);
    }
    let fraction = fraction.unwrap_or("");
    if fraction.len() > 6
        || (!fraction.is_empty()
            && (!fraction.bytes().all(|byte| byte.is_ascii_digit()) || fraction.ends_with('0')))
    {
        return Err(ErrorCode::InvalidTransaction);
    }
    let mut atomic = String::from(whole);
    atomic.push_str(fraction);
    atomic.extend(std::iter::repeat_n('0', 6 - fraction.len()));
    let canonical = atomic.trim_start_matches('0');
    let canonical = if canonical.is_empty() { "0" } else { canonical };
    if Uint256::parse_decimal(canonical)? == *amount {
        Ok(())
    } else {
        Err(ErrorCode::InvalidTransaction)
    }
}

pub fn parse_rfc3339_utc(value: &str) -> AgentResult<i64> {
    if !(value.len() == 20 || value.len() == 24)
        || &value[4..5] != "-"
        || &value[7..8] != "-"
        || &value[10..11] != "T"
        || &value[13..14] != ":"
        || &value[16..17] != ":"
        || !value.ends_with('Z')
        || (value.len() == 24 && &value[19..20] != ".")
    {
        return Err(ErrorCode::Expired);
    }
    let year = parse_component(&value[0..4])?;
    let month = parse_component(&value[5..7])?;
    let day = parse_component(&value[8..10])?;
    let hour = parse_component(&value[11..13])?;
    let minute = parse_component(&value[14..16])?;
    let second = parse_component(&value[17..19])?;
    if value.len() == 24 && !value[20..23].bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(ErrorCode::Expired);
    }
    if !(1..=12).contains(&month)
        || day < 1
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return Err(ErrorCode::Expired);
    }
    let days = days_from_civil(year, month, day);
    days.checked_mul(86_400)
        .and_then(|base| base.checked_add(hour * 3_600 + minute * 60 + second))
        .ok_or(ErrorCode::Expired)
}

fn parse_component(value: &str) -> AgentResult<i64> {
    if !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(ErrorCode::Expired);
    }
    value.parse().map_err(|_| ErrorCode::Expired)
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    }
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let adjusted_year = year - i64::from(month <= 2);
    let era = if adjusted_year >= 0 {
        adjusted_year
    } else {
        adjusted_year - 399
    } / 400;
    let year_of_era = adjusted_year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

pub fn format_rfc3339_utc(timestamp: i64) -> AgentResult<String> {
    let days = timestamp.div_euclid(86_400);
    let seconds = timestamp.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    if !(0..=9_999).contains(&year) {
        return Err(ErrorCode::Internal);
    }
    let hour = seconds / 3_600;
    let minute = (seconds % 3_600) / 60;
    let second = seconds % 60;
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.000Z"
    ))
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}
