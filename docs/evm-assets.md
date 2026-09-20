# Explicit EVM assets

Owner acceptance runbook: [direct EVM live proofs](evm-direct-live-acceptance-2026-09-19.md).

The APN 0.5.24 package supports the local encrypted disposable wallet on the
11 direct EVM networks in the frozen allowlist. `wallet balance-asset` reads
native coins or any explicitly selected contract on each of those networks;
direct transfers (`pay transfer prepare-asset`) use the same network registry
with the frozen token allowlist. x402, wallet policy, LI.FI and the portfolio
network set remain on their own registries (see
[Direct networks](#direct-networks-fee-models-and-finality)). Package
availability and a fresh mainnet payment remain separate proof layers.

## One direct-transfer journey

```sh
apn wallet balance-asset --profile default --chain eip155:8453 --asset native --rpc-url <https-base-rpc-url>
apn pay transfer prepare-asset --profile default --chain eip155:8453 --asset native --to <recipient> --amount 0.000001 --max-fee-wei <owner-budget> --idempotency-key <unique-key> --rpc-url <https-base-rpc-url>
apn pay transfer approve --operation <operation-id> --rpc-url <https-base-rpc-url>
apn operation status --operation <operation-id>
apn operation resume --operation <operation-id> --rpc-url <https-base-rpc-url>
apn receipt get --operation <operation-id>
```

The priority fee (the tip per gas) comes from the RPC's `eth_maxPriorityFeePerGas`
by default. Some public RPCs answer 0, and a transaction with no tip can wait a
few blocks for inclusion. `--priority-fee-wei <wei>` makes the owner's tip replace
that suggestion. The fee cap then becomes twice the base fee plus that tip. It
counts toward `--max-fee-wei` and is part of the request, so reusing an
idempotency key with a different tip is a conflict. Arbitrum One prices gas
without a separate tip, so there the flag is refused with
`priority_fee_not_applicable`. On a network whose base fee is zero, a zero tip is
refused because a zero total price is never signed.

Direct transfers accept only the frozen allowlist (`data/allowlist/2026-09-17/dataset.json`).
For a token, replace `native` with its pinned list contract; any other address is
refused with `APN_ALLOWLIST_REFUSED` (`allowlist_asset_unlisted`) before any RPC.
Symbol is not identity. Decimals come from the list row: `--decimals` is optional
and must equal it, and a contract reporting other decimals fails. Every direct
transfer also needs an owner-activated allowlist policy that admits the asset on
the `direct` rail; its per-operation and daily caps apply to native ETH and every
listed token (see `docs/allowlist-direct-integration.md`). No rounding, NFT,
swap, approval or arbitrary calldata is supported. `wallet balance-asset` still
reads any contract.

`--amount` is a canonical exact positive decimal; `--max-fee-wei` is a positive
integer native-ETH **pre-submission quote budget**, not an onchain-enforced total
fee cap. Ethereum uses execution-only EIP-1559 fees: its L1/operator extra fields
are explicitly zero and no Base oracle is queried. Base includes maximum
EIP-1559 execution cost, L1 data upper
estimate for at most 512 signed bytes, and operator fee estimate. Native value
must also be funded. The quote is rechecked before signing and every submission.
Variable L1/operator fees may change at inclusion. Missing oracle evidence fails
closed. Before signing on every supported EVM chain, the nonce must remain
exact, current required gas must fit within the frozen gas limit, and the
current derived base fee must fit within the frozen signed maximum-fee
envelope. Harmless lower gas estimates and fee-recommendation movement are
accepted without changing the approved transaction. A signed operation is
never replaced or repriced automatically.

Arbitrum uses its full inclusive `eth_estimateGas` result: L2 execution and L1
posting are paid within one gas envelope. Its `feeModel: arbitrum-inclusive`
is frozen and shown at approval and in receipts; zero *separate* L1/operator
surcharges do not mean posting is free. APN never calls the Base oracle or
adds posting costs twice. Priority fee is zero. Arbitrum additionally rechecks
the inclusive envelope after signing and before submission: required gas above
the frozen gas limit or current base fee above the frozen ceiling blocks the
existing signed operation rather than replacing it; resume only that operation
when its frozen envelope suffices. Before signing on any chain, nonce drift,
required gas above the frozen limit, or base fee above the frozen ceiling
requires a new operation. APN always signs the original approved transaction
unchanged.

## Direct networks, fee models and finality

`src/evm-direct-networks.ts` is the direct-only registry. It is separate from
the shared `EVM_NETWORKS` set (Base, Ethereum, Arbitrum), so enabling a direct
network never enables x402, LI.FI, wallet policy or balance reads on it. Each
network accepts its native coin and only its pinned list contracts, with list
decimals; the registry's native coin is checked against the list row on every
prepare. RPC stays an explicit `--rpc-url` on every command; there is no
default endpoint on the money path. `--max-fee-wei` is always required and is
in the network's native coin (wei-scale atomic units).

| Network | CAIP-2 | Native | List tokens (pinned contract, 6 decimals) | Fee model | Completion |
| --- | --- | --- | --- | --- | --- |
| Ethereum | `eip155:1` | ETH | USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7` | EIP-1559 | inclusion |
| Base | `eip155:8453` | ETH | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | OP-stack L1 + operator fee | inclusion |
| Arbitrum One | `eip155:42161` | ETH | USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | Arbitrum inclusive | `safe` head |
| OP Mainnet | `eip155:10` | ETH | USDC `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | OP-stack L1 + operator fee | inclusion |
| Polygon PoS | `eip155:137` | POL | USDC `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | EIP-1559 | inclusion |
| BNB Smart Chain | `eip155:56` | BNB | none (native only) | EIP-1559, zero base fee | `safe` head |
| Avalanche C-Chain | `eip155:43114` | AVAX | USDC `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`, USDT `0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7` | EIP-1559 | `safe` head |
| Unichain | `eip155:130` | ETH | USDC `0x078D782b760474a361dDA0AF3839290b0EF57AD6` | OP-stack L1 + operator fee | inclusion |
| Linea | `eip155:59144` | ETH | USDC `0x176211869cA2b568f2A7D4EE941E073a821EE1ff` | EIP-1559 | inclusion |
| Monad | `eip155:143` | MON | USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | gas-limit billed | `safe` head |
| Sei EVM | `eip155:1329` | SEI | USDC `0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392` | EIP-1559 | `safe` head |

Fee models. Every model signs an EIP-1559 transaction with
`maxFeePerGas = 2 x latest baseFeePerGas + eth_maxPriorityFeePerGas` and
`gas = eth_estimateGas`, and freezes `gas x maxFeePerGas` as the maximum
execution fee. The owner's `--max-fee-wei` caps the **total** quote: execution
plus any L1 data and operator fee. The quote is rechecked before signing and
before every submission.

- **OP-stack (Base, OP Mainnet, Unichain).** The L1 data fee upper bound for
  512 signed bytes (`getL1FeeUpperBound`) and the operator fee
  (`getOperatorFee`) come from the GasPriceOracle predeploy
  `0x420000000000000000000000000000000000000F` at the quoted block. All three
  are Isthmus chains; the operator fee read 0 on 2026-09-18. A budget that
  covers execution but not the L1 fee is refused.
- **EIP-1559 (Ethereum, Polygon, Avalanche, Linea, Sei, BNB).** Execution only;
  the L1/operator fields are zero and no oracle is called. BNB's base fee is 0,
  so the priority fee is the whole price (0.05 gwei observed); a zero total
  price is refused, and the explicit owner cap still applies. Linea's base fee
  sits at 7 wei and its price is carried by the priority fee.
- **Monad.** Monad charges the gas **limit**, not gas used. The budget is
  already `limit x maxFeePerGas`, so the cap holds; the quote carries
  `feeModel: monad-gas-limit` and the approval prompt says so, because the
  actual charge is close to the budgeted execution fee rather than below it.
- **Arbitrum.** Unchanged: inclusive gas, zero priority fee, post-signing
  envelope recheck.

Completion. `inclusion` networks complete on a canonical receipt at the
selected RPC's latest head, as Base and Ethereum always have. `safe` networks
additionally require the receipt block at or below the selected RPC's `safe`
head, and scan nonce supersession from `safe`, exactly as Arbitrum does. The
choice follows what each chain's `safe` tag means, measured on 2026-09-18:

- BNB, Avalanche, Sei: `safe` equals latest (fast or instant finality), so
  the check adds finality evidence at no delay. Monad: `safe` is the voted
  block, one block (about 0.4 s) behind latest.
- OP Mainnet and Unichain: `safe` is L1-derived and lagged 94 and 346 blocks;
  they keep Base's inclusion rule, like Base on the same stack.
- Linea: `safe` equals `finalized` (L1 finality), 614 blocks (about 20 min)
  behind; inclusion rule.
- Polygon PoS: the verified public RPC rejects the `safe` tag ("safe block not
  found"), while `finalized` (milestones) trails by about 2 blocks. Inclusion
  is treated as final on Polygon; this is the same trust class as Ethereum
  inclusion and not an irrevocable-finality claim.

If a `safe` network's receipt is not yet at the safe head, the operation stays
`unknown_finality` and `operation resume` completes it later without a new
signature.

Monad's asynchronous execution also applies a per-account reserve-balance rule,
which APN does not model and this change did not verify. A native MON transfer
that would nearly empty the account may be rejected or reverted by the network
even though APN's own funding check passes; leave headroom.

### Owner admissions

Each asset needs its own `"rail": "direct"` admission in the owner's
`apn.allowlist-policy-file.v1` (see `docs/allowlist-direct-integration.md`), with
`accounts.evm` set to the local wallet address. Caps are atomic units of the
asset. For example, native OP ETH and Avalanche USDT:

```json
{ "chain": "eip155:10", "kind": "native", "rail": "direct", "maximumPerTransferAtomic": "1200000000000000", "dailyLimitAtomic": "4000000000000000" }
{ "chain": "eip155:43114", "kind": "token", "identifier": "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", "rail": "direct", "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000" }
```

An asset without its own admission is refused with `allowlist_direct_not_admitted`,
even when the same symbol is admitted on another network.

### Read-only mainnet check (2026-09-18)

`prepare-asset` was run through the production RPC and prepare code, up to the
frozen fee quote, from the owner's public address
`0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7`. A stand-in wallet returned only
that address. The state root was temporary, the policy admitted every row, the
budget was 0.05 native, and nothing was approved, signed or broadcast. Amounts
were 0.000001 native and 0.01 of each token. The fee probe is the production
estimate and quote for a zero-value native transfer from the same address.

| Network | Native | Tokens | Fee probe (gas x max fee + L1 = total wei) |
| --- | --- | --- | --- |
| OP Mainnet | quote frozen, `awaiting_approval` (25890664038 wei incl. 4869958038 L1) | USDC quote frozen (45211 gas, 50125445662 wei) | 21000 x 1000984 + 4869958038 = 25890622038 |
| Polygon PoS | `APN_INSUFFICIENT_ASSET` (0 POL) | USDC `APN_INSUFFICIENT_ASSET` | 21000 x 526821219109 = 11063245601289000 |
| BNB Smart Chain | `APN_INSUFFICIENT_ASSET` (0 BNB) | none | 21000 x 50000000 = 1050000000000 |
| Avalanche C-Chain | quote frozen, `awaiting_approval` (2404768737000 wei) | USDC, USDT `APN_INSUFFICIENT_ASSET` | 21000 x 112783843 = 2368460703000 |
| Unichain | `APN_INSUFFICIENT_ASSET` (0 ETH) | USDC `APN_INSUFFICIENT_GAS` after the full quote (0.94 USDC, 0 ETH) | 21000 x 2000000 + 2918579164 = 44918579164 |
| Linea | `APN_INSUFFICIENT_ASSET` (0 ETH) | USDC `APN_INSUFFICIENT_ASSET` | 21000 x 200000014 = 4200000294000 |
| Monad | `APN_INSUFFICIENT_ASSET` (0 MON) | USDC `APN_INSUFFICIENT_ASSET` | 21000 x 202000000000 = 4242000000000000, `monad-gas-limit` |
| Sei EVM | `APN_INSUFFICIENT_ASSET` (0 SEI) | USDC `APN_INSUFFICIENT_ASSET` | 21000 x 101000000000 = 2121000000000000 |

An insufficient balance is an economic refusal: the transfer is correct but
unfunded. An amount above the asset balance now refuses before the gas estimate,
which would otherwise fail on the same shortfall.

Exact foreground TTY approval precedes private-key access. MCP
`apn_wallet_balance_asset` and `apn_pay_transfer_prepare_asset` use the same
catalog/core. MCP direct approval returns the existing CLI handoff; it cannot
authorize or strand the operation. Status and receipt do not resume effects.

## Safety, recovery and proof

- Chain, asset kind/address/decimals, amount, recipient, payer, nonce and fee
  budget are frozen. Wrong-chain RPC fails before submission or recovery.
- Global idempotency and conservative per-profile exclusion remain. Repeating
  the same request returns the old operation before metadata refresh; changing
  material inputs under the same key conflicts, including another operation kind.
- A durable started record precedes signing. Encrypted signature material is
  saved before returning. Restart retrieves only that signature; if none exists,
  the operation fails before effect rather than signing a replacement.
- Native completion requires the exact included transaction and successful
  receipt. ERC-20 completion additionally requires its exact `Transfer` log and
  exact sender/recipient balance deltas across the receipt block. Reorgs,
  concurrent token activity, fee-on-transfer/rebasing behavior, false-return
  tokens, or unavailable historical reads can leave delivery unproven. A hash
  or successful receipt alone never proves an exact generic token payment.
- Base/Ethereum completion reports **inclusion only**, not irrevocable finality;
  so do OP Mainnet, Unichain, Linea and Polygon. BNB, Avalanche, Monad and Sei
  use the Arbitrum `safe` rule below.
  Arbitrum additionally requires rechecked selected-RPC `safe` inclusion for
  success/revert and safe-chain nonce supersession; a sequencer-only receipt
  stays nonterminal. Its receipt says `rpc_safe_inclusion`, with observed safe
  block identity. This trusts the RPC and is not a trustless rollup proof or
  an independent challenge-finality guarantee. Terminal
  receipt fields must prove the same immutable operation; absent/altered receipt
  fails closed. No custodial aggregate balance or automatic funding is implied.
- Existing Base-USDC/ETH profile policy is Base-asset-specific. Other token
  balances are explicitly unassessed; generic direct permission is the exact
  operation approval, never conversion or reuse of a USDC allowance.

## Ethereum / Arbitrum x402 and policy

Use `wallet policy set-network --chain eip155:1` with explicit
`--max-balance-usdc-atomic` and `--max-x402-amount-atomic`, then
`x402 inspect-network` / `x402 fetch prepare-network --chain eip155:1` with the
existing URL, HTTP, RPC and idempotency options. Policy creation/increases require
foreground TTY approval; MCP returns the exact CLI handoff. Decreases are
noninteractive. `show-network` reports only the selected policy. Explicit Base
selection aliases the legacy Base policy. For Arbitrum use `--chain eip155:42161`
with the same commands and the selected-network RPC. All three policies are
separate; neither Ethereum nor Arbitrum inherits another network allowance.

Ethereum x402 supports only exact EIP-3009 canonical Ethereum USDC at
`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`. Name, version and domain separator
are independently read at a pinned safe block. Arbitrum uses native USDC at
`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, not bridged USDC.e. Direct ERC-20 support for list contracts
does not imply other x402 tokens or ERC-7710/Permit2 support. External wallet
profiles are refused before provider execution on non-Base networks.

Before new authorization and the first paid exposure, APN reloads the encrypted
network policy, payer, cap, balance and token domain. Lowering limits or changing
RPC/network/identity blocks new exposure, not read-only reconciliation of an
already-exposed authorization. RPC reconciliation checks the selected token and
safe/finalized chain evidence. Resume takes its network from the frozen operation,
not a new caller override. GET and absent/empty/nonempty POST envelopes remain
immutable across the same-material retry and result recovery.

Direct transfers and paid x402 purchases have separate acceptance records.
The bounded D4-D9 direct acceptance completed on
2026-09-10 for Arbitrum native ETH, USDC and USDT0 plus Base native ETH, USDC
and WETH: all six direct rows passed, both required Base WETH prerequisite
transactions were confirmed, and Base USDC funding was skipped as unnecessary.
That is pre-release source/live proof, not APN 0.5.10 publication, Homebrew
installation, merchant availability or x402 settlement proof.

## Capability boundary

| Profile | Native and list ERC-20 direct on the eleven list EVM networks (owner allowlist caps) | Base-USDC direct | Standard x402 |
| --- | --- | --- | --- |
| Local encrypted wallet | Base/Ethereum/Arbitrum: APN 0.5.10 capability, bounded Base/Arbitrum D4-D9 direct proof passed on 2026-09-10. The eight other networks: fake-RPC tests plus the read-only prepare check above; no signed mainnet transfer yet | Existing journey preserved; D5/D8 included in the bounded direct proof | Base plus APN 0.5.10 Ethereum/Arbitrum-USDC exact EIP-3009; fresh merchant proof held |
| Coinbase Agentic Wallet | Explicitly unsupported | Existing provider route | Existing Base-USDC route; pinned AWAL rejects present bodies, including empty |
| MetaMask Agent Wallet | Explicitly unsupported | Existing provider route | Existing Base-USDC route |
| MetaMask Smart Account | Explicitly unsupported | Existing bounded consent route | Existing advertised ERC-7710 route |

Direct list tokens do **not** imply arbitrary x402 tokens or merchant
support. Existing exact HTTP method/headers/absent/empty/nonempty body binding is
unchanged. Legacy 0.5.8 operations retain their old schema/hash and recovery path.
The earlier live provider proof was Local/Coinbase/MetaMask Agent on 0.5.6 and
Smart Account only after its pending-consent recovery fix on 0.5.7.

Local tests, the D4-D9 source/live result and a local installation are not
publication or Homebrew acceptance. Required merchant/x402 paid rows remain
held until separately bounded wallet/recipient/asset/network/amount/fee
authority is supplied.
