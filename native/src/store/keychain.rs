use super::{AgentResult, ErrorCode, SecretData, SecureStore};
use core_foundation::base::{CFType, TCFType};
use core_foundation::data::CFData;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use core_foundation_sys::array::{
    CFArrayGetCount, CFArrayGetTypeID, CFArrayGetValueAtIndex, CFArrayRef,
};
use core_foundation_sys::base::{CFGetTypeID, CFRelease, CFTypeRef};
use core_foundation_sys::error::CFErrorRef;
use core_foundation_sys::string::{CFStringGetTypeID, CFStringRef};
use security_framework::access_control::{ProtectionMode, SecAccessControl};
#[cfg(feature = "acceptance-test")]
use security_framework::passwords::delete_generic_password_options;
use security_framework::passwords::{PasswordOptions, generic_password};
use security_framework_sys::base::{errSecAuthFailed, errSecDuplicateItem, errSecItemNotFound};
use security_framework_sys::item::{
    kSecUseAuthenticationUI, kSecUseAuthenticationUISkip, kSecValueData,
};
use security_framework_sys::keychain_item::SecItemAdd;
use std::ffi::c_void;
use std::ptr;
use zeroize::Zeroizing;

const APPLICATION_SUFFIX: &str = ".ai.nuanu.apn.keychain-agent";
const ACCESS_GROUP_SUFFIX: &str = ".ai.nuanu.apn.keys";
const ERR_SEC_NOT_AVAILABLE: i32 = -25291;
const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;
const ERR_SEC_MISSING_ENTITLEMENT: i32 = -34018;

type SecTaskRef = *const c_void;

#[link(name = "Security", kind = "framework")]
unsafe extern "C" {
    fn SecTaskCreateFromSelf(allocator: *const c_void) -> SecTaskRef;
    fn SecTaskCopyValueForEntitlement(
        task: SecTaskRef,
        entitlement: CFStringRef,
        error: *mut CFErrorRef,
    ) -> CFTypeRef;
}

pub struct MacKeychainStore {
    team_id: String,
    access_group: String,
}

impl MacKeychainStore {
    pub fn from_signed_identity() -> AgentResult<Self> {
        let task = unsafe { SecTaskCreateFromSelf(ptr::null()) };
        if task.is_null() {
            return Err(ErrorCode::IdentityInvalid);
        }
        let result = (|| {
            let application_id = entitlement_string(task, "com.apple.application-identifier")?;
            let team_id = entitlement_string(task, "com.apple.developer.team-identifier")?;
            if team_id.is_empty()
                || team_id.len() > 32
                || !team_id.bytes().all(|byte| byte.is_ascii_alphanumeric())
                || application_id != format!("{team_id}{APPLICATION_SUFFIX}")
            {
                return Err(ErrorCode::IdentityInvalid);
            }
            let expected = format!("{team_id}{ACCESS_GROUP_SUFFIX}");
            let groups = entitlement_strings(task, "keychain-access-groups")?;
            if !groups.iter().any(|group| group == &expected) {
                return Err(ErrorCode::KeychainEntitlementMissing);
            }
            Ok(Self {
                team_id,
                access_group: expected,
            })
        })();
        unsafe { CFRelease(task) };
        result
    }

    pub fn team_id(&self) -> &str {
        &self.team_id
    }

    fn options(&self, service: &str, account: &str) -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(service, account);
        options.set_access_group(&self.access_group);
        options.set_access_synchronized(Some(false));
        options.use_protected_keychain();
        #[allow(deprecated)]
        options.query.push((
            unsafe { CFString::wrap_under_get_rule(kSecUseAuthenticationUI) },
            unsafe { CFString::wrap_under_get_rule(kSecUseAuthenticationUISkip) }.into_CFType(),
        ));
        options
    }
}

impl SecureStore for MacKeychainStore {
    fn load(&self, service: &str, account: &str) -> AgentResult<Option<SecretData>> {
        match generic_password(self.options(service, account)) {
            Ok(value) => Ok(Some(SecretData(Zeroizing::new(value)))),
            Err(error) if error.code() == errSecItemNotFound => Ok(None),
            Err(error) => Err(map_status(error.code())),
        }
    }

    fn create_once(&self, service: &str, account: &str, value: &[u8]) -> AgentResult<()> {
        let mut options = self.options(service, account);
        let access_control = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleAfterFirstUnlockThisDeviceOnly),
            0,
        )
        .map_err(|error| map_status(error.code()))?;
        options.set_access_control(access_control);
        #[allow(deprecated)]
        options.query.push((
            unsafe { CFString::wrap_under_get_rule(kSecValueData) },
            CFData::from_buffer(value).into_CFType(),
        ));
        #[allow(deprecated)]
        let params = CFDictionary::<CFString, CFType>::from_CFType_pairs(&options.query);
        let status = unsafe { SecItemAdd(params.as_concrete_TypeRef(), ptr::null_mut()) };
        if status == 0 {
            Ok(())
        } else {
            Err(map_status(status))
        }
    }

    #[cfg(feature = "acceptance-test")]
    fn delete_test(&self, service: &str, account: &str) -> AgentResult<()> {
        if service != super::TEST_SERVICE || !account.starts_with("APN:TEST-") {
            return Err(ErrorCode::InvalidOperationId);
        }
        match delete_generic_password_options(self.options(service, account)) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == errSecItemNotFound => Ok(()),
            Err(error) => Err(map_status(error.code())),
        }
    }
}

fn entitlement_string(task: SecTaskRef, key: &str) -> AgentResult<String> {
    let value = copy_entitlement(task, key)?;
    if unsafe { CFGetTypeID(value) } != unsafe { CFStringGetTypeID() } {
        unsafe { CFRelease(value) };
        return Err(ErrorCode::IdentityInvalid);
    }
    let string = unsafe { CFString::wrap_under_create_rule(value as CFStringRef) }.to_string();
    Ok(string)
}

fn entitlement_strings(task: SecTaskRef, key: &str) -> AgentResult<Vec<String>> {
    let value = copy_entitlement(task, key)?;
    if unsafe { CFGetTypeID(value) } != unsafe { CFArrayGetTypeID() } {
        unsafe { CFRelease(value) };
        return Err(ErrorCode::IdentityInvalid);
    }
    let array = value as CFArrayRef;
    let count = unsafe { CFArrayGetCount(array) };
    if count <= 0 || count > 32 {
        unsafe { CFRelease(value) };
        return Err(ErrorCode::IdentityInvalid);
    }
    let mut output = Vec::with_capacity(count as usize);
    for index in 0..count {
        let element = unsafe { CFArrayGetValueAtIndex(array, index) } as CFTypeRef;
        if element.is_null() || unsafe { CFGetTypeID(element) } != unsafe { CFStringGetTypeID() } {
            unsafe { CFRelease(value) };
            return Err(ErrorCode::IdentityInvalid);
        }
        output.push(unsafe { CFString::wrap_under_get_rule(element as CFStringRef) }.to_string());
    }
    unsafe { CFRelease(value) };
    Ok(output)
}

fn copy_entitlement(task: SecTaskRef, key: &str) -> AgentResult<CFTypeRef> {
    let key = CFString::new(key);
    let mut error: CFErrorRef = ptr::null_mut();
    let value =
        unsafe { SecTaskCopyValueForEntitlement(task, key.as_concrete_TypeRef(), &mut error) };
    if !error.is_null() {
        unsafe { CFRelease(error as CFTypeRef) };
    }
    if value.is_null() {
        Err(ErrorCode::KeychainEntitlementMissing)
    } else {
        Ok(value)
    }
}

fn map_status(status: i32) -> ErrorCode {
    match status {
        value if value == errSecDuplicateItem => ErrorCode::KeychainDuplicate,
        value if value == errSecItemNotFound => ErrorCode::KeychainNotFound,
        value if value == errSecAuthFailed || value == ERR_SEC_INTERACTION_NOT_ALLOWED => {
            ErrorCode::KeychainLocked
        }
        ERR_SEC_NOT_AVAILABLE => ErrorCode::KeychainUnavailable,
        ERR_SEC_MISSING_ENTITLEMENT => ErrorCode::KeychainEntitlementMissing,
        _ => ErrorCode::KeychainFailure,
    }
}

pub use MacKeychainStore as PlatformStore;
