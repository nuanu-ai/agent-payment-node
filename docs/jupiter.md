# Solana Jupiter surfaces

`apn swap solana jupiter` swaps native SOL for canonical Solana USDC (exact
input) through Jupiter Swap API V1. Only direct, single-step routes through
four reviewed Orca Whirlpool SOL/USDC pools are accepted. Jupiter's public API
supplies the quote and the swap instructions; APN checks every instruction,
account and program against fixed pins, simulates the exact message, signs
with the profile's local Solana key and sends once.

APN uses Jupiter Swap API V1 only (`instructionVersion=V1`). There is no
Jupiter V2 or Quantum path. For a swap that uses no off-chain API at all, see
[Orca](orca.md).

## Requirements and setup

- **Local Solana wallet.** The profile needs a local Solana account
  (`apn wallet ensure-solana --profile <profile> --provider local --accept-risk true`,
  see [Solana](solana.md)). The payer and the recipient are always that
  account.
- **Solana RPC.** `APN_SOLANA_RPC_URL` is optional. When it is unset or empty,
  APN uses the anonymous public endpoint `https://api.mainnet-beta.solana.com`;
  no RPC account, signup or API key is required. An invalid non-empty value
  fails without falling back. Public RPC has no availability guarantee and may
  rate-limit or refuse requests.
- **Jupiter API.** APN calls only `https://api.jup.ag/swap/v1/quote` and
  `https://api.jup.ag/swap/v1/swap-instructions`, with no API key, credentials
  or redirects, through a DNS-validated public address, built-in TLS roots, a
  10-second deadline and a 256 KiB response limit.
- **Owner admission.** The profile's active allowlist policy must admit native
  SOL and canonical USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) on
  `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` for the `swap` rail,
  both with the route (or mechanism pin) of the same pool from `inventory`.
  The policy file, staging and foreground activation work as described in
  [Orca](orca.md#owner-admission). Nothing is admitted by default; the
  per-transfer and daily caps come from the policy.

Admission is by route: the protocol, the Jupiter program and the pool. A
policy that names any earlier mechanism pin of a pool therefore admits that
pool's current route without re-admission. Quote, prepare, approve and the
pre-send checks all evaluate the exact active policy; a policy changed after
`prepare` refuses.

## Commands

| Command | What it does |
| --- | --- |
| `inventory` | Lists the Jupiter program, the pinned program authorities, the four current routes (pool, route, mechanism pin and digests) and the historical generations kept for observation. Grants nothing. |
| `quote --profile --account --to --amount --slippage-bps --owner-slippage-cap-bps` | Builds, checks, simulates and saves one unsigned quote. `--account` and `--to` must both be the profile's local Solana account. `--amount` is in lamports. `--slippage-bps` must not exceed `--owner-slippage-cap-bps`, which is at most 10000. |
| `prepare --profile --quote --idempotency-key` | Binds the saved quote to the owner policy and the route registry. Signs nothing. |
| `approve --operation` | Foreground terminal only. Re-checks the swap, shows the approval screen, then signs locally and sends once. |
| `execute --operation` | For an operation without a submission marker, requires a fresh foreground approval and continues; with a marker it only observes. |
| `status --operation` | Observes the saved signature and records proved finality. Never signs or sends. |

No option has a default. MCP serves `inventory`, `quote`, `prepare` and
`status`; `approve` and `execute` return `APN_FOREGROUND_APPROVAL_REQUIRED`
with the exact CLI command to run in a terminal.

```sh
apn swap solana jupiter inventory
QUOTE=$(apn swap solana jupiter quote --profile <profile> --account <solana-address> --to <solana-address> --amount 10000000 --slippage-bps 50 --owner-slippage-cap-bps 100 | jq -r .data.quoteHash)
OP=$(apn swap solana jupiter prepare --profile <profile> --quote $QUOTE --idempotency-key jupiter-0001 | jq -r .operation.operationId)
apn swap solana jupiter approve --operation $OP
apn swap solana jupiter status --operation $OP
```

A quote expires 90 seconds after it is made, so `prepare` and `approve` must
follow promptly. Run `status` again until the operation is terminal.

## Routes and pins

### Pools

| Route | Pool | Swap instruction | Mechanism digest |
| --- | --- | --- | --- |
| `whirlpool-v1-83-sol-usdc-authority` | `83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d` | Legacy Whirlpool swap: route enum 17, 36 route bytes, 21 accounts | `661c34724fb8d84d21077056341f1d38725f106eecb56253d6f31eca1cc4303e` |
| `whirlpool-v1-fp-sol-usdc-authority` | `FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q` | Legacy Whirlpool swap: route enum 17, 36 route bytes, 21 accounts | `c1ea8de6f3359088e114f32d57e123f70ba236ad02c5bbd85fc8e1b028db4273` |
| `whirlpool-swap-v2-esv-sol-usdc-authority` | `Esvfxt3jMDdtTZqLF1fqRhDjzM8Bpr7fZxJMrK69PB7e` | WhirlpoolSwapV2: route enum 47, 37 route bytes, 25 accounts, Memo | `798d533799a59c7706050700e2d4f310b88a8c7c23005a056bd042475ca60630` |
| `whirlpool-swap-v2-4h-sol-usdc-authority` | `4HppGTweoGQ8ZZ6UcCgwJKfi5mJD9Dqwy6htCpnbfBLW` | WhirlpoolSwapV2: route enum 47, 37 route bytes, 25 accounts, Memo | `c549ef3dd6d5fc9c1787a3411d0a98eb8232fcca41101965573c7e69374cd74c` |

What the guard binds for each pool:

- **83:** the reviewed legacy pool. Its oracle must be absent or an empty
  System-owned account; an adaptive-fee oracle refuses.
- **Fp:** static fee tier. Config `2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ`,
  tick spacing 2, fee-tier seed 2, both classic SOL/USDC vaults and the pool
  bump; the pool and oracle PDAs are re-derived. The oracle is an empty
  System-owned account.
- **Esv:** tick spacing 2, fee-tier seed 1027, adaptive-fee oracle.
- **4H:** tick spacing 4, fee-tier seed 1028, adaptive-fee oracle.

Fee rates and adaptive-fee constants are read from the chain, not pinned. The
pool list is fixed in the release: no pool is ever admitted from a quote, a
builder response, a policy file, the environment or a caller. Any other pool
needs its own account, program and ABI review in a new APN release.

### Programs

| Program | Address | Pin |
| --- | --- | --- |
| Jupiter V6 | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | ProgramData `4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT`, upgrade authority `CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ` |
| Orca Whirlpool | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | ProgramData `CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD`, upgrade authority `GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV` |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | ProgramData `3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2`, no upgrade authority |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | BPFLoader2 (cannot be upgraded) |
| Memo (SwapV2 routes only) | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | BPFLoader2 (cannot be upgraded) |
| System, Compute Budget | `11111111111111111111111111111111`, `ComputeBudget111111111111111111111111111111` | Native loader |

APN pins each upgradeable program by its ProgramData address and upgrade
authority, read from the 45-byte loader headers at quote time and again before
consent. It does not pin executable bytes. A new deployment by the pinned
authority is accepted. Another authority refuses with
`solana_program_authority_changed`; another ProgramData address or program
account refuses with `solana_program_identity_changed`. There is no upgrade
cooldown: the exact-message simulation against the programs as deployed, the
exact compiled accounts and privileges, the minimum output encoded in the swap
and the finalized receipt checks carry the safety.

## How a swap runs

### Quote

1. APN checks that the active owner policy admits both assets for this amount
   and resolves the admitted routes before any network read.
2. It asks Jupiter for a quote with `swapMode=ExactIn`, `dexes=Whirlpool`,
   `onlyDirectRoutes=true`, `instructionVersion=V1` and `platformFeeBps=0`.
   Jupiter's quote API has no pool selector; it answers with its best-priced
   direct Whirlpool pool. APN takes the answer when an admitted route names
   that pool. When a SwapV2 pool is admitted it asks without a filter first;
   for the legacy pools it may send `maxAccounts=12` as a discovery hint. At
   most one second quote read follows when the first answer names a pool
   outside the admitted set. The hint only narrows discovery: it cannot admit
   a pool, change the frozen route or bypass simulation. If no answer names an
   admitted pool, the quote refuses with `jupiter_v1_provider_pool_not_admitted`
   and names the endpoint, network, amount, the pools Jupiter answered and the
   admitted pools. A policy that admits one pool therefore quotes only while
   Jupiter's best pool is that pool.
3. It requests the swap instructions once, with `useSharedAccounts: false`,
   `wrapAndUnwrapSol: true`, no dynamic slippage, no dynamic compute limit and
   a compute unit price of 1,000 micro-lamports.
4. It decodes the route bytes and checks the input, quoted output and slippage
   against the quote. For SwapV2 routes the pool named in the raw accounts
   must be the quoted pool.
5. It reads every compiled account, lookup table and program header from the
   configured RPC, in requests of at most eight keys pinned to the quote's
   context slot.
6. It takes the blockhash to freeze from the configured RPC
   (`getLatestBlockhash` at `confirmed`, with `minContextSlot` at least the
   newest account read). The fee and height read must leave between 100 and
   151 blocks of lifetime; otherwise the quote refuses with
   `APN_REPREPARE_REQUIRED` and public `error.details`: `remainingBlocks`,
   `observedBlockHeight`, `lastValidBlockHeight`, `blockhashContextSlot`,
   `requiredMinimumContextSlot`, `minimumRemainingBlocks` (100),
   `maximumRemainingBlocks` (151) and `commitment` (`confirmed`). Heights,
   slots and the signed remaining-block difference are decimal strings. These
   details describe the completed reads; they do not diagnose provider lag.
7. It runs the guard below, simulates the exact message and saves the quote
   with its evidence. The saved quote records the hash of the configured RPC
   endpoint. A later command with a different endpoint refuses with
   `jupiter_v1_rpc_origin_mismatch` before any read, without changing the
   operation or releasing its holds; set the original endpoint to continue.

### What the guard checks

- **Route shape.** One 100% A-to-B step, no platform fee, no delegate, the
  payer's own token accounts, and the exact raw and compiled account roles and
  privileges. APN preserves Jupiter's route bytes; it does not rewrite them.
- **Wrap and close.** Setup creates the payer's wSOL associated account,
  transfers exactly the input and syncs it; cleanup closes the wSOL account. An
  existing wSOL account must hold no tokens: APN refuses to close existing wSOL
  funds.
- **Compute budget.** Exactly a 1,400,000-unit limit and a price of 1,000
  micro-lamports.
- **Accounts.** Mints, vaults, the three tick arrays of the selected pool (one
  aligned, descending run), the oracle, lookup table contents and the exact
  unsigned message. Every account snapshot must be at or after the quote's
  context slot.
- **Native expense.** The network fee must be between 1,400 and 20,000
  lamports. The maximum native expense is the input plus 5,000,000 lamports
  (fee, temporary wSOL account rent and margin), and the payer's balance must
  cover the input, the fee and the wSOL account rent.
- **Minimum output.** Jupiter's API minimum uses ceiling arithmetic, so the
  floor encoded in the instruction can be one atomic USDC unit lower. The
  approval shows both values, and both the simulation and the finalized
  receipt must meet both.
- **SwapV2 routes (Esv, 4H).** Memo is a read-only account; Memo CPI,
  Token-2022, transfer fees, transfer hooks and supplemental accounts are
  refused. The native SwapV2 CPI must be exactly one invocation with the quoted
  input, threshold 0, sqrt-price limit 0, exact input, A to B and no
  remaining-account information. Exactly two classic Token `TransferChecked`
  invocations must bind both mints, decimals, authorities, amounts and vault
  movements. Only the swap fields the program source declares may change in
  the pool, oracle and tick arrays. Any other CPI shape refuses.

### Simulation

APN simulates the exact message on the configured RPC before saving a quote
and again before the approval prompt.

- When the RPC returns complete pre- and post-balance vectors (lamports and
  tokens), monetary effects are derived from that single response. Every token
  role, owner, mint, decimal count and program is bound, and the vectors must
  match the returned account bytes, the exact native debit, the vault
  movements and the CPI transfer amounts. Partial, duplicate, mismatched or
  unbound evidence refuses. Without these vectors APN falls back to a
  conservative snapshot comparison.
- The read-only USDC mint may show a changed supply between banks; its
  authority, decimals, initialized state and freeze authority must stay
  byte-identical, and the message cannot write the mint.
- Inner instructions may come as compiled account indices or in the parsed and
  partially decoded forms the
  [simulateTransaction documentation](https://solana.com/docs/rpc/http/simulatetransaction)
  describes. A strict decoder converts each supported SPL or System operation
  into its exact opcode, atomic amount and account tuple before the checks
  above. Unknown fields, operations, token extensions, accounts, authorities or
  mixed encodings refuse.
- A failed simulation refuses with `APN_OPERATION_BLOCKED` and a fixed
  `simulationFailureReason`: `stale_context`, `replacement_blockhash`,
  `blockhash_not_found`, `insufficient_funds_for_fee`, `instruction_error` or
  `unclassified`, plus a bounded `instructionIndex` and `instructionCustomCode`
  when present. Provider text and logs are never included.

### Approve and send

`approve` runs only in a genuine foreground terminal. Before the prompt, within
the command's own request budget, APN:

1. re-reads the accounts and program authorities;
2. takes a fresh blockhash from the configured RPC (minimum context slot = the
   newest account read) and rebuilds the quoted message with it. Only the
   32-byte recent blockhash may differ: header, static accounts, instructions,
   data, lookup-table indexes and lookup-table contents must be byte-identical
   to the quote's, and the program authorities unchanged;
3. runs the guard, the fee read, the exact-message simulation and the 100–151
   block lifetime window on that message.

The pool's current tick may have moved into any of the three tick arrays the
quoted swap names; the Whirlpool program starts at whichever array holds the
current tick and walks down through the rest, and the simulation, the encoded
minimum and the receipt bound the result. A pool that left the named arrays
refuses with `APN_REPREPARE_REQUIRED` / `jupiter_v1_pool_left_quoted_tick_arrays`.
An RPC blockhash outside the lifetime window refuses with
`APN_OPERATION_BLOCKED` / `jupiter_v1_approval_lifetime_window`; nothing is
marked, so the same operation can be approved again.

The screen names the route variant and pool, the amounts, both minima, the
caps, and the approval message hash with its blockhash and last valid height
next to the quoted message hash. After the owner confirms:

- The final height read must leave at least 24 blocks before the message's
  last valid height; otherwise APN returns `APN_REPREPARE_REQUIRED` before the
  submission marker or any custody access.
- The signer checks the same operation, owner, public account, encrypted
  envelope and active policy before decrypting the key. The fresh read material
  and simulation are saved as content-hashed chunks before signing.
- A public signature marker and the encrypted signed bytes are written before
  an fsynced first-send claim. The sender consumes that claim under the
  operation lock and calls `sendTransaction` once, with `maxRetries: 0`.

`execute` asks for a fresh foreground approval for the same unmarked
operation; once a marker exists it only observes. No caller-supplied approval
artifact can unlock the signer.

### Status and finality

`status` never signs, resends, re-quotes or opens wallet secrets. It reads the
saved signature and the finalized transaction and checks the signature, the
frozen message, the finalized slot, the loaded addresses, the CPI, the native
expense, the token identities and both output minima before recording
`finalized`. The receipt may carry a top-level `transactionIndex` that is
absent, null or an integer from 0 through 4294967295; any other value or
unvalidated field refuses.

A finalized operation's `receiptProof.economics` records `inputAtomic`
(lamports), `outputAtomic` (USDC credited to the payer), `networkFeeAtomic`
and `nativeDebitAtomic` (lamports). `status` also returns them as
`actualEconomics` in its receipt slot.

## Recovery

- **Expired before the marker.** When the 90-second quote window closes and
  the operation has no submission marker, any of `approve`, `execute` or
  `status` records `failed_before_effect` under the same lock the signer uses
  and releases the usage reservation.
- **Unknown outcome.** Crashes, transport ambiguity, a missing status or
  blockhash expiry after the marker leave the operation in `unknown_finality`.
  APN keeps the original signature and only observes; nothing is re-signed or
  resent, and no reservation is released by hand.
- **Never landed.** Once the finalized block height passes the last valid
  height of the signed message and the signature has no status, `status`
  records `expired_unlanded` and releases the reservation.
- `apn operation abandon` does not apply to Jupiter swaps: `status` can always
  settle them from the frozen blockhash lifetime.

### Diagnostics

`status`, `approve` and `execute` may add two public records under `data`:

- `dispatchObservation`: written once after the single claimed send. It binds
  the operation, marker, claim hash, execution binding and signature, and
  records `outcome` (`acknowledged`, `signature_mismatch` or `error`), a fixed
  APN `errorCode`, an `rpcErrorCode` (a signed 32-bit code, only from a
  request-ID-correlated JSON-RPC error), an `rpcErrorReason`
  (`blockhash_not_found`, `insufficient_funds_for_fee`, `account_not_found`,
  `already_processed`, `instruction_error` or `unclassified`), and the HTTP
  status and bounded retry-after delay when known.
- `executionFailure`: written when binding, signing or the sender's preflight
  fails before the send claim. It records the phase (`binding_and_sign` or
  `sender_preflight`), the classified error, the observed block height when
  known and the frozen last valid height.

Both exclude provider text, simulation logs, keys and signed bytes. They are
diagnosis only: they never prove that nothing was sent, release usage or
permit a resend.

## RPC use and limits

- **Per-command budget.** Each command gets its own physical request budget
  from its read plan plus 2 requests of headroom: quote 17, prepare 2,
  approve 22, execute 22, status 6. No budget is stored or carried across
  commands, so a command that hit a rate limit can simply be run again.
- **Pacing.** POST starts to the same provider are paced at least 750 ms apart
  across processes through durable state. HTTP 429 ends the command
  (`APN_RPC_RATE_LIMITED`) and starts a provider cooldown of 2 to 30 seconds
  that honours `Retry-After`; a command started inside it refuses with
  `APN_PROVIDER_UNAVAILABLE` / `rpc_provider_cooldown`. If a timer wakes early,
  APN waits once more only when the clock advanced; a stuck or backward clock
  refuses before the next POST. Nothing retries inside a command.
- **Account reads.** At most eight keys per `getMultipleAccounts`. On
  `api.mainnet-beta.solana.com` and `solana-rpc.publicnode.com`, which do not
  accept several account reads in one JSON-RPC batch, account reads go out as
  individual POSTs. Other endpoints batch up to eight independent reads in one POST.
  Fee, height and rent reads share one POST. A batch never establishes a
  shared bank, and each read keeps its own context-slot check. Sends are never
  batched.
- **Response bodies.** APN requests gzip and accepts only identity or gzip
  encoding. Compressed and decoded bodies are each limited to 2,097,152 bytes;
  invalid, truncated or oversized bodies fail before parsing. Integers are
  parsed exactly.

## Reason codes

| Reason or code | Meaning | What to do |
| --- | --- | --- |
| `jupiter_v1_owner_admission` | No exact active policy, the profile account differs, the two assets do not admit the same route, or the policy changed after `prepare`. | Activate a policy that admits SOL and USDC with the same pool route; quote again after a policy change. |
| `jupiter_v1_provider_pool_not_admitted` | Jupiter's best direct pool is not one the policy admits. | Try later or another amount, or admit that reviewed pool's route. |
| `jupiter_v1_pool_left_quoted_tick_arrays` (`APN_REPREPARE_REQUIRED`) | The pool price left the tick arrays the quoted swap names. | Quote again. |
| `jupiter_v1_approval_lifetime_window` | The RPC returned a blockhash outside the 100–151 block window at approval. Nothing was marked. | Run `approve` again. |
| `APN_REPREPARE_REQUIRED` with lifetime details | The quote's blockhash lifetime was outside the window, or fewer than 24 blocks remained before signing. | Quote again. |
| `jupiter_v1_historical_route` (`APN_REPREPARE_REQUIRED`) | The saved quote comes from an older release that pinned executable bytes. | Quote again. |
| `jupiter_v1_rpc_origin_mismatch` | The configured Solana RPC differs from the one the quote was frozen with. | Set `APN_SOLANA_RPC_URL` back to the original endpoint. |
| `jupiter_v1_runtime_binding` | The request is outside the lane (for example `--to` differs from `--account`) or the saved material does not match its route. | Quote again with the profile's own account. |
| `jupiter_v1_execution_boundary` | The operation already has a marker or is not awaiting its first approval. | Use `status`. |
| `solana_program_authority_changed`, `solana_program_identity_changed` | A pinned program changed authority or identity. Nothing was signed. | Wait for an APN release that reviews the change. |
| `APN_RPC_RATE_LIMITED`, `rpc_provider_cooldown`, `APN_RPC_BUDGET_EXCEEDED` | The public RPC refused or the command used its request budget. | Run the command again later, or set another public HTTPS endpoint. |

## Compatibility

- Quotes and operations from earlier releases that pinned executable bytes
  belong to twelve historical route generations, listed under
  `historicalObserveOnly` in `inventory`. Their operations are still read and
  finished by `status`, but their saved quotes no longer prepare
  (`jupiter_v1_historical_route`).
- Older saved materials that stored complete ProgramData still load; current
  materials store only the 45-byte loader headers.
- Materials without a recorded RPC origin keep their genesis, program-pin and
  signed-operation checks; no origin comparison is made for them.
- An execution binding written before the approval began freezing its own
  blockhash holds the quoted message, whose lifetime is the same.
- Operations without a dispatch observation or execution-failure record remain
  readable; an earlier lost response is not reconstructed.
- Historical retirement records under `jupiter-historical-retirements/`,
  written by earlier releases for a few old operations, are still read for SOL
  daily-usage accounting. Nothing writes them any more.
- For a swap finalized before APN recorded receipt economics, `status` reads
  its finalized transaction once and keeps the facts in
  `receipt-facts/<operation>.swap.json`; a refused read leaves
  `actualEconomics` null with `actualFactsRefusal` naming why.
