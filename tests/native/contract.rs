use apn_keychain_agent::protocol::{
    ErrorCode, MAX_FRAME_BYTES, MAX_SESSION_FRAMES, PROTOCOL_VERSION, parse_request,
};

#[test]
fn native_protocol_has_only_the_slice_one_allowlist() {
    assert_eq!(PROTOCOL_VERSION, "apn.native.v1");
    assert_eq!(MAX_FRAME_BYTES, 64 * 1024);
    assert_eq!(MAX_SESSION_FRAMES, 1);
    let generic_sign = br#"{
        "version":"apn.native.v1",
        "requestId":"019d2f4a-172b-7e11-8a42-102030405060",
        "operation":"sign",
        "payload":{}
    }"#;
    assert_eq!(
        parse_request(generic_sign).unwrap_err(),
        ErrorCode::UnsupportedOperation
    );
}

#[test]
fn shipping_sources_have_no_listener_path_or_approval_bypass() {
    let protocol = include_str!("../../native/src/protocol.rs");
    let host = include_str!("../../native/src/host.rs");
    let code_signature = include_str!("../../native/src/code_signature.rs");
    let approval = include_str!("../../native/src/approval.rs");
    let store = format!(
        "{}\n{}",
        include_str!("../../native/src/store.rs"),
        include_str!("../../native/src/store/keychain.rs"),
    );

    for forbidden in ["TcpListener", "UnixListener", "bind(", "listen(", "socket("] {
        assert!(!protocol.contains(forbidden));
        assert!(!host.contains(forbidden));
    }
    assert!(!host.contains("APN_CORE_PATH"));
    assert!(!host.contains("APN_NODE_PATH"));
    assert!(host.contains(".env_clear()"));
    assert!(host.contains("APN_HOST_SERIALIZED"));
    assert!(host.contains("libc::flock"));
    assert!(host.contains("code_signature::validate_bundle"));
    assert!(code_signature.contains("SecStaticCodeCheckValidity"));
    assert!(code_signature.contains("STRICT_VALIDATE"));
    assert!(approval.contains("/dev/tty"));
    assert!(!approval.contains("--yes"));
    assert!(!approval.contains("stdin()"));
    assert!(!store.contains("kSecUseKeychain"));
    assert!(!store.contains("DefaultFileKeychain"));
    assert!(store.contains("kSecUseAuthenticationUI"));
    assert!(store.contains("kSecUseAuthenticationUISkip"));
}

#[test]
fn app_templates_bind_the_expected_identity_and_dp_keychain_group() {
    let info = include_str!("../../app/Info.plist");
    let entitlements = include_str!("../../app/APNKeychainAgent.entitlements");
    assert!(info.contains("ai.nuanu.apn.keychain-agent"));
    assert!(info.contains("${APP_IDENTIFIER_PREFIX}ai.nuanu.apn.keys"));
    assert!(entitlements.contains("com.apple.application-identifier"));
    assert!(entitlements.contains("${APP_IDENTIFIER_PREFIX}ai.nuanu.apn.keychain-agent"));
    assert!(entitlements.contains("keychain-access-groups"));
    assert!(entitlements.contains("${APP_IDENTIFIER_PREFIX}ai.nuanu.apn.keys"));
}
