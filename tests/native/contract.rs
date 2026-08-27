use apn_keychain_agent::protocol::{
    ErrorCode, MAX_FRAME_BYTES, MAX_SESSION_FRAMES, Operation, PROTOCOL_VERSION, parse_request,
};

#[test]
fn native_protocol_has_only_the_bounded_six_operation_allowlist() {
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
fn exact_x402_create_and_recovery_schemas_are_distinct_and_closed() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../fixtures/x402/eip3009-authorization-v1.json"
    ))
    .unwrap();
    let create_payload = fixture["createPayload"].clone();
    let create = serde_json::json!({
        "version": "apn.native.v1",
        "requestId": "019d2f4a-172b-7e11-8a42-102030405060",
        "operation": "x402Exact.approveAndAuthorize",
        "payload": create_payload,
    });
    assert!(matches!(
        parse_request(&serde_json::to_vec(&create).unwrap())
            .unwrap()
            .operation,
        Operation::X402ApproveAndAuthorize(_)
    ));

    let source = &fixture["createPayload"];
    let recovery_payload = serde_json::json!({
        "profile": source["profile"],
        "operationId": source["operationId"],
        "fingerprint": source["fingerprint"],
        "wallet": source["wallet"],
        "chainId": source["chainId"],
        "token": source["token"],
        "tokenDomain": source["tokenDomain"],
        "authorization": {
            "from": source["authorization"]["from"],
            "to": source["authorization"]["to"],
            "value": source["authorization"]["value"],
            "validAfter": source["authorization"]["validAfter"],
            "validBefore": source["authorization"]["validBefore"],
            "nonce": source["authorization"]["nonce"],
        },
        "intentHash": source["intentHash"],
        "expectedSignatureHash": fixture["signatureHash"],
    });
    let recovery = serde_json::json!({
        "version": "apn.native.v1",
        "requestId": "019d2f4a-172b-7e11-8a42-102030405061",
        "operation": "x402Exact.authorizationMaterial.get",
        "payload": recovery_payload,
    });
    assert!(matches!(
        parse_request(&serde_json::to_vec(&recovery).unwrap())
            .unwrap()
            .operation,
        Operation::X402AuthorizationMaterialGet(_)
    ));

    let mut invalid = recovery.clone();
    invalid["payload"]["resource"] = source["resource"].clone();
    assert_eq!(
        parse_request(&serde_json::to_vec(&invalid).unwrap()).unwrap_err(),
        ErrorCode::InvalidSchema
    );
    let mut broad_recovery = recovery;
    broad_recovery["payload"]["authorization"]["createdAt"] =
        source["authorization"]["createdAt"].clone();
    assert_eq!(
        parse_request(&serde_json::to_vec(&broad_recovery).unwrap()).unwrap_err(),
        ErrorCode::InvalidSchema
    );
}

#[test]
fn shipping_sources_have_no_listener_path_or_approval_bypass() {
    let protocol = include_str!("../../native/src/protocol.rs");
    let host = include_str!("../../native/src/host.rs");
    let code_signature = include_str!("../../native/src/code_signature.rs");
    let approval = include_str!("../../native/src/approval.rs");
    let x402 = include_str!("../../native/src/x402.rs");
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
    assert!(!x402.contains("/dev/tty"));
    assert!(!x402.contains("approval::"));
    assert!(!x402.contains("rawTransaction"));
    assert!(!x402.contains("paymentHeader"));
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
