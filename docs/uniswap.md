# Guarded Ethereum Uniswap swap

APN has two Uniswap V3 swap families on Ethereum mainnet. Neither uses an API
key, an off-chain quote service or the Uniswap Trading API: every price fact
comes from the chain, the transaction is encoded locally, and the owner's
local wallet signs, so APN never takes custody.

| Family | Swaps | Router |
| --- | --- | --- |
| `apn swap ethereum uniswap` (native input) | native ETH to canonical USDC or USDT; native ETH to WBTC with its own admission | Universal Router 2.2.0 |
| `apn swap ethereum uniswap-token` (token input) | canonical USDC to USDT and USDT to USDC | original V3 SwapRouter |

## Setup

`APN_ETHEREUM_RPC_URL` is required: a public HTTPS Ethereum mainnet endpoint
without credentials or query parameters. APN reads it on first use, so offline
commands such as `inventory` do not need it.

`APN_ETHEREUM_ARCHIVE_RPC_URL` is optional. When it is set, state reads pinned
to one exact block (`eth_getCode`, `eth_getStorageAt` and `eth_call` at a
numeric tag or block hash) go to it after its chain id is checked; otherwise
the primary serves them, which works for recent blocks on any full node.
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
`swap_owner_admission_required`; a policy changed after `prepare` refuses with
`swap_policy_drift`. The per-operation cap is checked at `prepare`; the daily
cap is enforced by the shared usage ledger. Staging and foreground activation
work as described in [Orca](orca.md#owner-admission).

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
