use crate::protocol::{AgentResult, ApproveAndSignPayload, EffectResult, ErrorCode};
use secp256k1::{PublicKey, Secp256k1, SecretKey};
use serde_json::json;
use sha2::Sha256;
use sha3::{Digest, Keccak256};
use zeroize::Zeroizing;

pub const CHAIN_ID: u64 = 8453;
pub const PROFILE: &str = "default";
pub const BASE_USDC: &str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
pub const TRANSFER_SELECTOR: [u8; 4] = [0xa9, 0x05, 0x9c, 0xbb];
const MIN_GAS_LIMIT: u64 = 21_000;
const MAX_GAS_LIMIT: u64 = 200_000;
const MAX_FEE_PER_GAS: u64 = 1_000_000_000_000;
const MAX_APPROVAL_WINDOW_SECONDS: i64 = 600;
const HALF_CURVE_ORDER: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Uint256([u8; 32]);

impl Uint256 {
    pub fn parse_decimal(value: &str) -> AgentResult<Self> {
        if value.is_empty()
            || value.len() > 78
            || (value.len() > 1 && value.starts_with('0'))
            || !value.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(ErrorCode::InvalidTransaction);
        }
        let mut output = [0_u8; 32];
        for digit in value.bytes() {
            let mut carry = u16::from(digit - b'0');
            for byte in output.iter_mut().rev() {
                let next = u16::from(*byte) * 10 + carry;
                *byte = next as u8;
                carry = next >> 8;
            }
            if carry != 0 {
                return Err(ErrorCode::InvalidTransaction);
            }
        }
        Ok(Self(output))
    }

    pub fn from_u64(value: u64) -> Self {
        let mut bytes = [0_u8; 32];
        bytes[24..].copy_from_slice(&value.to_be_bytes());
        Self(bytes)
    }

    pub fn is_zero(&self) -> bool {
        self.0.iter().all(|byte| *byte == 0)
    }

    pub fn fits_u64(&self) -> Option<u64> {
        if self.0[..24].iter().any(|byte| *byte != 0) {
            return None;
        }
        Some(u64::from_be_bytes(self.0[24..].try_into().ok()?))
    }

    pub(crate) fn to_be_bytes(&self) -> [u8; 32] {
        self.0
    }

    pub(crate) fn significant_bytes(&self) -> &[u8] {
        let first = self.0.iter().position(|byte| *byte != 0).unwrap_or(32);
        &self.0[first..]
    }
}

#[derive(Clone, Debug)]
pub struct PreparedTransfer {
    pub profile: String,
    pub operation_id: String,
    pub fingerprint: String,
    pub wallet_address: [u8; 20],
    pub recipient: [u8; 20],
    pub amount: Uint256,
    pub amount_atomic: String,
    pub amount_decimal: String,
    pub expires_at: String,
    pub expires_at_unix: i64,
    pub nonce: Uint256,
    pub gas_limit: Uint256,
    pub max_fee_per_gas: Uint256,
    pub max_priority_fee_per_gas: Uint256,
    pub calldata: Vec<u8>,
}

pub struct SignedMaterial {
    pub raw: Zeroizing<Vec<u8>>,
    pub transaction_hash: [u8; 32],
    pub raw_transaction_hash: [u8; 32],
    pub sender: [u8; 20],
}

impl SignedMaterial {
    pub fn response(&self) -> EffectResult {
        EffectResult {
            transaction_hash: prefixed_hex(&self.transaction_hash),
            raw_transaction: Zeroizing::new(prefixed_hex(&self.raw)),
            raw_transaction_hash: prefixed_hex(&self.raw_transaction_hash),
        }
    }
}

impl PreparedTransfer {
    pub fn validate(payload: ApproveAndSignPayload, now_unix: i64) -> AgentResult<Self> {
        validate_profile(&payload.profile)?;
        validate_operation_id(&payload.operation_id)?;
        if payload.chain_id != CHAIN_ID
            || payload.transaction.transaction_type != "eip1559"
            || !payload.transaction.access_list.is_empty()
            || payload.transaction.value_atomic != "0"
        {
            return Err(ErrorCode::InvalidTransaction);
        }
        let token = parse_address(&payload.transaction.to)?;
        if token != parse_address(BASE_USDC)? {
            return Err(ErrorCode::InvalidTransaction);
        }
        let wallet_address = parse_address(&payload.wallet_address)?;
        let recipient = parse_address(&payload.approval.recipient)?;
        if recipient.iter().all(|byte| *byte == 0) {
            return Err(ErrorCode::InvalidTransaction);
        }
        let amount = Uint256::parse_decimal(&payload.approval.amount_atomic)?;
        if amount.is_zero() {
            return Err(ErrorCode::InvalidTransaction);
        }
        validate_amount_decimal(&payload.approval.amount_decimal, &amount)?;

        let nonce = Uint256::parse_decimal(&payload.transaction.nonce_atomic)?;
        let gas_limit = Uint256::parse_decimal(&payload.transaction.gas_limit_atomic)?;
        let max_fee_per_gas = Uint256::parse_decimal(&payload.transaction.max_fee_per_gas_atomic)?;
        let max_priority_fee_per_gas =
            Uint256::parse_decimal(&payload.transaction.max_priority_fee_per_gas_atomic)?;
        let gas_u64 = gas_limit.fits_u64().ok_or(ErrorCode::InvalidTransaction)?;
        let fee_u64 = max_fee_per_gas
            .fits_u64()
            .ok_or(ErrorCode::InvalidTransaction)?;
        let priority_u64 = max_priority_fee_per_gas
            .fits_u64()
            .ok_or(ErrorCode::InvalidTransaction)?;
        if !(MIN_GAS_LIMIT..=MAX_GAS_LIMIT).contains(&gas_u64)
            || fee_u64 == 0
            || fee_u64 > MAX_FEE_PER_GAS
            || priority_u64 > fee_u64
        {
            return Err(ErrorCode::InvalidTransaction);
        }

        let calldata = transfer_calldata(&recipient, &amount);
        if decode_prefixed_hex(&payload.transaction.data, 68)? != calldata {
            return Err(ErrorCode::InvalidTransaction);
        }
        let expires_at_unix = parse_rfc3339_utc(&payload.approval.expires_at)?;
        if expires_at_unix <= now_unix
            || expires_at_unix.saturating_sub(now_unix) > MAX_APPROVAL_WINDOW_SECONDS
        {
            return Err(ErrorCode::Expired);
        }

        let expected_fingerprint = canonical_fingerprint(&payload)?;
        if !is_hash64(&payload.fingerprint) || payload.fingerprint != expected_fingerprint {
            return Err(ErrorCode::InvalidFingerprint);
        }

        Ok(Self {
            profile: payload.profile,
            operation_id: payload.operation_id,
            fingerprint: payload.fingerprint,
            wallet_address,
            recipient,
            amount,
            amount_atomic: payload.approval.amount_atomic,
            amount_decimal: payload.approval.amount_decimal,
            expires_at: payload.approval.expires_at,
            expires_at_unix,
            nonce,
            gas_limit,
            max_fee_per_gas,
            max_priority_fee_per_gas,
            calldata,
        })
    }

    pub fn effect_slot(&self) -> String {
        effect_slot(&self.profile, &self.operation_id, &self.fingerprint)
    }

    pub fn approval_phrase(&self) -> String {
        format!(
            "APPROVE APN TRANSFER {}",
            &self.fingerprint[self.fingerprint.len() - 16..]
        )
    }

    pub fn ensure_live(&self, now_unix: i64) -> AgentResult<()> {
        if now_unix < self.expires_at_unix {
            Ok(())
        } else {
            Err(ErrorCode::Expired)
        }
    }
}

pub fn canonical_fingerprint(payload: &ApproveAndSignPayload) -> AgentResult<String> {
    let gas_limit = Uint256::parse_decimal(&payload.transaction.gas_limit_atomic)?
        .fits_u64()
        .ok_or(ErrorCode::InvalidTransaction)?;
    let max_fee = Uint256::parse_decimal(&payload.transaction.max_fee_per_gas_atomic)?
        .fits_u64()
        .ok_or(ErrorCode::InvalidTransaction)?;
    let maximum_gas_cost = gas_limit
        .checked_mul(max_fee)
        .ok_or(ErrorCode::InvalidTransaction)?
        .to_string();
    let expires_at = parse_rfc3339_utc(&payload.approval.expires_at)?;
    let prepared_at = format_rfc3339_utc(
        expires_at
            .checked_sub(MAX_APPROVAL_WINDOW_SECONDS)
            .ok_or(ErrorCode::InvalidFingerprint)?,
    )?;
    let canonical = json!({
        "amountAtomic": payload.approval.amount_atomic,
        "chainId": payload.chain_id,
        "economics": {
            "gasLimitAtomic": payload.transaction.gas_limit_atomic,
            "maxFeePerGasAtomic": payload.transaction.max_fee_per_gas_atomic,
            "maxPriorityFeePerGasAtomic": payload.transaction.max_priority_fee_per_gas_atomic,
            "maximumGasCostAtomic": maximum_gas_cost,
            "nonceAtomic": payload.transaction.nonce_atomic,
        },
        "expiresAt": payload.approval.expires_at,
        "method": "pay.transfer",
        "operationId": payload.operation_id,
        "preparedAt": prepared_at,
        "profile": payload.profile,
        "recipient": payload.approval.recipient,
        "token": payload.transaction.to,
        "transactionData": payload.transaction.data,
        "walletAddress": payload.wallet_address,
    });
    let encoded = serde_json::to_vec(&canonical).map_err(|_| ErrorCode::Internal)?;
    Ok(hex_encode(&Sha256::digest(encoded)))
}

pub fn binding_hash(profile: &str, address: &str, created_at: &str) -> AgentResult<String> {
    let canonical = json!({
        "address": address,
        "createdAt": created_at,
        "profile": profile,
    });
    let encoded = serde_json::to_vec(&canonical).map_err(|_| ErrorCode::Internal)?;
    Ok(hex_encode(&Sha256::digest(encoded)))
}

pub fn effect_slot(profile: &str, operation_id: &str, fingerprint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"apn-effect-v1\0");
    hasher.update(profile.as_bytes());
    hasher.update(b"\0");
    hasher.update(operation_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(fingerprint.as_bytes());
    format!("APN:effect:{}", hex_encode(&hasher.finalize()))
}

pub fn validate_profile(profile: &str) -> AgentResult<()> {
    if (1..=32).contains(&profile.len())
        && profile.as_bytes()[0].is_ascii_lowercase()
        && profile.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
    {
        Ok(())
    } else {
        Err(ErrorCode::InvalidProfile)
    }
}

pub fn validate_operation_id(value: &str) -> AgentResult<()> {
    if (1..=96).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        Ok(())
    } else {
        Err(ErrorCode::InvalidOperationId)
    }
}

pub fn transfer_calldata(recipient: &[u8; 20], amount: &Uint256) -> Vec<u8> {
    let mut calldata = Vec::with_capacity(68);
    calldata.extend_from_slice(&TRANSFER_SELECTOR);
    calldata.extend_from_slice(&[0_u8; 12]);
    calldata.extend_from_slice(recipient);
    calldata.extend_from_slice(&amount.0);
    calldata
}

pub fn address_from_secret(secret: &[u8; 32]) -> AgentResult<[u8; 20]> {
    let secret = SecretKey::from_byte_array(*secret).map_err(|_| ErrorCode::WalletCorrupt)?;
    let public = PublicKey::from_secret_key(&Secp256k1::new(), &secret).serialize_uncompressed();
    let hash = Keccak256::digest(&public[1..]);
    hash[12..].try_into().map_err(|_| ErrorCode::Internal)
}

pub fn checksum_address(address: &[u8; 20]) -> String {
    let lower = hex_encode(address);
    let hash = Keccak256::digest(lower.as_bytes());
    let mut output = String::with_capacity(42);
    output.push_str("0x");
    for (index, character) in lower.bytes().enumerate() {
        let nibble = if index % 2 == 0 {
            hash[index / 2] >> 4
        } else {
            hash[index / 2] & 0x0f
        };
        if character.is_ascii_alphabetic() && nibble >= 8 {
            output.push((character as char).to_ascii_uppercase());
        } else {
            output.push(character as char);
        }
    }
    output
}

mod codec;
mod transaction;

pub use codec::{
    decode_prefixed_hex, format_rfc3339_utc, hex_encode, parse_address, parse_rfc3339_utc,
    prefixed_hex,
};
use codec::{is_hash64, validate_amount_decimal};
pub use transaction::{
    inspect_signed_transaction, sign_transfer, verify_effect, verify_material_matches_intent,
};

pub fn validate_fingerprint(value: &str) -> AgentResult<()> {
    if is_hash64(value) {
        Ok(())
    } else {
        Err(ErrorCode::InvalidFingerprint)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_uint256_and_rejects_noncanonical_money() {
        assert_eq!(Uint256::parse_decimal("0").unwrap().fits_u64(), Some(0));
        assert_eq!(
            Uint256::parse_decimal("18446744073709551615")
                .unwrap()
                .fits_u64(),
            Some(u64::MAX)
        );
        assert_eq!(
            Uint256::parse_decimal("01"),
            Err(ErrorCode::InvalidTransaction)
        );
        assert_eq!(
            Uint256::parse_decimal("1.0"),
            Err(ErrorCode::InvalidTransaction)
        );
        assert!(
            Uint256::parse_decimal(
                "115792089237316195423570985008687907853269984665640564039457584007913129639936"
            )
            .is_err()
        );
    }

    #[test]
    fn calldata_is_only_erc20_transfer() {
        let recipient = parse_address("0x1111111111111111111111111111111111111111").unwrap();
        let calldata = transfer_calldata(&recipient, &Uint256::parse_decimal("1000000").unwrap());
        assert_eq!(
            prefixed_hex(&calldata),
            "0xa9059cbb000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000f4240"
        );
    }

    #[test]
    fn known_secret_derives_expected_ethereum_address() {
        let mut secret = [0_u8; 32];
        secret[31] = 1;
        assert_eq!(
            checksum_address(&address_from_secret(&secret).unwrap()),
            "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"
        );
    }

    #[test]
    fn rfc3339_parser_is_strict_and_calendar_aware() {
        assert_eq!(parse_rfc3339_utc("1970-01-01T00:00:00Z").unwrap(), 0);
        assert_eq!(
            parse_rfc3339_utc("2024-02-29T00:00:00.000Z").unwrap(),
            1_709_164_800
        );
        assert!(parse_rfc3339_utc("2023-02-29T00:00:00.000Z").is_err());
        assert!(parse_rfc3339_utc("2024-01-01T00:00:00+00:00").is_err());
        assert_eq!(format_rfc3339_utc(0).unwrap(), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            format_rfc3339_utc(1_709_164_800).unwrap(),
            "2024-02-29T00:00:00.000Z"
        );
    }
}
