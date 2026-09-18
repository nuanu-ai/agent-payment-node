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

1. proves the RPC serves TRON mainnet genesis and reads the energy price,
   bandwidth price and maximum fee limit from `wallet/getchainparameters`;
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
   (`APN_INSUFFICIENT_ASSET`); a revert is `APN_OPERATION_BLOCKED`
   (`sunswap_output_below_minimum`, `sunswap_deadline_expired`, or
   `sunswap_constant_call_reverted` with the decoded reason); energy above the
   fee limit is `APN_FEE_BUDGET_EXCEEDED`; a dust input that yields no USDT is
   `sunswap_zero_output`;
7. requires the owner balance to cover `amount + feeLimitSun + bandwidth
   budget`, where the budget is the signed transaction size (serialized
   transaction plus 64 result bytes, 512 bytes for this call) times the
   bandwidth price, because `fee_limit` caps only energy;
8. persists the prepared material (quote, `approvalCapAtomic: "0"`, energy and bandwidth
   display, unsigned transaction, simulation, market evidence) keyed by
   `quoteHash`. `load(quoteHash)` re-derives every binding and reports
   `APN_STATE_CORRUPT` on any drift.

## Keyless mechanism pin

`apn swap tron sunswap inventory` lists the frozen catalog and, under
`keyless`, the mechanism pin owners admit, its digest, the protocol registry
digest and the five code pins. The pin is `constructorKind: sdk`, identity
`apn.sunswap-v2.local-abi-builder` 1.0.0, router
`TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax`, auxiliaries factory, pair and WTRX:

```json
{
  "schemaVersion": "apn.swap-mechanism-pin.v1",
  "protocolFamily": "sunswap_tron",
  "networkFamily": "tron",
  "chain": "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc",
  "protocolVersion": "2.0.0",
  "constructorKind": "sdk",
  "constructorIdentity": "apn.sunswap-v2.local-abi-builder",
  "constructorVersion": "1.0.0",
  "routerProgramIdentity": "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax",
  "auxiliaryContractProgramIdentities": [
    "TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY",
    "TFGDbUyP8xez44C76fin3bn3Ss6jugoUwJ",
    "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR"
  ],
  "quoteSchemaVersion": "v2-router-getamountsout-pair-getreserves.1",
  "transactionSchemaVersion": "v2-router-swapexactethfortokens-owner-recipient.1",
  "validationPolicyIdentity": "apn.sunswap.tron-native-v2-keyless",
  "validationPolicyVersion": "1.0.0"
}
```

Mechanism digest: `3319811f1171ad202094cb7c8d3ee20e257e751b98322a18a4808a3ba7d72b2b`.

## Owner admission

`prepare` needs the profile's active allowlist policy to admit native TRX and
canonical USDT for the `swap` rail, both with exactly this pin. Add the two
admissions to the profile's policy file (keep any admissions it already has,
use a new `overlayVersion`, and the profile's existing TRON account):

```json
{
  "schemaVersion": "apn.allowlist-policy-file.v1",
  "overlayVersion": "owner.2026-09-18.sunswap.1",
  "accounts": { "tron": "<the profile's local TRON account>" },
  "effectiveAt": "2026-09-18T08:00:00.000Z",
  "expiresAt": "2026-10-18T08:00:00.000Z",
  "admissions": [
    { "chain": "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc",
      "kind": "native", "rail": "swap",
      "maximumPerTransferAtomic": "8900000", "dailyLimitAtomic": "29700000",
      "mechanism": { "...": "the complete pin above" } },
    { "chain": "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc",
      "kind": "token", "identifier": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "rail": "swap",
      "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000",
      "mechanism": { "...": "the complete pin above" } }
  ]
}
```

Stage it with `apn allowlist policy stage` (pass `--expected-revision` when
the profile already has a revision) and activate it in the foreground with
`apn allowlist policy activate`. The TRX per-operation cap is checked at
`prepare`; the USDT cap is checked against the minimum output; the daily caps
are enforced by the shared usage ledger when the approval reserves the input.
The caps above are examples; nothing defaults to them. Without an active
admission `prepare` refuses with `swap_owner_admission_required`, and a policy
changed after `prepare` refuses with `swap_policy_drift`.

The profile's local TRON account (`apn wallet ensure-tron`) must be the quoted
`--account`; otherwise approval refuses with `swap_owner_account` before the
screen is shown. The recipient is always that same account.

## Commands

- `quote` takes `--fee-limit-sun` and `--deadline` (unix seconds, at most ten
  minutes ahead) from the owner; neither is defaulted. It returns the
  `quoteHash`, the exact unsigned transaction, the price and resource display,
  the simulation and the mechanism pin. Nothing is signed or broadcast.
- `prepare --quote <quoteHash>` binds the saved material to the owner policy
  and the protocol registry and waits for foreground approval.
- `approve` runs in the foreground CLI only. It prints the exact screen: TRX
  in (SUN and TRX), expected and minimum USDT, slippage, price impact, the
  simulated energy and its fee, `fee_limit`, the bandwidth budget, the maximum
  TRX debit, the deadline, the reference block and its TAPOS window, approval
  cap 0, the pair and router, and the quote, policy and mechanism digests. The
  owner types the six-character code. APN reads the clock again, reserves the
  input, and runs the pre-send guard at the current head: mainnet genesis,
  unchanged energy and bandwidth prices, all five code hashes, a live
  reference block and expiration, the exact call still returning at least the
  minimum within `fee_limit`, and a balance covering the maximum TRX debit.
  Any refusal before the submission marker releases the reservation as
  `failed_before_effect` with nothing signed. APN then persists the
  submission marker and the execution binding, signs with the profile's
  encrypted local TRON key, and broadcasts exactly once.
- `execute` continues an approved reservation that has no marker yet; after
  the marker it only observes.
- `status` never signs or broadcasts. It reads full-node and solidified
  history for the exact transaction id. A solidified success with the full
  receipt proof moves the operation to `finalized`. A solidified failed call
  (`REVERT`, `OUT_OF_ENERGY` and the other failed contract results), with the
  exact bytes, fees within `fee_limit` and the bandwidth budget and no emitted
  logs, moves it to `failed_confirmed_revert` and releases the reserved input;
  only the fee was burned. A lost broadcast answer is `unknown_finality` and
  is only observed, never rebroadcast.

MCP serves `inventory`, `quote`, `prepare` and `status`. `approve` and
`execute` return `APN_FOREGROUND_APPROVAL_REQUIRED` with the exact CLI handoff.

The success proof requires full-node and solidified history to agree,
`SUCCESS`, the exact transaction bytes, owner debit `= amount + fee` where
`fee = energy_fee + net_fee`, `energy_fee <= fee_limit` and `net_fee <=` the
frozen bandwidth budget, one WTRX `Deposit` of the amount by the router, one
pair `Swap` to the owner, and one USDT `Transfer` from the pair to the owner of
at least the minimum output. Real mainnet `swapExactETHForTokens` successes,
and real `REVERT` and `OUT_OF_ENERGY` router calls for the failed-call proof,
parse through the production RPC transport with full-node and solidified
records equal.

## Owner sequence for 5 TRX to USDT

`tron-local` and `TCikdGHFWNFWBc9ZqtTh2dmma1mnC4CanS` are the example profile
and account; the whole sequence must finish before the quote deadline.

```sh
export APN_TRON_RPC_URL=https://tron-rpc.publicnode.com
apn swap tron sunswap inventory
QUOTE=$(apn swap tron sunswap quote --profile tron-local --account TCikdGHFWNFWBc9ZqtTh2dmma1mnC4CanS --to TCikdGHFWNFWBc9ZqtTh2dmma1mnC4CanS --amount 5000000 --slippage-bps 50 --owner-slippage-cap-bps 50 --fee-limit-sun 30000000 --deadline $(( $(date +%s) + 540 )) | jq -r .data.quoteHash)
OP=$(apn swap tron sunswap prepare --profile tron-local --quote $QUOTE --idempotency-key sunswap-5trx-2026-09-18-1 | jq -r .operation.operationId)
apn swap tron sunswap approve --operation $OP
apn swap tron sunswap status --operation $OP
```

Run `status` again until it reports `finalized` (solidification takes about a
minute). A 2026-09-18 read-only rehearsal from that account quoted 1.671655
USDT expected, 1.663297 USDT minimum, a 31 basis-point price impact and
223,354 energy (22.3354 TRX at 100 SUN per energy), so the maximum TRX debit
is 35.512 TRX: 5 TRX input, the 30 TRX `fee_limit` and a 0.512 TRX
bandwidth budget.

The simulated energy includes the current dynamic-energy penalty of the pinned
contracts, which TRON recalculates every maintenance cycle (observed 157,354
to 223,354 energy for this call). Owners should set `fee_limit` with headroom.

## RPC

`APN_TRON_RPC_URL` must be an explicit public HTTPS base without credentials,
query parameters or fragments, so API keys cannot ride in the URL. The TronGrid
public endpoint throttles keyless bursts (HTTP 429), which fails the quote
closed; a quote needs about fourteen sequential reads.
