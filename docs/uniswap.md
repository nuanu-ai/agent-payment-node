# Guarded Uniswap swap (Ethereum and BNB Smart Chain)

APN has two Uniswap V3 swap families on Ethereum mainnet and two on BNB Smart
Chain. None uses an API key, an off-chain quote service or the Uniswap Trading
API: every price fact comes from the chain, the transaction is encoded
locally, and the owner's local wallet signs, so APN never takes custody.

| Family | Swaps | Router |
| --- | --- | --- |
| `apn swap ethereum uniswap` (native input) | native ETH to canonical USDC or USDT; native ETH to WBTC with its own admission | Universal Router 2.2.0 |
| `apn swap ethereum uniswap-token` (token input) | canonical USDC to USDT and USDT to USDC | original V3 SwapRouter |
| `apn swap bnb uniswap` (native input) | native BNB to Binance-Peg USDT or USDC | SwapRouter02 |
| `apn swap bnb uniswap-token` (token input) | Binance-Peg USDT or USDC to native BNB; USDT to USDC and USDC to USDT | SwapRouter02 |

The BNB families are described in
[BNB Smart Chain native input](#bnb-smart-chain-native-input-swap-bnb-uniswap) and
[BNB Smart Chain token input](#bnb-smart-chain-token-input-swap-bnb-uniswap-token).

## Setup

`APN_ETHEREUM_RPC_URL` is required: a public HTTPS Ethereum mainnet endpoint
without credentials or query parameters. APN reads it on first use, so offline
commands such as `inventory` do not need it.

`APN_ETHEREUM_ARCHIVE_RPC_URL` is optional. When it is set, state reads pinned
to one exact block (`eth_getCode`, `eth_getStorageAt` and `eth_call` at a
numeric tag or block hash) go to it after its chain id is checked; otherwise
the primary serves them, which works for recent blocks on any full node. This
holds for both families, including the token lane's batched reads. The token
lane reads receipts from `APN_ETHEREUM_RECEIPT_RPC_URL` when it is set to
another origin than the primary, else from the archive when that is set, else
from the primary. A batch goes to one endpoint only; it is never sent to
another one after a failure. With a token-lane primary pool, the primary
stands in for a missing archive or receipt reader only after the pool has
selected its provider; such a batch before that refuses with
`APN_RPC_CONFIG` / `token_primary_not_selected` and probes nothing. A token
lane state read the primary serves (`eth_call`, `eth_getCode`,
`eth_getStorageAt`, `eth_getBalance` at a block the command read) is pinned
to that block's hash (EIP-1898, `requireCanonical: true`), so a backend on
another branch refuses it instead of answering other state. A block read by
number keeps the first hash the primary answered; a later block's parent hash
only names a block the command never read. If the primary answers two
different hashes for one block, a read pinned there refuses with
`APN_RPC_PROTOCOL` / `token_primary_block_hash_conflict` and is not sent.
`eth_estimateGas` keeps the block number, since EIP-1898 does not define it
there. Pinning changes no request count.
Public endpoints that need no account or API key:

```sh
export APN_ETHEREUM_RPC_URL='https://ethereum-rpc.publicnode.com'
export APN_ETHEREUM_ARCHIVE_RPC_URL='https://eth.drpc.org'
```

dRPC lists `https://eth.drpc.org/` as its public Ethereum endpoint
([API overview](https://drpc.org/docs/ethereum-api)), and its `eth_getCode`
reference limits that method to latest state
([method constraints](https://drpc.org/docs/ethereum-api/accountinfo/eth_getCode)).
A public endpoint does not guarantee access to arbitrary historical state; a
quote is saved only after its exact pinned reads succeed.

Optional settings:

| Variable | Effect |
| --- | --- |
| `APN_UNISWAP_NATIVE_BATCH_READS=1` | Native-input quotes group independent reads into strict JSON-RPC batches of at most three requests, at most ten HTTP POSTs per quote. A provider batch error aborts the quote; there is no fallback to single reads. |
| `APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS` | Token-input lane only: an ordered pool of one to three primary endpoints. See [Token-lane primary pool](#token-lane-primary-pool). |

Both families need owner admission: the profile's active allowlist policy must
admit both assets of the swap for the `swap` rail with the family's route or
mechanism pin from `inventory`. Without it, `prepare` refuses with
`swap_owner_admission_required`, and `next_actions` name
`apn allowlist policy status --profile <profile>`; a policy changed after
`prepare` refuses with `swap_policy_drift`. An active policy that does not admit one of the two
assets refuses with the same reason: `prepare` for the native-input family,
`quote` for the token-input family. Its `details` name the `side` (`source` or
`destination`), the `chain`, the `asset` (`native` or the token address) and
the `admissionGap`:

| `admissionGap` | The active policy |
| --- | --- |
| `network_not_listed` | does not list Ethereum mainnet. |
| `asset_not_listed` | does not list the asset. |
| `swap_rail_not_admitted` | lists the asset without the `swap` rail. |
| `swap_route_not_admitted` | admits the asset for `swap` with another route. |

Its `next_actions` are `apn allowlist policy status --profile <profile>` and
the family's `inventory`, which prints the route to admit.

The per-operation cap is checked at `prepare` (the token-input family also
checks it, with today's usage, at `quote`); the daily cap is enforced by the
shared usage ledger when the approval reserves the input. Both refuse with
`APN_OPERATION_BLOCKED` and the reasons the direct rail uses:

| Reason | When | `details` |
| --- | --- | --- |
| `allowlist_per_transfer_cap_exceeded` | The amount is above the asset's per-transfer cap. For the output asset the amount is the minimum output. | `side`, `chain`, `asset`, `maximum_per_transfer_atomic`, `amount_atomic` |
| `allowlist_daily_cap_exceeded` | Today's shared usage plus the input is above the daily cap. | `side`, `chain`, `asset`, `daily_limit_atomic`, `daily_usage_atomic`, `amount_atomic` |

Lower the amount, wait for the next UTC day, or raise the cap in a new policy
revision. Staging and foreground activation work as described in
[Orca](orca.md#owner-admission).

`--to` may name another address than the paying account. Either `swap`
admission may pin `recipients`; the `--to` address must then be on each list
present, or `quote`, `prepare`, approval and the send refuse with
`allowlist_recipient_not_admitted` (see
[recipient pins](allowlist-policy.md#recipient-pins)).

## Pinned contracts

| Role | Address |
| --- | --- |
| Universal Router 2.2.0 | `0x0542093271A31f6FC1DADB232bd59eeb27de780F` |
| QuoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` |
| V3 factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| WETH9 | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| USDC proxy and implementation | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, `0x43506849D7C04F9138D1A2050bbF3A0c054402dd` |
| USDC/WETH 0.05% pool | `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640` |
| USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| WETH/USDT 0.3% pool | `0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36` |
| WBTC | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` |
| WBTC/WETH 0.3% pool | `0xCBCdF9626bC03E24f779434178A73a0B4bad62eD` |
| Original V3 SwapRouter (token input) | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| USDC/USDT 0.01% pool | `0x3416cF6C708Da44DB2624D63ea0AAef7113527C6` |

Each address is pinned to its runtime code hash. Contract immutables live in
runtime code, so each code hash pins them too.

- The USDC pool's token0 is USDC, token1 is WETH and its fee is 500.
- The USDT pool is the deepest WETH/USDT V3 pool by in-range liquidity:
  token0 WETH, token1 USDT, fee 3000.
- The WBTC pool's token0 is WBTC, token1 is WETH and its fee is 3000; WBTC has
  8 decimals.
- The factory's `getPool` returns each pool, and QuoterV2 reports the same
  factory and WETH9.
- USDT's `deprecated()` must stay false, because a deprecated TetherToken
  forwards to another contract. The USDC proxy must point at the pinned
  implementation.

A quote verifies every code hash at its block. Before sending, the native
lane re-checks only the state a code hash cannot fix: the USDC proxy
implementation and USDT's `deprecated()` flag. The router, quoter, factory,
WETH9 and pools have no upgrade path. The WBTC route touches no upgradeable
contract, so its pins are verified once at quote. Any drift fails closed with
`uniswap_code_pin_drift`.

## Native input: `swap ethereum uniswap`

`inventory` lists the keyless mechanism pin (`constructorKind: sdk`) and its
digest, the pairs and the code pins, plus the separate WBTC route with its own
mechanism pin, digest and registry. Owners admit native ETH and the output
token with the matching route or pin; a USDC or USDT admission does not admit
WBTC.

| Command | What it does |
| --- | --- |
| `inventory` | Lists the pins and pairs without admitting them. |
| `quote --profile --account --to --output-token --amount --slippage-bps --owner-slippage-cap-bps --deadline --max-gas-limit --max-fee-per-gas --max-priority-fee-per-gas` | Quotes on chain, encodes locally and simulates one unsigned transaction. |
| `prepare --profile --quote --idempotency-key` | Binds the saved quote to the owner policy. |
| `approve --operation` | Foreground terminal only: shows the screen, takes the typed code, signs locally and sends once. |
| `execute --operation` | Continues an approved reservation that has no marker yet; after the marker it only observes. |
| `status --operation` | Observes the transaction. Never signs or sends. |

No option has a default. `--amount` is in wei. `--output-token` is the pinned
USDC, USDT or WBTC address. `--deadline` is unix seconds within the next 30
minutes. `--slippage-bps` must not exceed `--owner-slippage-cap-bps` (at most
10000). The priority fee cap may not exceed the fee cap, and the gas limit cap
is at most 30,000,000.

```sh
QUOTE=$(apn swap ethereum uniswap quote --profile <profile> --account <account-address> --to <recipient-address> --output-token 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --amount 1000000000000000 --slippage-bps 50 --owner-slippage-cap-bps 100 --deadline <unix-seconds-within-30-minutes> --max-gas-limit 300000 --max-fee-per-gas 30000000000 --max-priority-fee-per-gas 1000000000 | jq -r .data.quoteHash)
OP=$(apn swap ethereum uniswap prepare --profile <profile> --quote $QUOTE --idempotency-key swap-0001 | jq -r .operation.operationId)
apn swap ethereum uniswap approve --operation $OP
apn swap ethereum uniswap status --operation $OP
```

### Quote

`quote` reads the latest block from the primary, then verifies the code pins
and reads pool `slot0` and QuoterV2 `quoteExactInputSingle` by `eth_call`, all
at that block's exact numeric tag. It computes the expected output, the
minimum output `ceil(expected * (10000 - slippageBps) / 10000)`, and the price
impact against the fee-adjusted spot price; an impact above the owner
slippage cap refuses with `uniswap_price_impact`, and a zero minimum with
`uniswap_output_floor`. A WBTC quote needs a minimum output of at least 1000
atomic units (`uniswap_wbtc_output_floor`). It encodes
`execute(WRAP_ETH, V3_SWAP_EXACT_IN)` locally as the exact inverse of the
strict decoder, simulates the unsigned transaction with `eth_call` and
`eth_estimateGas` at the same block, and saves the quote, the unsigned
transaction and the chain evidence under the state root, keyed by the quote
hash.

### Approve, execute, status

- `approve` prints the exact screen: what goes out, the expected and minimum
  output, slippage, price impact, gas limit and fee caps, the maximum network
  fee, the deadline and approval cap 0. The owner types a six-character code.
  APN then reads the clock again, reserves the amount, checks the nonce, fees,
  balance and mutable pins at the head, persists the submission marker and the
  execution binding, signs with the local wallet and sends exactly once.
- Any refusal before the submission marker releases the reservation as
  `failed_before_effect`. After the marker, APN never sends again.
- `status` never signs or sends. A finalized success moves the operation to
  `finalized`. A finalized reverted receipt moves it to
  `failed_confirmed_revert` and releases the reservation. Once the router
  deadline has passed at a finalized block without inclusion, `status` records
  `expired_unlanded` and releases the reservation.
- The success proof includes the native and output-token balances just before
  and just after the swap block. A pruning public RPC serves that state for
  only about 128 blocks, while finality takes 65–95 blocks. The first `status`
  that sees the receipt therefore reads those balances and keeps them in the
  state root, bound to the block hash. A later `status` reuses them and needs
  no historical state; after a reorg they are read again.
- Run `status` within about 25 minutes of sending. If the first observation
  comes later, `status` fails with `APN_PROVIDER_UNAVAILABLE` /
  `uniswap_pre_state_unavailable`; retry, or re-run `status` with an
  archive-capable `APN_ETHEREUM_RPC_URL`. Any other observation failure is
  also reported by `status`, never hidden behind an unchanged `submitted`.

MCP serves `inventory`, `quote`, `prepare` and `status`. `approve` and
`execute` are reachable only through `apn_foreground_handoff`, which returns
`APN_FOREGROUND_APPROVAL_REQUIRED` with the exact CLI command.

### Receipt economics

A finalized operation's `receiptProof.economics` holds what the receipt
itself proved: `inputAtomic` (the mined value), `outputAtomic` (the
recipient's `Transfer` credit), `networkFeeAtomic` (gas used × effective gas
price) and `nativeDebitAtomic`. A revert has input `"0"` and output `null`.
The quote keeps its expected and minimum output. SunSwap, Orca and Jupiter
fill the same fields from their own finalized records (fee in SUN or
lamports; Orca adds the rent of a token account it created). `status` also
returns them in its receipt slot as `actualEconomics` (the operation slot
stays the sealed record). The token-input lane adds the same
`actualEconomics` to its observed receipt.

## Token input: `swap ethereum uniswap-token`

This family supports only canonical Ethereum USDC to USDT and USDT to USDC
through the 0.01% pool. Its transaction is original SwapRouter
`exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))`
with selector `0x414bf389`, the deadline in the tuple,
`sqrtPriceLimitX96 = 0` and value zero. The approval spender is exactly the
original SwapRouter.

| Command | What it does |
| --- | --- |
| `inventory` | Lists the token route pins. |
| `quote --profile --account --to --source-token --output-token --amount --minimum-output --approval-cap --deadline --max-approval-gas-limit --max-swap-gas-limit --max-cleanup-gas-limit --max-fee-per-gas --max-priority-fee-per-gas --max-native-debit` | Quotes and simulates the exact token route. |
| `prepare --profile --quote --idempotency-key` | Prepares from one saved quote. |
| `approve --operation` | Foreground consent and the exact token approval. |
| `execute --operation` | Continues the exact approved swap without replay. |
| `status --operation` | Observes effects and reconciles durable local state. |
| `cleanup --operation [--max-fee-per-gas <wei> --max-priority-fee-per-gas <wei>]` | Foreground only, for a `cleanup_required` operation: sends the zero-allowance cleanup. |

Terminal states are `observed`, `cleaned` and `abandoned_unknown`.

### Allowance and success rules

- `quote` requires `--approval-cap` equal to `--amount` and budgets the
  worst-case approval, swap and cleanup gas within `--max-native-debit`.
- The allowance must start at zero or at exactly the input amount. The
  foreground `approve` may approve only that amount.
- USDT's no-return `approve` is accepted only when the call returns empty data;
  the final allowance and finalized receipt evidence remain mandatory.
- Successful execution proves the exact input debit, the minimum output and
  zero residual allowance.

### Signing guard

The swap's signing guard is its post-approval revalidation. At one fresh block
it checks the chain, the code pins, the exact allowance, the source balance,
the fresh quote floor, the exact simulation, the gas cap, the native balance
and the fee caps, and reads none of them twice. `execute` holds its one send
slot before it writes an attempt marker, so no read can take it.

### Status reads

Once an effect's receipt block is safe, `status` reads the allowance at that
block; for the swap it also reads both token balances at that block and the
block before it. Without `APN_ETHEREUM_ARCHIVE_RPC_URL` the primary serves
these reads. A pruning public primary keeps that state for only about 128
blocks (about 25 minutes), so run `status` soon after the send, or set an
archive endpoint before a later first `status`. When the primary answers one
of these reads with a JSON-RPC error and the effect's block is more than 128
blocks behind the safe head, `status` refuses with
`APN_PROVIDER_CAPABILITY_UNAVAILABLE` / `uniswap_token_status_archive_required`
(`details.blockNumber` is the effect's block, `details.safeBlockNumber` the
safe head). Nothing is recorded, and `next_actions` say to set
`APN_ETHEREUM_ARCHIVE_RPC_URL` and run
`apn swap ethereum uniswap-token status --operation <id>` again. A refusal of
a nearer block (for example a load-balanced backend that is behind) and any
failure of a configured archive are reported as they are. Quote, prepare and
the signing guard read only at a block they have just read from the primary,
so they never need an archive.

### Recovery and cleanup

- **Cleanup required.** A reverted or drifted post-approval operation enters
  `cleanup_required`. Only the explicit foreground `cleanup` command can send
  the zero-allowance cleanup, and every `cleanup_required` swap names
  `cleanup` in its `next_actions`. `cleaned` means no residual allowance.
- **Cleanup fees.** A cleanup whose fee caps (frozen at quote time) are below
  current Ethereum fees is refused before signing and stays
  `cleanup_required`; its `next_actions` offer the same cleanup again and
  `cleanup --max-fee-per-gas <wei> --max-priority-fee-per-gas <wei>`. Those
  are the owner's own caps for this cleanup only: they must cover a fresh fee
  quote (twice the latest base fee plus the node's priority fee, the signing
  guard's rule; a refusal names the quote), and the foreground consent shows
  them, the frozen caps and the new native debit cap before anything is
  signed. APN never raises a cap by itself.
- **Interrupted effect.** A started approval or swap with no hash and no
  public sealed effect (a stop between its marker and signing) makes `status`
  refuse with `uniswap_token_public_effect_missing` and name `execute`. That
  forward command opens custody under the account lock. When custody holds no
  signed bytes it frees the nonce, drops the marker, closes a route whose
  deadline passed (below) and otherwise stops; the next `execute` starts the
  effect afresh. Signed bytes it finds are journaled and only observed.
- **Deadline passed after the approval landed, no swap started.** `status` or
  `execute` proves the approval and reads the current allowance; a zero is
  confirmed only at a head that includes the approval, pinned by hash, and a
  node behind the approval is refused. If the allowance is still above zero,
  the swap becomes `cleanup_required` (`deadline_expired_after_approval`, with
  `next_actions` naming `cleanup`), whose consented revoke sends once and is
  observed to proof. If it is already zero, the swap is `cleaned` at once.
  Either way the principal hold is released with `cleaned`, and the approval
  gas stays charged.
- **Expired preparation.** For an expired `prepared` operation with no
  approval, swap, cleanup attempt, usage reservation or native debit, `status`
  reads the current allowance and records terminal no-effect evidence only
  when that allowance is zero. It never signs or broadcasts.
- **Residual allowance outside the operation.** A swap that was cleaned with
  its approval still standing (`expired_approval_no_swap`) shows the live
  residual in its `status` (`data.residualAllowance`, read at `latest`) and
  names the exact `apn wallet allowance revoke` command for it.

### Principal release

A `cleaned` swap whose approval landed releases its principal hold only on
proof that no swap of it can land, recorded as `principalRelease`:

- `swap_never_signed`: no swap marker is left; or
- `swap_nonce_consumed_by_cleanup`: its hashless marker's nonce is held, at
  the finalized tag, by its own landed cleanup. One primary batch reads the
  finalized nonce, the cleanup by hash and the finalized head; the canonical
  block at the cleanup's height must then be the one the cleanup names.

Gas, attempts and history stay; a bound or unproven swap keeps its hold.

Custody's "no signed bytes" is local state. A swap marker it freed (a refusal
before signing, a failed signature, a restart that found nothing signed) is
therefore kept in `freedSwapMarkers`, and every release also proves each such
marker's nonce on the finalized chain (`principalRelease.chainProof`): either
held by a landed cleanup of the swap in a finalized block, or unused. For the
unused case, one primary batch reads the finalized block and then
`eth_getTransactionCount(account, "finalized")` at or below the nonce, at a
block whose timestamp is past the route deadline (a swap included later
reverts on it). Until then the hold stays, and a `cleaned` swap's
`next_actions` name `status`, which reads the proof once finality reaches it.
A swap that never marked a swap needs no such read.

An owner-abandoned swap (`abandoned_unknown`) keeps its principal hold only
while a swap of it could still land. Its `status` names `execute`, which opens
custody under the account lock. With no swap marker, or a hashless one for
which custody holds no signed bytes (its nonce is then freed) and whose nonce
(and any freed marker's) the finalized chain proves as above, it records
`principalRelease` (`swap_never_signed`, naming that marker's nonce and hash,
with its `chainProof`) and releases the hold; gas, attempts and the terminal
phase stay, and signed bytes change nothing. Its own `cleanup` cannot reopen a
terminal record, so `status` and `execute` show any standing allowance
(`data.residualAllowance`) and name the generic `apn wallet allowance revoke`
for it.

### Shared EVM owner

The Ethereum raw signer may coexist with same-address MetaMask Smart Account
profiles and their Base delegation grants. Approval and token effects still
reject a second local signing profile or wallet for that address under the
shared EVM owner lock.

### Token-lane primary pool

`APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS` may contain an ordered JSON array of one
to three credential-free HTTPS Ethereum endpoints. Duplicate endpoint aliases,
shared provider families, query credentials, and an archive
(`APN_ETHEREUM_ARCHIVE_RPC_URL`) that shares a primary's origin are rejected.
The setting affects only the token-input lane. When it is absent,
`APN_ETHEREUM_RPC_URL` is the single primary.

Before signing, the lane sends the command's first full batch to each
candidate at most once. Transport deadlines, HTTP 429, 5xx and authentication
failures, malformed or wrong-chain responses, and missing capability (for
example no JSON-RPC batch support) put that provider into a finite shared
cooldown or quarantine. Partial responses never populate another provider's
cache. The first fully decoded candidate is frozen for the command. Business
reverts are terminal on that provider, and `eth_sendRawTransaction` has
exactly one attempt with no failover after signing. Batches hold at most three
reads; there is no fallback to single reads.

When a pooled command signs, the selected provider's opaque ID is stored with
the encrypted raw effect and in the token effect journal. Recovery resolves
that exact ID even if the configured order changes. A removed, cooling or
mismatched provider blocks recovery before submission; an already signed
effect never selects another candidate.

In pool mode the archive is independently chain-checked and must return the
exact hash of the primary's pinned block before its historical state is used.
Durable telemetry stores only opaque provider IDs, fixed outcome and reason
values, and counters.

### Request budgets

Each command has its own physical request cap; there is no cumulative
per-operation cap, so a command re-run after a rate limit does not exhaust the
operation. With `n` pooled primaries:

| Command | Single primary | With `n` pooled primaries |
| --- | --- | --- |
| `quote` | 8 | 7 + n |
| `prepare` | 9 | 8 + n |
| `approve` | 14 | 14 + n |
| `execute` | 15 | 15 + (n − 1) |
| `status` | 11 | 11 + n |
| `cleanup` | 14 | 14 + n |

An `execute` that resumes an approval plans for: allowance 1, nonce 1,
block 1, pins 4, state 1, simulation 1, gas 1, fees 1, send 1 and first
observation up to 3. A swap needs one fewer; each further pooled candidate may
cost one more probe.

## BNB Smart Chain native input: `swap bnb uniswap`

The BNB family has the model of the Ethereum native-input family: owner
admission by route, one pinned pool per pair, an on-chain quote, a foreground
approval, one send and a receipt proof. It swaps native BNB only. Token input
(USDT or USDC to BNB, USDT to USDC and back) is the separate family
[`swap bnb uniswap-token`](#bnb-smart-chain-token-input-swap-bnb-uniswap-token).

`APN_BNB_RPC_URL` is required. `APN_BNB_ARCHIVE_RPC_URL` is optional; when it
is set, the reads pinned to one block go to it. Public endpoints that need no
account: `https://bsc-rpc.publicnode.com`, `https://bsc-dataseed.bnbchain.org`.

### BNB pinned contracts

The addresses are Uniswap's published BNB deployment. Each one was read on
chain 56 on 2026-11-23 and is pinned to its runtime code hash.

| Role | Address |
| --- | --- |
| SwapRouter02 | `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2` |
| QuoterV2 | `0x78D78E420Da98ad378D7799bE8f4AF69033EB077` |
| V3 factory | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |
| Binance-Peg USDT (18 decimals) | `0x55d398326f99059fF775485246999027B3197955` |
| Binance-Peg USDC proxy and implementation (18 decimals) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`, `0xBA5Fe23f8a3a24BEd3236F05F2FcF35fd0BF0B5C` |
| USDT/WBNB 0.05% pool | `0x6fe9E9de56356F7eDBfcBB29FAB7cd69471a4869` |
| USDC/WBNB 0.05% pool | `0x5289A8Dbf7029eE0b0498a84777ed3941D9acfEc` |

- In both pools token0 is the stable token and token1 is WBNB.
- Each pool is the WBNB pool of its pair with the most in-range liquidity
  (fee tiers 100, 500, 3000 and 10000 were read).
- QuoterV2 and SwapRouter02 report the pinned factory and WBNB.
- The USDC/WBNB pool is thin. In our case 1 BNB quoted 2.6% less USDC than the
  USDT pool gave USDT. The owner slippage cap refuses such an input with
  `uniswap_price_impact`.

A quote reads `decimals()` of both tokens and the factory's `getPool` of both
pairs, then verifies every code hash and the USDC proxy implementation. Other
decimals refuse with `uniswap_bnb_decimals_mismatch`; any other drift refuses
with `uniswap_code_pin_drift`. Before sending, APN re-checks only the USDC
proxy implementation. The pair pins must also agree with the reviewed
Binance-Peg supplement (`src/binance-peg-policy-assets.ts`): the same symbol
and 18 decimals.

### BNB commands and rules

The six commands and their options are those of `swap ethereum uniswap`.
`--output-token` is the Binance-Peg USDT or USDC address. `--amount` is in wei
of BNB.

```sh
QUOTE=$(apn swap bnb uniswap quote --profile <profile> --account <account-address> --to <recipient-address> --output-token 0x55d398326f99059fF775485246999027B3197955 --amount 10000000000000000 --slippage-bps 50 --owner-slippage-cap-bps 100 --deadline <unix-seconds-within-30-minutes> --max-gas-limit 300000 --max-fee-per-gas 1000000000 --max-priority-fee-per-gas 100000000 | jq -r .data.quoteHash)
OP=$(apn swap bnb uniswap prepare --profile <profile> --quote $QUOTE --idempotency-key bnb-swap-0001 | jq -r .operation.operationId)
apn swap bnb uniswap approve --operation $OP
apn swap bnb uniswap status --operation $OP
```

- The owner policy must admit native BNB and the output token on
  `eip155:56` for the `swap` rail with the route that
  `apn swap bnb uniswap inventory` prints (protocol family `uniswap_bnb`).
- The calldata is `multicall(deadline, [exactInputSingle(WBNB, output, 500,
  recipient, amountIn, amountOutMinimum, 0)])` with `value` equal to
  `amountIn`. The router wraps exactly the input. The decoder refuses any
  other call, a second call, another fee tier, a price limit or a lower floor.
- The recipient must be an account. The router sentinels `0x…01` and `0x…02`,
  the router and WBNB refuse with `APN_INVALID_INPUT`.
- BNB charges no base fee. A zero priority fee refuses with
  `uniswap_zero_gas_price`.
- Blocks come about every 0.45 s. The quote's head drift bound is 256 blocks
  (the swap quote schema maximum), about two minutes. An approval after that
  refuses with `uniswap_execution_drift` before signing and releases the
  reservation; quote again.
- The receipt proof needs the balances around the swap block. A pruning RPC
  keeps that state for about 128 blocks, about one minute on BNB. Run `status`
  soon after sending, or set `APN_BNB_ARCHIVE_RPC_URL`. A late first
  observation refuses with `uniswap_pre_state_unavailable`.
- The receipt economics are the mined value, the recipient's `Transfer` credit
  and gas used × effective gas price. The receipt-facts reader also requires
  the router's single WBNB `Deposit` of the input.
- `apn operation status` and `apn operation abandon` route a BNB swap to
  `apn swap bnb uniswap status`.

## BNB Smart Chain token input: `swap bnb uniswap-token`

This family has the model of the Ethereum token-input family: an exact ERC-20
approval of one pinned router, one swap, and an explicit cleanup of any
residual allowance. The phases, the allowance and success rules, the signing
guard, recovery, principal release and the foreground consent are the same.
The differences are below.

| Direction | Pool | Fee |
| --- | --- | --- |
| Binance-Peg USDT to native BNB | USDT/WBNB `0x6fe9E9de56356F7eDBfcBB29FAB7cd69471a4869` | 500 |
| Binance-Peg USDC to native BNB | USDC/WBNB `0x5289A8Dbf7029eE0b0498a84777ed3941D9acfEc` | 500 |
| Binance-Peg USDT to USDC | USDT/USDC `0x2C3c320D49019D4f9A92352e947c7e5AcFE47D68` | 100 |
| Binance-Peg USDC to USDT | the same USDT/USDC pool | 100 |

`APN_BNB_RPC_URL` is required; `APN_BNB_ARCHIVE_RPC_URL` and
`APN_BNB_RECEIPT_RPC_URL` are optional, as `APN_ETHEREUM_ARCHIVE_RPC_URL` and
`APN_ETHEREUM_RECEIPT_RPC_URL` are for the Ethereum family. The primary pool
`APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS` is the Ethereum family's only; this
family does not read it. Use `https://bsc-rpc.publicnode.com`: in our case it
served state about 10 000 blocks (about 75 minutes) back, and the `safe` and
`finalized` tags. `https://bsc-dataseed.bnbchain.org` served state for about
127 blocks (about one minute) and refused state at `safe` and `finalized`.

### BNB token pins

The router, quoter, factory, WBNB, both tokens and the two WBNB pools are the
pins of the native BNB family. The USDT/USDC 0.01% pool
`0x2C3c320D49019D4f9A92352e947c7e5AcFE47D68` is pinned to its runtime code hash
`0xb64a9a26…6479c03c1`. Every pin was read again on chain 56 on 2026-11-24,
each read pinned to one block hash.

- The 0.01% pool is the deepest USDT/USDC pool by in-range liquidity. In our
  case (block 135304384): 0.01% 3.38e25, 0.05% 5.13e24, 0.3% 6.67e22, 1%
  2.09e21. The 0.01% pool held 239 264 USDT and 39 671 USDC.
- The USDT/WBNB and USDC/WBNB 0.05% pools stay the deepest WBNB pools of their
  pairs. The USDC/WBNB pool held only 1 609 USDC and 5.22 WBNB.
- QuoterV2 in our case (block 135304528), for 10 units in: USDT gave 0.017659
  BNB, USDC 0.017680 BNB, USDT 9.98996 USDC, USDC 10.00804 USDT. 1000 USDC gave
  1.7074 BNB against 1.7658 for 1000 USDT, and 10 000 USDC only 4.886 BNB. Set
  `--minimum-output` from a fresh quote: it is the only floor.

The owner admits the input token and the output asset (the other token, or
native BNB) on `eip155:56` for the `swap` rail with the route that
`apn swap bnb uniswap-token inventory` prints. That route lists SwapRouter02,
the factory, WBNB and the three pools. It is not the native family's route: an
admission of one does not admit the other.

A quote and the signing guard before every approval, swap and cleanup check,
at one block they just read: the chain is 56; the runtime code hash of
SwapRouter02, WBNB, USDT, the USDC proxy and its implementation, and the three
pools; the USDC proxy implementation slot; `decimals()` of both tokens is 18.
Any other decimals refuse with `uniswap_bnb_decimals_mismatch`; any other
drift refuses with `uniswap_code_pin_drift`.

### BNB token commands and rules

The seven commands and their options are those of `swap ethereum uniswap-token`.
`--source-token` is the Binance-Peg USDT or USDC address. `--output-token` is
`native` (BNB) or the other Binance-Peg address. `--amount` and
`--minimum-output` are atomic at 18 decimals; for a native output the minimum is
in wei of BNB.

```sh
QUOTE=$(apn swap bnb uniswap-token quote --profile <profile> --account <account-address> --to <recipient-address> --source-token 0x55d398326f99059fF775485246999027B3197955 --output-token native --amount 10000000000000000000 --minimum-output 17000000000000000 --approval-cap 10000000000000000000 --deadline <unix-seconds-within-30-minutes> --max-approval-gas-limit 80000 --max-swap-gas-limit 300000 --max-cleanup-gas-limit 80000 --max-fee-per-gas 1000000000 --max-priority-fee-per-gas 100000000 --max-native-debit 460000000000000 | jq -r .data.quoteHash)
OP=$(apn swap bnb uniswap-token prepare --profile <profile> --quote $QUOTE --idempotency-key bnb-token-swap-0001 | jq -r .operation.operationId)
apn swap bnb uniswap-token approve --operation $OP
apn swap bnb uniswap-token execute --operation $OP
apn swap bnb uniswap-token status --operation $OP
```

- The approval is `approve(SwapRouter02, amount)` on the input token. The
  allowance must start at zero or at exactly the input amount; cleanup sets it
  to zero. Both tokens return `true` from `approve`.
- The swap is SwapRouter02 `multicall(deadline, calls)` with value zero. For a
  token output the one call is `exactInputSingle(input, output, 100,
  recipient, amountIn, amountOutMinimum, 0)`. For native BNB the calls are
  `exactInputSingle(input, WBNB, 500, 0x…02, amountIn, amountOutMinimum, 0)`,
  which pays the WBNB to the router, and `unwrapWETH9(amountOutMinimum,
  recipient)`, which unwraps all of it and sends that BNB to the recipient.
  This is Uniswap's own encoding of a native output. The floor binds both
  calls. The decoder refuses any other call, a third call, another fee tier, a
  price limit, or a swap of a native output that pays anyone but the router.
- The recipient must be an account. The router sentinels `0x…01` and `0x…02`,
  the router and WBNB refuse with `APN_INVALID_INPUT`.
- BNB charges no base fee. A zero `--max-priority-fee-per-gas` refuses at quote
  with `uniswap_zero_gas_price`. In our case `eth_maxPriorityFeePerGas` was
  0.05 gwei (50 000 000 wei); the signing guard refuses a priority cap below the
  node's value with `uniswap_token_fee_cap`.
- In our case `eth_estimateGas` from a zero allowance gave: approve USDT 46 576,
  approve USDC 54 235; swap USDT to BNB 182 317, USDC to BNB 200 046, USDT to
  USDC 143 700, USDC to USDT 144 357.
- A successful swap proves the exact input debit from the input token balances
  just before and at the swap block, and zero residual allowance. A token
  output is proven by the recipient's balance of the output token. A native
  output is proven by the router's one WBNB `Withdrawal` in the swap's receipt:
  any other count, sender or contract refuses with
  `uniswap_token_unwrap_conflict`.
- `status` reads the effect's block state. Without `APN_BNB_ARCHIVE_RPC_URL` a
  primary that refuses a block more than 128 blocks behind the safe head (about
  one minute on BNB) refuses with `uniswap_token_status_archive_required`.
- The family has its own nonce reservations (`uniswap-bnb-token-nonces`). A
  BNB nonce never excludes an Ethereum nonce of the same account, nor the
  reverse. A direct BNB transfer never reuses a nonce a BNB token effect holds.
- Records share the token-swap journal with the Ethereum family. A record
  names its family by its route schema
  (`apn.uniswap-v3.bnb.swap-router-02.multicall.v1`). The other family's
  runtime refuses it with `uniswap_token_lane_mismatch` before any read, and a
  quote of the other family refuses at `prepare` with
  `uniswap_token_quote_binding`. `apn operation status` and
  `apn operation resume` name the BNB commands for a BNB record.
- Request caps per command are the Ethereum family's single-primary caps:
  quote 8, prepare 9, approve 14, execute 15, status 11, cleanup 14.
- MCP serves `inventory`, `quote`, `prepare` and `status`. `approve`,
  `execute` and `cleanup` are reachable only through `apn_foreground_handoff`.

## Compatibility

- Token effect journal v1 and older wallet effects remain readable. Pooled
  signed effects from before the provider binding existed fail closed, while
  single-primary recovery remains compatible.
- For a swap finalized before APN recorded receipt economics, `status` reads
  its own finalized transaction once through the lane's RPC (bound to the hash
  its record proved) and keeps the facts in
  `receipt-facts/<operation>.swap.json`, bound to the record's integrity hash;
  it never reads them again. A refused read leaves `actualEconomics` null with
  `actualFactsRefusal` naming why.
- Native-input materials and Universal Router operations from earlier
  releases remain byte compatible.
