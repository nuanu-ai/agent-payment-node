mod approval;
#[cfg(target_os = "macos")]
pub mod code_signature;
pub mod ethereum;
#[cfg(target_os = "macos")]
pub mod host;
pub mod protocol;
pub mod store;

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
    SecureStore, create_effect_once, describe_wallet, ensure_wallet, load_effect,
    load_wallet_secret,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ethereum::{Uint256, canonical_fingerprint, checksum_address, transfer_calldata};
    use crate::protocol::{ApprovalPayload, ApproveAndSignPayload, TransactionPayload};
    use crate::store::{SecretData, ensure_wallet_with_secret};
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
    fn child_session_may_finish_without_a_native_request() {
        let store = MemoryStore::default();
        let mut reader = std::io::Cursor::new(Vec::<u8>::new());
        let mut writer = Vec::new();
        assert_eq!(serve_one(&store, &mut reader, &mut writer), Ok(false));
        assert!(writer.is_empty());
    }
}
