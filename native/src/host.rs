use crate::protocol::{AgentResult, ErrorCode};
use crate::serve_one;
use crate::store::{PlatformStore, SecretData, SecureStore};
use std::ffi::OsString;
use std::fs::File;
use std::fs::OpenOptions;
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

const NODE_24: &str = "/opt/homebrew/opt/node@24/bin/node";
const CORE_RELATIVE_PATH: &str = "Resources/core/dist/bin.js";
const REQUEST_FD: RawFd = 3;
const RESPONSE_FD: RawFd = 4;

pub fn run_app(arguments: impl IntoIterator<Item = OsString>) -> AgentResult<ExitStatus> {
    let arguments: Vec<OsString> = arguments.into_iter().collect();
    let bundle = resolve_bundle()?;
    let store = match PlatformStore::from_signed_identity() {
        Ok(store) => {
            crate::code_signature::validate_bundle(&bundle, store.team_id())?;
            HostStore::Signed(store)
        }
        Err(ErrorCode::KeychainEntitlementMissing) if is_zero_native_version(&arguments) => {
            HostStore::VersionOnly
        }
        Err(error) => return Err(error),
    };
    let core = resolve_core(&bundle)?;
    validate_node()?;
    let _instance_lock = acquire_instance_lock()?;

    let request_pipe = anonymous_pipe()?;
    let response_pipe = anonymous_pipe()?;
    let child_request = duplicate_cloexec(request_pipe.write, 10)?;
    let child_response = duplicate_cloexec(response_pipe.read, 10)?;
    let maximum_fd = unsafe { libc::getdtablesize() }.clamp(64, 65_536);

    let mut command = Command::new(NODE_24);
    command
        .arg(&core)
        .args(&arguments)
        .env_clear()
        .env("APN_NATIVE_REQUEST_FD", REQUEST_FD.to_string())
        .env("APN_NATIVE_RESPONSE_FD", RESPONSE_FD.to_string())
        .env("APN_HOST_SERIALIZED", "1")
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    unsafe {
        command.pre_exec(move || {
            if libc::dup2(child_request, REQUEST_FD) < 0
                || libc::dup2(child_response, RESPONSE_FD) < 0
            {
                return Err(std::io::Error::last_os_error());
            }
            for fd in 5..maximum_fd {
                libc::close(fd);
            }
            Ok(())
        });
    }

    let child = command.spawn();
    close_fd(child_request);
    close_fd(child_response);
    close_fd(request_pipe.write);
    close_fd(response_pipe.read);
    let mut child = match child {
        Ok(child) => child,
        Err(_) => {
            close_fd(request_pipe.read);
            close_fd(response_pipe.write);
            return Err(ErrorCode::CoreUnavailable);
        }
    };

    let mut request_reader = unsafe { File::from_raw_fd(request_pipe.read) };
    let mut response_writer = unsafe { File::from_raw_fd(response_pipe.write) };
    let service_result = serve_one(&store, &mut request_reader, &mut response_writer);
    drop(response_writer);
    drop(request_reader);
    if let Err(error) = service_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    child.wait().map_err(|_| ErrorCode::CoreUnavailable)
}

enum HostStore {
    Signed(PlatformStore),
    VersionOnly,
}

impl SecureStore for HostStore {
    fn load(&self, service: &str, account: &str) -> AgentResult<Option<SecretData>> {
        match self {
            Self::Signed(store) => store.load(service, account),
            Self::VersionOnly => Err(ErrorCode::KeychainEntitlementMissing),
        }
    }

    fn create_once(&self, service: &str, account: &str, value: &[u8]) -> AgentResult<()> {
        match self {
            Self::Signed(store) => store.create_once(service, account, value),
            Self::VersionOnly => Err(ErrorCode::KeychainEntitlementMissing),
        }
    }

    #[cfg(feature = "acceptance-test")]
    fn delete_test(&self, service: &str, account: &str) -> AgentResult<()> {
        match self {
            Self::Signed(store) => store.delete_test(service, account),
            Self::VersionOnly => Err(ErrorCode::KeychainEntitlementMissing),
        }
    }
}

fn is_zero_native_version(arguments: &[OsString]) -> bool {
    arguments.len() == 1 && arguments[0].to_str() == Some("--version")
}

fn resolve_bundle() -> AgentResult<PathBuf> {
    let executable = std::env::current_exe()
        .and_then(|path| path.canonicalize())
        .map_err(|_| ErrorCode::BundleInvalid)?;
    if executable.file_name().and_then(|value| value.to_str()) != Some("APNKeychainAgent") {
        return Err(ErrorCode::BundleInvalid);
    }
    let macos = executable.parent().ok_or(ErrorCode::BundleInvalid)?;
    if macos.file_name().and_then(|value| value.to_str()) != Some("MacOS") {
        return Err(ErrorCode::BundleInvalid);
    }
    let contents = macos.parent().ok_or(ErrorCode::BundleInvalid)?;
    if contents.file_name().and_then(|value| value.to_str()) != Some("Contents") {
        return Err(ErrorCode::BundleInvalid);
    }
    let bundle = contents.parent().ok_or(ErrorCode::BundleInvalid)?;
    if bundle.file_name().and_then(|value| value.to_str()) != Some("APNKeychainAgent.app") {
        return Err(ErrorCode::BundleInvalid);
    }
    Ok(bundle.to_path_buf())
}

fn resolve_core(bundle: &Path) -> AgentResult<PathBuf> {
    let contents = bundle.join("Contents");
    let resources = contents
        .join("Resources")
        .canonicalize()
        .map_err(|_| ErrorCode::CoreUnavailable)?;
    let core = contents
        .join(CORE_RELATIVE_PATH)
        .canonicalize()
        .map_err(|_| ErrorCode::CoreUnavailable)?;
    if !core.starts_with(&resources) || !core.is_file() {
        return Err(ErrorCode::CoreUnavailable);
    }
    Ok(core)
}

fn validate_node() -> AgentResult<()> {
    let path = Path::new(NODE_24);
    let metadata = path.metadata().map_err(|_| ErrorCode::CoreUnavailable)?;
    if !metadata.is_file() || !is_executable(&metadata) {
        return Err(ErrorCode::CoreUnavailable);
    }
    Ok(())
}

fn acquire_instance_lock() -> AgentResult<File> {
    let directory = darwin_user_temp_dir()?;
    let metadata = directory.metadata().map_err(|_| ErrorCode::StateBusy)?;
    if !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o022 != 0
    {
        return Err(ErrorCode::StateBusy);
    }
    let path = directory.join("ai.nuanu.apn.lock");
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| ErrorCode::StateBusy)?;
    let metadata = file.metadata().map_err(|_| ErrorCode::StateBusy)?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.nlink() != 1
        || metadata.permissions().mode() & 0o777 != 0o600
    {
        return Err(ErrorCode::StateBusy);
    }
    let started = Instant::now();
    loop {
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Ok(file);
        }
        let error = std::io::Error::last_os_error();
        let would_block = error
            .raw_os_error()
            .is_some_and(|code| code == libc::EWOULDBLOCK || code == libc::EAGAIN);
        if !would_block || started.elapsed() >= Duration::from_secs(5) {
            return Err(ErrorCode::StateBusy);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn darwin_user_temp_dir() -> AgentResult<PathBuf> {
    let length = unsafe { libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, std::ptr::null_mut(), 0) };
    if length <= 1 || length > 4096 {
        return Err(ErrorCode::StateBusy);
    }
    let mut buffer = vec![0_u8; length];
    let written = unsafe {
        libc::confstr(
            libc::_CS_DARWIN_USER_TEMP_DIR,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
        )
    };
    if written != length || buffer.last() != Some(&0) {
        return Err(ErrorCode::StateBusy);
    }
    buffer.pop();
    let path = PathBuf::from(std::ffi::OsStr::from_bytes(&buffer));
    if !path.is_absolute() || !path_has_no_nul(&path) {
        return Err(ErrorCode::StateBusy);
    }
    Ok(path)
}

fn is_executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

struct Pipe {
    read: RawFd,
    write: RawFd,
}

fn anonymous_pipe() -> AgentResult<Pipe> {
    let mut descriptors = [-1; 2];
    if unsafe { libc::pipe(descriptors.as_mut_ptr()) } != 0 {
        return Err(ErrorCode::CoreUnavailable);
    }
    for descriptor in descriptors {
        let flags = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
        if flags < 0
            || unsafe { libc::fcntl(descriptor, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0
        {
            close_fd(descriptors[0]);
            close_fd(descriptors[1]);
            return Err(ErrorCode::CoreUnavailable);
        }
    }
    Ok(Pipe {
        read: descriptors[0],
        write: descriptors[1],
    })
}

fn duplicate_cloexec(descriptor: RawFd, minimum: RawFd) -> AgentResult<RawFd> {
    let duplicate = unsafe { libc::fcntl(descriptor, libc::F_DUPFD_CLOEXEC, minimum) };
    if duplicate < 0 {
        Err(ErrorCode::CoreUnavailable)
    } else {
        Ok(duplicate)
    }
}

fn close_fd(descriptor: RawFd) {
    if descriptor >= 0 {
        unsafe {
            libc::close(descriptor);
        }
    }
}

pub fn path_has_no_nul(path: &Path) -> bool {
    !path.as_os_str().as_bytes().contains(&0)
}

#[cfg(test)]
mod tests {
    use super::is_zero_native_version;
    use std::ffi::OsString;

    #[test]
    fn unsigned_identity_exception_is_exactly_zero_native_version() {
        assert!(is_zero_native_version(&[OsString::from("--version")]));
        assert!(!is_zero_native_version(&[]));
        assert!(!is_zero_native_version(&[
            OsString::from("--version"),
            OsString::from("wallet"),
        ]));
        assert!(!is_zero_native_version(&[OsString::from("wallet")]));
    }
}
