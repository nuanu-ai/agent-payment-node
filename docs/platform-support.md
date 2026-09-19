# Platform support matrix

This matrix records the platform boundary for the APN package in this source
tree. It is a source and packaging contract; it is not a claim about a future
port, a published release, or live payment acceptance.

## Current support

| Platform | Distribution | Credential custody | Status |
| --- | --- | --- | --- |
| macOS Apple Silicon (`darwin` / `arm64`) | Homebrew Formula (`nuanu-ai/tap/apn`) with Homebrew `node@24` | The APN wrapping secret is stored in the user's macOS login Keychain at `~/Library/Keychains/login.keychain-db` and accessed through `/usr/bin/security` | **Supported** |
| Linux | No package or release target | No supported credential backend | **Unsupported** |
| Windows | No package or release target | No supported credential backend | **Unsupported** |

The package manifest is deliberately restricted to `os: ["darwin"]` and
`cpu: ["arm64"]`. The native release build is deliberately fixed to the
`aarch64-apple-darwin` target. The current runtime also depends on macOS
login-Keychain custody and the macOS advisory-lock implementation. Homebrew
Formula installation is the supported delivery path; the signed app/Cask lane
under `packaging/` is deferred historical work.

The `os`, `cpu`, native-target, documentation, and workflow assertions are
covered by `tests/packaging/platform-support.test.mjs`. That test is a
deterministic source invariant only. It does not prove signing, publication,
installation, or live use.

## Required work before a Linux or Windows support claim

Each target requires all of the following before it can be added to the
package or release matrix:

1. **Credential backend:** implement and test a platform-appropriate protected
   credential store that preserves the current wallet binding, access-control,
   zeroization, and fail-closed behavior. A file-based secret or an unreviewed
   environment variable is not an equivalent backend.
2. **Native host and IPC:** provide the target's native host and bounded IPC
   adapter, including inherited-channel setup, one-request/one-response
   framing, executable identity checks, and the existing refusal of generic
   signing or send primitives.
3. **Locking:** provide an OS-native lock with equivalent serialization,
   ownership, symlink/hardlink, timeout, crash-release, and stale-state
   guarantees. The macOS `/usr/bin/lockf` behavior cannot be assumed on another
   operating system.
4. **Signing and toolchain:** define the target-specific signing or trust
   model, pinned Node and Rust toolchains, reproducible target build, artifact
   identity, and installer/package verification. macOS Developer ID and
   notarization evidence do not transfer to another target.
5. **CI and release:** add target-native CI runners and clean-system checks,
   dependency and packaging gates, immutable artifact and attestation proofs,
   publication/install procedures, and a target-specific release acceptance
   record. A successful cross-compile alone is insufficient.

Until those five workstreams have target-specific implementation and evidence,
Linux and Windows remain unsupported and must stay absent from `package.json`
`os`/`cpu` and the release workflows.
