# Deferred Apple/Cask release assembly

This directory belongs to the waiting Apple-profile Slice and is not the
default APN 0.2 distribution path. APN 0.2 uses the normal Homebrew Formula in
`nuanu-ai/homebrew-tap`, encrypted `~/.apn` custody and no signed app bundle.
The material below remains only for a future explicit return to that Slice.

The supported macOS artifact is an immutable zip containing
`APNKeychainAgent.app`. The public Cask installs that app, declares the
Homebrew `node@24` formula dependency, and exposes the app's native main
executable as `apn`.

`Casks/apn.rb.in` is a release template, not a publishable Cask. Release
assembly must replace every `__APN_*__` placeholder with the final version,
final post-stapling archive SHA-256, immutable arm64 release URL, and approved
homepage. A rendered Cask containing any placeholder is invalid.

The official Cask renderer accepts only an exact versioned asset under
`https://github.com/nuanu-ai/<repo>/releases/download/v<version>/` named
`APNKeychainAgent-<version>-arm64.zip`. Credentials, query strings, fragments,
other origins, mutable aliases, and alternate asset names fail closed.

The release pipeline is proof-linked and fail-closed:

1. `build-native-release.mjs` builds the arm64 Rust binary with the locked
   dependency graph and no Cargo features, rejects the acceptance-test command,
   and emits a hash-bound native-build manifest.
2. `assemble-macos-app.mjs` consumes that manifest, bundles the compiled core
   and production npm dependencies with development and optional peer packages
   omitted, rejects symlinks, and emits an unsigned structural manifest.
3. `verify-macos-app.mjs --mode structural` and
   `archive-structural-macos-app.mjs` prove only local layout/archive shape;
   `verify-cask-template.mjs` checks the checksum-bound Cask template in memory.
   None of these outputs is release-eligible.
4. With separate action-time authority, `sign-and-notarize-macos.sh` signs,
   verifies the exact profile/identity, submits to Apple, staples, runs
   Gatekeeper, and writes a notarized-app verification manifest.
5. `archive-macos-app.mjs` accepts only that manifest, re-verifies the app, and
   requires the independently supplied expected Nuanu Team ID. It captures a
   new verifier proof for both the source app and the extracted archive and
   requires exact version, Team ID, bundle ID, access group, architecture and
   bundle-digest equality before emitting the final archive manifest/checksum.
6. `render-cask.mjs` accepts only the final release-eligible archive manifest.
   It requires the expected Team ID again, extracts the archive, freshly
   re-runs notarized/Gatekeeper verification into another independent proof,
   compares the same complete identity tuple, and cannot render a publishable
   Cask from an older/unsigned archive or a hand-authored JSON claim.

Both release-only commands require the independently known Team ID rather than
trusting a manifest field:

```sh
node scripts/archive-macos-app.mjs \
  --app /absolute/APNKeychainAgent.app \
  --notarized-app-manifest /absolute/notarized-app.json \
  --expected-team-id ABCDEFGHIJ \
  --output /absolute/APNKeychainAgent-0.1.0-arm64.zip \
  --output-manifest /absolute/notarized-archive.json

node scripts/render-cask.mjs \
  --archive-manifest /absolute/notarized-archive.json \
  --expected-team-id ABCDEFGHIJ \
  --url https://github.com/nuanu-ai/agent-payment-node/releases/download/v0.1.0/APNKeychainAgent-0.1.0-arm64.zip \
  --homepage https://nuanu.ai/apn \
  --output /absolute/Casks/apn.rb
```

Outside a tap, Homebrew refuses `brew style --cask` by design. The local
structural gate therefore proves Ruby syntax, the required Cask DSL fields,
checksum binding, and Homebrew's file-level RuboCop checks. Full Cask-aware
`brew style --cask` and `brew install --cask nuanu-ai/tap/apn` are public-tap
acceptance gates, not local structural claims.

The release identity is fixed by the product contract:

- bundle ID: `ai.nuanu.apn.keychain-agent`;
- Keychain access-group suffix: `ai.nuanu.apn.keys`;
- one Nuanu Apple Developer Organization Team ID;
- Developer ID Application signature with hardened runtime and timestamp;
- embedded Developer ID provisioning profile authorizing the full Keychain
  access group;
- accepted notarization and a stapled ticket.

Local structural assembly does not satisfy those identity claims. Apple
credential access, notary submission, public release/tap mutation, Homebrew
publication, and live payment remain separately authorized actions.

Upgrades must preserve the same Team ID, bundle ID, designated requirement,
and Keychain access group. Neither Cask uninstall nor ordinary upgrade deletes
the wallet or public APN state.
