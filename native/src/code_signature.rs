#[cfg(target_os = "macos")]
mod macos {
    use crate::protocol::{AgentResult, ErrorCode};
    use core_foundation::base::{CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use core_foundation::url::CFURL;
    use core_foundation_sys::base::CFRelease;
    use core_foundation_sys::string::CFStringRef;
    use core_foundation_sys::url::CFURLRef;
    use std::ffi::c_void;
    use std::path::Path;
    use std::ptr;

    type SecStaticCodeRef = *const c_void;
    type SecRequirementRef = *const c_void;

    const CHECK_ALL_ARCHITECTURES: u32 = 1 << 0;
    const CHECK_NESTED_CODE: u32 = 1 << 3;
    const STRICT_VALIDATE: u32 = 1 << 4;
    const RESTRICT_SYMLINKS: u32 = 1 << 7;
    const RESTRICT_TO_APP_LIKE: u32 = 1 << 8;
    const RESTRICT_SIDEBAND_DATA: u32 = 1 << 9;

    #[link(name = "Security", kind = "framework")]
    unsafe extern "C" {
        fn SecStaticCodeCreateWithPath(
            path: CFURLRef,
            flags: u32,
            static_code: *mut SecStaticCodeRef,
        ) -> i32;
        fn SecRequirementCreateWithString(
            text: CFStringRef,
            flags: u32,
            requirement: *mut SecRequirementRef,
        ) -> i32;
        fn SecStaticCodeCheckValidity(
            static_code: SecStaticCodeRef,
            flags: u32,
            requirement: SecRequirementRef,
        ) -> i32;
    }

    pub fn validate_bundle(bundle: &Path, team_id: &str) -> AgentResult<()> {
        let url = CFURL::from_path(bundle, true).ok_or(ErrorCode::IdentityInvalid)?;
        let requirement_text = requirement_text(team_id)?;
        let requirement_string = CFString::new(&requirement_text);
        let mut requirement: SecRequirementRef = ptr::null();
        let mut static_code: SecStaticCodeRef = ptr::null();

        let requirement_status = unsafe {
            SecRequirementCreateWithString(
                requirement_string.as_concrete_TypeRef(),
                0,
                &mut requirement,
            )
        };
        if requirement_status != 0 || requirement.is_null() {
            return Err(ErrorCode::IdentityInvalid);
        }

        let create_status =
            unsafe { SecStaticCodeCreateWithPath(url.as_concrete_TypeRef(), 0, &mut static_code) };
        if create_status != 0 || static_code.is_null() {
            unsafe { CFRelease(requirement as CFTypeRef) };
            return Err(ErrorCode::IdentityInvalid);
        }

        let flags = CHECK_ALL_ARCHITECTURES
            | CHECK_NESTED_CODE
            | STRICT_VALIDATE
            | RESTRICT_SYMLINKS
            | RESTRICT_TO_APP_LIKE
            | RESTRICT_SIDEBAND_DATA;
        let validity_status =
            unsafe { SecStaticCodeCheckValidity(static_code, flags, requirement) };
        unsafe {
            CFRelease(static_code as CFTypeRef);
            CFRelease(requirement as CFTypeRef);
        }
        if validity_status == 0 {
            Ok(())
        } else {
            Err(ErrorCode::IdentityInvalid)
        }
    }

    fn requirement_text(team_id: &str) -> AgentResult<String> {
        if team_id.is_empty()
            || team_id.len() > 32
            || !team_id.bytes().all(|byte| byte.is_ascii_alphanumeric())
        {
            return Err(ErrorCode::IdentityInvalid);
        }
        Ok(format!(
            "anchor apple generic and identifier \"ai.nuanu.apn.keychain-agent\" and certificate leaf[subject.OU] = \"{team_id}\""
        ))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn requirement_is_exact_and_quotes_the_team_id() {
            assert_eq!(
                requirement_text("1ABCDEF234").unwrap(),
                "anchor apple generic and identifier \"ai.nuanu.apn.keychain-agent\" and certificate leaf[subject.OU] = \"1ABCDEF234\""
            );
            assert!(requirement_text("BAD TEAM").is_err());
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::validate_bundle;
