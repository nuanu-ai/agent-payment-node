# Agent Payment Node

APN is an open-source, CLI-first payment runtime for AI agents. Its default
profile is a disposable local EVM wallet: APN creates it, reports the public
address for manual low-value funding, and uses the same durable core for Base
USDC transfers and standard x402 v2 purchases.

APN 0.5.7 targets Apple Silicon macOS, Base (chain ID 8453), native ETH for gas,
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

The server exposes exactly twenty-two catalog-derived tools: version, Keychain
doctor, wallet, provider-permission and wallet-policy operations plus x402 inspect/prepare/approve,
direct-transfer prepare/foreground handoff, operation status/resume and receipt
reads. It has no remote listener, remote transport or arbitrary sign/send tool.

## Supply-chain verification

Candidate and release artifacts are built twice with Node 24.15.0 and must be
byte-identical. The workflow emits the npm tarball, a deterministic SPDX 2.3
SBOM derived from the production lock graph, and a release manifest binding
their names, sizes and SHA-256 digests to the exact repository commit. GitHub
artifact attestations bind those bytes to the pinned workflow identity.

Verify a downloaded artifact with the GitHub CLI:

```sh
gh attestation verify nuanu-ai-apn-<version>.tgz \
  --repo nuanu-ai/agent-payment-node \
  --signer-workflow nuanu-ai/agent-payment-node/.github/workflows/release.yml \
  --source-ref refs/heads/main \
  --deny-self-hosted-runners
```

Before a Homebrew update, verify the tarball, SBOM and manifest locally and pass
the proposed Formula as `--formula`; the verifier rejects mutable URLs, version
drift and any digest not present in the manifest:

```sh
node scripts/verify-supply-chain.mjs verify \
  --artifact nuanu-ai-apn-<version>.tgz \
  --sbom nuanu-ai-apn-<version>.spdx.json \
  --manifest nuanu-ai-apn-<version>.release.json \
  --formula Formula/apn.rb
```

Public releases are created only by the manually dispatched, least-privilege
release workflow from an existing protected `vX.Y.Z` tag and an independently
supplied full commit SHA. Publication and Homebrew changes remain separate
owner actions.

## First journey

```sh
apn wallet ensure --profile default
apn wallet status --profile default
apn wallet balance --profile default --rpc-url https://rpc.example
```

To create or reuse a provider-managed profile, use the generic foreground path:

```sh
apn wallet connect --profile provider-one --provider coinbase-agentic-wallet
apn wallet connect --profile metamask --provider metamask-agent-wallet
apn wallet connect --profile metamask --provider metamask-agent-wallet --auth-method browser
apn wallet connect --profile smart-account --provider metamask-smart-account --auth-method browser \
  --permission-cap-usdc-atomic 2000000 \
  --permission-expires-at 2000000000 \
  --idempotency-key smart-account-connect-0001
```

The CLI first reuses an active provider session without another email or OTP
prompt. If no session is active, it collects provider authentication only in
the foreground. MCP returns canonical structured `cli_handoff_argv` before
provider process access; the human-readable `cli_handoff` and `next_actions`
are one centrally quoted POSIX projection. The documented provider client
requires the email and one-time code in short-lived child argv; this is a
residual local same-user process-table risk, not OS-level argv secrecy. APN does
not log, persist or return those argv values or raw authentication output.

The MetaMask profile is a dedicated MetaMask Agent Wallet server-wallet, not
the browser extension or the user's main MetaMask account. APN pins the
official `@metamask/agent-wallet@6.1.5` package internally. When no valid
provider session exists, APN supports MetaMask's own Mobile QR login and
browser login. Omitting `--auth-method` preserves Mobile QR; selecting
`--auth-method browser` runs the provider's Google/email dashboard plus
six-digit OTP-pairing flow. Both stay in the foreground terminal. APN never
receives or copies the QR payload, browser credentials, provider CLI token,
seed phrase or private key. It then initializes only `server-wallet` with
`Guard`, binds the exact selected EVM address, and fails closed if a later
provider session selects a different address. A normal user does not install
`mm` separately or add provider skills. Google, email and Mobile QR can resolve
to different MetaMask server-wallet addresses, so APN always binds the address
reported by the completed provider session.

The `metamask-smart-account` profile is a separate browser-extension flow. The
browser lists every request-capable EIP-6963 or legacy injected provider and
requires an explicit human click even when only one is present. Its source,
name, RDNS and UUID are self-reported unverified hints—not selection authority; icons are not rendered. The human chooses the wallet
they installed, selects an already-active official MetaMask Smart Account on
Base and reviews the exact caller-supplied USDC cap and absolute expiry; APN supplies no default. MetaMask keeps the owner key.
APN creates one session account, stores its key and the validated ERC-7715 grant only inside an
authenticated encrypted envelope under `~/.apn`, and never returns the key or
raw permission context. Repeating the same idempotency key reuses the same
pending or committed identity after interruption. `wallet permission list`,
`sync`, `disable`, and `forget` expose the provider-neutral lifecycle; local
disable/forget never claims MetaMask-side revocation. Direct Base-USDC transfer
is available through the common `pay transfer` commands. Standard x402 is
available when the selected Base offer explicitly advertises
`extra.assetTransferMethod: "erc7710"`; APN rejects EIP-3009-only offers for
this profile before creating any payment effect.

An existing Smart Account profile created by the connect/permission capability
can upgrade once, locally and without new browser consent, to the complete
direct-transfer and ERC-7710 x402 capability fingerprint. APN refuses any other
capability drift. The owner Smart Account remains the USDC sender; the encrypted
APN session account is only the delegated executor and Base gas payer.

MetaMask Agent Wallet direct transfer and standard x402 are available through
the same generic APN operation contract. For x402, that server-wallet signs only
the exact frozen EIP-3009 authorization; APN owns the seller HTTP request, safe
retry, settlement evidence and receipt. `wallet balance` remains an independent
Base RPC observation; provider login or address binding is not a balance or
spending-authority claim.

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

For the default local wallet, prepare freezes recipient, amount, nonce, fees,
calldata and expiry. For a bound Coinbase or MetaMask Agent Wallet profile it
instead freezes the public profile revision/capability/sender, provider
execution ownership, recipient, integer atomic amount and canonical decimal,
Base/canonical-USDC identity, foreground-approval policy and validated RPC
binding. For a MetaMask Smart Account it additionally freezes the existing
permission revision, root grant fingerprint, session executor, official
DelegationManager and permission expiry. Available provider balance is never
spending authority.

Approval rechecks the applicable frozen facts and requires the exact phrase
shown in the foreground stdin/stderr TTY. The Coinbase adapter then durably
marks `started` before invoking exact `awal@2.12.1` through `process.execPath`
with only `send <amount> <recipient> --chain base --asset usdc --json`. Any
possible post-child timeout, loss, nonzero exit, malformed response or missing
transaction hash becomes no-replay `ambiguous_effect`; status, resume and
restart only observe. A provider transaction hash is non-terminal: completion
requires an independent successful Base receipt containing the exact canonical-
USDC `Transfer` event for the frozen sender, recipient and atomic amount.
Terminal provider receipts are committed before their terminal operation link;
after a crash between those writes, resume or receipt recovery links the exact
orphan receipt without another provider or RPC effect. A terminal provider
operation is never readable without its authoritative receipt. If the provider
reports a different sender before start, APN marks the profile `drift_blocked`
and returns the exact foreground `wallet connect --expected-revision` rebind
path instead of suggesting another doomed transfer prepare.
The Coinbase direct adapter reuses the existing bounded AWAL process timeout; expiry is
only an ambiguity signal and never authorizes a retry or another provider call.
Calling direct approval through MCP never opens a TTY or loads signing material;
it returns canonical operation-bound argv plus a shell-quoted foreground
terminal projection. Raw control characters are rejected before either handoff
is returned.

For a MetaMask Smart Account, prepare checks the still-active root grant,
remaining official ERC-20 allowance, owner USDC and nonzero session gas balance
without creating a child delegation. After the common APN foreground approval,
the session derives one deterministic session-to-session child constrained to
the exact canonical-USDC transfer, one call, the frozen time window and the
session redeemer. APN submits one EIP-1559 call to the official MetaMask
DelegationManager. Once that valid signed child exists, APN simulates the exact
redemption, rechecks nonce stability and precise session gas sufficiency, then
signs the transaction. The owner Smart Account is the `Transfer` sender; tokens
are never prefunded into the session account. The signed transaction, child
context and root permission remain encrypted under `~/.apn`. Ambiguous
submission may rebroadcast the same sealed bytes at most once; completion still
requires the exact successful Base receipt and owner-to-recipient USDC log. This
path does not use Vault, Hub, deposits, a relayer or a new MetaMask popup.

For MetaMask, APN re-selects and cross-checks the exact bound server-wallet,
then invokes one canonical Base-USDC `mm transfer` after the same APN foreground
approval. If Guard requires mobile MFA, APN persists only an opaque provider
request reference and returns `provider_pending`; it never emits that reference
in CLI or MCP output. `operation resume --wait-seconds <1..300>` watches only
that request across restart. Provider denial or expiry terminalizes without a
transaction claim; timeout remains resumable; loss without a recovery reference
stays `ambiguous_effect` and cannot invoke a second transfer. A returned hash is
still non-terminal until APN independently proves the exact Base receipt and
canonical-USDC Transfer log.

MetaMask 6.1.5 may emit a notice followed by a summary as newline-delimited
JSON. APN accepts that exact streaming contract, persists the notice's opaque
request reference before returning, and rejects unknown records or conflicting
request identities. If an interrupted invocation is already
`ambiguous_effect` and the exact request ID is independently known from
MetaMask, `operation recover-provider-request` binds that one request without
creating, signing or submitting another transfer; ordinary `operation resume`
then watches it and still requires the exact Base receipt and Transfer log.

Pinned `awal@2.12.1` parses its decimal argument through JavaScript floating-
point arithmetic and also treats whole numbers greater than `100` as atomic
units. Before durable start or child creation, the Coinbase adapter emulates
that exact parser and accepts only a decimal whose provider result equals APN's
frozen integer atomic amount. APN does not substitute atomic argv, add a spend
cap or weaken its integer monetary authority.

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

For a local-software profile, approve creates exactly one frozen EIP-3009
authorization; `operation resume` owns the next legal byte-identical paid-request
or recovery transition under the existing durable rules. For a bound MetaMask
profile, APN re-selects the frozen Guard server-wallet and asks `mm` to sign
only that EIP-712 payload. If MetaMask returns MFA pending, APN encrypts the
opaque request reference under `~/.apn`; after restart, resume watches only
that request and never creates a second signature request. The signature and
PAYMENT-SIGNATURE header remain protected. APN independently recovers the
frozen payer before using them, then runs the same APN-owned HTTP, retry,
seller-result, settlement and receipt state machine as the local profile.
MetaMask's separate x402 helper is not invoked, and its Guard outflow limit is
not treated as covering typed-data x402; the owner-approved APN policy remains
mandatory.

For a bound Coinbase profile, approve rechecks the stored policy, profile and
balance, performs one final unpaid GET preflight, durably commits `started`,
and invokes exactly one AWAL provider-atomic GET. Coinbase owns payment and its
internal paid retry; status and resume are observation-only and never invoke
AWAL pay again. APN completes only when the bounded seller result joins one
exact successful outgoing Base-USDC Transfer in the fixed window from the
frozen lower block through the earliest block timestamp at or after
`started + 240000ms`.

The AWAL adapter accepts only its exact paid-success envelope and normalizes
seller `data` as bounded canonical JSON; provider metadata and raw process output
are discarded and never become seller result state.

If that exact settlement is independently proven but no usable seller result is
available, APN terminates the same operation as
`failed_settled_without_result`. The immutable receipt records the exact spent
amount and Transfer evidence without inventing seller success or seller data;
status, resume, restart and approval replay remain observation-only.

`x402 fetch prepare` uses the owner-approved profile maximum. An optional
`--max-amount-atomic` may only make that ceiling stricter for one call; it can
never raise the profile limit. The local signed authorization amount and the
Coinbase provider maximum both equal the selected seller offer, not either
ceiling.

If settlement is still pending, one bounded command can perform the existing
legal resume transition once and then observe the same operation through
read-only RPC reconciliation:

```sh
apn operation resume --operation <operation-id> \
  --rpc-url https://rpc.example \
  --wait-seconds 60
```

The wait accepts `1..300` seconds. It bounds settlement observation and an
already created MetaMask direct-transfer Guard request. MetaMask x402 signature
MFA is recovered by ordinary `operation resume` against the same encrypted
request reference. After any one permitted paid request, provider transfer or
signature request, recovery cannot create another effect. Timeout returns the
same durable resumable operation.

An eligible legacy Coinbase operation that is durably stuck at
`provider_evidence_capability_gap` can be closed from one independently known
Base transaction without calling Coinbase or replaying payment:

```sh
apn operation recover-transaction-settlement \
  --operation <operation-id> \
  --transaction-hash <transaction-hash> \
  --idempotency-key <recovery-idempotency-key> \
  --rpc-url https://rpc.example
```

This narrow recovery reads only that receipt, its canonical block and the safe
head. It never scans a block range, signs, submits, invokes AWAL or creates a
seller result. A matching Base-USDC transfer terminalizes once as
`failed_settled_without_result`; changed operation, transaction or idempotency
material fails closed.

Recover an independently known provider request without replaying a direct
transfer:

```sh
apn operation recover-provider-request \
  --operation <operation-id> \
  --provider-request-id <provider-request-id>

apn operation resume --operation <operation-id> \
  --rpc-url https://rpc.example \
  --wait-seconds 60
```

The opaque request ID is accepted only for an eligible ambiguous provider
transfer, is never returned verbatim, and cannot be rebound to a different
request or operation.

## Durable commands

<!-- BEGIN APN COMMAND CATALOG -->
```text
apn --version
apn mcp serve
apn mcp config
apn doctor keychain
apn wallet ensure [--profile <profile>]
apn wallet connect --profile <profile> --provider <provider-id> [--auth-method <method>] [--expected-revision <positive-integer>] [--permission-cap-usdc-atomic <atomic>] [--permission-expires-at <unix-seconds>] [--idempotency-key <key>]
apn wallet permission list --profile <profile>
apn wallet permission sync --profile <profile> --expected-revision <positive-integer>
apn wallet permission disable --profile <profile> --expected-revision <positive-integer>
apn wallet permission forget --profile <profile> --expected-revision <positive-integer>
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
apn operation recover-provider-request --operation <operation-id> --provider-request-id <provider-request-id>
apn operation recover-transaction-settlement --operation <operation-id> --transaction-hash <transaction-hash> --idempotency-key <key> --rpc-url <https-url>
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

Idempotency keys resolve to one durable operation. Local execution persists
effect binding before submission and recovers only the exact encrypted raw
transaction or x402 authorization. Provider-atomic direct execution persists a
no-replay start journal before child creation and never resends after a possible
effect. Both paths treat lost outcomes as ambiguous and require independent
receipt evidence. Status and receipts survive
restart, reinstall and Formula upgrade because Homebrew does not own `~/.apn`.

## Proof boundary

Normal tests cover encryption negatives, permissions, concurrency,
create/reuse/restart, byte-identical direct-effect recovery, local x402
authorization recovery, Coinbase x402 exact argv/deadline/no-replay and bounded
settlement evidence, idempotency, receipts and all previous APN journeys without
public network traffic or money. Deterministic green tests are source proof, not
live provider acceptance, payment proof or production E2E.

Public release, clean Homebrew install and bounded live Base/x402 acceptance
are separately recorded release gates. The local stdio MCP surface projects
the same seventeen catalog-selected wallet, policy, payment, operation and
receipt commands through the shared binder/runtime/core path. Direct approval
remains foreground CLI only. Coinbase x402 source and deterministic product
proof are included; live Coinbase/provider and paid acceptance are recorded as
separate release gates. Hub, contracts, remote MCP, other providers, Stellar,
Solana and TRON are outside this release.

The published npm archive includes `npm-shrinkwrap.json`, so Formula installation resolves the exact
integrity-pinned production closure. It preserves direct MetaMask pins and overrides only the
`@metamask/utils` UUID edge to patched `uuid@11.1.1`; packaging exercises ESM/CommonJS exports and the audit gate rejects `GHSA-w5hq-g745-h8pq`.

The former signed-app/Cask path is retained only as a deferred historical
track under `packaging/`; it is not required by the Formula installation.

Licensed under the MIT License.
