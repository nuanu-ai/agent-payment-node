# Solana mainnet direct transfers

This APN 0.5.26 package includes local SOL, canonical USDC and pinned USDT
transfers on Solana mainnet. Package availability, clean installation and live mainnet
payment acceptance require separate evidence.

| Profile | Account and balance | Direct transfer |
| --- | --- | --- |
| Local software | Implemented with a separate encrypted ed25519 wallet | Implemented; foreground policy and payment approval required |
| Coinbase `awal` 2.12.1 | Existing authenticated Solana account only | Blocked: pinned provider contract does not guarantee the fee/rent payer and sender debit cap |
| MetaMask smart account | Unavailable | Unavailable |
| MetaMask agent wallet | Unavailable | Unavailable |

Solana x402 is unavailable. No provider refusal switches to a local signer.

## Account and RPC

Inspect the matrix without network access:

```sh
apn wallet capabilities-solana
apn help --json
apn help wallet ensure-solana
apn help pay transfer prepare-solana
```

Every account or money command requires an explicit profile. A local Solana
wallet has its own encrypted seed and never reuses the profile's EVM key. Its
envelope uses the existing macOS login-Keychain wrapping secret, separate chain
records and owner-only storage under the APN state root. Repeating ensure keeps
the same address; changing the profile's execution owner or address is refused.

```sh
apn wallet ensure-solana --profile solana-local --provider local --accept-risk true
```

This command creates a real local wallet when run outside a test fixture.
Keep the custody acknowledgement explicit. Only fund the returned public
address after reviewing the intended account and network.

Configure the intended public HTTPS RPC endpoint in `APN_SOLANA_RPC_URL`. There
is no default endpoint. URL credentials, query parameters, fragments, private
addresses and redirects are rejected. APN verifies mainnet genesis
`5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` at execution and observation
boundaries. Endpoint text and raw RPC errors are not included in receipts.

```sh
export APN_SOLANA_RPC_URL=https://your-solanamainnet-rpc.example
apn wallet balance-solana --profile solana-local --asset sol
apn wallet balance-solana --profile solana-local --asset usdc
```

The only assets are native SOL (9 decimals), Circle USDC mint
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6 decimals) and the frozen
allowlist's USDT mint `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`
(`--asset usdt`, 6 decimals). Both tokens use the canonical SPL Token program
and associated token accounts, with the same mint, decimals and balance-delta
evidence checks. Arbitrary mints, Token-2022 assets and self-transfers are
outside this bounded direct journey. The Coinbase `awal` route has no USDT path.

## Policy, preparation and approval

Both assets start denied. Two owner decisions are needed. The owner allowlist
policy must admit the asset on the `direct` rail; its per-operation and daily
caps are the only principal caps (see `docs/allowlist-direct-integration.md`).
The chain policy below, admitted in a foreground terminal, now caps only the
fee and rent in SOL; its principal flags are still required by the command but
are not enforced. These example limits illustrate the syntax.

```sh
apn policy admit-solana --profile solana-local --asset usdc \
  --max-per-transfer 1 --daily-limit 3 --max-fee-sol 0.003
```

The terminal shows the exact account, genesis, mint, atomic limits and policy
identity, then requires the displayed phrase. MCP returns this foreground
handoff and cannot approve it. Policy replacement is blocked while the profile
has an unresolved money operation.

Amounts must be positive canonical decimal strings: `1`, `1.25` and `0.000001`
are accepted at the applicable precision. Signs, exponent notation, whitespace,
leading zeroes, trailing fractional zeroes and excess precision are refused.
USDC principal is never added to SOL fees as if they were the same currency.
Daily principal usage follows UTC in the shared allowlist usage ledger;
unresolved reservations continue to count across midnight. A confirmed revert charges actual network fees and no delivered
principal. Timeouts do not release unknown reservations.

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
freezes an unsigned intent. It sends no transaction. `max-fee-sol` covers the
sender's network fee plus any recipient associated-account rent; it must fit
the admitted cap. USDC still needs SOL for these costs. If the recipient's
associated account is absent, the frozen message includes its exact idempotent
creation and rent payer.

Approval expires after 240 seconds. That deadline bounds the owner's reading
time only: it is not the sending window. Until 0.5.18 the whole operation was
valid for 60 seconds and the block reference frozen at preparation had to
survive the approval pause, so a careful owner could lose the transfer to a
reference that expired while the screen was being read.

The terminal displays the sender, recipient, network, asset, decimal and atomic
amount, fee/rent payers and caps, policy, operation, fingerprint and expiry, and
on a local Solana transfer states that the block reference is re-acquired after
approval and these exact bytes simulated before anything is signed. It rechecks
the frozen bounds before signing and submission. A stale preparation
fails before effect and needs a new idempotency key. Solana uses
`APN_SOLANA_RPC_URL`; the common `--rpc-url` option continues to select the EVM
RPC for EVM operations.

### The send guard

The native local adapter requests the fresh blockhash and confirmed block height
in one JSON-RPC batch when the RPC transport supports batching. This saves one
physical POST at the send guard without moving the approval, simulation, signer
or durable submission checkpoints. For local SOL, the operation service now
releases the profile and operation locks during prepare RPC, approval reads and
prompt, send binding and retry waits, signer revalidation, the first submission,
and finalized observation. It reacquires them for journal comparisons and
transitions; before signing and the first send it also rechecks the account,
policy and owner allowlist.
The per-key prepare claim and per-operation approval claim still serialize the
respective work across RPC waits. Owner abandonment still holds the profile and
operation locks during its validity-history RPC check and foreground prompt.
The production factory does not yet attach `SolanaRpcBudget` to `SolanaRpc`, so
the transport's shared physical request limit and two-per-second pacing are not
enabled for this live rail. Live request counts and rate-limit acceptance remain
unverified.

After the owner approves and before anything is signed, the send guard runs
once:

1. It re-acquires the recent block reference and the current block height, so
   the sending window opens after the reading time rather than being consumed
   by it. The re-acquired window must not be older than the frozen one and must
   still leave at least 38 blocks — about 15 seconds at mainnet slot times, the
   same margin the bridge rail already demands. A validator that answers with an
   almost-closed window is refused.
2. It re-proves the frozen fee, rent, recipient-account and funding bounds
   against the re-acquired reference.
3. It simulates the exact bytes with `simulateTransaction` and `sigVerify:
   false`. Simulation produces no on-chain effect and needs no signature, so a
   transaction that would fail on chain is refused while no signature exists.

The result is a send binding — block reference, last valid block height,
observed block height, acquisition time and the simulation evidence — written
exactly once, together with the durable `signing_started` transition. It is
outside the operation fingerprint, so re-acquiring a window never restates the
intent the owner approved, and it can never be restated afterwards: signing,
submission, recovery and finalized evidence all read that one recorded window.
`operation resume` reuses it and never simulates or re-binds a second time.
Records that never re-bound, including every TRON record, omit the field
entirely and keep their exact previous shape, identity hash and receipt.

A refusal by the send guard is terminal before effect and carries its own
reason, so a lost read never reads as a chain refusal:

| Reason | Meaning |
| --- | --- |
| `solana_simulation_unavailable` | The simulation read was lost in transport. Re-run up to 4 times, 5 seconds apart, while the approved window still leaves 15 seconds; each attempt re-acquires a fresh window. |
| `solana_simulation_protocol` | The simulation answer was malformed, or claimed success while executing nothing, so it proves nothing. |
| `solana_simulation_blockhash_not_found` | The validator does not know the re-acquired reference. |
| `solana_simulation_already_processed` | The validator has already seen this transaction. |
| `solana_simulation_insufficient_funds` | Fee or rent funding no longer covers the transfer. |
| `solana_simulation_instruction_error` | An instruction in the frozen message would fail. |
| `solana_simulation_rejected` | Any other refusal the validator names. |
| `pre_send_guard_refused` | The re-acquired window, fee, rent, recipient account or funding no longer matches the frozen intent. |

Only the transport loss is retried. Every chain answer and every malformed
answer is an answer, not noise, and ends the operation before any effect with
nothing signed and nothing in custody.

## Recovery and completion

Local signing stores one encrypted transaction bound to the operation and its
fingerprint. Submission intent is durable before the first send. APN never
reconstructs or resends a transaction after a possible broadcast. A crash before
the first submission may recover that same sealed effect; a crash after the
submission boundary permits observation only.

`operation resume` makes one bounded observation and does not accept
`--wait-seconds` for this rail. Confirmed-only status, missing history, invalid
evidence or an expired blockhash after possible broadcast remains unresolved.
Do not create a replacement payment for such an operation. Same-key replay
returns the same intent; conflicting intents and other money operations on the
same active profile are refused.

Completion requires finalized evidence with cryptographically verified signed
bytes, exact instructions, account roles, sender/recipient effects and actual
fees/rent. SOL needs the exact native balance effects. USDC additionally needs
the exact mint, account owners and token deltas. A finalized rollback records a
failed terminal receipt only after verifying its identity and fee-only effect.
Provider evidence supports only finite legacy/v0 messages without address-table
lookups and with validated optional compute-budget instructions.

The durable operation is authoritative. If writing its derived receipt was
interrupted, receipt access gives a recovery action; `operation resume` repairs
that receipt under the same locks. Terminal outcomes cannot change. Signed
payloads, seeds and provider raw output never appear in public operation or
receipt responses.

## Coinbase boundary and outstanding proof

`wallet ensure-solana --profile <profile> --provider coinbase-awal` links an
already authenticated pinned `awal` account. APN does not log in or enroll it.
The existing profile owner must agree; no key is exported into APN custody.

The concrete adapter validates pinned account, balance and send-result formats.
Production transfer preparation returns `APN_PROVIDER_CAPABILITY_UNAVAILABLE`
before launching send because `awal` does not attest the required network-fee
cap and ATA-rent payer. The synthetic fee contract used by tests has no
production implementation. An ambiguous provider invocation, if admitted by a
future supported contract, is durably recorded and never re-launched; without
a trusted signature it requires manual reconciliation.

Local SOL, local USDC, Coinbase SOL and Coinbase USDC each retain an open mainnet
acceptance row. None is proven by test fixtures, package discovery or public
RPC identity reads. Publication, installation and each bounded live payment
require their own evidence.

## Expired unlanded transfer

A local SOL or USDC transfer can stay `unknown_finality` when submission lost its response and the RPC never reports the signature. `operation resume` keeps observing and never resends it. After the finalized block height passes the frozen `lastValidBlockHeight` and `getSignatureStatuses` with history still returns no status, the owner may end the operation in a foreground terminal:

```sh
apn operation abandon --operation <operation-id>
```

The terminal shows the account, recipient, amount and the exact phrase. The operation becomes `abandoned_unknown`, its receipt records owner acknowledgement only, and the profile can prepare a new transfer. The financial outcome stays unknown because RPC history can be incomplete; APN refuses abandonment while the window is open or the signature is visible.
