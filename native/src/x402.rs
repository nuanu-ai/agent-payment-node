#[path = "x402/eip712.rs"]
mod eip712;

use self::eip712::{TransferMessage, Uint256, domain_separator, transfer_digest};
use secp256k1::ecdsa::{RecoverableSignature, RecoveryId};
use secp256k1::{Message, PublicKey, Secp256k1, SecretKey};
use serde::de::Error as _;
use serde::de::Visitor;
use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest as _, Sha256};
use sha3::Keccak256;
use std::fmt;
use std::net::Ipv6Addr;
use zeroize::Zeroizing;

pub const CHAIN_ID: &str = "8453";
pub const BASE_USDC: &str = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SIGNATURE_HASH_DOMAIN: &[u8] = b"apn.x402.signature.v1\0";
const INTENT_HASH_DOMAIN: &[u8] = b"apn.x402.authorization-intent.v1\0";
const SLOT_DOMAIN: &[u8] = b"apn-x402-effect-v1\0";
const HALF_CURVE_ORDER: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentIdentifierPosture {
    Absent,
    Optional,
    Required,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct X402Resource {
    pub origin: String,
    pub path: String,
    pub url_hash: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct X402TokenDomain {
    pub name: String,
    pub version: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct X402Authorization {
    pub from: String,
    pub to: String,
    pub value: String,
    pub valid_after: String,
    pub valid_before: String,
    pub nonce: String,
    pub created_at: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct X402ApprovalIntent {
    pub profile: String,
    pub operation_id: String,
    pub fingerprint: String,
    pub wallet: String,
    pub chain_id: String,
    pub token: String,
    pub resource: X402Resource,
    pub cap_atomic: String,
    pub payee: String,
    pub amount_atomic: String,
    pub token_domain: X402TokenDomain,
    pub authorization: X402Authorization,
    pub payment_identifier_posture: PaymentIdentifierPosture,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null_string",
        skip_serializing_if = "Option::is_none"
    )]
    pub payment_identifier_value: Option<String>,
    pub offer_hash: String,
    pub intent_hash: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct X402AuthorizationRecovery {
    pub profile: String,
    pub operation_id: String,
    pub fingerprint: String,
    pub wallet: String,
    pub chain_id: String,
    pub token: String,
    pub token_domain: X402TokenDomain,
    pub authorization: PublicAuthorization,
    pub intent_hash: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_non_null_hash",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_signature_hash: Option<String>,
}

impl fmt::Debug for X402Resource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("X402Resource { validated fields redacted }")
    }
}

impl fmt::Debug for X402TokenDomain {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("X402TokenDomain { validated fields redacted }")
    }
}

impl fmt::Debug for X402Authorization {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("X402Authorization { replayable fields redacted }")
    }
}

impl fmt::Debug for X402ApprovalIntent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("X402ApprovalIntent { replayable fields redacted }")
    }
}

impl fmt::Debug for X402AuthorizationRecovery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("X402AuthorizationRecovery { replayable fields redacted }")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum X402AuthorizationError {
    Invalid,
    Expired,
    Mismatch,
    WalletCorrupt,
    Internal,
}

pub struct PreparedAuthorization {
    intent: X402ApprovalIntent,
    wallet: [u8; 20],
    valid_before: u64,
    digest: [u8; 32],
}

impl fmt::Debug for PreparedAuthorization {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PreparedAuthorization { replayable fields redacted }")
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicAuthorization {
    pub from: String,
    pub to: String,
    pub value: String,
    pub valid_after: String,
    pub valid_before: String,
    pub nonce: String,
}

impl fmt::Debug for PublicAuthorization {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PublicAuthorization { replayable fields redacted }")
    }
}

pub struct AuthorizationMaterial {
    pub authorization: PublicAuthorization,
    pub signature: Zeroizing<String>,
    pub signature_hash: String,
}

impl fmt::Debug for AuthorizationMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AuthorizationMaterial { replayable fields redacted }")
    }
}

impl Serialize for AuthorizationMaterial {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AuthorizationMaterial", 3)?;
        state.serialize_field("authorization", &self.authorization)?;
        state.serialize_field("signature", self.signature.as_str())?;
        state.serialize_field("signatureHash", &self.signature_hash)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for AuthorizationMaterial {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct WireMaterial {
            authorization: PublicAuthorization,
            signature: String,
            signature_hash: String,
        }

        let wire = WireMaterial::deserialize(deserializer)?;
        if decode_signature(&wire.signature).is_none() || !is_hash256(&wire.signature_hash) {
            return Err(D::Error::custom("invalid x402 authorization material"));
        }
        Ok(Self {
            authorization: wire.authorization,
            signature: Zeroizing::new(wire.signature),
            signature_hash: wire.signature_hash,
        })
    }
}

impl PreparedAuthorization {
    pub fn validate(
        intent: X402ApprovalIntent,
        now_unix: u64,
    ) -> Result<Self, X402AuthorizationError> {
        if !is_profile(&intent.profile)
            || !is_hash256(&intent.operation_id)
            || !is_hash256(&intent.fingerprint)
            || intent.chain_id != CHAIN_ID
            || intent.token != BASE_USDC
            || !valid_origin(&intent.resource.origin)
            || !valid_path(&intent.resource.path)
            || !is_hash256(&intent.resource.url_hash)
            || !is_hash256(&intent.offer_hash)
            || !is_hash256(&intent.intent_hash)
            || !valid_domain_component(&intent.token_domain.name)
            || !valid_domain_component(&intent.token_domain.version)
        {
            return Err(X402AuthorizationError::Invalid);
        }

        validate_payment_identifier(&intent)?;
        let wallet = parse_address(&intent.wallet).ok_or(X402AuthorizationError::Invalid)?;
        let payee = parse_address(&intent.payee).ok_or(X402AuthorizationError::Invalid)?;
        let token = parse_address(&intent.token).ok_or(X402AuthorizationError::Invalid)?;
        let from =
            parse_address(&intent.authorization.from).ok_or(X402AuthorizationError::Invalid)?;
        let to = parse_address(&intent.authorization.to).ok_or(X402AuthorizationError::Invalid)?;
        if wallet.iter().all(|byte| *byte == 0)
            || payee.iter().all(|byte| *byte == 0)
            || token.iter().all(|byte| *byte == 0)
        {
            return Err(X402AuthorizationError::Invalid);
        }
        if wallet != from || payee != to {
            return Err(X402AuthorizationError::Mismatch);
        }

        let cap = Uint256::parse_decimal(&intent.cap_atomic)
            .filter(|value| !value.is_zero())
            .ok_or(X402AuthorizationError::Invalid)?;
        let amount = Uint256::parse_decimal(&intent.amount_atomic)
            .filter(|value| !value.is_zero())
            .ok_or(X402AuthorizationError::Invalid)?;
        let value = Uint256::parse_decimal(&intent.authorization.value)
            .filter(|value| !value.is_zero())
            .ok_or(X402AuthorizationError::Invalid)?;
        if amount.is_greater_than(&cap) {
            return Err(X402AuthorizationError::Invalid);
        }
        if amount != value {
            return Err(X402AuthorizationError::Mismatch);
        }
        if intent.authorization.valid_after != "0" {
            return Err(X402AuthorizationError::Invalid);
        }
        let created_at =
            parse_u64(&intent.authorization.created_at).ok_or(X402AuthorizationError::Invalid)?;
        let valid_before =
            parse_u64(&intent.authorization.valid_before).ok_or(X402AuthorizationError::Invalid)?;
        let validity = valid_before
            .checked_sub(created_at)
            .ok_or(X402AuthorizationError::Invalid)?;
        if !(30..=300).contains(&validity) {
            return Err(X402AuthorizationError::Invalid);
        }
        if now_unix >= valid_before {
            return Err(X402AuthorizationError::Expired);
        }
        if created_at > now_unix {
            return Err(X402AuthorizationError::Invalid);
        }
        let nonce =
            parse_bytes32(&intent.authorization.nonce).ok_or(X402AuthorizationError::Invalid)?;
        if canonical_intent_hash(&intent.authorization) != intent.intent_hash {
            return Err(X402AuthorizationError::Mismatch);
        }

        let separator = domain_separator(
            &intent.token_domain.name,
            &intent.token_domain.version,
            8453,
            &token,
        );
        let digest = transfer_digest(
            &separator,
            TransferMessage {
                from: &from,
                to: &to,
                value: &value,
                valid_after: 0,
                valid_before,
                nonce: &nonce,
            },
        );
        Ok(Self {
            intent,
            wallet,
            valid_before,
            digest,
        })
    }

    pub fn intent(&self) -> &X402ApprovalIntent {
        &self.intent
    }

    pub fn ensure_live(&self, now_unix: u64) -> Result<(), X402AuthorizationError> {
        if now_unix < self.valid_before {
            Ok(())
        } else {
            Err(X402AuthorizationError::Expired)
        }
    }

    pub fn effect_slot(&self) -> String {
        effect_slot(
            &self.intent.profile,
            &self.intent.operation_id,
            &self.intent.fingerprint,
        )
    }

    pub fn matches_recovery(
        &self,
        recovery: &X402AuthorizationRecovery,
    ) -> Result<(), X402AuthorizationError> {
        if recovery.profile != self.intent.profile
            || recovery.operation_id != self.intent.operation_id
            || recovery.fingerprint != self.intent.fingerprint
            || recovery.wallet != self.intent.wallet
            || recovery.chain_id != self.intent.chain_id
            || recovery.token != self.intent.token
            || recovery.token_domain != self.intent.token_domain
            || recovery.authorization != self.public_authorization_inner()
            || recovery.intent_hash != self.intent.intent_hash
        {
            return Err(X402AuthorizationError::Mismatch);
        }
        Ok(())
    }

    pub fn public_authorization(&self) -> PublicAuthorization {
        self.public_authorization_inner()
    }

    fn public_authorization_inner(&self) -> PublicAuthorization {
        PublicAuthorization {
            from: self.intent.authorization.from.clone(),
            to: self.intent.authorization.to.clone(),
            value: self.intent.authorization.value.clone(),
            valid_after: self.intent.authorization.valid_after.clone(),
            valid_before: self.intent.authorization.valid_before.clone(),
            nonce: self.intent.authorization.nonce.clone(),
        }
    }
}

impl X402AuthorizationRecovery {
    pub fn validate(&self, now_unix: u64) -> Result<(), X402AuthorizationError> {
        if !is_profile(&self.profile)
            || !is_hash256(&self.operation_id)
            || !is_hash256(&self.fingerprint)
            || self.chain_id != CHAIN_ID
            || self.token != BASE_USDC
            || !valid_domain_component(&self.token_domain.name)
            || !valid_domain_component(&self.token_domain.version)
            || !is_hash256(&self.intent_hash)
            || self
                .expected_signature_hash
                .as_deref()
                .is_some_and(|value| !is_hash256(value))
        {
            return Err(X402AuthorizationError::Invalid);
        }
        let wallet = parse_address(&self.wallet).ok_or(X402AuthorizationError::Invalid)?;
        let from =
            parse_address(&self.authorization.from).ok_or(X402AuthorizationError::Invalid)?;
        let to = parse_address(&self.authorization.to).ok_or(X402AuthorizationError::Invalid)?;
        if wallet.iter().all(|byte| *byte == 0)
            || to.iter().all(|byte| *byte == 0)
            || wallet != from
        {
            return Err(X402AuthorizationError::Mismatch);
        }
        if Uint256::parse_decimal(&self.authorization.value)
            .filter(|value| !value.is_zero())
            .is_none()
            || self.authorization.valid_after != "0"
            || parse_bytes32(&self.authorization.nonce).is_none()
        {
            return Err(X402AuthorizationError::Invalid);
        }
        let valid_before =
            parse_u64(&self.authorization.valid_before).ok_or(X402AuthorizationError::Invalid)?;
        if now_unix >= valid_before {
            return Err(X402AuthorizationError::Expired);
        }
        Ok(())
    }

    pub fn effect_slot(&self) -> String {
        effect_slot(&self.profile, &self.operation_id, &self.fingerprint)
    }
}

pub fn effect_slot(profile: &str, operation_id: &str, fingerprint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(SLOT_DOMAIN);
    hasher.update(profile.as_bytes());
    hasher.update(b"\0");
    hasher.update(operation_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(fingerprint.as_bytes());
    hex_encode(&hasher.finalize())
}

impl PreparedAuthorization {
    pub fn sign(
        &self,
        secret_bytes: &[u8; 32],
        now_unix: u64,
    ) -> Result<AuthorizationMaterial, X402AuthorizationError> {
        self.ensure_live(now_unix)?;
        let secret_copy = Zeroizing::new(*secret_bytes);
        let secret = SecretKey::from_byte_array(*secret_copy)
            .map_err(|_| X402AuthorizationError::WalletCorrupt)?;
        let public = PublicKey::from_secret_key(&Secp256k1::new(), &secret);
        if ethereum_address(&public) != self.wallet {
            return Err(X402AuthorizationError::Mismatch);
        }

        let signature =
            Secp256k1::new().sign_ecdsa_recoverable(Message::from_digest(self.digest), &secret);
        let (recovery_id, compact) = signature.serialize_compact();
        let parity = i32::from(recovery_id);
        if !(0..=1).contains(&parity) || compact[32..] > HALF_CURVE_ORDER[..] {
            return Err(X402AuthorizationError::Internal);
        }
        let mut encoded = [0_u8; 65];
        encoded[..64].copy_from_slice(&compact);
        encoded[64] = 27 + parity as u8;
        self.verified_material(encoded, None, now_unix)
    }

    pub fn verify_material(
        &self,
        signature: &str,
        expected_signature_hash: Option<&str>,
        now_unix: u64,
    ) -> Result<AuthorizationMaterial, X402AuthorizationError> {
        let signature = decode_signature(signature).ok_or(X402AuthorizationError::Invalid)?;
        self.verified_material(signature, expected_signature_hash, now_unix)
    }

    pub fn verify_stored_material(
        &self,
        material: &AuthorizationMaterial,
        expected_signature_hash: Option<&str>,
        now_unix: u64,
    ) -> Result<AuthorizationMaterial, X402AuthorizationError> {
        if material.authorization != self.public_authorization_inner() {
            return Err(X402AuthorizationError::Mismatch);
        }
        if let Some(expected) = expected_signature_hash {
            if !is_hash256(expected) {
                return Err(X402AuthorizationError::Invalid);
            }
            if expected != material.signature_hash {
                return Err(X402AuthorizationError::Mismatch);
            }
        }
        self.verify_material(
            material.signature.as_str(),
            Some(&material.signature_hash),
            now_unix,
        )
    }

    fn verified_material(
        &self,
        signature: [u8; 65],
        expected_signature_hash: Option<&str>,
        now_unix: u64,
    ) -> Result<AuthorizationMaterial, X402AuthorizationError> {
        self.ensure_live(now_unix)?;
        if !matches!(signature[64], 27 | 28) || signature[32..64] > HALF_CURVE_ORDER[..] {
            return Err(X402AuthorizationError::Invalid);
        }
        let recovery_id = RecoveryId::try_from(i32::from(signature[64] - 27))
            .map_err(|_| X402AuthorizationError::Invalid)?;
        let recoverable = RecoverableSignature::from_compact(&signature[..64], recovery_id)
            .map_err(|_| X402AuthorizationError::Invalid)?;
        let public = Secp256k1::new()
            .recover_ecdsa(Message::from_digest(self.digest), &recoverable)
            .map_err(|_| X402AuthorizationError::Invalid)?;
        if ethereum_address(&public) != self.wallet {
            return Err(X402AuthorizationError::Mismatch);
        }

        let signature_hash = domain_hash(SIGNATURE_HASH_DOMAIN, &signature);
        if let Some(expected) = expected_signature_hash {
            if !is_hash256(expected) {
                return Err(X402AuthorizationError::Invalid);
            }
            if expected != signature_hash {
                return Err(X402AuthorizationError::Mismatch);
            }
        }
        Ok(AuthorizationMaterial {
            authorization: self.public_authorization_inner(),
            signature: Zeroizing::new(format!("0x{}", hex_encode(&signature))),
            signature_hash,
        })
    }
}

fn deserialize_optional_non_null_string<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    struct OptionalStringVisitor;

    impl<'de> Visitor<'de> for OptionalStringVisitor {
        type Value = Option<String>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("an omitted field or a non-null string")
        }

        fn visit_some<D: Deserializer<'de>>(
            self,
            deserializer: D,
        ) -> Result<Self::Value, D::Error> {
            String::deserialize(deserializer).map(Some)
        }

        fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Err(E::custom(
                "null is not permitted for paymentIdentifierValue",
            ))
        }

        fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Err(E::custom(
                "null is not permitted for paymentIdentifierValue",
            ))
        }
    }

    deserializer.deserialize_option(OptionalStringVisitor)
}

fn deserialize_optional_non_null_hash<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    struct OptionalHashVisitor;

    impl<'de> Visitor<'de> for OptionalHashVisitor {
        type Value = Option<String>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("an omitted field or a non-null hash string")
        }

        fn visit_some<D: Deserializer<'de>>(
            self,
            deserializer: D,
        ) -> Result<Self::Value, D::Error> {
            String::deserialize(deserializer).map(Some)
        }

        fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Err(E::custom("null is not permitted for expectedSignatureHash"))
        }

        fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Err(E::custom("null is not permitted for expectedSignatureHash"))
        }
    }

    deserializer.deserialize_option(OptionalHashVisitor)
}

fn validate_payment_identifier(intent: &X402ApprovalIntent) -> Result<(), X402AuthorizationError> {
    match intent.payment_identifier_posture {
        PaymentIdentifierPosture::Absent if intent.payment_identifier_value.is_none() => Ok(()),
        PaymentIdentifierPosture::Optional | PaymentIdentifierPosture::Required => {
            let expected = format!("apn_{}", intent.operation_id);
            if intent.payment_identifier_value.as_deref() == Some(expected.as_str()) {
                Ok(())
            } else {
                Err(X402AuthorizationError::Mismatch)
            }
        }
        PaymentIdentifierPosture::Absent => Err(X402AuthorizationError::Mismatch),
    }
}

fn canonical_intent_hash(authorization: &X402Authorization) -> String {
    let canonical = format!(
        "{{\"createdAt\":\"{}\",\"from\":\"{}\",\"nonce\":\"{}\",\"to\":\"{}\",\"validAfter\":\"{}\",\"validBefore\":\"{}\",\"value\":\"{}\"}}",
        authorization.created_at,
        authorization.from,
        authorization.nonce,
        authorization.to,
        authorization.valid_after,
        authorization.valid_before,
        authorization.value,
    );
    domain_hash(INTENT_HASH_DOMAIN, canonical.as_bytes())
}

fn domain_hash(domain_with_nul: &[u8], value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain_with_nul);
    hasher.update(value);
    hex_encode(&hasher.finalize())
}

fn ethereum_address(public: &PublicKey) -> [u8; 20] {
    let encoded = public.serialize_uncompressed();
    let hash = Keccak256::digest(&encoded[1..]);
    hash[12..].try_into().expect("Keccak-256 has 32 bytes")
}

fn parse_u64(value: &str) -> Option<u64> {
    Uint256::parse_decimal(value)?.fits_u64()
}

fn parse_address(value: &str) -> Option<[u8; 20]> {
    if value.len() != 42 || !value.starts_with("0x") || !is_lower_hex(&value[2..]) {
        return None;
    }
    decode_hex(&value[2..])
}

fn parse_bytes32(value: &str) -> Option<[u8; 32]> {
    if value.len() != 66 || !value.starts_with("0x") || !is_lower_hex(&value[2..]) {
        return None;
    }
    decode_hex(&value[2..])
}

fn decode_signature(value: &str) -> Option<[u8; 65]> {
    if value.len() != 132 || !value.starts_with("0x") || !is_lower_hex(&value[2..]) {
        return None;
    }
    decode_hex(&value[2..])
}

fn decode_hex<const N: usize>(value: &str) -> Option<[u8; N]> {
    if value.len() != N * 2 {
        return None;
    }
    let mut output = [0_u8; N];
    for (index, byte) in output.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(output)
}

fn hex_encode(value: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(value.len() * 2);
    for byte in value {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn is_lower_hex(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn is_hash256(value: &str) -> bool {
    value.len() == 64 && is_lower_hex(value)
}

fn is_profile(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
}

fn valid_domain_component(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}

fn valid_origin(value: &str) -> bool {
    if value.len() > 2048 || !value.starts_with("https://") || !value.is_ascii() {
        return false;
    }
    let authority = &value[8..];
    if authority.is_empty()
        || authority.bytes().any(|byte| {
            byte.is_ascii_control() || matches!(byte, b' ' | b'/' | b'?' | b'#' | b'\\' | b'@')
        })
    {
        return false;
    }
    if authority.starts_with('[') {
        let Some(close) = authority.find(']') else {
            return false;
        };
        if authority[1..close].parse::<Ipv6Addr>().is_err() {
            return false;
        }
        if close + 1 == authority.len() {
            return true;
        }
        return authority[close + 1..]
            .strip_prefix(':')
            .is_some_and(valid_port);
    }

    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => (host, Some(port)),
        _ => (authority, None),
    };
    let labels = host.strip_suffix('.').unwrap_or(host);
    if labels.is_empty()
        || host.len() > 253
        || host.bytes().any(|byte| {
            !(byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-'))
        })
        || labels.split('.').any(|label| {
            label.is_empty() || label.len() > 63 || label.starts_with('-') || label.ends_with('-')
        })
    {
        return false;
    }
    port.is_none_or(valid_port)
}

fn valid_port(port: &str) -> bool {
    !port.is_empty()
        && (port.len() == 1 || !port.starts_with('0'))
        && port.bytes().all(|byte| byte.is_ascii_digit())
        && port
            .parse::<u16>()
            .is_ok_and(|value| value != 0 && value != 443)
}

fn valid_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 2048
        && value.starts_with('/')
        && value.is_ascii()
        && !value
            .bytes()
            .any(|byte| byte.is_ascii_control() || matches!(byte, b' ' | b'?' | b'#' | b'\\'))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIGNATURE: &str = "0x0a5171938a684accd35a09ca13c5876ee481f3f098efa1eaac412809e90f34695a1a506fcf04c3ea1a4c87d7dd9a707a8118f371367246bfbffcdc9322a9de131c";

    fn intent(posture: PaymentIdentifierPosture) -> X402ApprovalIntent {
        let operation_id = "01".repeat(32);
        X402ApprovalIntent {
            profile: "local_software".to_owned(),
            operation_id: operation_id.clone(),
            fingerprint: "02".repeat(32),
            wallet: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf".to_owned(),
            chain_id: CHAIN_ID.to_owned(),
            token: BASE_USDC.to_owned(),
            resource: X402Resource {
                origin: "https://seller.example".to_owned(),
                path: "/resource".to_owned(),
                url_hash: "03".repeat(32),
            },
            cap_atomic: "2000000".to_owned(),
            payee: "0x2222222222222222222222222222222222222222".to_owned(),
            amount_atomic: "1250000".to_owned(),
            token_domain: X402TokenDomain {
                name: "USD Coin".to_owned(),
                version: "2".to_owned(),
            },
            authorization: X402Authorization {
                from: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf".to_owned(),
                to: "0x2222222222222222222222222222222222222222".to_owned(),
                value: "1250000".to_owned(),
                valid_after: "0".to_owned(),
                valid_before: "1760000000".to_owned(),
                nonce: format!("0x{}", "ab".repeat(32)),
                created_at: "1759999940".to_owned(),
            },
            payment_identifier_posture: posture,
            payment_identifier_value: match posture {
                PaymentIdentifierPosture::Absent => None,
                PaymentIdentifierPosture::Optional | PaymentIdentifierPosture::Required => {
                    Some(format!("apn_{operation_id}"))
                }
            },
            offer_hash: "04".repeat(32),
            intent_hash: "399ef13c8ea14bc3459a62c801f55d2ec8ec35aaa06401cb5bf126fdd108bf25"
                .to_owned(),
        }
    }

    #[test]
    fn known_vector_signs_low_s_and_recovers_exact_payer() {
        let prepared = PreparedAuthorization::validate(
            intent(PaymentIdentifierPosture::Optional),
            1_759_999_950,
        )
        .unwrap();
        assert_eq!(
            hex_encode(&prepared.digest),
            "e36116884332d647c03f39e04ea71db8f78013a05a7b0c6be310060305b96218"
        );
        let mut secret = [0_u8; 32];
        secret[31] = 1;
        let material = prepared.sign(&secret, 1_759_999_951).unwrap();
        assert_eq!(material.signature.as_str(), SIGNATURE);
        assert_eq!(
            material.signature_hash,
            "74bb706ea2800779ac000f02304371d1aac9948b31d0cf50dde9e910c7d8ca31"
        );
        assert_eq!(
            material.authorization,
            PublicAuthorization {
                from: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf".to_owned(),
                to: "0x2222222222222222222222222222222222222222".to_owned(),
                value: "1250000".to_owned(),
                valid_after: "0".to_owned(),
                valid_before: "1760000000".to_owned(),
                nonce: format!("0x{}", "ab".repeat(32)),
            }
        );
        assert!(
            prepared
                .verify_material(
                    SIGNATURE,
                    Some("74bb706ea2800779ac000f02304371d1aac9948b31d0cf50dde9e910c7d8ca31"),
                    1_759_999_952,
                )
                .is_ok()
        );
    }

    #[test]
    fn shared_fixture_matches_rust_digest_signature_hash_and_slot() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/x402/eip3009-authorization-v1.json"
        ))
        .unwrap();
        let shared_intent: X402ApprovalIntent =
            serde_json::from_value(fixture["createPayload"].clone()).unwrap();
        let token = parse_address(&shared_intent.token).unwrap();
        assert_eq!(
            hex_encode(&domain_separator(
                &shared_intent.token_domain.name,
                &shared_intent.token_domain.version,
                8453,
                &token,
            )),
            fixture["domainSeparator"].as_str().unwrap()
        );
        let prepared = PreparedAuthorization::validate(shared_intent, 1_759_999_950).unwrap();
        assert_eq!(
            hex_encode(&prepared.digest),
            fixture["digest"].as_str().unwrap()
        );
        assert_eq!(
            prepared.effect_slot(),
            fixture["effectSlot"].as_str().unwrap()
        );
        let mut secret = [0_u8; 32];
        secret[31] = 1;
        let material = prepared.sign(&secret, 1_759_999_951).unwrap();
        assert_eq!(
            material.signature.as_str(),
            fixture["signature"].as_str().unwrap()
        );
        assert_eq!(
            material.signature_hash,
            fixture["signatureHash"].as_str().unwrap()
        );
    }

    #[test]
    fn high_s_wrong_payer_and_expired_material_fail_closed() {
        let prepared = PreparedAuthorization::validate(
            intent(PaymentIdentifierPosture::Absent),
            1_759_999_950,
        )
        .unwrap();
        let high_s = "0x0a5171938a684accd35a09ca13c5876ee481f3f098efa1eaac412809e90f3469a5e5af9030fb3c15e5b3782822658f843995e97578d6597bffd581f9ad8c632e1b";
        assert!(matches!(
            prepared.verify_material(high_s, None, 1_759_999_951),
            Err(X402AuthorizationError::Invalid)
        ));
        assert!(matches!(
            prepared.verify_material(SIGNATURE, None, 1_760_000_000),
            Err(X402AuthorizationError::Expired)
        ));
        let mut wrong_secret = [0_u8; 32];
        wrong_secret[31] = 2;
        assert!(matches!(
            prepared.sign(&wrong_secret, 1_759_999_951),
            Err(X402AuthorizationError::Mismatch)
        ));
    }

    #[test]
    fn frozen_cross_field_and_payment_identifier_mismatches_are_rejected() {
        for posture in [
            PaymentIdentifierPosture::Absent,
            PaymentIdentifierPosture::Optional,
            PaymentIdentifierPosture::Required,
        ] {
            assert!(PreparedAuthorization::validate(intent(posture), 1_759_999_950).is_ok());
        }

        let mut invalid = intent(PaymentIdentifierPosture::Required);
        invalid.payment_identifier_value = None;
        assert!(matches!(
            PreparedAuthorization::validate(invalid, 1_759_999_950),
            Err(X402AuthorizationError::Mismatch)
        ));
        let mut invalid = intent(PaymentIdentifierPosture::Absent);
        invalid.payment_identifier_value = Some(format!("apn_{}", invalid.operation_id));
        assert!(matches!(
            PreparedAuthorization::validate(invalid, 1_759_999_950),
            Err(X402AuthorizationError::Mismatch)
        ));
        let mut invalid = intent(PaymentIdentifierPosture::Optional);
        invalid.amount_atomic = "1250001".to_owned();
        assert!(matches!(
            PreparedAuthorization::validate(invalid, 1_759_999_950),
            Err(X402AuthorizationError::Mismatch)
        ));
        let mut invalid = intent(PaymentIdentifierPosture::Optional);
        invalid.intent_hash = "00".repeat(32);
        assert!(matches!(
            PreparedAuthorization::validate(invalid, 1_759_999_950),
            Err(X402AuthorizationError::Mismatch)
        ));
        let mut future = intent(PaymentIdentifierPosture::Optional);
        future.authorization.created_at = "1760001000".to_owned();
        future.authorization.valid_before = "1760001060".to_owned();
        future.intent_hash = canonical_intent_hash(&future.authorization);
        assert!(matches!(
            PreparedAuthorization::validate(future, 1_759_999_950),
            Err(X402AuthorizationError::Invalid)
        ));
    }

    #[test]
    fn serde_is_exact_and_debug_redacts_replayable_material() {
        let raw = serde_json::to_value(intent(PaymentIdentifierPosture::Required)).unwrap();
        let parsed: X402ApprovalIntent = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(parsed, intent(PaymentIdentifierPosture::Required));
        let mut unknown = raw;
        unknown.as_object_mut().unwrap().insert(
            "digest".to_owned(),
            serde_json::Value::String("00".repeat(32)),
        );
        assert!(serde_json::from_value::<X402ApprovalIntent>(unknown).is_err());
        let mut null_optional =
            serde_json::to_value(intent(PaymentIdentifierPosture::Absent)).unwrap();
        null_optional
            .as_object_mut()
            .unwrap()
            .insert("paymentIdentifierValue".to_owned(), serde_json::Value::Null);
        assert!(serde_json::from_value::<X402ApprovalIntent>(null_optional).is_err());
        assert!(!format!("{parsed:?}").contains("abababab"));

        let prepared = PreparedAuthorization::validate(parsed, 1_759_999_950).unwrap();
        let material = prepared
            .verify_material(SIGNATURE, None, 1_759_999_951)
            .unwrap();
        let encoded = serde_json::to_vec(&material).unwrap();
        let decoded: AuthorizationMaterial = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(decoded.signature.as_str(), SIGNATURE);
        assert!(
            prepared
                .verify_stored_material(
                    &decoded,
                    Some("74bb706ea2800779ac000f02304371d1aac9948b31d0cf50dde9e910c7d8ca31"),
                    1_759_999_952,
                )
                .is_ok()
        );
        assert!(!format!("{decoded:?}").contains(&SIGNATURE[2..]));
    }

    #[test]
    fn slot_is_exact_domain_separated_hash() {
        let prepared = PreparedAuthorization::validate(
            intent(PaymentIdentifierPosture::Absent),
            1_759_999_950,
        )
        .unwrap();
        assert_eq!(prepared.effect_slot().len(), 64);
        let mut expected = Sha256::new();
        expected.update(b"apn-x402-effect-v1\0");
        expected.update(prepared.intent.profile.as_bytes());
        expected.update(b"\0");
        expected.update(prepared.intent.operation_id.as_bytes());
        expected.update(b"\0");
        expected.update(prepared.intent.fingerprint.as_bytes());
        assert_eq!(prepared.effect_slot(), hex_encode(&expected.finalize()));
    }
}
