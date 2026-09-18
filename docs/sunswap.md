# TRON SunSwap V2: keyless guarded swap

APN exposes `inventory`, `quote`, `prepare`, `status`, `approve`, and `execute`
under `apn swap tron sunswap`. The only admitted mechanism is native TRX to
canonical USDT through the SunSwap V2 router on TRON mainnet. APN uses no API
key and no off-chain quote endpoint: price, expected output and reserves come
from the pinned router and pair through `wallet/triggerconstantcontract`, the
transaction is encoded locally from the pinned ABI, and only the owner's local
TRON key could ever sign it. Inventory presence reports `admitted: false` and
grants no spending authority.

## Pins (verified on-chain, 2026-09-18, block 86344275)

| Role | Address | Code hash (keccak256 of runtime code) |
| --- | --- | --- |
| V2 router (`UniswapV2Router02`) | `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` | `cb5fd039…c16a3fb5` |
| V2 factory (`UniswapV2Factory`) | `TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY` | `4d942d93…b234b1fe` |
| WTRX/USDT pair | `TFGDbUyP8xez44C76fin3bn3Ss6jugoUwJ` | `41625dc3…796d14d8` |
| WTRX (`WTRX`, 6 decimals) | `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` | `12573415…9c3dc03e` |
| USDT (`TetherToken`, 6 decimals) | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | `99bb60e5…4c7b78a9` |

Each pin was checked with `wallet/getcontract` (contract name and `code_hash`),
`wallet/getcontractinfo` (`keccak256(runtimecode) == code_hash`) and constant
calls: `router.WETH() == WTRX`, `router.factory() == factory`,
`factory.getPair` in both token orders `== pair`, `pair.token0() == WTRX`,
`pair.token1() == USDT`, token symbols and decimals, `USDT.deprecated() ==
false`, and `getAmountsOut` equal to the 997/1000 constant-product formula over
`getReserves`. The full hashes and checks live in the frozen catalog digest
(`src/swap/sunswap-tron/catalog.ts`).

## Quote

`SunSwapKeylessQuoteBuilder.quote(input)` requires the owner account as the
recipient, a positive SUN amount, `slippageBps <= ownerSlippageCapBps`, an
explicit owner `feeLimitSun`, and a router `deadline` within the next ten
minutes. Nothing is defaulted. The builder then:

1. proves the RPC serves TRON mainnet genesis and reads the energy price and
   maximum fee limit from `wallet/getchainparameters`;
2. records the head block, re-verifies all five code hashes, reads
   `getAmountsOut(amount, [WTRX, USDT])` and `getReserves()`, and requires the
   next head to stay within 10 blocks of the recorded block;
3. fails closed unless the router output equals the reserve formula exactly;
4. derives, in integer math, the expected output, the minimum output
   `ceil(expected * (10000 - slippageBps) / 10000)`, the spot and execution
   prices, and the price impact against the reserve spot price (including the
   0.30% LP fee);
5. encodes `swapExactETHForTokens(minOut, [WTRX, USDT], owner, deadline)` with
   `call_value = amount` and `fee_limit = feeLimitSun`, referenced to the
   recorded block;
6. simulates that exact call from the owner and rechecks the head drift. A
   missing or underfunded owner account is an economic refusal
   (`APN_INSUFFICIENT_ASSET`), a revert is `APN_OPERATION_BLOCKED`, and energy
   above the fee limit is `APN_FEE_BUDGET_EXCEEDED`;
7. requires the owner balance to cover `amount + feeLimitSun`;
8. persists the prepared material (quote, `approvalCapAtomic: "0"`, energy
   display, unsigned transaction, simulation, market evidence) keyed by
   `quoteHash`. `load(quoteHash)` re-derives every binding and reports
   `APN_STATE_CORRUPT` on any drift.

The builder is not installed in the CLI or MCP runtime. The shipped runtime
still reports `sunswap_runtime_unavailable` for `quote`.

## Execution and receipt

`prepare` refuses until the owner separately admits both exact assets and the
mechanism. Native TRX has no TRC20 or Permit2 approval, so `approve` always
returns `sunswap_native_no_approval`. `execute` returns
`sunswap_execution_dormant`; the signer, single-send and observer adapters stay
unwired. The receipt proof requires full-node and solidified history to agree,
`SUCCESS`, the exact transaction bytes, owner debit `= amount + fee` with the
fee within the fee limit, one WTRX `Deposit` of the amount by the router, one
pair `Swap` to the owner, and one USDT `Transfer` from the pair to the owner of
at least the minimum output.

## RPC

`APN_TRON_RPC_URL` must be an explicit public HTTPS base without credentials,
query parameters or fragments, so API keys cannot ride in the URL. The TronGrid
public endpoint throttles keyless bursts (HTTP 429), which fails the quote
closed; a quote needs about fourteen sequential reads.
