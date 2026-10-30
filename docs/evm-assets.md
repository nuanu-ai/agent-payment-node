# Explicit EVM assets

A local encrypted wallet can read balances and send direct transfers of native coins and listed tokens on eleven EVM
mainnets. Every transfer follows the same prepare, approve and recover flow, is capped by the owner allowlist policy, and
uses an RPC endpoint the caller names explicitly.

Use this guide for `wallet balance`, `pay transfer prepare-asset` and `pay transfer approve` on EVM networks, and for
reading or revoking an ERC-20 allowance the wallet granted. Owner caps are described in
[direct transfers under the allowlist](allowlist-direct-integration.md).

## Networks and assets

The direct-transfer network registry (`src/evm-direct-networks.ts`) is separate from the network set that x402, LI.FI,
wallet policy and the portfolio use. Enabling a network for direct transfers enables nothing else.

| Network | CAIP-2 | Native | Tokens (pinned contract) | Fee model | Completion |
| --- | --- | --- | --- | --- | --- |
| Ethereum | `eip155:1` | ETH | USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7`, WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | EIP-1559 | inclusion |
| Base | `eip155:8453` | ETH | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, WETH `0x4200000000000000000000000000000000000006` | OP Stack (L1 data + operator fee) | inclusion |
| Arbitrum One | `eip155:42161` | ETH | USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, USD₮0 `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | Arbitrum inclusive | `safe` head |
| OP Mainnet | `eip155:10` | ETH | USDC `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | OP Stack (L1 data + operator fee) | inclusion |
| Polygon PoS | `eip155:137` | POL | USDC `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | EIP-1559 | inclusion |
| BNB Smart Chain | `eip155:56` | BNB | none (native only) | EIP-1559, zero base fee | `safe` head |
| Avalanche C-Chain | `eip155:43114` | AVAX | USDC `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`, USDT `0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7` | EIP-1559 | `safe` head |
| Unichain | `eip155:130` | ETH | USDC `0x078D782b760474a361dDA0AF3839290b0EF57AD6` | OP Stack (L1 data + operator fee) | inclusion |
| Linea | `eip155:59144` | ETH | USDC `0x176211869cA2b568f2A7D4EE941E073a821EE1ff` | EIP-1559 | inclusion |
| Monad | `eip155:143` | MON | USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | gas-limit billed | `safe` head |
| Sei EVM | `eip155:1329` | SEI | USDC `0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392` | EIP-1559 | `safe` head |

Native coins have 18 decimals. USDC, USDT and USD₮0 have 6; WETH has 18.

- Direct transfers accept only these assets. USDC and USDT come from the frozen allowlist inventory
  (`data/allowlist/2026-09-17/dataset.json`); WETH on Ethereum and Base and USD₮0 on Arbitrum are separately pinned
  direct-only identities. Any other contract is refused with `APN_ALLOWLIST_REFUSED` (`allowlist_asset_unlisted`)
  before any RPC call.
- A symbol is not an identity: select a token by its exact contract.
- Decimals come from the pinned row. `--decimals` is optional and, when given, must equal it. A contract that reports
  other decimals is refused.
- Rounding, NFTs, swaps, token approvals and arbitrary calldata are not supported on this path.
- `wallet balance --chain --asset` reads native coins and *any* contract on these eleven networks; reading a balance
  grants nothing.

## Requirements

- A local wallet profile (`apn wallet ensure --profile <profile>`). Provider-managed profiles cannot use generic direct
  transfers (see [Profiles](#profiles-and-capabilities)).
- An active owner allowlist policy that admits each asset on the `direct` rail, with `accounts.evm` set to the wallet
  address. Without it every direct transfer is refused with `allowlist_policy_required`.
- Funds: the asset amount, plus native coin for the fee (and for the value of a native transfer).
- An explicit `--rpc-url` on every command. There is no default endpoint on the money path. The endpoint must serve the
  selected chain and must accept JSON-RPC batch requests ([RPC endpoints](#rpc-endpoints)).

Some reads that happen after a transfer use the chain's own environment variable instead of `--rpc-url`:

| Chain | Variable |
| --- | --- |
| Ethereum | `APN_ETHEREUM_RPC_URL` |
| Base | `APN_BASE_RPC_URL` |
| Arbitrum One | `APN_ARBITRUM_RPC_URL` |
| OP Mainnet | `APN_OPTIMISM_RPC_URL` |
| Polygon PoS | `APN_POLYGON_RPC_URL` |
| BNB Smart Chain | `APN_BNB_RPC_URL` |
| Avalanche C-Chain | `APN_AVALANCHE_RPC_URL` |
| Unichain | `APN_UNICHAIN_RPC_URL` |
| Linea | `APN_LINEA_RPC_URL` |
| Monad | `APN_MONAD_RPC_URL` |
| Sei EVM | `APN_SEI_RPC_URL` |

They are used by `wallet allowance status|revoke` and by the one-time fee read for a transfer completed before APN
recorded its fee ([Actual fee](#actual-fee)). No variable has a default.

## Commands

```sh
apn wallet balance --profile default --chain eip155:8453 --asset native --rpc-url <https-base-rpc-url>
apn pay transfer prepare-asset --profile default --chain eip155:8453 --asset native --to <recipient> \
  --amount 0.000001 --max-fee-wei <owner-budget> --idempotency-key <unique-key> --rpc-url <https-base-rpc-url>
apn pay transfer approve --operation <operation-id> --rpc-url <https-base-rpc-url>     # foreground terminal
apn operation status --operation <operation-id>
apn operation resume --operation <operation-id> --rpc-url <https-base-rpc-url>
apn receipt get --operation <operation-id>
```

For a token, replace `native` with its pinned contract. Without `--chain` and `--asset`, `wallet balance` reads Base ETH
and canonical Base USDC.

| Option | Meaning |
| --- | --- |
| `--profile` | The local wallet profile. |
| `--chain` | Exact CAIP-2 identity of one of the eleven networks. |
| `--asset` | `native` or a pinned token contract. |
| `--decimals` | Optional; must equal the pinned decimals. |
| `--to` | Non-zero recipient address. |
| `--amount` | Canonical exact positive decimal; no rounding. |
| `--max-fee-wei` | Required. Positive integer in the network's native coin (wei-scale units): the pre-submission budget for the total fee quote. It is not an onchain-enforced total fee cap. |
| `--priority-fee-wei` | Optional owner tip per gas ([Priority fee](#priority-fee)). |
| `--idempotency-key` | 8 to 200 safe ASCII characters. |
| `--rpc-url` | Credential-free public HTTPS endpoint of the selected chain. |

Approval is a foreground terminal step. Exact foreground approval comes before any private-key access. Over MCP,
`apn_wallet_balance` and `apn_pay_transfer_prepare_asset` run the same code as the CLI; approval is not an MCP tool, and
`apn_foreground_handoff` returns the exact CLI command without authorizing or blocking the operation. `operation status`
and `receipt get` never resume effects.

## Owner admissions

Each asset needs its own `"rail": "direct"` admission in the owner's `apn.allowlist-policy-file.v1`
([allowlist policy](allowlist-policy.md)), with `accounts.evm` set to the local wallet address. Caps are in atomic
units of the asset. For example, native OP ETH and Avalanche USDT:

```json
{ "chain": "eip155:10", "kind": "native", "rail": "direct", "maximumPerTransferAtomic": "1200000000000000", "dailyLimitAtomic": "4000000000000000" }
{ "chain": "eip155:43114", "kind": "token", "identifier": "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", "rail": "direct", "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000" }
```

An asset without its own admission is refused with `allowlist_direct_not_admitted`, even when the same symbol is
admitted on another network. The per-operation and daily caps apply to native coins and tokens alike.

## Fees

### Quote and budget

Every network signs an EIP-1559 transaction with
`maxFeePerGas = 2 x latest baseFeePerGas + priority fee` and `gas = eth_estimateGas`, and freezes `gas x maxFeePerGas`
as the maximum execution fee. `--max-fee-wei` caps the **total** quote: execution plus any L1 data fee and operator fee.
A quote above the budget is refused with `APN_FEE_BUDGET_EXCEEDED`. The native balance must cover the quote plus the
value of a native transfer (`APN_INSUFFICIENT_GAS` otherwise).

The quote is re-read once, before signing. Before signing on every network:

- the nonce must still be exactly the frozen one;
- the current required gas must fit within the frozen gas limit;
- the current derived base fee must fit within the frozen signed maximum fee.

Harmless lower gas estimates and fee-recommendation movements are accepted without changing the approved transaction.
Nonce drift, required gas above the frozen limit or a base fee above the frozen ceiling requires a new operation.
Nothing is re-read between signing and the send. A signed transaction is never replaced or repriced automatically;
APN always sends the original approved transaction unchanged.

### Priority fee

By default the tip per gas comes from the RPC's `eth_maxPriorityFeePerGas`. Some public RPCs answer 0, and a transaction
with no tip can wait several blocks for inclusion. `--priority-fee-wei <wei>` replaces that suggestion with the owner's
tip; the fee cap becomes twice the base fee plus that tip. The tip counts toward `--max-fee-wei` and is part of the
request, so reusing an idempotency key with a different tip is a conflict.

- Arbitrum One prices gas without a separate tip: the flag is refused with `priority_fee_not_applicable`.
- On a network whose base fee is zero (BNB), a zero tip is refused (`zero_gas_price`): a zero total price is never
  signed.

### Fee models

- **EIP-1559 (Ethereum, Polygon, Avalanche, Linea, Sei, BNB).** Execution only. The L1 and operator fields are zero and
  no oracle is called. BNB's base fee is 0, so the priority fee is the whole price. Linea's base fee is close to zero
  and its price is carried by the priority fee.
- **OP Stack (Base, OP Mainnet, Unichain).** The quote adds the L1 data fee upper bound for at most 512 signed bytes
  (`getL1FeeUpperBound`) and the operator fee (`getOperatorFee`), both read from the GasPriceOracle predeploy
  `0x420000000000000000000000000000000000000F` at the quoted block. A budget that covers execution but not the L1 fee
  is refused. Missing oracle data fails closed. The L1 and operator fees are variable and may change at inclusion.
- **Arbitrum inclusive.** The full `eth_estimateGas` result covers L2 execution and L1 posting in one gas envelope.
  The quote carries `feeModel: arbitrum-inclusive`, shown at approval and in receipts. Zero *separate* L1/operator
  surcharges do not mean posting is free; APN never adds posting costs twice. The priority fee is zero.
- **Monad gas-limit billing.** Monad charges the gas **limit**, not gas used. The budget is already
  `limit x maxFeePerGas`, so the cap holds; the quote carries `feeModel: monad-gas-limit` and the approval prompt says
  so, because the actual charge is close to the budgeted execution fee rather than below it.

### Actual fee

A completed or reverted transfer reports what it paid in `actual_network_fee` (in `operation status` and the receipt),
taken from its own canonical receipt by the network's rule: gas used x effective price; on OP Stack networks plus the
receipt's `l1Fee` and operator fee; Arbitrum's gas used already includes L1 posting; Monad bills the gas limit.

- A component the receipt does not carry makes the fee `incomplete`, with the reason and no total. It is never an
  estimate.
- `actual_sender_native_debit_atomic` adds the transferred value for a completed native transfer.
- Both are null until an outcome is proven. `fee_budget` stays the approved cap.
- Base USDC transfers made with `pay transfer prepare` report the same fields.
- For a transfer completed before APN recorded its fee, `operation status` and `receipt get` read that transfer's own
  receipt once through the chain's `APN_<CHAIN>_RPC_URL`, bound to its stored hash and the block its record proved.
  The fee is kept in `receipt-facts/<operation>.direct.json`, bound to the record's integrity hash, and never read
  again; the sealed record is not rewritten. Without the variable the answer still comes, with the fee null and
  `actual_facts_refusal` naming the variable.

## RPC endpoints

Every network and asset uses one batched reader (`src/evm-direct-reads.ts`). One step makes these JSON-RPC POSTs:

| Phase | POSTs | Reads |
| --- | --- | --- |
| balances | 1 | `latest` head, native balance; for a token also its code, `balanceOf` and `decimals` |
| nonce and estimate | 1 | pending nonce, `eth_estimateGas`, priority fee (not on Arbitrum), `latest` head |
| OP Stack fees | 1, OP Stack only | `getL1FeeUpperBound` and `getOperatorFee` at that head |
| send | 1 | the exact signed bytes |
| receipt | 1 | the receipt |
| evidence | 1 | the receipt's block, the transaction and, on `safe` networks, the `safe` head |

The endpoint's chain id rides inside the first POST of an invocation and is not asked again. The endpoint address is
pinned for the invocation, and every response is still validated as untrusted input. Prepare therefore makes 2 POSTs
(3 on OP Stack) and approve makes 5 (6 on OP Stack), including the send and the receipt evidence, so a transfer can
complete within the approving invocation.

Each step has a hard POST cap of twice its plan: prepare 4 (6 on OP Stack), approve 10 (12), resume 12. Requests are
paced per provider. Exhausting the cap fails with `APN_RPC_BUDGET_EXCEEDED`.

**The selected `--rpc-url` must accept JSON-RPC batches.** A missing, malformed, rejected or rate-limited batch ends
that step; there is no per-call fallback. An endpoint that answers a batch with a single object fails with
`APN_RPC_PROTOCOL` and reason `rpc_batch_unsupported` after that one POST. An endpoint on the wrong chain fails with
`APN_CHAIN_MISMATCH` before submission or recovery.

The keyless public endpoints below accepted batch requests when this guide was written. Those in the second column also
answered the reader's real request shapes; they are the endpoints APN's portfolio uses by default. Provider limits
change, so treat this as a starting point, not a guarantee.

| Network | Accepted the reader's request shapes | Also accepted a simple batch | Refused or limited |
| --- | --- | --- | --- |
| Ethereum | `https://ethereum-rpc.publicnode.com` | `https://eth.drpc.org` | |
| Base | `https://mainnet.base.org` | `https://base-rpc.publicnode.com`, `https://base.drpc.org` | |
| Arbitrum One | `https://arb1.arbitrum.io/rpc` | `https://arbitrum-one-rpc.publicnode.com`, `https://arbitrum.drpc.org` | |
| OP Mainnet | `https://mainnet.optimism.io` | `https://optimism-rpc.publicnode.com`, `https://optimism.drpc.org` | |
| Polygon PoS | `https://polygon-bor-rpc.publicnode.com` | `https://polygon.drpc.org` | `https://polygon-rpc.com`: HTTP 401, "API key disabled" |
| BNB Smart Chain | `https://bsc-rpc.publicnode.com`, `https://bsc-dataseed.bnbchain.org` | `https://bsc-dataseed.binance.org` | `https://bsc.drpc.org`: HTTP 429, public rate limit |
| Avalanche C-Chain | `https://api.avax.network/ext/bc/C/rpc` | `https://avalanche-c-chain-rpc.publicnode.com`, `https://avalanche.drpc.org` | |
| Unichain | `https://mainnet.unichain.org` | `https://unichain-rpc.publicnode.com` | `https://unichain.drpc.org`: accepted the batch but answered `eth_blockNumber` with -32601 "not available" |
| Linea | `https://rpc.linea.build` | `https://linea-rpc.publicnode.com`, `https://linea.drpc.org` | |
| Monad | `https://rpc.monad.xyz` | `https://rpc2.monad.xyz`, `https://rpc3.monad.xyz`, `https://monad.drpc.org` | `https://rpc1.monad.xyz`: HTTP 403 |
| Sei EVM | `https://evm-rpc.sei-apis.com` | `https://sei-evm-rpc.publicnode.com`, `https://sei.drpc.org` | |

None of these endpoints refused the batch format itself; every refusal was an access or rate limit that individual
calls would hit too.

## Completion and finality

- **`inclusion` networks** (Ethereum, Base, OP Mainnet, Unichain, Linea, Polygon) complete on a canonical receipt at the
  selected RPC's latest head. This is inclusion, not irrevocable finality.
- **`safe` networks** (Arbitrum One, BNB, Avalanche, Monad, Sei) also require the receipt block to be at or below the
  selected RPC's `safe` head, and check nonce supersession from `safe`. A sequencer-only receipt stays nonterminal. The
  receipt says `rpc_safe_inclusion`, with the observed safe block identity. This trusts the RPC; it is not a trustless
  rollup proof or an independent challenge-finality guarantee.

Why each network has its rule:

- BNB, Avalanche and Sei: `safe` equals `latest` (fast or instant finality), so the check adds finality evidence at no
  delay. Monad: `safe` is the voted block, about one block behind `latest`.
- OP Mainnet and Unichain: `safe` is derived from L1 and lags far behind; they keep Base's inclusion rule.
- Linea: `safe` equals `finalized` (L1 finality), about 20 minutes behind; inclusion rule.
- Polygon PoS: public RPCs reject the `safe` tag ("safe block not found"). Inclusion is treated as final, the same
  trust class as Ethereum inclusion, not an irrevocable-finality claim.

Balances are read at `latest` on every network. Some public BNB endpoints fail `safe` state reads (`missing trie node`)
while `latest` works. The `safe` receipt proof is still required: if the `safe` read is unavailable, the signed
operation stays nonterminal for observation-only recovery. `latest` is never substituted for `safe`.

If a `safe` network's receipt is not yet at the safe head, the operation stays `unknown_finality`, and
`operation resume` completes it later without a new signature.

### Token transfers

- A direct ERC-20 transfer calls the token contract itself; it uses no allowance or spender approval.
- Before signing APN checks the pinned address and decimals, the token's contract code and balance, the native gas
  balance, the pending nonce, the gas estimate and the fee quote.
- Native completion requires the exact included transaction and a successful receipt.
- ERC-20 completion also requires that receipt's sole `Transfer` log out of the sender to carry the exact amount to the
  exact recipient from the pinned token. It needs no historical balance read, so a keyless RPC without archive state,
  or a busy recipient, still completes.
- Fee-on-transfer behaviour (a second debit log) or a missing log leaves delivery unproven. A transaction hash or a
  successful receipt alone never proves an exact token payment.
- Terminal receipt fields must prove the same immutable operation; an absent or altered receipt fails closed.

## Safety and recovery

**Frozen inputs.** Chain, asset kind, address and decimals, amount, recipient, payer, nonce and fee budget are frozen
at prepare.

**Idempotency.** Repeating the same request returns the existing operation before any metadata refresh. Changing
material inputs under the same key is a conflict, including a different operation kind.

**Conflicts.** A new direct transfer waits only for unresolved operations on the same chain and sending account.

**Before signing.** Every check that can refuse (owner policy, funding, fees, nonce) runs before signing. A durable
started record precedes signing, and the encrypted signature is saved before the command returns. After a restart APN
retrieves only that signature; if none exists, the operation fails before effect rather than signing a replacement.

**After signing.** A saved signature is only dispatched as its exact bytes, or kept for `operation resume`:

- If the approving invocation finds no receipt yet, the state is `submitted_pending`.
  `apn operation resume --operation <id> --observe-only true --rpc-url <url>` inspects it later without broadcasting.
- Resume sends a signature APN never dispatched. After an ambiguous dispatch it re-sends the identical bytes only when
  the RPC holds neither a receipt nor the pending transaction.
- If the sender's finalized nonce is past the frozen one, and a node whose transaction index reaches the block read at
  prepare knows neither the transaction nor a receipt, the transfer ends `failed_proven_superseded` and its usage hold
  is released.
- For a transfer already in `unknown_finality`, resume checks the saved transaction's receipt and can complete it or
  confirm a revert when the existing receipt proof is sufficient. If the receipt is absent, unreadable or still
  insufficient, the operation stays nonterminal. From that state resume does not send the transaction again, load
  custody material or attempt a nonce-based supersession proof.

**Abandon.**

- A signature APN never dispatched can be closed with `apn operation abandon` after foreground owner acknowledgement.
  APN then never sends it, and the account's next transfer reuses its nonce.
- A dispatched transfer that no proof can decide (for example on a pruned node) can be closed the same way after its
  approval window. It ends `abandoned_unknown`, is never sent again, and its usage hold stays charged.

**Expired preparations.** A prepared transfer must be approved within 10 minutes. A new `prepare-asset` on the same
profile, network and sending account first retires that account's expired unsigned transfers: each becomes a terminal
`failed_before_effect` operation and receipt with reason `approval_window_expired`. The same idempotency key still
returns the old operation. A usage reservation, or any signed or submitted evidence, keeps the operation blocking
instead. Base USDC transfers prepared with `pay transfer prepare` and other operation families are not retired this way.

**Funding and policy.** An amount above the asset balance is refused with `APN_INSUFFICIENT_ASSET` before the gas
estimate; this is an economic refusal (the transfer is correct but unfunded). No custodial aggregate balance or
automatic funding is implied. `wallet balance` classifies the funding posture against the profile x402 policy of the
exact chain and token (`within_limit`, `overfunded`, or `unassessed` when there is none); a balance never implies
spending permission. Permission for a direct transfer is the owner allowlist admission plus the exact operation
approval, never a conversion or reuse of another allowance.

**Monad reserve balance.** Monad's asynchronous execution applies a per-account reserve-balance rule that APN does not
model. A native MON transfer that would nearly empty the account may be rejected or reverted by the network even though
APN's own funding check passes. Leave headroom.

## Reading and revoking an allowance the wallet granted

```sh
apn wallet allowance status --profile <profile> --chain eip155:<id> --asset <token-address> --spender <address>
apn wallet allowance revoke --profile <profile> --chain eip155:<id> --asset <token-address> --spender <address> \
  --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>
```

`status` reads one ERC-20 allowance of the profile's local wallet at the chain's latest block (CLI and MCP; read-only).

`revoke` sends `approve(spender, 0)` from that wallet and nothing else: it never sets a nonzero amount and calls no other
contract. Because revoking only removes a permission, no asset admission applies.

- Both commands read through the chain's `APN_<CHAIN>_RPC_URL` ([Requirements](#requirements)). A chain APN has no
  variable for is refused (`wallet_allowance_chain_rpc_setting_unknown`); an unset variable is refused by name
  (`wallet_allowance_rpc_required`).
- Before foreground consent, which shows chain, token, spender, the current allowance and the maximum gas debit, it reads
  the allowance at one block and refuses when it is already zero.
- It is an owned operation (`wallet_allowance_revoke` in the operation index) with one send.
  `apn operation status --operation <id>` observes it to an `Approval(owner, spender, 0)` log in a canonical block at
  the chain's proof tag, or a zero allowance there.
- A revoke that can never land is closed by the finalized never-lands proof as `superseded`, naming the same revoke
  command. `apn operation abandon` is the owner's last exit (`abandoned_unknown`, naming the allowance read, since the
  transaction may still land).
- Repeating the command continues the open revoke of the same profile, chain, token and spender and never sends twice.
- A send the RPC refuses before transport (the command's POST cap, the provider's cooldown, HTTP 429) leaves the revoke
  `signed`. The error and its status name the same revoke command with its frozen caps, which later sends the same
  sealed bytes once.
- A revoke that was never consented stops holding the wallet's chain once its 240-second consent window plus a
  10-minute unstarted margin has passed.
- Over MCP, revoke returns the CLI handoff.

## x402 on Ethereum and Arbitrum

Direct transfers and x402 purchases use separate registries and separate policies. Local-wallet x402 is described in
[x402 to any seller](x402-any-seller.md); this section covers what is specific to Ethereum and Arbitrum.

```sh
apn wallet policy set --profile <profile> --chain eip155:1 --max-balance-usdc-atomic <limit> --max-x402-amount-atomic <limit>
apn x402 inspect --url <seller-url> --chain eip155:1
apn x402 fetch prepare --profile <profile> --chain eip155:1 --url <seller-url> --idempotency-key <key> --rpc-url <ethereum-rpc>
```

- Use `--chain eip155:1` for Ethereum and `--chain eip155:42161` for Arbitrum, with an RPC of the selected network.
  Omitting `--chain` selects Base.
- Without `--asset`, `--chain eip155:1` means canonical Ethereum USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`, and
  `--chain eip155:42161` means native Arbitrum USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (not bridged USDC.e).
- Each network's policy is separate; none inherits another network's allowance. `wallet policy show --chain` reports
  only the selected policy.
- Creating or raising a policy needs the foreground terminal; over MCP it returns the exact CLI handoff. Decreases run
  without a terminal.
- The token's EIP-712 name, version and domain separator are read on chain at a pinned block at the network's proof tag.
- Listing a token for direct transfers does not admit it for x402, and does not imply ERC-7710 or Permit2 support.
- External wallet profiles are refused before provider execution on networks other than Base.
- Before a new authorization and the first paid exposure, APN reloads the encrypted network policy, payer, cap, balance
  and token domain. Lowering limits or changing the RPC, network or identity blocks new exposure, but not read-only
  reconciliation of an already-exposed authorization. Reconciliation checks the selected token and safe or finalized
  chain evidence.
- Resume takes its network from the frozen operation, never from a new caller override. GET requests and absent, empty
  and nonempty POST bodies stay bound to the operation across the same-material retry and result recovery.

## Profiles and capabilities

| Profile | Native and listed-token direct transfers (owner allowlist caps) | Base USDC direct (`pay transfer prepare`) | Standard x402 |
| --- | --- | --- | --- |
| Local encrypted wallet | Supported on all eleven networks | Supported | Owner-admitted EVM chains and tokens, and Solana ([any seller](x402-any-seller.md)) |
| Coinbase Agentic Wallet | Not supported | Through the provider route | Base USDC through the provider route; the pinned provider package rejects requests with a body, including an empty one |
| MetaMask Agent Wallet | Not supported | Through the provider route | Base USDC through the provider route |
| MetaMask Smart Account | Not supported | Through the bounded consent route | The advertised ERC-7710 route |

Direct list tokens do not imply arbitrary x402 tokens or merchant support. The exact HTTP method, headers and
absent, empty or nonempty body binding of x402 requests is the same on every profile.

## Arbitrum native transfers beside a settled Circle route

An unresolved Circle CCTP route normally blocks new transfers from its Arbitrum source account. One exception applies:
a native ETH transfer on Arbitrum One to the custody wallet of any local wallet profile does not wait for a Circle route
of the same sending account once that route can no longer sign on Arbitrum. That is the case only when:

- the route belongs to the sending profile and the same source custody wallet;
- its source burn is at the `finalized` tag and the issuer attestation is present;
- every non-mint effect (approval and burn) is confirmed with proof;
- the residual token allowance is zero.

Other recipients, assets, chains, unknown operations and unfinished cleanup keep the normal conflict rule. The
recipient is matched against validated local wallet metadata and stays bound to the request, transaction and approval
fingerprint. The Circle journal and its usage holds are not changed.

## Reason codes and troubleshooting

| Code / reason | Meaning | What to do |
| --- | --- | --- |
| `APN_ALLOWLIST_REFUSED` / `allowlist_asset_unlisted` | The contract is not a pinned asset of that network. | Use a contract from the table above. |
| `APN_ALLOWLIST_REFUSED` / `allowlist_direct_not_admitted`, `allowlist_policy_required`, cap reasons | Owner policy does not admit this transfer. | See [direct transfers under the allowlist](allowlist-direct-integration.md#refusals). |
| `APN_INVALID_INPUT` / `priority_fee_not_applicable` | `--priority-fee-wei` on Arbitrum One. | Omit the flag. |
| `APN_INVALID_INPUT` / `zero_gas_price` | Zero tip on a zero-base-fee network. | Set a positive `--priority-fee-wei`. |
| `APN_FEE_BUDGET_EXCEEDED` | The current total fee quote is above `--max-fee-wei`. | Prepare again later, or with a higher budget under a new idempotency key. |
| `APN_INSUFFICIENT_ASSET` | Asset balance below the amount. | Fund the wallet. |
| `APN_INSUFFICIENT_GAS` | Native balance cannot cover the fee quote (plus value for a native transfer). | Fund native gas. |
| `APN_ASSET_MISMATCH` | No contract at the address, or the contract reports other decimals. | Check the selected network and contract. |
| `APN_RPC_PROTOCOL` / `rpc_batch_unsupported` | The endpoint does not accept JSON-RPC batches. | Choose another endpoint ([RPC endpoints](#rpc-endpoints)). |
| `APN_RPC_BUDGET_EXCEEDED` | The step used its POST cap. | Check the endpoint, then rerun; an approved transfer continues with `operation resume`. |
| `APN_CHAIN_MISMATCH` | The RPC serves another chain. | Use an endpoint of the selected chain. |
| `APN_REPREPARE_REQUIRED` | Frozen inputs (nonce, gas, fee ceiling) no longer hold before approval. | Prepare a new operation. |
| `APN_IDEMPOTENCY_CONFLICT` | The key was used for a different request. | Use a new key or repeat the original request. |
| `approval_window_expired` | The preparation expired unapproved. | Prepare again. |

## Compatibility

- Operations prepared by older versions keep their original schema, hash and recovery path.
- A request without `--priority-fee-wei` hashes exactly as before the flag existed, so existing idempotency keys keep
  resolving.
- Base USDC records written before APN recorded the prepared block hash cannot be closed by the supersession proof; they
  can be closed with `operation abandon` after their approval window (`abandoned_unknown`, hold stays charged).
- Older Arbitrum native transfers prepared without the Circle exception keep their original hashes and behaviour.
