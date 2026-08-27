use crate::x402::{X402ApprovalIntent, X402AuthorizationRecovery};
use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;
use std::io::{self, Read, Write};
use zeroize::Zeroizing;

pub const PROTOCOL_VERSION: &str = "apn.native.v1";
pub const MAX_FRAME_BYTES: usize = 64 * 1024;
pub const MAX_SESSION_FRAMES: usize = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    EmptyFrame,
    FrameTooLarge,
    FrameTruncated,
    TrailingFrame,
    InvalidJson,
    InvalidSchema,
    UnsupportedVersion,
    UnsupportedOperation,
    InvalidRequestId,
    InvalidProfile,
    InvalidOperationId,
    InvalidTransaction,
    InvalidFingerprint,
    Expired,
    ApprovalRequired,
    ApprovalRefused,
    TtyUnavailable,
    TtyNotForeground,
    WalletNotFound,
    WalletCorrupt,
    WalletMismatch,
    EffectNotFound,
    EffectMismatch,
    X402AuthorizationInvalid,
    X402AuthorizationNotFound,
    X402AuthorizationMismatch,
    KeychainDuplicate,
    KeychainNotFound,
    KeychainLocked,
    KeychainUnavailable,
    KeychainEntitlementMissing,
    KeychainFailure,
    IdentityInvalid,
    BundleInvalid,
    CoreUnavailable,
    StateBusy,
    Internal,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EmptyFrame => "APN_IPC_EMPTY_FRAME",
            Self::FrameTooLarge => "APN_IPC_FRAME_TOO_LARGE",
            Self::FrameTruncated => "APN_IPC_FRAME_TRUNCATED",
            Self::TrailingFrame => "APN_IPC_TRAILING_FRAME",
            Self::InvalidJson => "APN_IPC_INVALID_JSON",
            Self::InvalidSchema => "APN_IPC_INVALID_SCHEMA",
            Self::UnsupportedVersion => "APN_IPC_VERSION_UNSUPPORTED",
            Self::UnsupportedOperation => "APN_OPERATION_UNSUPPORTED",
            Self::InvalidRequestId => "APN_REQUEST_ID_INVALID",
            Self::InvalidProfile => "APN_PROFILE_INVALID",
            Self::InvalidOperationId => "APN_OPERATION_ID_INVALID",
            Self::InvalidTransaction => "APN_TRANSACTION_INVALID",
            Self::InvalidFingerprint => "APN_FINGERPRINT_INVALID",
            Self::Expired => "APN_APPROVAL_EXPIRED",
            Self::ApprovalRequired => "APN_APPROVAL_REQUIRED",
            Self::ApprovalRefused => "APN_APPROVAL_REFUSED",
            Self::TtyUnavailable => "APN_TTY_UNAVAILABLE",
            Self::TtyNotForeground => "APN_TTY_NOT_FOREGROUND",
            Self::WalletNotFound => "APN_WALLET_NOT_FOUND",
            Self::WalletCorrupt => "APN_WALLET_CORRUPT",
            Self::WalletMismatch => "APN_WALLET_MISMATCH",
            Self::EffectNotFound => "APN_EFFECT_NOT_FOUND",
            Self::EffectMismatch => "APN_EFFECT_MISMATCH",
            Self::X402AuthorizationInvalid => "APN_X402_AUTHORIZATION_INVALID",
            Self::X402AuthorizationNotFound => "APN_X402_AUTHORIZATION_NOT_FOUND",
            Self::X402AuthorizationMismatch => "APN_X402_AUTHORIZATION_MISMATCH",
            Self::KeychainDuplicate => "APN_KEYCHAIN_DUPLICATE",
            Self::KeychainNotFound => "APN_KEYCHAIN_NOT_FOUND",
            Self::KeychainLocked => "APN_KEYCHAIN_LOCKED",
            Self::KeychainUnavailable => "APN_KEYCHAIN_UNAVAILABLE",
            Self::KeychainEntitlementMissing => "APN_KEYCHAIN_ENTITLEMENT_MISSING",
            Self::KeychainFailure => "APN_KEYCHAIN_FAILURE",
            Self::IdentityInvalid => "APN_SIGNED_IDENTITY_INVALID",
            Self::BundleInvalid => "APN_BUNDLE_INVALID",
            Self::CoreUnavailable => "APN_CORE_UNAVAILABLE",
            Self::StateBusy => "APN_STATE_BUSY",
            Self::Internal => "APN_INTERNAL",
        }
    }
}

pub type AgentResult<T> = Result<T, ErrorCode>;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestEnvelope {
    version: String,
    #[serde(rename = "requestId")]
    request_id: String,
    operation: String,
    payload: Value,
}

#[derive(Debug)]
pub struct Request {
    pub request_id: String,
    pub operation: Operation,
}

#[derive(Debug)]
pub enum Operation {
    WalletDescribe(WalletPayload),
    WalletEnsure(WalletPayload),
    ApproveAndSign(Box<ApproveAndSignPayload>),
    EffectMaterialGet(EffectMaterialPayload),
    X402ApproveAndAuthorize(Box<X402ApprovalIntent>),
    X402AuthorizationMaterialGet(Box<X402AuthorizationRecovery>),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WalletPayload {
    pub profile: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveAndSignPayload {
    pub profile: String,
    pub operation_id: String,
    pub fingerprint: String,
    pub wallet_address: String,
    pub chain_id: u64,
    pub transaction: TransactionPayload,
    pub approval: ApprovalPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransactionPayload {
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub to: String,
    pub value_atomic: String,
    pub data: String,
    pub nonce_atomic: String,
    pub gas_limit_atomic: String,
    pub max_fee_per_gas_atomic: String,
    pub max_priority_fee_per_gas_atomic: String,
    pub access_list: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovalPayload {
    pub recipient: String,
    pub amount_atomic: String,
    pub amount_decimal: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectMaterialPayload {
    pub profile: String,
    pub operation_id: String,
    pub fingerprint: String,
    pub expected_transaction_hash: String,
    pub expected_raw_transaction_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletResult {
    pub profile: String,
    pub address: String,
    pub created_at: String,
    pub binding_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletDescribeResult {
    pub found: bool,
    pub profile: String,
    pub address: String,
    pub created_at: String,
    pub binding_hash: String,
}

impl From<WalletResult> for WalletDescribeResult {
    fn from(wallet: WalletResult) -> Self {
        Self {
            found: true,
            profile: wallet.profile,
            address: wallet.address,
            created_at: wallet.created_at,
            binding_hash: wallet.binding_hash,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct WalletNotFoundResult {
    pub found: bool,
}

pub struct EffectResult {
    pub transaction_hash: String,
    pub raw_transaction: Zeroizing<String>,
    pub raw_transaction_hash: String,
}

impl Serialize for EffectResult {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("EffectResult", 3)?;
        state.serialize_field("transactionHash", &self.transaction_hash)?;
        state.serialize_field("rawTransaction", self.raw_transaction.as_str())?;
        state.serialize_field("rawTransactionHash", &self.raw_transaction_hash)?;
        state.end()
    }
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponseEnvelope<'a> {
    version: &'static str,
    request_id: Option<&'a str>,
    ok: bool,
    error: ErrorBody,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SuccessResponseEnvelope<'a, T: Serialize> {
    version: &'static str,
    request_id: &'a str,
    ok: bool,
    result: T,
}

pub fn parse_request(frame: &[u8]) -> AgentResult<Request> {
    if frame.is_empty() {
        return Err(ErrorCode::EmptyFrame);
    }
    if frame.len() > MAX_FRAME_BYTES {
        return Err(ErrorCode::FrameTooLarge);
    }
    let envelope: RequestEnvelope = serde_json::from_slice(frame).map_err(|error| {
        if error.is_syntax() || error.is_eof() {
            ErrorCode::InvalidJson
        } else {
            ErrorCode::InvalidSchema
        }
    })?;
    if envelope.version != PROTOCOL_VERSION {
        return Err(ErrorCode::UnsupportedVersion);
    }
    if !is_canonical_request_id(&envelope.request_id) {
        return Err(ErrorCode::InvalidRequestId);
    }

    let operation = match envelope.operation.as_str() {
        "wallet.describe" => Operation::WalletDescribe(decode_payload(envelope.payload)?),
        "wallet.ensure" => Operation::WalletEnsure(decode_payload(envelope.payload)?),
        "directTransfer.approveAndSign" => {
            Operation::ApproveAndSign(Box::new(decode_payload(envelope.payload)?))
        }
        "effectMaterial.get" => Operation::EffectMaterialGet(decode_payload(envelope.payload)?),
        "x402Exact.approveAndAuthorize" => {
            Operation::X402ApproveAndAuthorize(Box::new(decode_payload(envelope.payload)?))
        }
        "x402Exact.authorizationMaterial.get" => {
            Operation::X402AuthorizationMaterialGet(Box::new(decode_payload(envelope.payload)?))
        }
        _ => return Err(ErrorCode::UnsupportedOperation),
    };
    Ok(Request {
        request_id: envelope.request_id,
        operation,
    })
}

pub fn extract_request_id(frame: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(frame).ok()?;
    let request_id = value.as_object()?.get("requestId")?.as_str()?;
    if is_canonical_request_id(request_id) {
        Some(request_id.to_owned())
    } else {
        None
    }
}

fn decode_payload<T: for<'de> Deserialize<'de>>(payload: Value) -> AgentResult<T> {
    serde_json::from_value(payload).map_err(|_| ErrorCode::InvalidSchema)
}

pub fn success_response<T: Serialize>(request_id: &str, result: T) -> AgentResult<Vec<u8>> {
    serde_json::to_vec(&SuccessResponseEnvelope {
        version: PROTOCOL_VERSION,
        request_id,
        ok: true,
        result,
    })
    .map_err(|_| ErrorCode::Internal)
}

pub fn error_response(request_id: Option<&str>, code: ErrorCode) -> Vec<u8> {
    serde_json::to_vec(&ErrorResponseEnvelope {
        version: PROTOCOL_VERSION,
        request_id,
        ok: false,
        error: ErrorBody {
            code: code.as_str(),
            message: "Native request failed.",
        },
    })
    .unwrap_or_else(|_| {
        b"{\"version\":\"apn.native.v1\",\"requestId\":null,\"ok\":false,\"error\":{\"code\":\"APN_INTERNAL\",\"message\":\"Native request failed.\"}}".to_vec()
    })
}

pub fn read_frame(reader: &mut impl Read) -> AgentResult<Option<Vec<u8>>> {
    let mut prefix = [0_u8; 4];
    let first = match reader.read(&mut prefix[..1]) {
        Ok(0) => return Ok(None),
        Ok(_) => 1,
        Err(error) if error.kind() == io::ErrorKind::Interrupted => 0,
        Err(_) => return Err(ErrorCode::FrameTruncated),
    };
    if first == 0 {
        reader
            .read_exact(&mut prefix[..1])
            .map_err(|_| ErrorCode::FrameTruncated)?;
    }
    reader
        .read_exact(&mut prefix[1..])
        .map_err(|_| ErrorCode::FrameTruncated)?;
    let length = u32::from_be_bytes(prefix) as usize;
    if length == 0 {
        return Err(ErrorCode::EmptyFrame);
    }
    if length > MAX_FRAME_BYTES {
        return Err(ErrorCode::FrameTooLarge);
    }
    let mut payload = vec![0_u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|_| ErrorCode::FrameTruncated)?;
    Ok(Some(payload))
}

pub fn write_frame(writer: &mut impl Write, payload: &[u8]) -> AgentResult<()> {
    if payload.is_empty() {
        return Err(ErrorCode::EmptyFrame);
    }
    if payload.len() > MAX_FRAME_BYTES {
        return Err(ErrorCode::FrameTooLarge);
    }
    writer
        .write_all(&(payload.len() as u32).to_be_bytes())
        .and_then(|_| writer.write_all(payload))
        .and_then(|_| writer.flush())
        .map_err(|_| ErrorCode::FrameTruncated)
}

pub fn require_eof(reader: &mut impl Read) -> AgentResult<()> {
    let mut trailing = [0_u8; 1];
    loop {
        match reader.read(&mut trailing) {
            Ok(0) => return Ok(()),
            Ok(_) => return Err(ErrorCode::TrailingFrame),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(ErrorCode::FrameTruncated),
        }
    }
}

pub fn is_canonical_request_id(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }
    value.as_bytes().iter().enumerate().all(|(index, byte)| {
        if matches!(index, 8 | 13 | 18 | 23) {
            *byte == b'-'
        } else {
            byte.is_ascii_digit() || (b'a'..=b'f').contains(byte)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const ID: &str = "019d2f4a-172b-7e11-8a42-102030405060";

    #[test]
    fn frame_round_trip_uses_big_endian_length() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, b"{}").unwrap();
        assert_eq!(&bytes[..4], &[0, 0, 0, 2]);
        let mut cursor = Cursor::new(bytes);
        assert_eq!(read_frame(&mut cursor).unwrap().unwrap(), b"{}");
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn frame_limits_and_truncation_fail_closed() {
        let mut oversized = Cursor::new(((MAX_FRAME_BYTES as u32) + 1).to_be_bytes());
        assert_eq!(read_frame(&mut oversized), Err(ErrorCode::FrameTooLarge));
        let mut truncated = Cursor::new([0, 0, 0, 2, b'{']);
        assert_eq!(read_frame(&mut truncated), Err(ErrorCode::FrameTruncated));
    }

    #[test]
    fn trailing_bytes_after_one_frame_fail_closed() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, b"{}").unwrap();
        bytes.push(0);
        let mut cursor = Cursor::new(bytes);
        assert_eq!(read_frame(&mut cursor).unwrap().unwrap(), b"{}");
        assert_eq!(require_eof(&mut cursor), Err(ErrorCode::TrailingFrame));
    }

    #[test]
    fn request_rejects_unknown_fields_and_operations() {
        let unknown = format!(
            r#"{{"version":"{PROTOCOL_VERSION}","requestId":"{ID}","operation":"wallet.describe","payload":{{"profile":"local_software","extra":true}}}}"#
        );
        assert_eq!(
            parse_request(unknown.as_bytes()).unwrap_err(),
            ErrorCode::InvalidSchema
        );
        let generic = format!(
            r#"{{"version":"{PROTOCOL_VERSION}","requestId":"{ID}","operation":"sign","payload":{{}}}}"#
        );
        assert_eq!(
            parse_request(generic.as_bytes()).unwrap_err(),
            ErrorCode::UnsupportedOperation
        );
    }

    #[test]
    fn request_id_is_strict_lowercase_uuid_shape() {
        assert!(is_canonical_request_id(ID));
        assert!(!is_canonical_request_id(
            "019D2F4A-172B-7E11-8A42-102030405060"
        ));
        assert!(!is_canonical_request_id("request-1"));
    }
}
