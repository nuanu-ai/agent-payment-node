# Direct EVM acceptance runbook (2026-09-19)

This is the owner handoff for the remaining direct EVM proofs. The base network
matrix uses the frozen allowlist dataset
[`data/allowlist/2026-09-17/dataset.json`](../data/allowlist/2026-09-17/dataset.json).
The three C1-12 historical token rows use the separate direct-only registry.
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
| No-money prepare | A fresh policy-aware intent can be built, quoted, persisted, and refused safely without signing or sending. | At the 28 Sep installed APN 0.5.27 checkpoint, all nine C1-12 direct rows have current-owner prepare evidence. This does not complete paid acceptance. |
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

## Current checkpoint nine-row proof matrix

The 9/9 mapping has nine asset rows across three networks: Ethereum ETH, USDC,
and WETH; Base ETH, USDC, and WETH; and Arbitrum One ETH, USDC, and USD₮0.
Source identities are present in the frozen network registry or the direct-only
supplemental registry below. This establishes code support only.

At the 28 Sep installed APN 0.5.27 checkpoint, the five previously evidenced
current-owner prepare rows plus the four fresh operations below cover all 9/9
direct rows. The four fresh operations used active buyer policy r25. Their
post-expiry local outcomes are `failed_before_effect` /
`approval_window_expired`, with no signing, send, transaction hash, or chain
evidence. Physical live POST counts for these prepares were not observed; the
source guard is 24 physical POSTs per invocation with 750 ms provider-family
pacing. The historical paid receipts below remain separate from this unsigned
prepare coverage. Distinct paid receipts and current-policy recipient acceptance
are still incomplete, so C1-12 remains `in_progress`.

The 19 Sep owner report was cited as showing fresh evidence for Ethereum ETH,
but the cited records do not identify that evidence's proof layer, operation,
or receipt. The 26 Sep C1-12 checkpoint additionally records a Base ETH no-money
prepare under buyer policy revision 20, operation prefix `fe563b15…`; it expired
as `failed_before_effect` without a reservation, transaction hash, RPC send, or
receipt. That is a no-effect outcome, not a paid receipt. These later notes
supersede the unqualified “1/9 current” count; they do not establish the full
current-source no-money or paid matrix.

On 27 Sep, a later default→buyer 0.0004 ETH Ethereum native operation
`7631cc91878ec39b211a5c870c5abcb8d32dd836cc3b200447d7b6ecb82fbde9`
became terminal `completed` / `confirmed_exact_native_transfer`. Its saved
receipt proves transaction
`0xb893edb0b5e1e3bbbb208643bb0835c98dcc56160c2be95ec1dc98d420a2497d`
included at block `26070276`, with exact native amount `400000000000000 wei`,
`included_native_transaction_and_receipt` and `inclusion_only` finality. The
pre-send quote had maximum execution fee `12663215124000 wei`; actual gas fee
remains unknown after a supplementary HTTP 403. This adds an exact live receipt
for the Ethereum ETH row, without completing the other eight rows or Base
gasless acceptance. PR #427's five-POST Ethereum native prepare count is
source-fixture evidence only, separate from this effect.

On 28 Sep, a distinct buyer→default Base ETH direct operation
`a7f5d3ba57c27871dfae096d41b6a9799ff0f178d41324b936badffe221b12ba`
transferred exactly `1000000000000 wei`. Read-only installed status and receipt
show terminal `completed` / `confirmed_exact_native_transfer`, proof
`included_native_transaction_and_receipt`: [transaction
`0x8ac8f01f2d2b1c9ac21fea75ac1305c45e6e41a8e17f2cbf2351917f97aa2f17`](https://basescan.org/tx/0x8ac8f01f2d2b1c9ac21fea75ac1305c45e6e41a8e17f2cbf2351917f97aa2f17)
in Base block `51872258`. Finality is `inclusion_only`; the actual total fee
is unavailable from the saved record. First approval reached the 24-POST guard
before submission. The exact saved signed transaction was resumed once and then
observed, without duplicate signing or send. This proves one Base ETH direct
effect, not the nine-row matrix or separate Base gasless receipt. Merged
[PR #431](https://github.com/nuanu-ai/agent-payment-node/pull/431) measured six
synthetic HTTPS POSTs for Base native prepare and six per funding phase; it did
not measure a complete guarded approve/resume invocation end to end.

On 28 Sep, a distinct buyer→default canonical Ethereum USDC operation
`6d2f32d642fb6ab54f32ddb9d734ed7dbd2a180c96b2fce071a7d7187253de58`
transferred exactly `1000` atomic USDC. Installed APN status and receipt show
terminal `completed` / `confirmed_exact_erc20_transfer`, proof
`included_transfer_event_and_block_balance_deltas`: [transaction
`0xfa33ff8460936d62f95a3f338f7d3912f5f41cb1909f4e3216f3be05c6c30c00`](https://etherscan.io/tx/0xfa33ff8460936d62f95a3f338f7d3912f5f41cb1909f4e3216f3be05c6c30c00)
in Ethereum block `26071092`. The canonical Transfer log and adjacent-block
balance deltas agree on the exact buyer debit and default-recipient credit.
Finality is `inclusion_only`; actual gas fee is unknown. There was one approval
and one observation-only follow-up, with no duplicate send. This is live
current-source proof for the Ethereum USDC row. Merged [PR #436](https://github.com/nuanu-ai/agent-payment-node/pull/436)
separately models 22 physical fake-HTTPS POSTs through a synthetic send under
the 24-POST guard; the fixture is not live provider telemetry.

A later Arbitrum One USDC no-money prepare after PR #421 created unsigned operation
`b0ebd6812ca2e9acb15751ed6a93012fcb6f4e1632cc4542bd6340b624193de9`
for `1000` atomic USDC. Its approval window ended at `2026-09-26T16:51:07Z`.
At the exact local read at `2026-09-26T16:51:54Z`, the operation and persisted
receipt still showed nonterminal `awaiting_approval` / `durable_pre_effect`,
with only a prepare transition and no transaction hash. No persisted expiry
transition or chain read was performed. This adds one unsigned no-money
observation to the Arbitrum USDC row; it adds no paid receipt or matrix closure.
At a later direct read-only local JSON checkpoint (`2026-09-27T15:43:15Z`), the
operation and persisted receipt were terminal `failed_before_effect` /
`approval_window_expired`; the recorded transition was
`2026-09-26T17:18:56.490Z`. The earlier `awaiting_approval` result is retained
as a timed observation. Neither read proves an on-chain effect.

| Chain / asset row | Code / source | Current-source no-money proof | Paid receipt proof |
| --- | --- | --- | --- |
| Ethereum ETH | Present in direct network registry | Earlier paid operation `7631cc91…fbde9` included a prepare phase. Distinct installed APN 0.5.27 r25 unsigned operation `eedf8a55e156760108f083a04492f1794c9753352eedc690078e07a939bcefd0` prepared `1000000000000 wei` with fee quote `14875609434000 wei` below the `100000000000000 wei` cap; expiry 11:53:40 UTC, then terminal `failed_before_effect` / `approval_window_expired` locally, with no RPC/TTY/sign/send/chain evidence after expiry | `7631cc91…fbde9` terminal `completed`, tx `0xb893edb0…2497d`, block 26070276, exact 0.0004 ETH; `inclusion_only`, actual gas fee unknown |
| Ethereum USDC | Present in direct network registry | The unsigned prepare was a phase of the same later-paid operation `6d2f32d642fb6ab54f32ddb9d734ed7dbd2a180c96b2fce071a7d7187253de58`; no separate no-money-only operation is recorded | [Tx `0xfa33ff8460936d62f95a3f338f7d3912f5f41cb1909f4e3216f3be05c6c30c00`](https://etherscan.io/tx/0xfa33ff8460936d62f95a3f338f7d3912f5f41cb1909f4e3216f3be05c6c30c00), block `26071092`, exact `1000` atomic USDC buyer debit/default credit by Transfer log and balance deltas; `completed` / `confirmed_exact_erc20_transfer`, `inclusion_only`; actual fee unknown |
| Ethereum WETH | Present in PR #370 direct-only registry | The unsigned prepare was a phase of the same later-paid operation `950cd8bd5ae4a87cbdad8aa6e40cb31b0635925920c050cb03d84b8a7b5a2f47`; no separate no-money-only operation is recorded | [Tx `0x07e0bf307fb1fdbc05823164c66c234d9152a9350c5ea93ee4e85309e0698c8a`](https://etherscan.io/tx/0x07e0bf307fb1fdbc05823164c66c234d9152a9350c5ea93ee4e85309e0698c8a), block `26071247`, exact `100000000` atomic WETH buyer debit/default credit; `completed` / `confirmed_exact_erc20_transfer`, proof `included_transfer_event_and_block_balance_deltas`, `inclusion_only`; actual fee unknown |
| Base ETH | Present in direct network registry | Earlier operation `fe563b15…` expired as `failed_before_effect`; no reservation, transaction hash, RPC send, or receipt | Later distinct operation `a7f5d3ba57c27871dfae096d41b6a9799ff0f178d41324b936badffe221b12ba` completed; [tx `0x8ac8f01f2d2b1c9ac21fea75ac1305c45e6e41a8e17f2cbf2351917f97aa2f17`](https://basescan.org/tx/0x8ac8f01f2d2b1c9ac21fea75ac1305c45e6e41a8e17f2cbf2351917f97aa2f17), block 51872258, exact `1000000000000 wei`, `inclusion_only`; actual total fee unknown |
| Base USDC | Present in direct network registry | Installed APN 0.5.27 r25 operation `b423703b2c8414383197d5e896f8be82237d79d92fb5b395eee5c6edd95dc9bd` prepared `1000` atomic USDC with fee quote `499697000000 wei` below the `100000000000000 wei` cap; expiry 11:56:37 UTC, then terminal `failed_before_effect` / `approval_window_expired` locally, with no sign/send/chain evidence | Historical paid receipt under policy revision 11; see the [direct token evidence ledger](evm-direct-usdc-base-arbitrum-acceptance-2026-09-24.md) |
| Base WETH | Present in PR #370 direct-only registry | Installed APN 0.5.27 prepared `8da31a2060eaef3422252b311a321da3af4eca6afe19e4dff4ad0cc15041180e` for `100000000` atomic Base WETH under active buyer policy r25; it initially reached `awaiting_approval` / `durable_pre_effect`, then a once-only local no-RPC approve after expiry returned `APN_REPREPARE_REQUIRED` and persisted `failed_before_effect` / `approval_window_expired` (`durable_pre_effect_failure`). No reservation, transaction hash, chain evidence, or paid effect is recorded | Installed APN 0.5.31 r26 operation `de98f55e6ccca1615f14a3e42de15683a1b050a5af4999a6072113dbb5e646b5` completed at `2026-09-29T00:13:27Z`; transaction `0x9b7050c7173c200c2eef57b040fd2d2dbbe4386571cad76481e0503070ed0b2a`, Base block `51925645`. APN receipt hash `d8a5deed98b3b807c1a8ed0bb4299dac851be5a0d25653cbd8d5f5ed1a59952e`, proof `included_transfer_event_and_block_balance_deltas`, confirms the exact canonical WETH Transfer event and buyer/seller balance deltas of `-100000000` / `+100000000` atomic at `inclusion_only` finality. Exactly one approval/sign/send. This is the current Base WETH direct acceptance proof. |
| Arbitrum One ETH | Present in direct network registry | Installed APN 0.5.27 prepared operation `b07b2cc3b0ee2d5c9b6544f3a38b02e74243444da2eec95e5270a1ba6029d91b` on `eip155:42161` under active buyer r25 for native ETH `1000000000000 wei` to the owner-approved local recipient; fee quote `902320000000 wei` was below the `50000000000000 wei` cap. It reached `awaiting_approval` / `durable_pre_effect` and expired at 11:16:58Z. One local non-TTY/no-RPC approve at 11:19:10Z returned `APN_REPREPARE_REQUIRED`; status and receipt became terminal `failed_before_effect` / `approval_window_expired` with `durable_pre_effect_failure`. No usage reservation or on-chain receipt is recorded, and no paid effect is established. The live POST count was not observed; five is model-only | On-chain inclusion (29 Sep 2026, Asia/Makassar): one installed APN 0.5.31 buyer-policy-r26 approval/send to the named seller, operation `e7ffed5842d39f64a56f6042bd015600838616ae227b70d96ee679aacfc502cf`, transaction `0x4860786ab995c5d38cfa4c711e7933fe6713e06698361fa58d9a164877744d46`; receipt status 1 at Arbitrum block `0x1e63e65e`. An independent seller balance read was 0 at the prior block and `1000000000000 wei` at inclusion; actual fee `478919340000 wei`. The initial APN saved receipt hash `fef157b0c942312e164d9fa1d9936d6056bbeeca0146939907122a43d171e42b` was `unknown_finality` / `inclusion_effect_unproven`; one observe-only recovery on 29 Sep, with no resubmission, returned terminal receipt hash `71e6fe1a2dde669f5a311d00022cf9ba7d224a40b2b244ec556ce799e7664d90`, state `completed`, proof class `included_native_transaction_and_receipt`, and finality `rpc_safe_inclusion`. APN verified the transaction at block `509863518` (hash `0x5720ee65acaae05567d9615f021ff801817c7f622a7394866008ff5ccc7fe4a7`) below safe block `509865847` (hash `0xb8b317898e837509ddaa42715a8a8560fb4a1138038b5f48ae6a4b140dc0c759`), with `transactionVerified=true`. This is terminal APN safe-receipt proof for this Arbitrum ETH operation; the transaction and seller balance evidence above remain separately identified. |
| Arbitrum One USDC | Present in direct network registry | Earlier `b0ebd681…` prepared unsigned for 1000 atomic USDC after #421 and expired without effect. Distinct installed APN 0.5.27 r25 operation `064fb55d0651469a1a34db27d58e158475cfd85c2ae2a852e64f7696da6e6d42` prepared `1000` atomic USDC with fee quote `1893092500000 wei` below the `100000000000000 wei` cap; expiry 11:57:12 UTC, then terminal `failed_before_effect` / `approval_window_expired` locally, with no sign/send/chain evidence | Historical safe-inclusion receipt under policy revision 12; see the [direct token evidence ledger](evm-direct-usdc-base-arbitrum-acceptance-2026-09-24.md). The unsigned prepares add no paid receipt |
| Arbitrum One USD₮0 | Present in PR #370 direct-only registry | Active r25 exact direct-only admission pins `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`, 6 decimals, `10000` atomic/day. First prepare was locally blocked by the outstanding Arbitrum USDC operation before RPC. After its expiry, installed APN 0.5.27 prepared `1000` atomic USD₮0 as operation `e47d1951e253efd0725e00a70294c774736e8afbe22892131766205b1ab21115`, fee quote `2537320968000 wei` below the `100000000000000 wei` cap; expiry 12:14:38 UTC, then terminal `failed_before_effect` / `approval_window_expired` locally, with no sign/send/chain evidence | One installed APN 0.5.31 r26 approval attempt for `1000` atomic on 29 Sep reached `signed_not_submitted` after `APN_RPC_BUDGET_EXCEEDED` at the 24/24 physical-POST guard; candidate transaction hash `0x396e07447206a0a2d2115c3c82bd4fba12083833c8e7c364820d7c37f5a2aabc`. The one official-RPC batch returned `tx=null` and `receipt=null`, with latest nonce 72 unchanged. Source audit attributes guard exhaustion to 19 unbatched generic-ERC20 pre-sign POSTs plus repeated pre-send funding reads, before broadcast. At that historical v0.5.31 checkpoint, no broadcast or paid effect was confirmed and no retry/resume had run. One later installed APN 0.5.32 resume of the same operation `c909f65d3399ced2b0d9fb9a882b2d8b35de69ad8fff0cb8abe7d0ab29f3f331` used the same sealed transaction, without another signature; APN now reports `submitted_pending` with that hash. Independent Arbitrum receipt status 1 at block `509884454` and its Transfer log show exactly `1000` atomic USD₮0 buyer→approved seller. This is on-chain inclusion and exact token-effect evidence, while APN terminal safe proof remains pending. Arbitrum USD₮0 acceptance remains open. |

The Ethereum USDT receipt in the ledger is a separate asset row; it does not
substitute for Arbitrum USD₮0. The ledger remains authoritative for exact
historical receipt identifiers and their policy, amount, and finality evidence.

WETH and USDT0 remain absent from the frozen market-cap dataset above. The
direct-only supplemental registry pins Ethereum WETH9
`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (18 decimals), Base WETH9
`0x4200000000000000000000000000000000000006` (18 decimals), and Arbitrum
USD₮0 `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` (6 decimals). Their
identities are recorded in the [direct registry](../src/evm-direct-supplemental-assets.ts),
with deployment references in [LI.FI documentation](lifi.md) and historical
direct acceptance in [EVM assets](evm-assets.md). Source registration alone
does not admit a token for direct use. The Ethereum WETH paid operation is
recorded above. The Base WETH prepare under active buyer policy r25 demonstrates
owner-policy admission for that operation; it expired before any submission, so a
distinct paid receipt remains open. Active r25 also has the exact Arbitrum USD₮0
direct-only admission and the unsigned prepare above. Frozen-only `allowlist
resolve` intentionally excludes USD₮0; its absence there does not imply missing
owner admission. Paid USD₮0 acceptance remains open.
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
