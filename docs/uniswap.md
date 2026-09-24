# Guarded Ethereum Uniswap swap

APN swaps native ETH for canonical Ethereum USDC or USDT through Uniswap V3
without an API key or an off-chain quote service. The Uniswap Trading API is not used
by the default path. Every price fact comes from the chain, and the owner's
local wallet signs, so APN never takes custody.

## Pinned contracts

All addresses and runtime code hashes were read on Ethereum mainnet with
`eth_getCode` and cross-checked on 2026-09-18 (block 26001913):

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
| Original V3 SwapRouter (token input) | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| USDC/USDT 0.01% pool | `0x3416cF6C708Da44DB2624D63ea0AAef7113527C6` |

The USDC pool's token0 is USDC, token1 is WETH and its fee is 500. The USDT
pool is the deepest WETH/USDT V3 pool by in-range liquidity: token0 WETH,
token1 USDT, fee 3000. The factory's `getPool` returns each pool, and QuoterV2
reports the same factory and WETH9. USDT's `deprecated()` must stay false,
because a deprecated TetherToken forwards to another contract.
Contract immutables live in runtime code, so each code hash pins them too.
Quote and pre-send checks verify every hash again, and any drift fails
closed. The keyless mechanism pin (`constructorKind: sdk`) and its digest are
listed by `swap ethereum uniswap inventory`. Owners admit both assets with
that exact pin.

## Commands

- `quote --output-token <USDC or USDT>` reads `slot0` and QuoterV2
  `quoteExactInputSingle` by `eth_call`
  at one block. It computes the expected output, the minimum output from the
  owner's slippage cap, and the price impact against the fee-adjusted spot
  price. It encodes `execute(WRAP_ETH, V3_SWAP_EXACT_IN)` locally as the
  exact inverse of the strict decoder. It then simulates the unsigned
  transaction with `eth_call` and `eth_estimateGas` at the same block, and
  saves the quote, the unsigned transaction and the chain evidence under the
  state root, keyed by the quote hash. It needs `APN_ETHEREUM_RPC_URL`.
  Set `APN_UNISWAP_NATIVE_BATCH_READS=1` to group independent native quote reads into
  strict JSON-RPC batches of at most three requests. A provider batch error aborts the
  quote; APN does not fall back to scalar reads. The modeled successful ETH to USDT
  quote uses ten HTTP POSTs without retries.
- `prepare` requires the owner's active sealed policy to admit both assets
  for the `swap` rail with the keyless pin. Without it, `prepare` refuses with
  `swap_owner_admission_required`. The per-operation cap is checked here, and
  the daily cap is enforced by the shared usage ledger.
- `approve` runs in the foreground CLI only. It prints the exact screen: what
  goes out, the expected and minimum USDC, slippage, price impact, gas limit
  and fee caps, the maximum network fee, the deadline and approval cap 0.
  The owner types a six-character code. APN then reads the clock again,
  reserves the amount, checks the nonce, fees, balance and code pins at the
  head, persists the submission marker and the execution binding, signs with
  the local wallet and sends exactly once.
- `execute` continues an approved reservation that has no marker yet.
  After a marker exists, it only observes.
- `status` never signs or sends. A finalized success moves the operation to
  `finalized`. A finalized reverted receipt moves it to
  `failed_confirmed_revert` and releases the reservation.
- The success proof includes the native and output-token balances just before
  and just after the swap block. A pruning public RPC serves that state for
  only about 128 blocks, while finality takes 65–95. So the first `status`
  that sees the receipt reads those balances and keeps them in the state root,
  bound to the block hash. A later `status` reuses them and needs no historical
  state. After a reorg they are read again.
- Run `status` within about 25 minutes of sending. If the first observation
  comes later, `status` fails with `APN_PROVIDER_UNAVAILABLE` /
  `uniswap_pre_state_unavailable`. Re-run it with an archive-capable
  `APN_ETHEREUM_RPC_URL`. Any other observation failure is also reported by
  `status`, never hidden behind an unchanged `submitted`.

MCP serves `inventory`, `quote`, `prepare` and `status`. `approve` and
`execute` return `APN_FOREGROUND_APPROVAL_REQUIRED` with the exact CLI
handoff.

Any refusal before the submission marker releases the reservation as
`failed_before_effect`. After the marker, APN never sends again.

## Canonical token input lane

The separate `swap ethereum uniswap-token` family supports only canonical
Ethereum USDC to USDT and USDT to USDC through the fee-100 pool. Its transaction
is original SwapRouter `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))`
with selector `0x414bf389`, tuple deadline, `sqrtPriceLimitX96 = 0`, and value
zero. The approval spender is exactly the original SwapRouter. Universal Router
and native-input materials remain byte compatible.

`quote` requires an explicit approval cap equal to the input amount and budgets
the worst-case approval, swap, and cleanup gas. Allowance must start at zero or
the exact input amount. The foreground `approve` path may approve only that
amount. Successful execution proves the exact input debit, minimum output, and
zero residual allowance. A reverted or drifted post-approval operation enters
`cleanup_required`; only the explicit foreground `cleanup` command can send the
zero allowance cleanup. `status` observes and never signs or broadcasts.
USDT's no-return approval behavior is accepted only when the call returns empty
data; final allowance and finalized receipt evidence remain mandatory.

### Token-lane public primary pool

`APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS` may contain an ordered JSON array of one to
three credential-free HTTPS Ethereum endpoints. Duplicate endpoint aliases,
shared provider families, query credentials, and an archive that shares a
primary origin are rejected. The setting affects only the guarded token-input
lane. When it is absent, `APN_ETHEREUM_RPC_URL` keeps the previous single-primary
behavior and request counts.

Before signing, the lane sends the command's first full semantic batch to each
candidate at most once. Transport deadlines, HTTP 429/5xx/authentication,
malformed responses, wrong-chain responses, and missing capability put that
opaque provider identity into a finite shared cooldown or quarantine. Partial
responses never populate another provider's cache. The first fully decoded
candidate is frozen for the command. Business reverts are terminal on that
provider, and `eth_sendRawTransaction` has exactly one total attempt with no
post-sign failover. Batches remain capped at three logical reads; there is no
scalar fallback.

When a pooled command signs, the selected opaque provider ID is stored with the
encrypted raw effect and in token effect journal v2. Recovery resolves that
exact ID even if the configured order changes. A removed, cooling, or mismatched
provider blocks recovery before submission; an already signed effect never
selects another candidate. Legacy journal v1 and wallet effects remain readable.
Pooled legacy signed effects without a durable provider binding fail closed,
while scalar recovery remains compatible.

The distinct archive is independently chain-checked and must return the exact
hash for the primary's numeric pinned block before historical state is used.
Its anchor request verifies the archive chain, allowing nine token code and
safety reads to fit in three batches of three. With three primaries,
the effect-bearing reservations are quote 10, prepare 11, approval 17, and swap
24 physical attempts, totaling 62 against the durable operation ceiling of 64. Status and
cleanup reserve no new cumulative effect budget but enforce request-session
caps of 11 and 17. Durable telemetry stores only opaque provider IDs, finite
outcome/reason enums, and counters.

## 0.5.26 evidence boundary

The 0.5.26 release carries source and CI proof for this token-input lane and
retained no-effect live quote/recovery evidence. It does not record live paid
or effect acceptance. The latest live preflight did not reach `prepare` because
the available public providers could not satisfy the guarded read requirements;
no approval, swap or cleanup transaction was submitted.
