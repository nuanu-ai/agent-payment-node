# APNKeychainAgent build and release boundary

`APNKeychainAgent` is a Rust macOS application executable. It must be packaged
as `APNKeychainAgent.app/Contents/MacOS/APNKeychainAgent`; it is not a bare
npm-installed helper and never selects the file Keychain.

Local source/unit proof (no signing and no Keychain access):

```sh
cargo test --offline
node scripts/build-native-release.mjs \
  --output-manifest /absolute/private/output/native-build.json \
  --target-dir /absolute/private/output/target
```

Packaging must substitute the placeholders in `app/Info.plist` and
`app/APNKeychainAgent.entitlements` from the Nuanu Organization Team ID and
provisioning profile. The resulting full access group must be
`<TeamID>.ai.nuanu.apn.keys`. The executable validates its own signed
application identifier, team identifier, and access-group entitlement before
launching the bundle-owned core. It also performs strict Security.framework
static-code validation of the complete bundle and resource seal against the
exact identifier and Team ID.

The compiled core belongs at
`Contents/Resources/core/dist/bin.js`. The host launches it only with
`/opt/homebrew/opt/node@24/bin/node` and connects it through two inherited
anonymous pipes. There is no socket, listener, daemon, filesystem IPC, or
environment-configurable executable/path fallback. The child environment is
cleared before launch, so Node loader/path/proxy/certificate injection variables
are not inherited. Commands that need no native operation exchange zero IPC
frames; all other invocations exchange at most one request/response and require
EOF after the sole frame.

The native allowlist has two x402-specific operations only:
`x402Exact.approveAndAuthorize` creates one exact EIP-3009 authorization in a
create-once Keychain slot, and `x402Exact.authorizationMaterial.get` recovers
that same material after a lost response or restart. The create-once approval
request and Keychain slot bind the profile, operation, wallet, offer, and
payment-identifier posture. The EIP-712 signature itself binds the Base USDC
token domain and exact EIP-3009 `from`, `to`, `value`, `validAfter`,
`validBefore`, and `nonce` fields. Neither operation accepts seller HTTP wire
bytes, exposes a generic signing primitive, or broadcasts a transaction.
Unlike direct transfer, this disposable-wallet x402 path intentionally has no
TTY prompt; its authority is the already frozen single-use authorization, not
a reusable session permission.

Before launching the core, the signed host acquires one effective-user macOS
advisory lock in `_CS_DARWIN_USER_TEMP_DIR`. The lock path is fixed, opened
without symlink following, verified as an owner-only single-link regular file,
and held across the complete child/native session. This kernel-owned outer lock
serializes all APN invocations; the core may remove an expired dead-PID state
lock only while running under that host serialization. A direct core launch
cannot perform stale-lock recovery or reach native custody/signing.

The `acceptance-test` Cargo feature adds a separately compiled
`keychain-test` subcommand whose slots must start with `TEST-`; that binary is
not a release artifact. Release evidence remains separate: exact signed hash
and architecture, profile/entitlement inspection, clean-host DP-Keychain
custody, Developer ID, notarization/Gatekeeper, and no-money assembled-app
acceptance. This source/build lane does not satisfy those gates.

Secret scalars, loaded Keychain values, signed-transaction and x402
authorization buffers, and the serialized native response buffer use
zeroizing owners. The IPC response must necessarily exist transiently in the
anonymous-pipe kernel buffer and in the child process for immediate use; the
native host cannot zero those copies after the write syscall. They must never
be logged or copied to public state by either side.
