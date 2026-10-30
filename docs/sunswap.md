# TRON SunSwap V2: keyless guarded swap

`apn swap tron sunswap` swaps native TRX for canonical USDT through the
SunSwap V2 router on TRON mainnet. This is the only admitted mechanism. APN
uses no API key and no off-chain quote endpoint: price, expected output and
reserves come from the pinned router and pair through
`wallet/triggerconstantcontract`, the transaction is encoded locally from the
pinned ABI, and only the owner's local TRON key signs it. Inventory reports
`admitted: false` and grants no spending authority.

## Requirements and setup

- **Local TRON wallet.** The profile's local TRON account
  (`apn wallet ensure-tron`, see [TRON](tron.md)) must be the quoted
  `--account`; otherwise approval refuses with `swap_owner_account` before the
  screen is shown. The recipient (`--to`) must be that same account. The
  account must be activated (`sunswap_owner_not_activated`).
- **TRON RPC.** `APN_TRON_RPC_URL` must be an explicit public HTTPS base without
  credentials, query parameters or fragments, so API keys cannot ride in the
  URL. There is no default. The pacing setting
  `APN_TRON_RPC_MIN_POST_INTERVAL_MS` described in [TRON](tron.md#account-assets-and-rpc)
  applies. The TronGrid public endpoint throttles keyless bursts (HTTP 429),
  which fails the quote closed; a quote needs about fourteen sequential reads.
- **Owner admission** of TRX and USDT, described [below](#owner-admission).

## Pins

| Role | Address | Code hash (keccak256 of runtime code) |
| --- | --- | --- |
| V2 router (`UniswapV2Router02`) | `TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax` | `cb5fd039…c16a3fb5` |
| V2 factory (`UniswapV2Factory`) | `TKWJdrQkqHisa1X8HUdHEfREvTzw4pMAaY` | `4d942d93…b234b1fe` |
| WTRX/USDT pair | `TFGDbUyP8xez44C76fin3bn3Ss6jugoUwJ` | `41625dc3…796d14d8` |
| WTRX (`WTRX`, 6 decimals) | `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` | `12573415…9c3dc03e` |
| USDT (`TetherToken`, 6 decimals) | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | `99bb60e5…4c7b78a9` |

Each pin is checked with `wallet/getcontract` (contract name and `code_hash`),
`wallet/getcontractinfo` (`keccak256(runtimecode) == code_hash`) and constant
calls: `router.WETH() == WTRX`, `router.factory() == factory`,
`factory.getPair` in both token orders `== pair`, `pair.token0() == WTRX`,
`pair.token1() == USDT`, token symbols and decimals,
`USDT.deprecated() == false`, and `getAmountsOut` equal to the 997/1000
constant-product formula over `getReserves`. The full hashes and checks live
in the frozen catalog digest (`src/swap/sunswap-tron/catalog.ts`). A changed
code hash refuses with `sunswap_code_hash_mismatch`.

## Commands

| Command | What it does |
| --- | --- |
| `inventory` | Lists the frozen catalog and, under `keyless`, the mechanism pin owners admit, its digest, the protocol registry digest and the five code pins. |
| `quote --profile --account --to --amount --slippage-bps --owner-slippage-cap-bps --fee-limit-sun --deadline` | Returns the `quoteHash`, the exact unsigned transaction, the price and resource display, the simulation and the mechanism pin. Nothing is signed or broadcast. |
| `prepare --profile --quote --idempotency-key` | Binds the saved material to the owner policy and the protocol registry and waits for foreground approval. |
| `approve --operation` | Foreground terminal only: shows the screen, takes the typed code, runs the pre-send guard, signs locally and broadcasts once. |
| `execute --operation` | Continues an approved reservation that has no marker yet; after the marker it only observes. |
| `status --operation` | Observes the exact transaction. Never signs or broadcasts. |

No option has a default. `--amount` is in SUN (1 TRX = 1,000,000 SUN).
`--fee-limit-sun` is the owner's explicit energy fee limit. `--deadline` is
unix seconds, at most ten minutes ahead. `--slippage-bps` must not exceed
`--owner-slippage-cap-bps` (at most 10000).

MCP serves `inventory`, `quote`, `prepare` and `status`. `approve` and
`execute` are reachable only through `apn_foreground_handoff`, which returns
`APN_FOREGROUND_APPROVAL_REQUIRED` with the exact CLI command.

### Example: 5 TRX to USDT

The whole sequence must finish before the quote deadline.

```sh
export APN_TRON_RPC_URL=https://tron-rpc.publicnode.com
apn swap tron sunswap inventory
QUOTE=$(apn swap tron sunswap quote --profile <profile> --account <tron-address> --to <tron-address> --amount 5000000 --slippage-bps 50 --owner-slippage-cap-bps 50 --fee-limit-sun 30000000 --deadline $(( $(date +%s) + 540 )) | jq -r .data.quoteHash)
OP=$(apn swap tron sunswap prepare --profile <profile> --quote $QUOTE --idempotency-key sunswap-0001 | jq -r .operation.operationId)
apn swap tron sunswap approve --operation $OP
apn swap tron sunswap status --operation $OP
```

Run `status` again until it reports `finalized` (solidification takes about a
minute). With a 30 TRX `fee_limit`, the maximum TRX debit of this example is
the 5 TRX input, plus up to 30 TRX of energy, plus the bandwidth budget.

The simulated energy includes the current dynamic-energy penalty of the
pinned contracts, which TRON recalculates every maintenance cycle, so the
energy for the same call changes over time. Set `fee_limit` with headroom.

## Quote

The quote requires the owner account as the recipient, a positive SUN amount,
`slippageBps <= ownerSlippageCapBps`, an explicit owner `feeLimitSun`, and a
router `deadline` within the next ten minutes. APN then:

1. proves the RPC serves TRON mainnet genesis and reads the energy price,
   bandwidth price and maximum fee limit from `wallet/getchainparameters`;
2. records the head block, re-verifies all five code hashes, reads
   `getAmountsOut(amount, [WTRX, USDT])` and `getReserves()`, and requires the
   next head to stay within 10 blocks of the recorded block
   (`sunswap_head_drift`);
3. fails closed unless the router output equals the reserve formula exactly
   (`sunswap_reserve_drift`);
4. derives, in integer math, the expected output, the minimum output
   `ceil(expected * (10000 - slippageBps) / 10000)`, the spot and execution
   prices, and the price impact against the reserve spot price (including the
   0.30% LP fee);
5. encodes `swapExactETHForTokens(minOut, [WTRX, USDT], owner, deadline)` with
   `call_value = amount` and `fee_limit = feeLimitSun`, referenced to the
   recorded block;
6. simulates that exact call from the owner and rechecks the head drift. A
   missing or underfunded owner account is an economic refusal
   (`APN_INSUFFICIENT_ASSET`: `sunswap_owner_not_activated` or
   `sunswap_owner_trx_insufficient`); a revert is `APN_OPERATION_BLOCKED`
   (`sunswap_output_below_minimum`, `sunswap_deadline_expired`, or
   `sunswap_constant_call_reverted` with the decoded reason); energy above the
   fee limit is `APN_FEE_BUDGET_EXCEEDED` (`sunswap_fee_limit_exceeded`); a
   dust input that yields no USDT is `sunswap_zero_output`;
7. requires the owner balance to cover `amount + feeLimitSun + bandwidth
   budget`, where the budget is the signed transaction size (serialized
   transaction plus 64 result bytes, 512 bytes for this call) times the
   bandwidth price, because `fee_limit` caps only energy;
8. persists the prepared material (quote, `approvalCapAtomic: "0"`, energy and
   bandwidth display, unsigned transaction, simulation, market evidence) keyed
   by `quoteHash`. Loading it re-derives every binding and reports
   `APN_STATE_CORRUPT` on any drift.

## Keyless mechanism pin

The pin is `constructorKind: sdk`, identity
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
canonical USDT for the `swap` rail, both with this pin or the route
`inventory` prints for it. Add the two admissions to the profile's policy file
(keep any admissions it already has, use a new `overlayVersion`, and the
profile's existing TRON account):

```json
{
  "schemaVersion": "apn.allowlist-policy-file.v1",
  "overlayVersion": "<a new overlay version>",
  "accounts": { "tron": "<the profile's local TRON account>" },
  "effectiveAt": "<ISO instant>",
  "expiresAt": "<ISO instant>",
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

Stage it with `apn allowlist policy stage --profile <profile> --file <absolute-policy-file>`
(pass `--expected-revision` when the profile already has a revision) and
activate it in the foreground with
`apn allowlist policy activate --profile <profile> --revision <revision>`. The
TRX per-operation cap is checked at `prepare`; the USDT cap is checked against
the minimum output; the daily caps are enforced by the shared usage ledger
when the approval reserves the input. The caps above are examples; nothing
defaults to them. Without an active admission `prepare` refuses with
`swap_owner_admission_required`, and a policy changed after `prepare` refuses
with `swap_policy_drift`.

## Approve, execute, status

- **`approve`** runs in the foreground CLI only. It prints the exact screen:
  TRX in (SUN and TRX), expected and minimum USDT, slippage, price impact, the
  simulated energy and its fee, `fee_limit`, the bandwidth budget, the maximum
  TRX debit, the deadline, the reference block and its TAPOS window, approval
  cap 0, the pair and router, and the quote, policy and mechanism digests. The
  owner types the six-character code. APN reads the clock again, reserves the
  input, and runs the pre-send guard at the current head: mainnet genesis,
  unchanged energy and bandwidth prices (`sunswap_resource_price_drift`), all
  five code hashes, a live reference block (`sunswap_reference_block_expired`)
  and expiration, the exact call still returning at least the minimum within
  `fee_limit`, and a balance covering the maximum TRX debit. Any refusal
  before the submission marker releases the reservation as
  `failed_before_effect` with nothing signed. APN then persists the submission
  marker and the execution binding, signs with the profile's encrypted local
  TRON key, and broadcasts exactly once.
- **`execute`** continues an approved reservation that has no marker yet;
  after the marker it only observes.
- **`status`** never signs or broadcasts. It reads full-node and solidified
  history for the exact transaction id. A solidified success with the full
  receipt proof moves the operation to `finalized`. A solidified failed call
  (`REVERT`, `OUT_OF_ENERGY` and the other failed contract results), with the
  exact bytes, fees within `fee_limit` and the bandwidth budget and no emitted
  logs, moves it to `failed_confirmed_revert` and releases the reserved input;
  only the fee was burned. A lost broadcast answer is `unknown_finality` and
  is only observed, never rebroadcast. Once the solidified chain passes the
  transaction's expiration without it, `status` records `expired_unlanded`
  and releases the reservation.

The success proof requires full-node and solidified history to agree,
`SUCCESS`, the exact transaction bytes, owner debit `= amount + fee` where
`fee = energy_fee + net_fee`, `energy_fee <= fee_limit` and `net_fee <=` the
frozen bandwidth budget, one WTRX `Deposit` of the amount by the router, one
pair `Swap` to the owner, and one USDT `Transfer` from the pair to the owner
of at least the minimum output.

A finalized operation's `receiptProof.economics` records the input, the USDT
output and the fee in SUN; `status` also returns them as `actualEconomics`
(see [Uniswap](uniswap.md#receipt-economics)).
