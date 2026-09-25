# Direct EVM acceptance runbook (2026-09-19)

This is the owner handoff for the remaining direct EVM proofs. It is pinned to
`origin/main` commit `5e5dbefc8bb37026563bbc6cfc91ed2850d11fc7` and the frozen
allowlist dataset
[`data/allowlist/2026-09-17/dataset.json`](../data/allowlist/2026-09-17/dataset.json).
The commands below stop at `prepare`; they do not approve, sign, submit, resume,
or charge a payment.

Authoritative implementation references are the [direct network registry](../src/evm-direct-networks.ts),
[CLI command catalog](../src/evm-command-catalog.ts),
[asset behavior](evm-assets.md), and
[direct policy integration](allowlist-direct-integration.md). The current
owner report is historical context only; do not copy wallet values from it into
evidence or source.

## Proof boundary

Keep these proof layers separate:

| Layer | What it proves | Current position |
| --- | --- | --- |
| Code/source | The registry, allowlist identities, fee model, policy schema, and CLI exist at the pinned commit. | Complete for the eleven rows below. |
| No-money prepare | A fresh policy-aware intent can be built, quoted, persisted, and refused safely without signing or sending. | Owner must run the fresh matrix below with current RPCs and policy. |
| Live proof | An owner-authorized transfer is approved, signed, submitted, included, and checked at the network's required finality. | Pending for the remaining rows. |

The current report records `1/9` for the repeated direct EVM mapping and `8/9`
remaining. It also records that the first current direct transfer using
`--priority-fee-wei` is still open. Those report results are historical evidence,
not fresh acceptance of this source revision.

## Eleven-network acceptance matrix

The chain names, native assets, token contracts, and decimals below are copied
from the frozen dataset. A token `identifier` is the only accepted asset value;
do not substitute a symbol or a contract from an older report.

| CAIP-2 chain | Network | Native asset | Listed token assets (contract; decimals) | Fee model | Required proof finality |
| --- | --- | --- | --- | --- | --- |
| `eip155:1` | Ethereum | ETH (18) | USDC (`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`; 6); USDT (`0xdAC17F958D2ee523a2206206994597C13D831ec7`; 6) | EIP-1559 execution only | Inclusion |
| `eip155:8453` | Base | ETH (18) | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; 6) | OP Stack execution + L1 data + operator fee | Inclusion |
| `eip155:42161` | Arbitrum One | ETH (18) | USDC (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`; 6) | Inclusive L2 execution + L1 posting envelope | Safe head |
| `eip155:10` | OP Mainnet | ETH (18) | USDC (`0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85`; 6) | OP Stack execution + L1 data + operator fee | Inclusion |
| `eip155:137` | Polygon PoS | POL (18) | USDC (`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359`; 6) | EIP-1559 execution only | Inclusion |
| `eip155:56` | BNB Smart Chain | BNB (18) | None | EIP-1559 execution only | Safe head |
| `eip155:43114` | Avalanche C-Chain | AVAX (18) | USDC (`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`; 6); USDT (`0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7`; 6) | EIP-1559 execution only | Safe head |
| `eip155:130` | Unichain | ETH (18) | USDC (`0x078D782b760474a361dDA0AF3839290b0EF57AD6`; 6) | OP Stack execution + L1 data + operator fee | Inclusion |
| `eip155:59144` | Linea | ETH (18) | USDC (`0x176211869cA2b568f2A7D4EE941E073a821EE1ff`; 6) | EIP-1559 execution only | Inclusion |
| `eip155:143` | Monad | MON (18) | USDC (`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`; 6) | Gas limit charged, not gas used | Safe head |
| `eip155:1329` | Sei EVM | SEI (18) | USDC (`0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392`; 6) | EIP-1559 execution only | Safe head |

For the no-money matrix, use these smallest repeatable probe values unless the
owner supplies a stricter value: `0.000001` of the native asset, or `0.01` of a
listed token. These are positive prepare amounts, not permission to fund or
send. Token `0.01` means `10000` atomic units at six decimals. Every command
still requires an owner-selected positive `--max-fee-wei` quote budget.

## Gas, fee, and finality requirements

- `--max-fee-wei` is a positive native-asset pre-submission quote budget. It is
  checked against the frozen estimate and is not an on-chain total-fee cap.
  Native value and the fee budget must both fit the owner-funded account before
  a live approval.
- Base, OP Mainnet, and Unichain include execution, L1 data, and operator fee
  estimates from the Base `GasPriceOracle` predeploy
  `0x420000000000000000000000000000000000000F`. Arbitrum uses one inclusive
  execution/L1-posting envelope and must not add an OP Stack oracle fee.
- Monad charges against the gas limit. Fee and nonce changes are rechecked at
  approval/submission; a stale or insufficient envelope requires a new prepared
  operation. A signed operation is not repriced automatically.
- A first live priority-fee candidate is `100000000` wei (`0.1` gwei), subject
  to the owner's current RPC quote and budget. It is an explicit owner input,
  not a default. Include `--priority-fee-wei 100000000` only on a non-Arbitrum
  row when the owner approves that candidate. Arbitrum must omit the flag; the
  command is rejected with `priority_fee_not_applicable`. A zero-base-fee chain
  needs a positive tip to avoid a zero total gas price.
- `inclusion` requires a canonical receipt at the latest head. `safe` requires
  the receipt block to be at or below the selected RPC safe head. A receipt
  that is not yet safe is `unknown_finality`; resume the same operation only
  after separate live authorization.

## Policy activation prerequisites

The dataset records asset identity; it does not grant direct authority. Before
any prepare, the owner must create a complete `apn.allowlist-policy-file.v1`
with the exact schema fields `schemaVersion`, `overlayVersion`, `accounts`,
`effectiveAt`, `expiresAt`, and `admissions`. `accounts.evm` must match the
local wallet reported by APN. Each matrix asset needs its own `direct`
admission with positive per-operation and daily atomic caps. The file must be an
absolute, owner-owned, non-group/world-writable regular file of at most 256 KiB;
on macOS use its `/private/...` path rather than a `/tmp` symlink.

Use the foreground owner flow from
[`docs/allowlist-policy.md`](allowlist-policy.md):

```sh
apn wallet status --profile <profile>
apn allowlist policy stage --profile <profile> --file <absolute-policy-file>
apn allowlist policy status --profile <profile>
apn allowlist policy activate --profile <profile> --revision <revision>
apn allowlist policy status --profile <profile>
```

For an update, pass the latest revision with
`--expected-revision <revision>` when staging. Activation displays the full
revision and requires the owner's typed six-character code in a foreground
terminal. Staging alone grants no authority. The historical policy file under
the runtime evidence directory is not evidence of current eleven-network
coverage; regenerate and activate a current policy, then record its revision
and digest without copying account values into this runbook.

The encrypted local wallet manifest is referenced by APN as
`~/.apn/wallets/<profile>.json`. Keep it owner-only and use APN commands; never
print, paste, export, or copy its secret material.

## No-send prepare commands

Run each row only after the policy status is active. Use an HTTPS RPC URL with
no credentials in the command line. `balance-asset` is a read; `prepare-asset`
may persist local operation state and query the RPC but never signs or submits.

```sh
# Native probe; replace every placeholder with owner-supplied values.
apn wallet balance-asset \
  --profile <profile> --chain <caip2> --asset native \
  --rpc-url <https-rpc-url>

apn pay transfer prepare-asset \
  --profile <profile> --chain <caip2> --asset native \
  --to <owner-approved-recipient> --amount 0.000001 \
  --max-fee-wei <positive-owner-budget> \
  --idempotency-key <fresh-unique-key> --rpc-url <https-rpc-url>

# Token probe; use the exact contract and matching decimals from the matrix.
apn wallet balance-asset \
  --profile <profile> --chain <caip2> --asset <listed-contract> \
  --decimals 6 --rpc-url <https-rpc-url>

apn pay transfer prepare-asset \
  --profile <profile> --chain <caip2> --asset <listed-contract> \
  --decimals 6 --to <owner-approved-recipient> --amount 0.01 \
  --max-fee-wei <positive-owner-budget> \
  --idempotency-key <fresh-unique-key> --rpc-url <https-rpc-url>
```

For the priority-fee candidate, add
`--priority-fee-wei 100000000` to the prepare command on the selected non-
Arbitrum row and record the exact value in the evidence ledger. Do not add it to
Arbitrum. After prepare, capture the operation ID, policy revision/digest,
asset identity, quote, and refusal or insufficient-balance reason. Read-only
follow-up commands are `apn operation status --operation <operation-id>` and
`apn receipt get --operation <operation-id>`; do not run `approve`, `resume`,
`execute`, or an equivalent send command in this no-money pass.

## Fresh 9/9 mapping requirement

The historical acceptance mapping has nine rows: Ethereum ETH, USDC, and WETH;
Base ETH, USDC, and WETH; and Arbitrum One ETH, USDC, and USDT0. The current
report has fresh evidence for only one of those nine (Ethereum ETH). The other
eight require fresh evidence on this source revision.

WETH and USDT0 remain absent from the frozen market-cap dataset above. The
direct-only supplemental registry pins Ethereum WETH9
`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (18 decimals), Base WETH9
`0x4200000000000000000000000000000000000006` (18 decimals), and Arbitrum
USD₮0 `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` (6 decimals). Their
identities are recorded in the [direct registry](../src/evm-direct-supplemental-assets.ts),
with deployment references in [LI.FI documentation](lifi.md) and historical
direct acceptance in [EVM assets](evm-assets.md). They require exact direct
owner-policy admissions and fresh no-money prepares before any live acceptance.
The registry does not admit them on bridge, x402, gasless, or swap rails.

## Owner inputs required for live acceptance

- Profile name and a fresh `apn wallet status` identity check against the
  owner-held manifest at `~/.apn/wallets/<profile>.json`.
- One current HTTPS RPC URL per chain, with the provider and observation time.
- An owner-approved recipient address per test, the probe amount, positive
  native fee budget, and (where selected) the priority-fee candidate.
- A staged and activated policy revision covering the exact current matrix,
  with effective/expiry times and atomic caps.
- The owner decision to move from no-money prepare to live approval and send,
  including the required receipt/finality evidence destination.
- A fresh idempotency key per prepared intent and a record of any existing
  operation that must be resumed or left untouched.

## Safety boundary

This document contains no private keys, seed phrases, wallet secrets, or copied
owner addresses. Do not paste them into commands, reports, issues, or this
repository. The no-money phase stops before approval/sign/send and must not be
used to infer live inclusion, finality, or funding. Only the owner can authorize
the subsequent paid live proof after reviewing the fresh prepare evidence.
