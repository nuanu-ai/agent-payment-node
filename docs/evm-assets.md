# Explicit EVM assets

Owner acceptance runbook: [direct EVM live proofs](evm-direct-live-acceptance-2026-09-19.md).

The local encrypted wallet works on the 11 direct EVM networks in the frozen
allowlist. `wallet balance --chain <caip2> --asset <native-or-contract>` reads
native coins or any explicitly selected contract on each of those networks;
direct transfers (`pay transfer prepare-asset`) use the same network registry
with the frozen token allowlist. x402, wallet policy, LI.FI and the portfolio
network set remain on their own registries (see
[Direct networks](#direct-networks-fee-models-and-finality)). Package
availability and a fresh mainnet payment remain separate proof layers.

## One direct-transfer journey

```sh
apn wallet balance --profile default --chain eip155:8453 --asset native --rpc-url <https-base-rpc-url>
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
swap, approval or arbitrary calldata is supported. `wallet balance --chain --asset`
still reads any contract.

`--amount` is a canonical exact positive decimal; `--max-fee-wei` is a positive
integer native-ETH **pre-submission quote budget**, not an onchain-enforced total
fee cap. Ethereum uses execution-only EIP-1559 fees: its L1/operator extra fields
are explicitly zero and no Base oracle is queried. Base includes maximum
EIP-1559 execution cost, L1 data upper
estimate for at most 512 signed bytes, and operator fee estimate. Native value
must also be funded. The quote is re-read once, before signing.
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
adds posting costs twice. Priority fee is zero. Nothing is re-read between
signing and the send: the signed gas limit and maximum fee already bound what the
transaction may cost. Before signing on any chain, nonce drift,
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
plus any L1 data and operator fee. The quote is re-read once, before signing.

Read plan. Every listed network and asset uses one batched reader
(`src/evm-direct-reads.ts`); there are no per-network or per-token read lanes.
One step reads, in physical JSON-RPC POSTs:

| Phase | POSTs | Reads |
|---|---|---|
| balances | 1 | `latest` head, native balance; for a token also its code, `balanceOf` and `decimals` |
| nonce and estimate | 1 | pending nonce, `eth_estimateGas`, priority fee (not on Arbitrum), `latest` head |
| OP-stack fees | 1, OP-stack only | `getL1FeeUpperBound` and `getOperatorFee` at that head |
| send | 1 | the exact signed bytes |
| receipt | 1 | the receipt |
| evidence | 1 | the receipt's block, the transaction and, on `safe` networks, the `safe` head |

The endpoint's chain id rides inside the first POST of an invocation and is not
asked again: the endpoint's address is pinned for the invocation, and every
response is still validated as untrusted input. No head is re-read around pinned
reads. So prepare is 2 POSTs (3 on OP-stack) and approve is 5 (6 on OP-stack),
including the send and the receipt evidence, so every network can complete in
the approving invocation. Each step's hard POST cap is derived from this plan
times two (`directEvmStepBudget`): prepare 4 (6), approve 10 (12), resume 12, and
every listed network is capped and paced the same way. A missing, malformed,
rejected or rate-limited batch ends that step without scalar fallback; there is
no per-call variant: **the selected `--rpc-url` must accept JSON-RPC batches**.
An endpoint that answers a batch with a single object fails with
`APN_RPC_PROTOCOL` and reason `rpc_batch_unsupported`, after that one POST.

Keyless public endpoints checked on 2026-10-17 without keys. Each was sent one
`[eth_chainId, eth_blockNumber]` batch. The endpoint in the second column also
answered the reader's three real POST shapes (a six-item token balance batch;
nonce, estimate, tip and head; the receipt block, the transaction and, on `safe`
networks, the `safe` head). This is the same endpoint APN's portfolio uses by
default.

| Network | Batches verified with the reader's real shapes | Also accepted the 2-item batch | Refused or limited |
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

No keyless endpoint above refused the batch format itself; every refusal was an
access or rate limit that a per-call transport would hit too. Provider limits
change, so this table is evidence for that date, not a guarantee. Live payment
execution is a separate operational check.

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
- **Arbitrum.** Inclusive gas and zero priority fee.

Completion. `inclusion` networks complete on a canonical receipt at the
selected RPC's latest head, as Base and Ethereum always have. `safe` networks
additionally require the receipt block at or below the selected RPC's `safe`
head, and scan nonce supersession from `safe`, exactly as Arbitrum does. The
choice follows what each chain's `safe` tag means, measured on 2026-09-18:

- BNB, Avalanche, Sei: `safe` equals latest (fast or instant finality), so
  the check adds finality evidence at no delay. Monad: `safe` is the voted
  block, one block (about 0.4 s) behind latest.

On 2026-09-25 the selected public BNB endpoint returned `missing trie node`
for a `safe` state read while `latest` succeeded. Direct BNB native commands
read balances at `latest`, like every network, under the plan-derived cap and
persistent provider pacing. The `safe` receipt proof remains required;
an unavailable `safe` read leaves the signed operation nonterminal for
observation-only recovery. `latest` is not substituted for `safe`.
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
For a direct transfer already in `unknown_finality`, `operation resume` checks
the saved transaction's receipt and can complete or confirm a revert when the
existing receipt proof is sufficient. If the receipt is absent, unreadable, or
still insufficient, it remains nonterminal. Resume does not submit the signed
transaction again, load custody material, or attempt nonce-based superseding
proof from that starting state.

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
frozen fee quote, from one funded public address. A stand-in wallet returned only
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
`apn_wallet_balance` and `apn_pay_transfer_prepare_asset` use the same
catalog/core. Approval is not an MCP tool: `apn_foreground_handoff` returns the
exact CLI command; it cannot authorize or strand the operation. Status and receipt do not resume effects.

Every listed token, including canonical Ethereum USDC and WETH9, Base USDC and
WETH and Arbitrum USDC and USD₮0, uses the read plan above. The frozen allowlist
address and decimals, token contract code and balance, native gas balance, pending
nonce, gas estimate and fee quote are checked before signing; nothing is re-read
between signing and the send. Direct ERC-20 transfer calls the token contract
itself and does not use an allowance or spender approval. The approving
invocation reads the receipt; if it is not there yet the state is
`submitted_pending`, and `apn operation resume --operation <id> --observe-only true
--rpc-url <url>` inspects it later without broadcasting. A successful receipt
alone is insufficient: completion requires the receipt's sole exact `Transfer`
log out of the sender, read from that receipt alone. The POST counts are from
mocked HTTPS, not a live provider acceptance check.

A fresh explicit EVM prepare retires expired unsigned local transfers on the
same profile, network and sending account before checking for conflicts. It
writes a terminal `failed_before_effect` operation and receipt with reason
`approval_window_expired`; the same idempotency key still returns its old
operation. A usage reservation or signed/submitted evidence keeps the operation
blocked. Legacy Base transfers and other operation families are not retired by
this path.

## Safety, recovery and proof

- A completed or reverted transfer reports what it actually paid in
  `actual_network_fee` (operation status and receipt alike), taken from its own
  canonical receipt by the network's rule: gas used x effective price; on OP
  stack networks plus the receipt's `l1Fee` and operator fee; Arbitrum's gas used
  already includes L1 posting; Monad bills the gas limit. A component the
  receipt does not carry makes it `incomplete` with the reason and no total, never
  an estimate. `actual_sender_native_debit_atomic` adds the transferred value for a
  completed native transfer. Both are null until an outcome is proven;
  `fee_budget` stays the approved cap. The Base USDC lane (`pay transfer`)
  reports the same fields. For a transfer completed before APN recorded its fee,
  status and receipt read that transfer's own receipt once through the chain's
  `APN_<CHAIN>_RPC_URL` (bound to its stored hash and the block its record
  proved), keep the fee in `receipt-facts/<operation>.direct.json` bound to the
  record's integrity hash, and never read it again; the sealed record is not
  rewritten. Without the setting the answer still comes, with the fee null and
  `actual_facts_refusal` naming the variable.

- Chain, asset kind/address/decimals, amount, recipient, payer, nonce and fee
  budget are frozen. Wrong-chain RPC fails before submission or recovery.
- Global idempotency and conservative per-profile exclusion remain. Repeating
  the same request returns the old operation before metadata refresh; changing
  material inputs under the same key conflicts, including another operation kind.
- A durable started record precedes signing. Encrypted signature material is
  saved before returning. Restart retrieves only that signature; if none exists,
  the operation fails before effect rather than signing a replacement.
- Every check that can refuse (owner policy, funding, fees, nonce) runs before
  signing. A persisted signature is then only dispatched, as its exact bytes, or
  kept for `operation resume`: resume sends a signature APN never dispatched, and
  after an ambiguous dispatch it re-sends the identical bytes only when the RPC
  holds neither a receipt nor the pending transaction. A sender nonce finalized
  past the frozen one, while a node whose transaction index reaches the block
  read at prepare knows neither the transaction nor a receipt, ends the transfer
  as `failed_proven_superseded` and releases its usage hold. A signature APN never
  dispatched can be closed with `apn operation abandon` after foreground owner
  acknowledgement; APN then never sends it and the account's next transfer
  reuses its nonce. A dispatched transfer that no proof decides (a pruned node,
  or a Base USDC record written before the prepared block hash was recorded) can
  be closed the same way after its approval window: it ends `abandoned_unknown`,
  is never sent again, and its usage hold stays charged.
- Native completion requires the exact included transaction and successful
  receipt. ERC-20 completion additionally requires that receipt's sole
  `Transfer` log out of the sender to be the exact amount to the exact
  recipient from the pinned token; it needs no historical balance read, so a
  keyless RPC without archive state, or a busy recipient, still completes.
  Fee-on-transfer behaviour (a second debit log) or a missing log leaves
  delivery unproven. A hash or successful receipt alone never proves an exact
  generic token payment.
- Base/Ethereum completion reports **inclusion only**, not irrevocable finality;
  so do OP Mainnet, Unichain, Linea and Polygon. BNB, Avalanche, Monad and Sei
  use the Arbitrum `safe` rule below.
  Arbitrum additionally requires selected-RPC `safe` inclusion for
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

Use `wallet policy set --chain eip155:1` with explicit
`--max-balance-usdc-atomic` and `--max-x402-amount-atomic`, then
`x402 inspect` / `x402 fetch prepare --chain eip155:1` with the
existing URL, HTTP, RPC and idempotency options. Policy creation/increases require
foreground TTY approval; MCP returns the exact CLI handoff. Decreases are
noninteractive. `wallet policy show --chain` reports only the selected policy. Explicit Base
selection (or omitting `--chain`) uses the Base policy. For Arbitrum use `--chain eip155:42161`
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

## Reading and revoking an allowance the wallet granted

`apn wallet allowance status --profile <p> --chain eip155:<id> --asset <token-address> --spender <address>`
reads one ERC-20 allowance of the profile's local wallet at the chain's latest block
(CLI and MCP; read-only). `apn wallet allowance revoke` with the same selectors plus
`--max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>`
sends `approve(spender, 0)` from that wallet and nothing else: it never sets a
nonzero amount and calls no other contract. Revoking only removes a permission, so
no asset admission applies, but the chain's own `APN_<CHAIN>_RPC_URL` setting is
required (a chain APN names no setting for, or an unset one, is refused by name).
Before the foreground consent (chain, token, spender, the current allowance and the
maximum gas debit) it reads the allowance at one block and refuses when it is
already zero. It is an owned operation (`wallet_allowance_revoke` in the operation
index): one send, observed by `apn operation status --operation <id>` to an
`Approval(owner, spender, 0)` log in a canonical block at the chain's proof tag (or
a zero allowance there); the shared finalized never-lands proof closes one that can
never land (`superseded`, naming the same revoke again), and `apn operation abandon`
is the owner's last exit (`abandoned_unknown`, naming the allowance read, since it may
still land). Repeating the command continues the open revoke of the same profile,
chain, token and spender and never sends twice. A send the RPC refuses before
transport (the command's POST cap, the provider's cooldown, HTTP 429) leaves the
revoke `signed`, and the error and its status name the same revoke command with its
frozen caps, which later sends the same sealed bytes once. A revoke never consented
stops holding the wallet's chain once its 240 s consent window plus the 10 minute
unstarted margin has passed. MCP returns the CLI handoff for the revoke.

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

Arbitrum native transfers to the built-in `default` local wallet may use a distinct finalized Circle source admission. It applies only when exactly one unresolved Circle source belongs to the sending profile and public custody identity, both approval and burn are currently canonical `FINALIZED`, the issuer attestation matches, every non-mint effect is confirmed, and the finalized token allowance is zero. Other recipients, assets, chains, unknown operations and unfinished cleanup keep the existing conservative conflict rule. The recipient address is resolved from validated public wallet/provider metadata, then remains bound to the normal request, transaction and approval fingerprint; no user address or source profile alias is embedded in this admission.

New intents freeze the default custody identity and immutable saved source identity. Preparation uses fourteen bounded read-only RPC POSTs to verify the two transactions and allowances. After foreground approval, Native repeats those fourteen reads and one pending nonce read before signing, rejects changed custody/proof/allowance/nonce, and checks all remaining conflict domains. The old Circle journal and usage holds remain unchanged. Existing intents without this optional admission retain their original hashes and behavior.
