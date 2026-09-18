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
