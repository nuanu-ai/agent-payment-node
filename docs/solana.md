# Solana mainnet direct transfers

APN sends native SOL, canonical USDC and pinned USDT on Solana mainnet from a
local software wallet. Every transfer needs two owner decisions (an allowlist
admission and a chain policy), a frozen preparation, and an explicit
foreground approval; APN signs locally and sends once.

| Profile | Account and balance | Direct transfer |
| --- | --- | --- |
| Local software | Separate encrypted ed25519 wallet | Available; foreground policy and payment approval required |
| Coinbase `awal` 2.12.1 | Existing authenticated Solana account only | Blocked: the pinned provider contract does not guarantee the fee/rent payer and sender debit cap |
| MetaMask smart account | Unavailable | Unavailable |
| MetaMask agent wallet | Unavailable | Unavailable |

No provider refusal ever switches an operation to the local signer.

Solana x402 `exact` payments are available on the local software profile only,
for a classic SPL mint of the frozen allowlist inventory (USDC, USDT) that the
owner admitted: an allowlist x402 row with the `x402-exact-svm` mechanism pin
and `wallet policy set --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp --asset <mint>`.
They need `APN_SOLANA_RPC_URL` set, and the seller's facilitator pays the fee.
Native SOL offers and Token-2022 mints are refused. Commands:
`x402 solana pay|observe|status`; details in
[x402-any-seller.md](x402-any-seller.md). The Coinbase and MetaMask profiles
have no Solana x402.

## Account and RPC

Inspect the capability matrix without network access:

```sh
apn wallet capabilities-solana
apn help --json
apn help wallet ensure-solana
apn help pay transfer prepare-solana
```

Every account or money command requires an explicit profile. A local Solana
wallet has its own encrypted seed and never reuses the profile's EVM key. Its
envelope uses the existing macOS login-Keychain wrapping secret, separate
chain records and owner-only storage under the APN state root. Repeating
`ensure-solana` keeps the same address; changing the profile's execution owner
or address is refused.

```sh
apn wallet ensure-solana --profile solana-local --provider local --accept-risk true
```

This command creates a real local wallet when run outside a test fixture.
Keep the custody acknowledgement explicit, and fund the returned public
address only after reviewing the intended account and network.

Normal Solana commands use the anonymous public mainnet RPC
`https://api.mainnet-beta.solana.com` when `APN_SOLANA_RPC_URL` is unset or
empty. No RPC account, signup or API key is required. Set
`APN_SOLANA_RPC_URL` only to choose another public HTTPS endpoint; an invalid
non-empty value refuses instead of falling back. URL credentials, query
parameters, fragments, private addresses and redirects are rejected. APN
verifies mainnet genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` at
execution and observation boundaries. Endpoint text and raw RPC errors are not
included in receipts. The common `--rpc-url` option selects the EVM RPC for
EVM operations only.

```sh
# Optional: choose another public HTTPS endpoint.
# export APN_SOLANA_RPC_URL=https://your-solana-mainnet-rpc.example
apn wallet balance-solana --profile solana-local --asset sol
apn wallet balance-solana --profile solana-local --asset usdc
```

### Assets

| `--asset` | Asset | Decimals |
| --- | --- | --- |
| `sol` | native SOL | 9 |
| `usdc` | Circle USDC, mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 |
| `usdt` | USDT from the frozen allowlist, mint `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | 6 |

Both tokens use the canonical SPL Token program and associated token
accounts, with the same mint, decimals and balance-delta evidence checks.
Arbitrary mints, Token-2022 assets and self-transfers are outside this direct
transfer. The Coinbase `awal` route has no USDT path.

## Policy, preparation and approval

Every asset starts denied. Two owner decisions are needed:

1. The owner allowlist policy must admit the asset on the `direct` rail; its
   per-operation and daily caps apply (see
   [allowlist-direct-integration.md](allowlist-direct-integration.md)).
2. The chain policy, admitted in a foreground terminal, caps the fee and rent
   in SOL and enforces its own per-transfer and UTC-daily principal limits.

Both are checked at prepare and again before signing; a transfer must fit
both. The example limits below only illustrate the syntax.

```sh
apn policy admit-solana --profile solana-local --asset usdc \
  --max-per-transfer 1 --daily-limit 3 --max-fee-sol 0.003
```

The terminal shows the exact account, genesis, mint, atomic limits and policy
identity, then requires the displayed phrase. MCP returns this foreground
handoff and cannot approve it. Policy replacement is blocked while the profile
has an unresolved money operation.

Amounts must be positive canonical decimal strings: `1`, `1.25` and
`0.000001` are accepted at the applicable precision. Signs, exponent notation,
whitespace, leading zeroes, trailing fractional zeroes and excess precision
are refused. USDC principal is never added to SOL fees as if they were the
same currency. Daily principal usage follows UTC in the shared allowlist usage
ledger; unresolved reservations keep counting across midnight. A confirmed
revert charges actual network fees and no delivered principal. Timeouts do not
release unknown reservations.

```sh
apn pay transfer prepare-solana --profile solana-local --asset usdc \
  --to <solana-recipient> --amount 1 --max-fee-sol 0.003 \
  --idempotency-key solana-example-001

apn pay transfer approve --operation <operation-id>
apn operation status --operation <operation-id>
apn operation resume --operation <operation-id>
apn receipt get --operation <operation-id>
```

Preparation performs public account, mint, funding, fee and rent checks and
freezes an unsigned intent. It sends no transaction. `--max-fee-sol` covers
the sender's network fee plus any recipient associated-account rent and must
fit the admitted cap. USDC and USDT transfers still need SOL for these costs.
If the recipient's associated account is absent, the frozen message includes
its exact idempotent creation and rent payer.

Approval expires 240 seconds after preparation. That deadline bounds the
owner's reading time only; it is not the sending window, which opens after
approval when the send guard takes a fresh block reference.

The terminal displays the sender, recipient, network, asset, decimal and
atomic amount, fee and rent payers and caps, policy, operation, fingerprint
and expiry, and states that the block reference is re-acquired after approval
and the exact bytes simulated before anything is signed. APN checks the frozen
bounds before the prompt, in the send guard, and once more immediately before
sealing. Nothing re-reads the chain between sealing and the send, because the
network itself refuses an expired blockhash or an unfunded transfer. A
signature recovered by a later `operation resume` is revalidated once before
its send; a failed read leaves it sealed and resumable, and only proof
(expiry, funds, fee or owner policy) ends it unsent. A stale preparation fails
before effect and needs a new idempotency key.

### The send guard

After the owner approves and before anything is signed, the send guard runs
once:

1. It re-acquires the recent block reference and the current block height, so
   the sending window opens after the reading time rather than being consumed
   by it. The re-acquired window must not be older than the frozen one and
   must still leave at least 38 blocks (about 15 seconds at mainnet slot
   times). A validator that answers with an almost-closed window is refused.
2. It re-proves the frozen fee, rent, recipient-account and funding bounds
   against the re-acquired reference.
3. It simulates the exact bytes with `simulateTransaction` and
   `sigVerify: false`. Simulation produces no on-chain effect and needs no
   signature, so a transaction that would fail on chain is refused while no
   signature exists.

The result is a send binding (block reference, last valid block height,
observed block height, acquisition time and the simulation evidence), written
exactly once together with the durable `signing_started` transition. It is
outside the operation fingerprint, so re-acquiring a window never restates the
intent the owner approved, and it can never be restated afterwards: signing,
submission, recovery and finalized evidence all read that one recorded
window. `operation resume` reuses it and never simulates or re-binds a second
time.

A refusal by the send guard is terminal before effect and carries its own
reason, so a lost read never reads as a chain refusal:

| Reason | Meaning |
| --- | --- |
| `solana_simulation_unavailable` | The simulation read was lost in transport. APN re-runs the guard automatically up to 4 times, 5 seconds apart, while the approved window still leaves 15 seconds; each attempt re-acquires a fresh window. |
| `solana_simulation_protocol` | The simulation answer was malformed, or claimed success while executing nothing, so it proves nothing. |
| `solana_simulation_blockhash_not_found` | The validator does not know the re-acquired reference. |
| `solana_simulation_already_processed` | The validator has already seen this transaction. |
| `solana_simulation_insufficient_funds` | Fee or rent funding no longer covers the transfer. |
| `solana_simulation_instruction_error` | An instruction in the frozen message would fail. |
| `solana_simulation_rejected` | Any other refusal the validator names. |
| `pre_send_guard_refused` | The re-acquired window, fee, rent, recipient account or funding no longer matches the frozen intent. |

Only the transport loss is retried. Every chain answer and every malformed
answer ends the operation before any effect, with nothing signed and nothing
in custody. Prepare a new transfer with a new idempotency key.

### RPC requests and locks

- **Budget.** Each command invocation gets a fresh budget of 24 physical
  POSTs. A JSON-RPC batch counts as one POST, and the submission counts as
  one. The genesis hash is read once per command and RPC instance.
- **Pacing.** POST starts to the same provider are paced at least 750 ms apart
  across processes through durable state. HTTP 429 stops the command without
  a retry and starts a provider cooldown of 2 to 30 seconds that honours
  `Retry-After`; a command started inside it refuses with
  `APN_PROVIDER_UNAVAILABLE` / `rpc_provider_cooldown`.
- **Batching.** The send guard requests the fresh blockhash and confirmed
  block height in one JSON-RPC batch when the transport supports batching. On
  `api.mainnet-beta.solana.com` and `solana-rpc.publicnode.com`, which do not
  accept several account reads in one JSON-RPC batch, account reads go out as
  individual POSTs. On `api.mainnet-beta.solana.com`, a USDC transfer that
  creates the recipient account makes 12 physical requests in its approving
  command up to and including the send, so the finality observation that
  follows also fits the budget. With a batching endpoint, a SOL or USDC
  transfer uses 17 POSTs in total including preparation. These counts were
  measured against a test RPC; a live provider may still rate-limit requests.
- **Locks.** For local SOL, APN releases the profile and operation locks while
  it waits on RPC and on the owner: during prepare RPC, approval reads and the
  prompt, send binding and retry waits, signer revalidation, the first
  submission and finalized observation. It reacquires them for journal
  comparisons and transitions; before signing and the first send it also
  rechecks the account, policy and owner allowlist. The per-key prepare claim
  and the per-operation approval claim still serialize that work across RPC
  waits. Owner abandonment performs its history reads and the foreground
  prompt outside the locks, then rechecks the journal, account, policy and
  allowlist before committing.

## Recovery and completion

Local signing stores one encrypted transaction bound to the operation and its
fingerprint. Submission intent is durable before the first send. APN never
reconstructs or resends a transaction after a possible broadcast. A crash
before the first submission may recover that same sealed effect; a crash after
the submission boundary permits observation only.

`operation resume` makes one bounded observation and does not accept
`--wait-seconds` for this rail. Confirmed-only status, missing history,
invalid evidence or an expired blockhash after a possible broadcast remain
unresolved. Do not create a replacement payment for such an operation.
Same-key replay returns the same intent; conflicting intents and other money
operations on the same active profile are refused.

Completion requires finalized evidence with cryptographically verified signed
bytes, exact instructions, account roles, sender and recipient effects and
actual fees and rent. SOL needs the exact native balance effects. Token
transfers additionally need the exact mint, account owners and token deltas.
A finalized rollback records a failed terminal receipt only after verifying
its identity and fee-only effect. Provider evidence supports only finite
legacy or v0 messages without address-table lookups and with validated
optional compute-budget instructions.

The durable operation is authoritative. If writing its derived receipt was
interrupted, receipt access gives a recovery action, and `operation resume`
repairs that receipt under the same locks. Terminal outcomes cannot change.
Signed payloads, seeds and provider raw output never appear in public
operation or receipt responses.

### Expired unlanded transfer

A local transfer can stay `unknown_finality` when submission lost its response
and the RPC never reports the signature. `operation resume` keeps observing
and never resends it. After the finalized block height passes the frozen
`lastValidBlockHeight` and `getSignatureStatuses` with history still returns
no status, the owner may end the operation in a foreground terminal:

```sh
apn operation abandon --operation <operation-id>
```

The terminal shows the account, recipient, amount and the exact phrase. The
operation becomes `abandoned_unknown`, its receipt records owner
acknowledgement only, and the profile can prepare a new transfer. The
financial outcome stays unknown because RPC history can be incomplete; APN
refuses abandonment while the window is open or the signature is visible.

## Coinbase `awal` boundary

`wallet ensure-solana --profile <profile> --provider coinbase-awal` links an
already authenticated pinned `awal` account. APN does not log in or enroll it.
The existing profile owner must agree; no key is exported into APN custody.

The adapter validates the pinned account, balance and send-result formats.
Transfer preparation returns `APN_PROVIDER_CAPABILITY_UNAVAILABLE` before
launching a send, because `awal` does not attest the required network-fee cap
and associated-account rent payer. If a future supported contract admits it,
an ambiguous provider invocation is durably recorded and never re-launched;
without a trusted signature it requires manual reconciliation.

## Compatibility

Records that never re-bound a send window, including every TRON record, omit
the send binding entirely and keep their exact previous shape, identity hash
and receipt.
