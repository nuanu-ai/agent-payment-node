use crate::ethereum::{
    address_from_secret, binding_hash, checksum_address, hex_encode, validate_profile,
};
use crate::protocol::{AgentResult, ErrorCode, WalletResult};
use crate::x402::{AuthorizationMaterial, X402ApprovalIntent};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

const WALLET_SERVICE: &str = "ai.nuanu.apn.wallet.v1";
const EFFECT_SERVICE: &str = "ai.nuanu.apn.effect.v1";
const X402_EFFECT_SERVICE: &str = "ai.nuanu.apn.x402-effect.v1";
#[cfg(feature = "acceptance-test")]
const TEST_SERVICE: &str = "ai.nuanu.apn.TEST.v1";

pub struct SecretData(pub Zeroizing<Vec<u8>>);

pub trait SecureStore {
    fn load(&self, service: &str, account: &str) -> AgentResult<Option<SecretData>>;
    fn create_once(&self, service: &str, account: &str, value: &[u8]) -> AgentResult<()>;

    #[cfg(feature = "acceptance-test")]
    fn delete_test(&self, service: &str, account: &str) -> AgentResult<()>;
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WalletMetadata {
    version: String,
    profile: String,
    address: String,
    created_at: String,
    binding_hash: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredX402Authorization {
    pub intent: X402ApprovalIntent,
    pub material: AuthorizationMaterial,
}

#[derive(Serialize)]
#[serde(deny_unknown_fields)]
struct StoredX402AuthorizationRef<'a> {
    intent: &'a X402ApprovalIntent,
    material: &'a AuthorizationMaterial,
}

pub fn describe_wallet(
    store: &impl SecureStore,
    profile: &str,
) -> AgentResult<Option<WalletResult>> {
    validate_profile(profile)?;
    let (secret_account, metadata_account) = wallet_accounts(profile);
    let secret = store.load(WALLET_SERVICE, &secret_account)?;
    let metadata = store.load(WALLET_SERVICE, &metadata_account)?;
    match (secret, metadata) {
        (None, None) => Ok(None),
        (Some(secret), Some(metadata)) => {
            Ok(Some(validate_wallet_pair(profile, &secret.0, &metadata.0)?))
        }
        _ => Err(ErrorCode::WalletCorrupt),
    }
}

pub fn ensure_wallet(
    store: &impl SecureStore,
    profile: &str,
    created_at: &str,
) -> AgentResult<WalletResult> {
    validate_profile(profile)?;
    let (secret_account, metadata_account) = wallet_accounts(profile);
    let secret = store.load(WALLET_SERVICE, &secret_account)?;
    let metadata = store.load(WALLET_SERVICE, &metadata_account)?;
    match (secret, metadata) {
        (Some(secret), Some(metadata)) => validate_wallet_pair(profile, &secret.0, &metadata.0),
        (Some(secret), None) => {
            create_metadata(store, profile, created_at, &metadata_account, &secret.0)
        }
        (None, Some(_)) => Err(ErrorCode::WalletCorrupt),
        (None, None) => {
            let secret = generate_secret()?;
            match store.create_once(WALLET_SERVICE, &secret_account, secret.as_ref()) {
                Ok(()) => create_metadata(
                    store,
                    profile,
                    created_at,
                    &metadata_account,
                    secret.as_ref(),
                ),
                Err(ErrorCode::KeychainDuplicate) => {
                    let existing = store
                        .load(WALLET_SERVICE, &secret_account)?
                        .ok_or(ErrorCode::WalletCorrupt)?;
                    create_metadata(store, profile, created_at, &metadata_account, &existing.0)
                }
                Err(error) => Err(error),
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn ensure_wallet_with_secret(
    store: &impl SecureStore,
    profile: &str,
    created_at: &str,
    secret: [u8; 32],
) -> AgentResult<WalletResult> {
    validate_profile(profile)?;
    let (secret_account, metadata_account) = wallet_accounts(profile);
    if store.load(WALLET_SERVICE, &secret_account)?.is_none() {
        store.create_once(WALLET_SERVICE, &secret_account, &secret)?;
    }
    let loaded = store
        .load(WALLET_SERVICE, &secret_account)?
        .ok_or(ErrorCode::WalletCorrupt)?;
    match store.load(WALLET_SERVICE, &metadata_account)? {
        Some(metadata) => validate_wallet_pair(profile, &loaded.0, &metadata.0),
        None => create_metadata(store, profile, created_at, &metadata_account, &loaded.0),
    }
}

fn create_metadata(
    store: &impl SecureStore,
    profile: &str,
    created_at: &str,
    metadata_account: &str,
    secret: &[u8],
) -> AgentResult<WalletResult> {
    let secret: &[u8; 32] = secret.try_into().map_err(|_| ErrorCode::WalletCorrupt)?;
    let address = checksum_address(&address_from_secret(secret)?);
    let binding_hash = binding_hash(profile, &address, created_at)?;
    let metadata = WalletMetadata {
        version: "apn.wallet.v1".to_owned(),
        profile: profile.to_owned(),
        address: address.clone(),
        created_at: created_at.to_owned(),
        binding_hash: binding_hash.clone(),
    };
    let encoded = Zeroizing::new(serde_json::to_vec(&metadata).map_err(|_| ErrorCode::Internal)?);
    match store.create_once(WALLET_SERVICE, metadata_account, &encoded) {
        Ok(()) => Ok(WalletResult {
            profile: profile.to_owned(),
            address,
            created_at: created_at.to_owned(),
            binding_hash,
        }),
        Err(ErrorCode::KeychainDuplicate) => {
            let current = store
                .load(WALLET_SERVICE, metadata_account)?
                .ok_or(ErrorCode::WalletCorrupt)?;
            validate_wallet_pair(profile, secret, &current.0)
        }
        Err(error) => Err(error),
    }
}

fn validate_wallet_pair(
    profile: &str,
    secret: &[u8],
    metadata: &[u8],
) -> AgentResult<WalletResult> {
    let secret: &[u8; 32] = secret.try_into().map_err(|_| ErrorCode::WalletCorrupt)?;
    let metadata: WalletMetadata =
        serde_json::from_slice(metadata).map_err(|_| ErrorCode::WalletCorrupt)?;
    if metadata.version != "apn.wallet.v1" || metadata.profile != profile {
        return Err(ErrorCode::WalletCorrupt);
    }
    let actual_address = checksum_address(&address_from_secret(secret)?);
    let expected_binding = binding_hash(profile, &metadata.address, &metadata.created_at)?;
    if metadata.address != actual_address || metadata.binding_hash != expected_binding {
        return Err(ErrorCode::WalletMismatch);
    }
    Ok(WalletResult {
        profile: metadata.profile,
        address: metadata.address,
        created_at: metadata.created_at,
        binding_hash: metadata.binding_hash,
    })
}

pub fn load_wallet_secret(store: &impl SecureStore, profile: &str) -> AgentResult<SecretData> {
    validate_profile(profile)?;
    let (secret_account, metadata_account) = wallet_accounts(profile);
    let secret = store
        .load(WALLET_SERVICE, &secret_account)?
        .ok_or(ErrorCode::WalletNotFound)?;
    let metadata = store
        .load(WALLET_SERVICE, &metadata_account)?
        .ok_or(ErrorCode::WalletCorrupt)?;
    validate_wallet_pair(profile, &secret.0, &metadata.0)?;
    Ok(secret)
}

fn wallet_accounts(profile: &str) -> (String, String) {
    let profile_hash = hex_encode(&Sha256::digest(profile.as_bytes()));
    (
        format!("APN:wallet:{profile_hash}:secret"),
        format!("APN:wallet:{profile_hash}:metadata"),
    )
}

pub fn load_effect(store: &impl SecureStore, account: &str) -> AgentResult<SecretData> {
    store
        .load(EFFECT_SERVICE, account)?
        .ok_or(ErrorCode::EffectNotFound)
}

pub fn create_effect_once(
    store: &impl SecureStore,
    account: &str,
    raw_transaction: &[u8],
) -> AgentResult<()> {
    match store.create_once(EFFECT_SERVICE, account, raw_transaction) {
        Ok(()) => Ok(()),
        Err(ErrorCode::KeychainDuplicate) => {
            let existing = load_effect(store, account)?;
            if existing.0.as_slice() == raw_transaction {
                Ok(())
            } else {
                Err(ErrorCode::EffectMismatch)
            }
        }
        Err(error) => Err(error),
    }
}

pub fn load_x402_authorization(
    store: &impl SecureStore,
    account: &str,
) -> AgentResult<StoredX402Authorization> {
    let encoded = store
        .load(X402_EFFECT_SERVICE, account)?
        .ok_or(ErrorCode::X402AuthorizationNotFound)?;
    serde_json::from_slice(&encoded.0).map_err(|_| ErrorCode::X402AuthorizationInvalid)
}

pub fn create_x402_authorization_once(
    store: &impl SecureStore,
    account: &str,
    intent: &X402ApprovalIntent,
    material: &AuthorizationMaterial,
) -> AgentResult<()> {
    let encoded = Zeroizing::new(
        serde_json::to_vec(&StoredX402AuthorizationRef { intent, material })
            .map_err(|_| ErrorCode::Internal)?,
    );
    match store.create_once(X402_EFFECT_SERVICE, account, &encoded) {
        Ok(()) => Ok(()),
        Err(ErrorCode::KeychainDuplicate) => {
            let existing = store
                .load(X402_EFFECT_SERVICE, account)?
                .ok_or(ErrorCode::X402AuthorizationNotFound)?;
            if existing.0.as_slice() == encoded.as_slice() {
                Ok(())
            } else {
                Err(ErrorCode::EffectMismatch)
            }
        }
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "macos")]
fn generate_secret() -> AgentResult<Zeroizing<[u8; 32]>> {
    use security_framework::random::SecRandom;
    for _ in 0..16 {
        let mut secret = Zeroizing::new([0_u8; 32]);
        SecRandom::default()
            .copy_bytes(secret.as_mut())
            .map_err(|_| ErrorCode::KeychainUnavailable)?;
        if address_from_secret(&secret).is_ok() {
            return Ok(secret);
        }
    }
    Err(ErrorCode::Internal)
}

#[cfg(not(target_os = "macos"))]
fn generate_secret() -> AgentResult<Zeroizing<[u8; 32]>> {
    Err(ErrorCode::KeychainUnavailable)
}

#[cfg(all(target_os = "macos", feature = "acceptance-test"))]
pub fn keychain_test_command(
    store: &impl SecureStore,
    action: &str,
    slot: &str,
) -> AgentResult<()> {
    if !slot.starts_with("TEST-")
        || slot.len() > 64
        || !slot
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(ErrorCode::InvalidOperationId);
    }
    let account = format!("APN:{slot}");
    match action {
        "create" => {
            let mut value = Zeroizing::new([0_u8; 32]);
            security_framework::random::SecRandom::default()
                .copy_bytes(value.as_mut())
                .map_err(|_| ErrorCode::KeychainUnavailable)?;
            store.create_once(TEST_SERVICE, &account, value.as_ref())
        }
        "delete" => store.delete_test(TEST_SERVICE, &account),
        _ => Err(ErrorCode::UnsupportedOperation),
    }
}

#[cfg(target_os = "macos")]
mod keychain;

#[cfg(target_os = "macos")]
pub use keychain::PlatformStore;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

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

    #[test]
    fn wallet_is_create_once_and_reused() {
        let store = MemoryStore::default();
        let mut secret = [0_u8; 32];
        secret[31] = 1;
        let first = ensure_wallet_with_secret(
            &store,
            crate::ethereum::PROFILE,
            "2026-08-26T00:00:00.000Z",
            secret,
        )
        .unwrap();
        let second = ensure_wallet_with_secret(
            &store,
            crate::ethereum::PROFILE,
            "2026-08-27T00:00:00.000Z",
            secret,
        )
        .unwrap();
        assert_eq!(first.address, second.address);
        assert_eq!(first.created_at, second.created_at);
        assert_eq!(
            describe_wallet(&store, crate::ethereum::PROFILE)
                .unwrap()
                .unwrap()
                .address,
            first.address
        );
    }

    #[test]
    fn metadata_without_secret_fails_closed() {
        let store = MemoryStore::default();
        let (_, metadata_account) = wallet_accounts(crate::ethereum::PROFILE);
        store
            .create_once(WALLET_SERVICE, &metadata_account, b"{}")
            .unwrap();
        assert_eq!(
            describe_wallet(&store, crate::ethereum::PROFILE).unwrap_err(),
            ErrorCode::WalletCorrupt
        );
    }

    #[test]
    fn effect_slot_is_create_once_and_mismatch_is_refused() {
        let store = MemoryStore::default();
        create_effect_once(&store, "APN:effect:test", b"signed-1").unwrap();
        create_effect_once(&store, "APN:effect:test", b"signed-1").unwrap();
        assert_eq!(
            create_effect_once(&store, "APN:effect:test", b"signed-2"),
            Err(ErrorCode::EffectMismatch)
        );
    }
}
