mod approval;
#[cfg(target_os = "macos")]
pub mod code_signature;
pub mod ethereum;
#[cfg(target_os = "macos")]
pub mod host;
pub mod protocol;
pub mod store;
pub mod x402;

use crate::ethereum::{
    PreparedTransfer, effect_slot, format_rfc3339_utc, parse_address, sign_transfer,
    validate_fingerprint, validate_operation_id, validate_profile, verify_effect,
    verify_material_matches_intent,
};
use crate::protocol::{
    AgentResult, EffectResult, ErrorCode, Operation, Request, WalletDescribeResult,
    WalletNotFoundResult, error_response, extract_request_id, parse_request, read_frame,
    require_eof, success_response, write_frame,
};
use crate::store::{
    SecureStore, StoredX402Authorization, create_effect_once, create_x402_authorization_once,
    describe_wallet, ensure_wallet, load_effect, load_wallet_secret, load_x402_authorization,
};
use crate::x402::{
    AuthorizationMaterial, PreparedAuthorization, X402AuthorizationError, X402AuthorizationRecovery,
};
use std::io::{Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};
use zeroize::Zeroize;

pub fn serve_one(
    store: &impl SecureStore,
    reader: &mut impl Read,
    writer: &mut impl Write,
) -> AgentResult<bool> {
    debug_assert_eq!(protocol::MAX_SESSION_FRAMES, 1);
    let frame = match read_frame(reader) {
        Ok(Some(frame)) => frame,
        Ok(None) => return Ok(false),
        Err(error) => {
            write_frame(writer, &error_response(None, error))?;
            return Ok(true);
        }
    };
    let response_request_id = extract_request_id(&frame);
    if let Err(error) = require_eof(reader) {
        write_frame(
            writer,
            &error_response(response_request_id.as_deref(), error),
        )?;
        return Ok(true);
    }
    let request = match parse_request(&frame) {
        Ok(request) => request,
        Err(error) => {
            write_frame(
                writer,
                &error_response(response_request_id.as_deref(), error),
            )?;
            return Ok(true);
        }
    };
    let request_id = request.request_id.clone();
    let mut response = match handle_request(store, request) {
        Ok(response) => response,
        Err(error) => error_response(Some(&request_id), error),
    };
    let result = write_frame(writer, &response);
    response.zeroize();
    result.map(|()| true)
}

fn handle_request(store: &impl SecureStore, request: Request) -> AgentResult<Vec<u8>> {
    let now = now_unix()?;
    match request.operation {
        Operation::WalletDescribe(payload) => match describe_wallet(store, &payload.profile)? {
            Some(wallet) => {
                success_response(&request.request_id, WalletDescribeResult::from(wallet))
            }
            None => success_response(&request.request_id, WalletNotFoundResult { found: false }),
        },
        Operation::WalletEnsure(payload) => {
            let created_at = format_rfc3339_utc(now)?;
            let wallet = ensure_wallet(store, &payload.profile, &created_at)?;
            success_response(&request.request_id, wallet)
        }
        Operation::ApproveAndSign(payload) => {
            let intent = PreparedTransfer::validate(*payload, now)?;
            let result = approve_and_sign(store, &intent)?;
            success_response(&request.request_id, result)
        }
        Operation::EffectMaterialGet(payload) => {
            validate_profile(&payload.profile)?;
            validate_operation_id(&payload.operation_id)?;
            validate_fingerprint(&payload.fingerprint)?;
            let account = effect_slot(
                &payload.profile,
                &payload.operation_id,
                &payload.fingerprint,
            );
            let material = load_effect(store, &account)?;
            let verified = verify_effect(
                &material.0,
                &payload.expected_transaction_hash,
                &payload.expected_raw_transaction_hash,
            )?;
            let wallet =
                describe_wallet(store, &payload.profile)?.ok_or(ErrorCode::WalletNotFound)?;
            if verified.sender != parse_address(&wallet.address)? {
                return Err(ErrorCode::EffectMismatch);
            }
            success_response(&request.request_id, verified.response())
        }
        Operation::X402ApproveAndAuthorize(payload) => {
            let intent = PreparedAuthorization::validate(*payload, now_unix_u64()?)
                .map_err(map_x402_error)?;
            let material = approve_and_authorize_x402(store, &intent)?;
            success_response(&request.request_id, material)
        }
        Operation::X402AuthorizationMaterialGet(payload) => {
            let material = get_x402_authorization(store, &payload)?;
            success_response(&request.request_id, material)
        }
    }
}

fn approve_and_authorize_x402(
    store: &impl SecureStore,
    intent: &PreparedAuthorization,
) -> AgentResult<AuthorizationMaterial> {
    let account = intent.effect_slot();
    match load_x402_authorization(store, &account) {
        Ok(stored) => return verify_stored_x402(intent, stored, None),
        Err(ErrorCode::X402AuthorizationNotFound) => {}
        Err(error) => return Err(error),
    }

    intent
        .ensure_live(now_unix_u64()?)
        .map_err(map_x402_error)?;
    let secret = load_wallet_secret(store, &intent.intent().profile)?;
    let secret_bytes: &[u8; 32] = secret
        .0
        .as_slice()
        .try_into()
        .map_err(|_| ErrorCode::WalletCorrupt)?;
    let material = intent
        .sign(secret_bytes, now_unix_u64()?)
        .map_err(map_x402_error)?;
    create_x402_authorization_once(store, &account, intent.intent(), &material)?;
    let stored = load_x402_authorization(store, &account)?;
    verify_stored_x402(intent, stored, None)
}

fn get_x402_authorization(
    store: &impl SecureStore,
    recovery: &X402AuthorizationRecovery,
) -> AgentResult<AuthorizationMaterial> {
    let now = now_unix_u64()?;
    recovery.validate(now).map_err(map_x402_error)?;
    let stored = load_x402_authorization(store, &recovery.effect_slot())?;
    let prepared =
        PreparedAuthorization::validate(stored.intent.clone(), now).map_err(map_x402_error)?;
    prepared
        .matches_recovery(recovery)
        .map_err(map_x402_error)?;
    verify_stored_x402(
        &prepared,
        stored,
        recovery.expected_signature_hash.as_deref(),
    )
}

fn verify_stored_x402(
    intent: &PreparedAuthorization,
    stored: StoredX402Authorization,
    expected_signature_hash: Option<&str>,
) -> AgentResult<AuthorizationMaterial> {
    if &stored.intent != intent.intent() {
        return Err(ErrorCode::X402AuthorizationMismatch);
    }
    intent
        .ensure_live(now_unix_u64()?)
        .map_err(map_x402_error)?;
    intent
        .verify_stored_material(&stored.material, expected_signature_hash, now_unix_u64()?)
        .map_err(map_x402_error)
}

fn map_x402_error(error: X402AuthorizationError) -> ErrorCode {
    match error {
        X402AuthorizationError::Invalid => ErrorCode::X402AuthorizationInvalid,
        X402AuthorizationError::Expired => ErrorCode::Expired,
        X402AuthorizationError::Mismatch => ErrorCode::X402AuthorizationMismatch,
        X402AuthorizationError::WalletCorrupt => ErrorCode::WalletCorrupt,
        X402AuthorizationError::Internal => ErrorCode::Internal,
    }
}

fn approve_and_sign(
    store: &impl SecureStore,
    intent: &PreparedTransfer,
) -> AgentResult<EffectResult> {
    let account = intent.effect_slot();
    match load_effect(store, &account) {
        Ok(existing) => {
            let verified = verify_material_matches_intent(&existing.0, intent)?;
            return Ok(verified.response());
        }
        Err(ErrorCode::EffectNotFound) => {}
        Err(error) => return Err(error),
    }

    approval::approve(intent)?;
    finish_approved_signing(store, intent)
}

fn finish_approved_signing(
    store: &impl SecureStore,
    intent: &PreparedTransfer,
) -> AgentResult<EffectResult> {
    intent.ensure_live(now_unix()?)?;
    let secret = load_wallet_secret(store, &intent.profile)?;
    let secret_bytes: &[u8; 32] = secret
        .0
        .as_slice()
        .try_into()
        .map_err(|_| ErrorCode::WalletCorrupt)?;
    let signed = sign_transfer(secret_bytes, intent)?;
    create_effect_once(store, &intent.effect_slot(), signed.raw.as_slice())?;
    Ok(signed.response())
}

fn now_unix() -> AgentResult<i64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ErrorCode::Internal)?;
    i64::try_from(duration.as_secs()).map_err(|_| ErrorCode::Internal)
}

fn now_unix_u64() -> AgentResult<u64> {
    u64::try_from(now_unix()?).map_err(|_| ErrorCode::Internal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ethereum::{
        Uint256, canonical_fingerprint, checksum_address, hex_encode, transfer_calldata,
    };
    use crate::protocol::{ApprovalPayload, ApproveAndSignPayload, TransactionPayload};
    use crate::store::{SecretData, ensure_wallet_with_secret};
    use crate::x402::{
        PaymentIdentifierPosture, PublicAuthorization, X402ApprovalIntent, X402Authorization,
        X402AuthorizationRecovery, X402Resource, X402TokenDomain,
    };
    use sha2::{Digest, Sha256};
    use std::collections::HashMap;
    use std::sync::Mutex;
    use zeroize::Zeroizing;

    #[derive(Default)]
    struct MemoryStore(Mutex<HashMap<(String, String), Vec<u8>>>);

    impl SecureStore for MemoryStore {
        fn load(&self, service: &str, account: &str) -> AgentResult<Option<SecretData>> {
            Ok(self
                .0
                .lock()
                .unwrap()
                .get(&(service.to_owned(), account.to_owned()))
                .cloned()
                .map(|value| SecretData(Zeroizing::new(value))))
        }

        fn create_once(&self, service: &str, account: &str, value: &[u8]) -> AgentResult<()> {
            let mut state = self.0.lock().unwrap();
            let key = (service.to_owned(), account.to_owned());
            if state.contains_key(&key) {
                return Err(ErrorCode::KeychainDuplicate);
            }
            state.insert(key, value.to_vec());
            Ok(())
        }

        #[cfg(feature = "acceptance-test")]
        fn delete_test(&self, service: &str, account: &str) -> AgentResult<()> {
            self.0
                .lock()
                .unwrap()
                .remove(&(service.to_owned(), account.to_owned()));
            Ok(())
        }
    }

    fn intent(secret: [u8; 32]) -> PreparedTransfer {
        let wallet = checksum_address(&crate::ethereum::address_from_secret(&secret).unwrap());
        let recipient = "0x1111111111111111111111111111111111111111";
        let calldata = transfer_calldata(
            &parse_address(recipient).unwrap(),
            &Uint256::parse_decimal("1000000").unwrap(),
        );
        let mut payload = ApproveAndSignPayload {
            profile: "local_software".to_owned(),
            operation_id: "op-test-1".to_owned(),
            fingerprint: "0".repeat(64),
            wallet_address: wallet,
            chain_id: 8453,
            transaction: TransactionPayload {
                transaction_type: "eip1559".to_owned(),
                to: crate::ethereum::BASE_USDC.to_owned(),
                value_atomic: "0".to_owned(),
                data: crate::ethereum::prefixed_hex(&calldata),
                nonce_atomic: "7".to_owned(),
                gas_limit_atomic: "65000".to_owned(),
                max_fee_per_gas_atomic: "200000000".to_owned(),
                max_priority_fee_per_gas_atomic: "100000000".to_owned(),
                access_list: vec![],
            },
            approval: ApprovalPayload {
                recipient: recipient.to_owned(),
                amount_atomic: "1000000".to_owned(),
                amount_decimal: "1".to_owned(),
                expires_at: "2026-08-26T00:10:00.000Z".to_owned(),
            },
        };
        payload.fingerprint = canonical_fingerprint(&payload).unwrap();
        assert_eq!(
            payload.fingerprint,
            "64e4fe55bb2338c4be197276132d2181f94958f46ce85d910c02cf51bf265a81"
        );
        let now = crate::ethereum::parse_rfc3339_utc("2026-08-26T00:05:00.000Z").unwrap();
        let mut intent = PreparedTransfer::validate(payload, now).unwrap();
        intent.expires_at_unix = i64::MAX;
        intent
    }

    fn x402_intent(secret: [u8; 32], now: u64) -> X402ApprovalIntent {
        let wallet = checksum_address(&crate::ethereum::address_from_secret(&secret).unwrap())
            .to_lowercase();
        let authorization = X402Authorization {
            from: wallet.clone(),
            to: "0x2222222222222222222222222222222222222222".to_owned(),
            value: "1250000".to_owned(),
            valid_after: "0".to_owned(),
            valid_before: (now + 60).to_string(),
            nonce: format!("0x{}", "ab".repeat(32)),
            created_at: now.to_string(),
        };
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
        let mut intent_hasher = Sha256::new();
        intent_hasher.update(b"apn.x402.authorization-intent.v1\0");
        intent_hasher.update(canonical.as_bytes());
        X402ApprovalIntent {
            profile: "local_software".to_owned(),
            operation_id: "01".repeat(32),
            fingerprint: "02".repeat(32),
            wallet,
            chain_id: crate::x402::CHAIN_ID.to_owned(),
            token: crate::x402::BASE_USDC.to_owned(),
            resource: X402Resource {
                origin: "https://seller.example".to_owned(),
                path: "/resource".to_owned(),
                url_hash: "03".repeat(32),
            },
            cap_atomic: "2000000".to_owned(),
            payee: authorization.to.clone(),
            amount_atomic: authorization.value.clone(),
            token_domain: X402TokenDomain {
                name: "USD Coin".to_owned(),
                version: "2".to_owned(),
            },
            authorization,
            payment_identifier_posture: PaymentIdentifierPosture::Absent,
            payment_identifier_value: None,
            offer_hash: "04".repeat(32),
            intent_hash: hex_encode(&intent_hasher.finalize()),
        }
    }

    fn x402_recovery(
        intent: &X402ApprovalIntent,
        expected_signature_hash: Option<String>,
    ) -> X402AuthorizationRecovery {
        X402AuthorizationRecovery {
            profile: intent.profile.clone(),
            operation_id: intent.operation_id.clone(),
            fingerprint: intent.fingerprint.clone(),
            wallet: intent.wallet.clone(),
            chain_id: intent.chain_id.clone(),
            token: intent.token.clone(),
            token_domain: intent.token_domain.clone(),
            authorization: PublicAuthorization {
                from: intent.authorization.from.clone(),
                to: intent.authorization.to.clone(),
                value: intent.authorization.value.clone(),
                valid_after: intent.authorization.valid_after.clone(),
                valid_before: intent.authorization.valid_before.clone(),
                nonce: intent.authorization.nonce.clone(),
            },
            intent_hash: intent.intent_hash.clone(),
            expected_signature_hash,
        }
    }

    #[test]
    fn sign_encode_recover_and_replay_use_identical_stored_bytes() {
        let store = MemoryStore::default();
        let mut secret = [0_u8; 32];
        secret[31] = 1;
        ensure_wallet_with_secret(&store, "local_software", "2026-08-26T00:00:00.000Z", secret)
            .unwrap();
        let intent = intent(secret);
        assert!(approval::approve_with_test_input(&intent, &intent.approval_phrase()).is_ok());
        let first = finish_approved_signing(&store, &intent).unwrap();
        let replay = verify_material_matches_intent(
            &load_effect(&store, &intent.effect_slot()).unwrap().0,
            &intent,
        )
        .unwrap()
        .response();
        assert_eq!(first.transaction_hash, replay.transaction_hash);
        assert_eq!(first.raw_transaction, replay.raw_transaction);
        assert_eq!(first.raw_transaction_hash, replay.raw_transaction_hash);
    }

    #[test]
    fn approval_test_hook_exists_only_under_cfg_test_and_refuses_wrong_phrase() {
        let mut secret = [0_u8; 32];
        secret[31] = 1;
        let intent = intent(secret);
        assert_eq!(
            approval::approve_with_test_input(&intent, "yes"),
            Err(ErrorCode::ApprovalRefused)
        );
    }

    #[test]
    fn signing_refuses_material_that_expired_after_approval() {
        let store = MemoryStore::default();
        let mut secret = [0_u8; 32];
        secret[31] = 1;
        ensure_wallet_with_secret(&store, "local_software", "2026-08-26T00:00:00.000Z", secret)
            .unwrap();
        let mut expired = intent(secret);
        expired.expires_at_unix = 0;
        assert!(matches!(
            finish_approved_signing(&store, &expired),
            Err(ErrorCode::Expired)
        ));
    }

    #[test]
    fn x402_compound_create_loads_first_and_recovery_returns_identical_material() {
        let store = MemoryStore::default();
        let mut secret = [0_u8; 32];
        secret[31] = 1;
        ensure_wallet_with_secret(&store, "local_software", "2026-08-27T00:00:00.000Z", secret)
            .unwrap();
        let now = now_unix_u64().unwrap();
        let frozen = x402_intent(secret, now);
        let prepared = PreparedAuthorization::validate(frozen.clone(), now).unwrap();
        let first = approve_and_authorize_x402(&store, &prepared).unwrap();
        let replay = approve_and_authorize_x402(&store, &prepared).unwrap();
        assert_eq!(first.signature.as_str(), replay.signature.as_str());
        assert_eq!(first.signature_hash, replay.signature_hash);

        let recovered = get_x402_authorization(
            &store,
            &x402_recovery(&frozen, Some(first.signature_hash.clone())),
        )
        .unwrap();
        assert_eq!(first.signature.as_str(), recovered.signature.as_str());
        assert_eq!(first.signature_hash, recovered.signature_hash);

        let conflicting = AuthorizationMaterial {
            authorization: first.authorization.clone(),
            signature: Zeroizing::new(first.signature.as_str().to_owned()),
            signature_hash: "00".repeat(32),
        };
        assert_eq!(
            create_x402_authorization_once(&store, &prepared.effect_slot(), &frozen, &conflicting,),
            Err(ErrorCode::EffectMismatch)
        );

        let mut changed = frozen.clone();
        changed.offer_hash = "05".repeat(32);
        let changed = PreparedAuthorization::validate(changed, now).unwrap();
        assert_eq!(
            approve_and_authorize_x402(&store, &changed).unwrap_err(),
            ErrorCode::X402AuthorizationMismatch
        );
        assert_eq!(
            get_x402_authorization(&store, &x402_recovery(&frozen, Some("00".repeat(32))),)
                .unwrap_err(),
            ErrorCode::X402AuthorizationMismatch
        );
    }

    #[test]
    fn child_session_may_finish_without_a_native_request() {
        let store = MemoryStore::default();
        let mut reader = std::io::Cursor::new(Vec::<u8>::new());
        let mut writer = Vec::new();
        assert_eq!(serve_one(&store, &mut reader, &mut writer), Ok(false));
        assert!(writer.is_empty());
    }
}
