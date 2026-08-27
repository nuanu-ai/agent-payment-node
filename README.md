# Agent Payment Node

APN is a local-first CLI for a disposable agent wallet, direct transfers, and
standard x402 payments. The agent calls one command surface; a signed native
app owns local custody and narrowly bounded signing.

The current local MVP targets Apple Silicon macOS, Base (chain ID 8453), native
ETH for gas, and the canonical Base USDC contract. It creates one stable EOA
per named profile, keeps the private key and replayable signed effect material
in the macOS data-protection Keychain, and never exposes a raw-key or
generic-signing API to Node.js.

## Intended install

The public release path is one command:

```text
brew install --cask nuanu-ai/tap/apn
```

The Cask will install `APNKeychainAgent.app`, Homebrew Node 24, and the `apn`
command. That Cask has not been published yet. The current artifact is an
unsigned structural build only.

## Commands

```text
apn --version
apn doctor keychain
apn wallet ensure [--profile <name>]
apn wallet status [--profile <name>]
apn wallet balance [--profile <name>] --rpc-url <https-url>
apn x402 inspect --url <https-url>
apn x402 fetch prepare --profile <name> --url <https-url> \
  --max-amount-atomic <base-units> --idempotency-key <key> \
  --rpc-url <https-url>
apn x402 fetch approve --operation <id> --rpc-url <https-url>
apn pay transfer prepare --profile <name> --to <0x-address> \
  --amount-usdc <decimal> --idempotency-key <key> --rpc-url <https-url>
apn pay transfer approve --operation <id> --rpc-url <https-url>
apn operation status --operation <id>
apn operation resume --operation <id> --rpc-url <https-url>
apn receipt get --operation <id>
```

Every result is one `apn.cli.v1` JSON object. A direct transfer is prepared and
frozen before the native host displays its complete economics on `/dev/tty`.
Direct-transfer signing requires the exact displayed approval phrase; there is
no `--yes`, stdin, environment-variable, socket, daemon, or unattended bypass.

APN treats a transaction hash as non-terminal evidence. `completed` requires a
successful receipt with the exact Base USDC `Transfer` event. Ambiguous send,
missing receipt, or unresolved nonce consumption remains non-success and is
recovered through the existing operation and exact signed bytes.

## Standard x402 flow

`x402 inspect` performs one unpaid public-HTTPS `GET`, validates the canonical
v2 `PAYMENT-REQUIRED` header, and returns compatible seller offers without
creating state, reading the wallet, or calling RPC. `x402 fetch prepare`
obtains a fresh 402, applies the caller's atomic-unit cap, checks the profile's
Base USDC balance and token domain at one pinned safe block, and freezes the
first fully payable seller-ordered offer under the idempotency key.

`x402 fetch approve` creates or reuses exactly one EIP-3009 authorization for
that frozen operation. This disposable-wallet path is unattended by design,
but it is not a reusable permission or generic signer: profile, target, payee,
amount, token, chain, nonce, validity, offer, and payment-identifier posture are
all bound before native signing. APN then repeats the exact `GET` with only the
canonical `PAYMENT-SIGNATURE` header. It never broadcasts an EVM transaction
and never calls facilitator verify/settle APIs; the seller/facilitator owns
submission, while APN validates the seller response and reconciles safe-chain
evidence through the explicit RPC endpoint.

After an ambiguous outcome, `operation resume` runs one bounded durable
reconciliation step and permits at most one byte-identical paid retry when the
recorded evidence allows it. Completed JSON or text seller content appears only
in the completing command's `data`; status and receipts expose safe metadata,
proof class, finality, transaction hashes, and recovery actions without the
seller body or replayable payment material.

## Custody and state

- Key and replayable direct-transfer/x402 authorization material:
  data-protection Keychain,
  `AfterFirstUnlockThisDeviceOnly`, non-synchronizing, exact Nuanu access group.
- Public state: `~/Library/Application Support/nuanu-apn`, resolved from the
  effective macOS user rather than caller-controlled `HOME`; it contains
  integrity-linked operation, recovery, result metadata, and receipts, not the
  private key, signature, or `PAYMENT-SIGNATURE` bytes.
- Wallet posture: disposable local software wallet. Fund only low value that
  the agent is allowed to spend; there is no backup or hardware-wallet claim.
- Network posture: explicit public HTTPS Base RPC only, with DNS/IP validation,
  response limits, chain checks, and no redirect following.

## Verification boundary

Local source proof covers exact-money parsing, idempotency, state recovery,
receipt validation, strict x402 wire handling, bounded retry and settlement
reconciliation, inherited-pipe IPC, bounded Rust signing, forbidden-surface
scans, strict Rust linting, Node 24 tests, and unsigned app structure. Tests use
injected deterministic ports and no public seller/RPC traffic or money.

It does **not** prove Developer ID signing, the exact provisioning profile,
data-protection Keychain behavior under the final identity, notarization,
Gatekeeper, a public Homebrew tap install, upgrade continuity, a live Base USDC
transfer, or a live paid x402 settlement. Those are explicit release/acceptance
gates; local GREEN is not production E2E.

Hub, MCP, external wallet providers, Stellar, Solana, and Tron are outside this
Slice. Standard x402 does not require the AI Labs Hub.

The repository is not published and its open-source license is not selected.
See `packaging/README.md` for the proof-linked release pipeline.
