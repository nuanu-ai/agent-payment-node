# Agent Payment Node

APN is a local-first CLI for a disposable agent wallet and standard payment
flows. The agent calls one command surface; a signed native app owns local
custody and narrowly bounded signing.

Slice 1 targets Apple Silicon macOS, Base (chain ID 8453), native ETH for gas,
and the canonical Base USDC contract. It creates one stable EOA per named
profile, keeps the private key and replayable signed transaction bytes in the
macOS data-protection Keychain, and never exposes a raw-key or generic-signing
API to Node.js.

## Intended install

The public release path is one command:

```text
brew install --cask nuanu-ai/tap/apn
```

The Cask will install `APNKeychainAgent.app`, Homebrew Node 24, and the `apn`
command. That Cask has not been published yet. The current artifact is an
unsigned structural build only.

## Slice 1 commands

```text
apn --version
apn doctor keychain
apn wallet ensure [--profile <name>]
apn wallet status [--profile <name>]
apn wallet balance [--profile <name>] --rpc-url <https-url>
apn pay transfer prepare --profile <name> --to <0x-address> \
  --amount-usdc <decimal> --idempotency-key <key> --rpc-url <https-url>
apn pay transfer approve --operation <id> --rpc-url <https-url>
apn operation status --operation <id>
apn operation resume --operation <id> --rpc-url <https-url>
apn receipt get --operation <id>
```

Every result is one `apn.cli.v1` JSON object. A transfer is prepared and frozen
before the native host displays its complete economics on `/dev/tty`. Signing
requires the exact displayed approval phrase; there is no `--yes`, stdin,
environment-variable, socket, daemon, or unattended bypass in this Slice.

APN treats a transaction hash as non-terminal evidence. `completed` requires a
successful receipt with the exact Base USDC `Transfer` event. Ambiguous send,
missing receipt, or unresolved nonce consumption remains non-success and is
recovered through the existing operation and exact signed bytes.

## Custody and state

- Key and signed effect material: data-protection Keychain,
  `AfterFirstUnlockThisDeviceOnly`, non-synchronizing, exact Nuanu access group.
- Public state: `~/Library/Application Support/nuanu-apn`, resolved from the
  effective macOS user rather than caller-controlled `HOME`.
- Wallet posture: disposable local software wallet. Fund only low value that
  the agent is allowed to spend; there is no backup or hardware-wallet claim.
- Network posture: explicit public HTTPS Base RPC only, with DNS/IP validation,
  response limits, chain checks, and no redirect following.

## Verification boundary

Local source proof covers exact-money parsing, idempotency, state recovery,
receipt validation, inherited-pipe IPC, bounded Rust signing, forbidden-surface
scans, strict Rust linting, Node 24 tests, and unsigned app/archive/Cask-template
structure. It uses mocks and no money.

It does **not** prove Developer ID signing, the exact provisioning profile,
data-protection Keychain behavior under the final identity, notarization,
Gatekeeper, a public Homebrew tap install, upgrade continuity, or a live Base
USDC transfer. Those are explicit release/acceptance gates.

Standard x402 is the next vertical Slice and is not present in Slice 1. Hub,
MCP, external wallet providers, Stellar, Solana, and Tron are outside this
Slice.

The repository is not published and its open-source license is not selected.
See `packaging/README.md` for the proof-linked release pipeline.
