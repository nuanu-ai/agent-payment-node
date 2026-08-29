# Agent Payment Node

APN is an open-source, CLI-first payment runtime for AI agents. Its default
profile is a disposable local EVM wallet: APN creates it, reports the public
address for manual low-value funding, and uses the same durable core for Base
USDC transfers and standard x402 v2 purchases.

APN 0.3.0 targets Apple Silicon macOS, Base (chain ID 8453), native ETH for gas,
and canonical Base USDC. It does not require an Apple Developer identity, an
app bundle, a daemon, a browser extension, or the AI Labs Hub.

## Install

```sh
brew install nuanu-ai/tap/apn
```

The Formula installs the `apn` command and Homebrew `node@24` dependency. The
first wallet command creates `~/.apn` with mode `0700` and one encrypted wallet
envelope per profile with mode `0600`.

An agent can discover the complete installed contract without a repository or
README. Text help is available at every group and command; the versioned JSON
manifest is the machine source of truth:

```sh
apn --help
apn wallet --help
apn help pay transfer prepare
apn help --json
```

All discovery paths run before state, Keychain, wallet, policy, approval,
network, signing or payment construction. Successful help is raw text and the
manifest is one raw `apn.command-manifest.v1` JSON object. Operational commands
continue to emit exactly one `apn.cli.v1` envelope.

Local MCP clients can obtain a provider-neutral launch descriptor and start the
stdio server without editing any client configuration:

```sh
apn mcp config
apn mcp serve
```

The server exposes exactly sixteen catalog-derived tools: version, Keychain
doctor, wallet and wallet-policy operations plus x402 inspect/prepare/approve,
direct-transfer prepare/foreground handoff, operation status/resume and receipt
reads. It has no remote listener, remote transport or arbitrary sign/send tool.

## First journey

```sh
apn wallet ensure --profile default
apn wallet status --profile default
apn wallet balance --profile default --rpc-url https://rpc.example
```

To create or reuse a provider-managed profile, use the generic foreground path:

```sh
apn wallet connect --profile provider-one --provider coinbase-agentic-wallet
```

The CLI collects provider authentication only in the foreground. MCP returns
the exact CLI handoff before provider process access. The documented provider
client requires the email and one-time code in short-lived child argv; this is
a residual local same-user process-table risk, not OS-level argv secrecy. APN
does not log, persist or return those argv values or raw authentication output.

`wallet ensure` creates or reuses one stable address. Fund only that public
address, manually, with a small amount of Base ETH and Base USDC. APN never
prints or exports the private key.

Before unattended x402, the wallet owner must configure explicit limits. APN
does not compile or substitute monetary defaults:

```sh
apn wallet policy set --profile default \
  --max-balance-usdc-atomic <owner-limit-in-6-decimal-units> \
  --max-x402-amount-atomic <owner-limit-in-6-decimal-units> \
  [--max-balance-eth-wei <optional-owner-limit>]

apn wallet policy show --profile default
```

For example, one USDC is `1000000` atomic units. Creating a policy or raising
any limit requires the exact phrase shown in the foreground terminal. A pure
decrease is non-interactive. Omitting the optional ETH argument preserves its
existing value. `wallet balance` reports `policy_unconfigured`, `within_limit`
or `overfunded`, including exact excess. APN cannot stop inbound funding and
never sweeps or refunds automatically; an overfunded wallet is blocked from
starting a new unattended x402 purchase until the owner resolves it.

Prepare and approve a direct transfer:

```sh
apn pay transfer prepare --profile default \
  --to <recipient-address> \
  --amount-usdc 0.01 \
  --idempotency-key example-direct-001 \
  --rpc-url https://rpc.example

apn pay transfer approve --operation <operation-id> \
  --rpc-url https://rpc.example
```

The prepare step freezes recipient, amount, nonce, fees, calldata and expiry.
The approve step rechecks them and requires the exact phrase shown in the
foreground stdin/stderr TTY. A transaction hash is non-terminal: completion requires a
successful receipt containing the exact canonical-USDC `Transfer` event.
Calling direct approval through MCP never opens a TTY or loads signing material;
it returns the exact operation-bound CLI command to run in that foreground
terminal.

Inspect and buy a standard x402 resource:

```sh
apn x402 inspect --url https://seller.example/resource

apn x402 fetch prepare --profile default \
  --url https://seller.example/resource \
  --idempotency-key example-x402-001 \
  --rpc-url https://rpc.example

apn x402 fetch approve --operation <operation-id> \
  --rpc-url https://rpc.example
```

The approve command creates exactly one frozen EIP-3009 authorization. It does
not send the paid request; `operation resume` owns the next legal paid-request
or recovery transition. APN retries only when its durable recovery rules permit
a byte-identical paid request. The seller and facilitator own settlement
submission. APN requires a valid seller result and reconciled settlement
evidence before reporting a paid completion.

`x402 fetch prepare` uses the owner-approved profile maximum. An optional
`--max-amount-atomic` may only make that ceiling stricter for one call; it can
never raise the profile limit. The signed authorization amount always equals
the selected seller offer, not either ceiling.

If settlement is still pending, one bounded command can perform the existing
legal resume transition once and then observe the same operation through
read-only RPC reconciliation:

```sh
apn operation resume --operation <operation-id> \
  --rpc-url https://rpc.example \
  --wait-seconds 60
```

The wait accepts `1..300` seconds. After any one permitted paid request, the
observation loop cannot sign, submit, create another operation, or issue
another HTTP request. Timeout returns the same durable resumable operation.

## Durable commands

<!-- BEGIN APN COMMAND CATALOG -->
```text
apn --version
apn mcp serve
apn mcp config
apn doctor keychain
apn wallet ensure [--profile <profile>]
apn wallet connect --profile <profile> --provider <provider-id> [--expected-revision <positive-integer>]
apn wallet status [--profile <profile>]
apn wallet balance [--profile <profile>] --rpc-url <https-url>
apn wallet policy show --profile <profile>
apn wallet policy set --profile <profile> --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic> [--max-balance-eth-wei <wei>]
apn x402 inspect --url <https-url>
apn x402 fetch prepare --profile <profile> --url <https-url> --idempotency-key <key> --rpc-url <https-url> [--max-amount-atomic <atomic>]
apn x402 fetch approve --operation <operation-id> --rpc-url <https-url>
apn pay transfer prepare --profile <profile> --idempotency-key <key> --to <address> --amount-usdc <decimal> --rpc-url <https-url>
apn pay transfer approve --operation <operation-id> --rpc-url <https-url>
apn operation status --operation <operation-id>
apn operation resume --operation <operation-id> --rpc-url <https-url> [--wait-seconds <1..300>]
apn receipt get --operation <operation-id>
```
<!-- END APN COMMAND CATALOG -->

`apn doctor keychain` performs a read-only query against the ordinary login
Keychain. An `ok: true` result means the Keychain command path is usable; an
`absent` wallet status is expected before first wallet creation and does not
create a wrapping secret.

Every operational invocation emits exactly one `apn.cli.v1` JSON envelope. Raw private
keys, wrapping secrets, signed transaction bytes, x402 signatures and payment
headers are excluded from command output, public operation state and receipts.

## Custody and threat model

- `~/.apn/wallets/<profile>.json` is a versioned AES-256-GCM envelope.
- A random 256-bit wrapping secret is stored as the APN-specific generic
  password `ai.nuanu.apn.wrapping-secret.v1/default` in the ordinary macOS
  login Keychain, explicitly bound to `~/Library/Keychains/login.keychain-db`.
- HKDF-SHA-256 derives a per-write encryption key from a random 32-byte salt;
  the profile, address, chain, creation time and binding hash are authenticated
  as GCM additional data.
- The encrypted record also retains exact direct-transfer and x402 effect
  material so restart recovery never needs a second signature.
- State uses owner-only permissions, symlink/hardlink rejection, macOS kernel
  advisory locks, bounded canonical JSON and fsync-plus-atomic-rename writes.

This is `local_software_disposable` custody, not savings custody. Encryption
protects a copied `~/.apn` directory when the Keychain secret is absent. It
does not protect against compromise of the same unlocked login session, APN
process, user account or host. JavaScript/viem memory is garbage-collected, so
cryptographic zeroization of every transient key copy is not claimed. Missing
Keychain material, authentication failure, unsafe permissions or identity
mismatch fails closed and never rotates the wallet silently. Every contender
opens the same stable, owner-only hashed lock file and acquires it through the
fixed system `/usr/bin/lockf` adapter. APN waits up to five seconds when the
kernel lock is busy. Releasing the held file descriptor, including on process
exit or crash, releases the kernel lock; the stable lock file is never renamed
or unlinked and contains no PID, lease or recovery metadata.

On first creation only, APN invokes the fixed system `/usr/bin/security`
command with the generated wrapping secret in its `-w` password argument,
because the macOS CLI's prompt form reads from a controlling terminal rather
than piped stdin. That argument can be observed by another process already
running as the same user during the short creation window. This is inside the
declared same-unlocked-user compromise boundary; APN never returns the
wrapping secret or the encrypted wallet's private key to its caller.

The current MVP keeps recovery material in one authenticated wallet envelope
bounded to 1 MiB. Historical effects are not compacted automatically. Reaching
that bound rejects persistence and submission rather than overwriting the
wallet or receipts; envelope partitioning/compaction is a post-MVP capacity
item.

Direct-transfer approval requires foreground stdin/stderr attached to actual TTYs and an exact
operation-bound phrase. Input is bounded by a 60-second approval deadline;
timeout, interruption, or input failure closes the terminal and unwinds held
state locks. The Node implementation does not independently attest the
terminal's foreground process group. This is a human-confirmation boundary,
not protection against compromise of the same user session.

## Recovery guarantees

Idempotency keys resolve to one durable operation. APN persists effect binding
before submission, treats lost send responses as ambiguous, checks receipts
and confirmed nonce evidence before resubmission, and recovers only the exact
encrypted raw transaction or x402 authorization. Status and receipts survive
restart, reinstall and Formula upgrade because Homebrew does not own `~/.apn`.

## Proof boundary

Normal tests cover encryption negatives, permissions, concurrency,
create/reuse/restart, byte-identical direct-effect recovery, x402 authorization
recovery, idempotency, receipts and all previous APN journeys without public
network traffic or money. Local green tests are not live or production E2E.

Public release, clean Homebrew install and bounded live Base/x402 acceptance
are separately recorded release gates. The local stdio MCP surface projects
the same fifteen catalog-selected wallet, policy, payment, operation and
receipt commands through the shared binder/runtime/core path. Direct approval
remains foreground CLI only. Hub, contracts, remote MCP, provider wallets,
Stellar, Solana and TRON are outside this release.

The published npm archive includes `npm-shrinkwrap.json`; Formula installation
therefore resolves the exact integrity-pinned production dependency closure
recorded by this release.

The former signed-app/Cask path is retained only as a deferred historical
track under `packaging/`; it is not required by the Formula installation.

Licensed under the MIT License.
