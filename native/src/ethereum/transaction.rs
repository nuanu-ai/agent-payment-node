use super::codec::{
    decode_signed, decode_small_uint, parse_address, prefixed_hex, rlp_bytes, rlp_list, rlp_u64,
    rlp_uint, strip_leading_zeroes, uint_from_rlp,
};
use super::{
    AgentResult, BASE_USDC, CHAIN_ID, ErrorCode, HALF_CURVE_ORDER, PreparedTransfer,
    SignedMaterial, TRANSFER_SELECTOR, Uint256,
};
use secp256k1::ecdsa::{RecoverableSignature, RecoveryId};
use secp256k1::{Message, Secp256k1, SecretKey};
use sha3::{Digest, Keccak256};
use zeroize::Zeroizing;

pub fn sign_transfer(
    secret_bytes: &[u8; 32],
    intent: &PreparedTransfer,
) -> AgentResult<SignedMaterial> {
    let secret_copy = Zeroizing::new(*secret_bytes);
    let secret = SecretKey::from_byte_array(*secret_copy).map_err(|_| ErrorCode::WalletCorrupt)?;
    let unsigned_fields = unsigned_fields(intent);
    let unsigned_rlp = rlp_list(&unsigned_fields);
    let mut signing_preimage = Vec::with_capacity(1 + unsigned_rlp.len());
    signing_preimage.push(0x02);
    signing_preimage.extend_from_slice(&unsigned_rlp);
    let digest: [u8; 32] = Keccak256::digest(&signing_preimage).into();
    let message = Message::from_digest(digest);
    let signature = Secp256k1::new().sign_ecdsa_recoverable(message, &secret);
    let (recovery_id, compact) = signature.serialize_compact();
    let parity = i32::from(recovery_id);
    if parity > 1 || compact[32..] > HALF_CURVE_ORDER[..] {
        return Err(ErrorCode::Internal);
    }

    let mut signed_fields = unsigned_fields;
    signed_fields.push(rlp_u64(parity as u64));
    signed_fields.push(rlp_bytes(strip_leading_zeroes(&compact[..32])));
    signed_fields.push(rlp_bytes(strip_leading_zeroes(&compact[32..])));
    let signed_rlp = rlp_list(&signed_fields);
    let mut raw = Zeroizing::new(Vec::with_capacity(1 + signed_rlp.len()));
    raw.push(0x02);
    raw.extend_from_slice(&signed_rlp);

    let verified = inspect_signed_details(&raw)?;
    if verified.sender != intent.wallet_address
        || verified.recipient != intent.recipient
        || verified.amount != intent.amount
        || verified.nonce != intent.nonce
        || verified.gas_limit != intent.gas_limit
        || verified.max_fee_per_gas != intent.max_fee_per_gas
        || verified.max_priority_fee_per_gas != intent.max_priority_fee_per_gas
    {
        return Err(ErrorCode::WalletMismatch);
    }
    Ok(verified.into())
}

fn unsigned_fields(intent: &PreparedTransfer) -> Vec<Vec<u8>> {
    vec![
        rlp_u64(CHAIN_ID),
        rlp_uint(&intent.nonce),
        rlp_uint(&intent.max_priority_fee_per_gas),
        rlp_uint(&intent.max_fee_per_gas),
        rlp_uint(&intent.gas_limit),
        rlp_bytes(&parse_address(BASE_USDC).expect("constant address is valid")),
        rlp_bytes(&[]),
        rlp_bytes(&intent.calldata),
        rlp_list(&[]),
    ]
}

pub fn inspect_signed_transaction(raw: &[u8]) -> AgentResult<SignedMaterial> {
    Ok(inspect_signed_details(raw)?.into())
}

fn inspect_signed_details(raw: &[u8]) -> AgentResult<VerifiedMaterial> {
    let decoded = decode_signed(raw)?;
    let unsigned = rlp_list(&decoded.fields[..9]);
    let mut preimage = vec![0x02];
    preimage.extend_from_slice(&unsigned);
    let digest: [u8; 32] = Keccak256::digest(&preimage).into();

    let parity = decode_small_uint(&decoded.payloads[9])?;
    if parity > 1 || decoded.payloads[10].len() > 32 || decoded.payloads[11].len() > 32 {
        return Err(ErrorCode::InvalidTransaction);
    }
    let mut compact = [0_u8; 64];
    compact[32 - decoded.payloads[10].len()..32].copy_from_slice(&decoded.payloads[10]);
    compact[64 - decoded.payloads[11].len()..].copy_from_slice(&decoded.payloads[11]);
    if compact[32..] > HALF_CURVE_ORDER[..] {
        return Err(ErrorCode::InvalidTransaction);
    }
    let recovery =
        RecoveryId::try_from(parity as i32).map_err(|_| ErrorCode::InvalidTransaction)?;
    let signature = RecoverableSignature::from_compact(&compact, recovery)
        .map_err(|_| ErrorCode::InvalidTransaction)?;
    let public = Secp256k1::new()
        .recover_ecdsa(Message::from_digest(digest), &signature)
        .map_err(|_| ErrorCode::InvalidTransaction)?
        .serialize_uncompressed();
    let public_hash = Keccak256::digest(&public[1..]);
    let sender: [u8; 20] = public_hash[12..]
        .try_into()
        .map_err(|_| ErrorCode::Internal)?;

    if decode_small_uint(&decoded.payloads[0])? != CHAIN_ID
        || decoded.payloads[5] != parse_address(BASE_USDC)?
        || !decoded.payloads[6].is_empty()
        || !decoded.payloads[8].is_empty()
        || decoded.payloads[7].len() != 68
        || decoded.payloads[7][..4] != TRANSFER_SELECTOR
        || decoded.payloads[7][4..16].iter().any(|byte| *byte != 0)
    {
        return Err(ErrorCode::InvalidTransaction);
    }
    let recipient: [u8; 20] = decoded.payloads[7][16..36]
        .try_into()
        .map_err(|_| ErrorCode::InvalidTransaction)?;
    let amount = Uint256(
        decoded.payloads[7][36..68]
            .try_into()
            .map_err(|_| ErrorCode::InvalidTransaction)?,
    );
    let transaction_hash: [u8; 32] = Keccak256::digest(raw).into();
    let raw_transaction_hash = transaction_hash;
    Ok(SignedMaterial {
        raw: Zeroizing::new(raw.to_vec()),
        transaction_hash,
        raw_transaction_hash,
        sender,
    }
    .with_fields(
        recipient,
        amount,
        uint_from_rlp(&decoded.payloads[1])?,
        uint_from_rlp(&decoded.payloads[4])?,
        uint_from_rlp(&decoded.payloads[3])?,
        uint_from_rlp(&decoded.payloads[2])?,
    ))
}

struct VerifiedMaterial {
    material: SignedMaterial,
    recipient: [u8; 20],
    amount: Uint256,
    nonce: Uint256,
    gas_limit: Uint256,
    max_fee_per_gas: Uint256,
    max_priority_fee_per_gas: Uint256,
}

impl SignedMaterial {
    fn with_fields(
        self,
        recipient: [u8; 20],
        amount: Uint256,
        nonce: Uint256,
        gas_limit: Uint256,
        max_fee_per_gas: Uint256,
        max_priority_fee_per_gas: Uint256,
    ) -> VerifiedMaterial {
        VerifiedMaterial {
            material: self,
            recipient,
            amount,
            nonce,
            gas_limit,
            max_fee_per_gas,
            max_priority_fee_per_gas,
        }
    }
}

impl std::ops::Deref for VerifiedMaterial {
    type Target = SignedMaterial;
    fn deref(&self) -> &Self::Target {
        &self.material
    }
}

impl From<VerifiedMaterial> for SignedMaterial {
    fn from(value: VerifiedMaterial) -> Self {
        value.material
    }
}

pub fn verify_effect(
    raw: &[u8],
    expected_transaction_hash: &str,
    expected_raw_transaction_hash: &str,
) -> AgentResult<SignedMaterial> {
    let verified = inspect_signed_transaction(raw)?;
    if prefixed_hex(&verified.transaction_hash) != expected_transaction_hash
        || prefixed_hex(&verified.raw_transaction_hash) != expected_raw_transaction_hash
    {
        return Err(ErrorCode::EffectMismatch);
    }
    Ok(verified)
}

pub fn verify_material_matches_intent(
    raw: &[u8],
    intent: &PreparedTransfer,
) -> AgentResult<SignedMaterial> {
    let verified = inspect_signed_details(raw)?;
    if verified.sender != intent.wallet_address
        || verified.recipient != intent.recipient
        || verified.amount != intent.amount
        || verified.nonce != intent.nonce
        || verified.gas_limit != intent.gas_limit
        || verified.max_fee_per_gas != intent.max_fee_per_gas
        || verified.max_priority_fee_per_gas != intent.max_priority_fee_per_gas
    {
        return Err(ErrorCode::EffectMismatch);
    }
    Ok(verified.into())
}
