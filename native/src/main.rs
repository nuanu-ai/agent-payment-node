#[cfg(target_os = "macos")]
fn main() {
    use apn_keychain_agent::host::run_app;
    use std::ffi::OsString;

    let arguments: Vec<OsString> = std::env::args_os().skip(1).collect();

    #[cfg(feature = "acceptance-test")]
    if arguments.first().and_then(|value| value.to_str()) == Some("keychain-test") {
        use apn_keychain_agent::protocol::ErrorCode;
        use apn_keychain_agent::store::{PlatformStore, keychain_test_command};
        let result = if arguments.len() == 3 {
            let action = arguments[1].to_str().ok_or(ErrorCode::InvalidOperationId);
            let slot = arguments[2].to_str().ok_or(ErrorCode::InvalidOperationId);
            action
                .and_then(|action| slot.map(|slot| (action, slot)))
                .and_then(|(action, slot)| {
                    let store = PlatformStore::from_signed_identity()?;
                    keychain_test_command(&store, action, slot)
                })
        } else {
            Err(ErrorCode::InvalidOperationId)
        };
        match result {
            Ok(()) => {
                println!("APN_KEYCHAIN_TEST_OK");
                std::process::exit(0);
            }
            Err(error) => {
                eprintln!("{}", error.as_str());
                std::process::exit(2);
            }
        }
    }

    match run_app(arguments) {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("{}", error.as_str());
            std::process::exit(2);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("APN_PLATFORM_UNSUPPORTED");
    std::process::exit(2);
}
