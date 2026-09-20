# LI.FI EVM cross-chain assets

This APN 0.5.24 package includes local-wallet route selection and execution for
the admitted assets between Ethereum, Base and Arbitrum One. It implements
Across V4 and Stargate V2 Taxi through the LI.FI API. Package availability,
source tests and installed-package tests are separate from real mainnet
acceptance, which remains **0/3**, and named human acceptance remains open.

| Profile | Custody and execution | Bridge availability |
| --- | --- | --- |
| `local` | Existing local EVM wallet; APN signs and observes | Implemented for the finite protocols below, subject to current quote, deployment, funding and approval checks |
| `metamask-smart-account` | Delegated owner/session | Unavailable; existing grants do not authorize LI.FI effects |
| `metamask-agent-wallet` | Provider custody and execution | Unavailable; no admitted bridge execution and recovery contract |
| `coinbase-awal` | Provider custody and execution | Unavailable; no admitted bridge execution and recovery contract |

No profile silently falls back to the local signer. Provider inventory is
informational: a listed chain, token or tool does not establish executable APN
support. Solana and TRON bridge directions, Stargate Bus, Polymer and other
bridge tools remain outside this execution profile. Direct Solana/TRON rails
and gasless payment profiles have separate acceptance requirements.

### Reviewed quote-only EVM destinations

The public LI.FI quote API was read on 2026-09-20 for Ethereum USDC to four
additional USDC deployments already named by the frozen allowlist. APN accepts
these exact chains, assets and tools for route discovery and offline calldata
inspection only. Every returned row remains `preparable: false` with
`destination_execution_unreviewed`; `bridge prepare` refuses it before opening
any destination RPC, and no approval or send path is enabled.

| Destination | USDC | Reviewed public quote tools | Provider refusal captured |
|---|---|---|---|
| OP Mainnet (`eip155:10`) | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | Across V4, Stargate V2 Taxi | none |
| Polygon PoS (`eip155:137`) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | Across V4 | Stargate V2: no available quote |
| Avalanche C-Chain (`eip155:43114`) | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | Stargate V2 Taxi | Across: no available quote |
| Unichain (`eip155:130`) | `0x078D782b760474a361dDA0AF3839290b0EF57AD6` | Across V4 | Stargate V2: no available quote |

The recorded provider fixture is
`tests/core/lifi-fixtures/lifi-ethereum-additional-destinations-quote-20260920.json`.
It proves the same `swapAndStartBridgeTokensViaAcrossV4` (`0x1794958f`) and
`swapAndStartBridgeTokensViaStargate` (`0xa6010a66`) envelopes, exact chain and
token identities, fee forwarding, Taxi endpoint IDs, and fail-closed rejection
of altered calldata or fees. Glacis, Mayan and LI.FI Intents remain refused.

Offline capabilities expose direct Circle CCTP V2 with Forwarding and a signed
upfront fee quote in `selected_direct_lane` as the first-lane design, still
non-executable. The existing `candidate_lanes` array keeps its LI.FI Solana
and TRON rows and indexes. Captured LI.FI Mayan MCTP evidence is exploratory
only; the LI.FI Solana inventory candidate uses LI.FI
Solana chain ID `1151111081099710` and the Solana USDC mint
`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Inventory makes one
additional anonymous `/connections` read for that exact pair. A returned
connection is provider inventory, not an amount-specific route or an APN
execution capability. `bridge routes`, `prepare` and `approve` still refuse
this lane; no Solana destination proof or recovery contract is admitted.
If its connection read fails or returns malformed data, inventory reports that
candidate as `unavailable` while retaining the admitted EVM results.
If the admitted inventory itself leaves no room for that optional marker within
the response bound, the candidate is omitted from this inventory result.
The identifiers follow LI.FI's [Solana provider documentation](https://docs.li.fi/introduction/lifi-architecture/solana-overview)
and [token reference](https://docs.li.fi/mcp-server/tools); inventory must still
be refreshed to learn current provider connectivity.

**Execution direction for the first Base USDC → Solana USDC lane:** target
direct Circle CCTP V2 with the Forwarding Service and a signed upfront fee
quote. Circle collects the quoted fee on Base with the burn and mints the full
burned amount to the Solana recipient; APN must bind the quote, fee token and
expiry, source debit and burn, Solana USDC associated token account (ATA),
destination mint/delivery, and no-resend recovery before admitting execution.
For Solana, `mintRecipient` is the recipient's USDC ATA, and ATA creation needs
the corresponding forwarding hook and quoted recipient setup cost. This is a
technical target, not an implemented or accepted transfer. The separate TRON
USDT / NEAR Intents discovery lane below has no CCTP V2 implication.
[Circle upfront fees](https://developers.circle.com/cctp/concepts/how-upfront-fees-work)
and [Forwarding Service](https://developers.circle.com/cctp/concepts/forwarding-service)
define the fee and destination mechanics.

Offline capabilities also identify **Base canonical USDC → TRON canonical USDT**
as a discovery-only candidate through LI.FI tool `near` (NEAR Intents). The LI.FI TRON
chain ID is `728126428` (`TVM`), and the destination contract is
`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`. Inventory separately reads the TVM
chain, token, bridge tool and exact NEAR-filtered connection. If any read
fails, disagrees with those identities or exceeds the response bound, the
candidate is unavailable or omitted while admitted EVM inventory remains
usable. A connection reports provider inventory only: it supplies no
amount-specific route, source call, fee bound, TRON delivery proof or recovery
contract. `bridge routes`, `prepare` and `approve` do not admit this lane.
On 16 September 2026 an anonymous 100 USDC quote-only read for `near` returned
a Base USDC → TRON USDT quote; the same filtered read for `allbridge` returned
"Tool allbridge is currently disabled for this action." This dated quote is
provider evidence, not APN execution admission. The [LI.FI API reference](https://docs.li.fi/agents/reference/endpoint-specs)
distinguishes connections from routes, and the [NEAR Intents facet](https://github.com/lifinance/contracts/blob/main/docs/NEARIntentsFacet.md)
requires separate source, destination and refund proof.

The saved synthetic 100 USDC quote can now be inspected offline with
`inspectNearBaseTronQuoteOffline`. Its canonical Base transaction calls the
LI.FI Diamond at `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` with
`swapAndStartBridgeTokensViaNEARIntents` (`0x3110c7b9`), forwards a 0.25 USDC
LI.FI fee, and passes 99.75 USDC to the NEAR Intents deposit. The quote's TRON
recipient decodes to a 20-byte account payload matching the facet's
`nonEVMReceiver` bytes32. The API's TRON chain ID `728126428` and the facet's
custom ID `1885080386571452` are deliberately checked as distinct values.
The ABI, receiver convention, transfer to the deposit address, signed fields,
and custom chain ID are pinned to
[LI.FI contracts commit `6a670100`](https://github.com/lifinance/contracts/tree/6a670100f9d011e39fbf2fe973493de0a50cf970)
([facet source](https://github.com/lifinance/contracts/blob/6a670100f9d011e39fbf2fe973493de0a50cf970/src/Facets/NEARIntentsFacet.sol),
[chain constants](https://github.com/lifinance/contracts/blob/6a670100f9d011e39fbf2fe973493de0a50cf970/src/Helpers/LiFiData.sol)).
This is byte-level source inspection of a synthetic quote. The destination
USDT token is quote metadata, not a field in the facet's signed payload.
`verifyNearBaseTronSignatureOffline` additionally reconstructs the facet's
EIP-712 digest and recovers the calldata signature against a caller-supplied
backend signer, Diamond, Base chain ID and trusted observation time. The facet
keeps its backend signer as an immutable constructor value without a public
getter, so the caller must independently establish the current installed facet
and its signer. A recovered address from the saved synthetic quote alone does
not establish that authority. The offline proof does not verify live Diamond
deployment, deposit address provenance, quote consumption, TRON settlement,
refund path or recovery. Both inspectors report `executionAdmitted: false` and
`bridgeCompletion: false`; `bridge routes`, `prepare` and `approve` still refuse
the lane.

`preflightNearBaseTronSourceReadOnly` provides a separate, injected-RPC source
preflight. The operator must pin the canonical JSON SHA-256 of the entire frozen
quote, the expected bytecode hash of the **currently installed** NEAR Intents
facet, and its backend signer. The pinned contract has no public signer getter:
obtain the signer independently from verified deployment or constructor
provenance, and refresh the pins after an upgrade. A signer recovered from the
quote is not sufficient operator provenance. The preflight samples one current
Base `safe` block, checks the Diamond selector mapping and installed facet code,
verifies the quote signature and deadline, checks `isQuoteConsumed`, and runs
`eth_call` with the exact quote calldata, payer, target, and value at that block.
It rechecks the block hash afterward and fails closed on unavailable RPC,
stale safe block, changed mapping/code, consumed quote, or simulation revert.
The returned proof has `executionAdmitted: false` and `bridgeCompletion: false`.
It does not establish deposit address provenance, destination delivery, or
refund availability; there is no signing, sending, or route admission hook.

## Discover and select a route

```sh
apn bridge capabilities
apn bridge inventory
apn help bridge routes
apn help --json
```

Capabilities and help are offline. Even `bridge capabilities --profile example`
does not inspect a wallet, state, Keychain or network. Inventory anonymously
reads LI.FI chains, tokens, tools and connections and exposes bounded public
fields with response hashes.

Optional authenticated LI.FI requests read `APN_LIFI_API_KEY` from the runtime
environment; the value is used only for the fixed LI.FI API base.

Configure each selected chain explicitly. The generic EVM `--rpc-url` option is
not a fallback for bridge operations.

### Admitted chains and native coins

| Chain | RPC environment variable | Native coin | Wrapped native pinned for Across |
| --- | --- | --- | --- |
| `eip155:1` Ethereum | `APN_ETHEREUM_RPC_URL` | ETH, 18 decimals | WETH9 `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, code hash |
| `eip155:8453` Base | `APN_BASE_RPC_URL` | ETH, 18 decimals | WETH9 predeploy `0x4200000000000000000000000000000000000006`, code hash |
| `eip155:42161` Arbitrum One | `APN_ARBITRUM_RPC_URL` | ETH, 18 decimals | aeWETH `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`, EIP-1967 implementation and admin slots |
| `eip155:59144` Linea | `APN_LINEA_RPC_URL` | ETH, 18 decimals | WETH9 `0xe5D7C2a44FfDdF6b295A15c148167daaAf5Cf34f`, code hash; destination only from Ethereum |

A native coin is a first-class registry row, not a token with a sentinel
address. It pays gas and Stargate's LayerZero messaging fee, and since this
change it is also a bridgeable **principal** over Across between Ethereum,
Base and Arbitrum, plus the reviewed Ethereum-to-Linea self-transfer lane.
The operator names it `native` (`--from-token native --to-token
native`); the provider's zero-address wire sentinel is never accepted as
operator input and is never a token. See [Native ETH principal](#native-eth-principal).

### The frozen list binds the registry

Every native coin and every token row except WBTC must equal an entry of the
frozen allowlist dataset (`data/allowlist/2026-09-17/dataset.json`): chain,
kind, contract, symbol and decimals. APN checks this against the compiled
inventory before admitting any route leg and treats a drift as an installation
fault. An address the list does not name is refused as
`asset_not_on_frozen_list`; it is never matched by symbol. WBTC predates the
list and stays a `legacy_pinned` row with its own pins.

### Admitted token rows

| Chain | Token | Decimals | Address | Upgradeability pinned | Tools | Peers |
| --- | --- | --- | --- | --- | --- | --- |
| `eip155:1` | USDC | 6 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | legacy proxy: implementation and admin slots | Across, Stargate pool 1 | Base, Arbitrum |
| `eip155:8453` | USDC | 6 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | legacy proxy: implementation and admin slots | Across, Stargate pool 1 | Ethereum, Arbitrum |
| `eip155:42161` | USDC | 6 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | legacy proxy: implementation and admin slots | Across, Stargate pool 1 | Ethereum, Base |
| `eip155:1` | USDT | 6 | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | immutable code hash, plus `basisPointsRate() == 0`, `maximumFee() == 0`, `deprecated() == false` | Across | none: the list names no USDT on Base or Arbitrum One |
| `eip155:1` | WBTC | 8 | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | immutable: code hash only | Across | Arbitrum |
| `eip155:42161` | WBTC | 8 | `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f` | beacon proxy: EIP-1967 beacon slot, beacon code, `implementation()` | Across | Ethereum |

Both sides of a route must be admitted rows of the same kind with the same pair
key, the same decimals, and each other in their peer sets. Peer sets are
asymmetric on purpose: Base admits no canonical WBTC, so no WBTC direction
touches Base. A row with no peer is refused as `asset_has_no_listed_peer`.

### Assets refused rather than approximated

| Asset | Why it is refused |
| --- | --- |
| Native ETH principal over Stargate | Stargate's native pools have not been reviewed; the route is listed but not preparable (`asset_tool_unreviewed`) |
| WETH on any admitted chain | not on the frozen list; LI.FI itself filters the route because Across does not send WETH to EOAs |
| USDT from Ethereum | the row is pinned but has no peer: LI.FI's Arbitrum USDT output is USD₮0 `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`, which the frozen list does not name, and LI.FI returns no Across or Stargate route from USDT to a listed USDC without a swap |
| Any token the frozen list does not name (DAI, cbBTC, USD₮0, ...) | `asset_not_on_frozen_list` |
| Any Stargate pool other than `assetId 1` | the pool has not been reviewed the way USDC was |
| Any fee-on-transfer or rebasing token | the exact-amount `Transfer` proof cannot hold |
| A proxy with no stable implementation, admin or beacon slot | there is nothing to pin an upgrade against |
| A fourth EVM chain | `EvmChainId` in `src/evm-asset.ts` is workspace-wide and touches every rail, receipt schema and conflict domain; that is a separate change |

RPC URLs must use public HTTPS without URL credentials, query parameters or
fragments. APN verifies the exact chain ID, pins resolved public addresses and
uses default TLS verification. It freezes both RPC origins in the intent.
LI.FI uses the fixed `https://li.quest/v1` origin. Both transports have bounded
JSON bodies, two concurrent requests, a 15-second request deadline, and no
redirects or automatic retries.

The following values illustrate syntax; choose principal, recipient, output
floor and fee limits for the intended payment. The profile must already have
its local EVM wallet and source USDC and native ETH funding.

```sh
apn bridge routes --profile existing-local \
  --from-chain eip155:1 --to-chain eip155:8453 \
  --from-token 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --to-token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --amount 10 --to <recipient> --min-output 9.9 \
  --max-native-debit-wei 20000000000000000 \
  --max-route-fee 0.1 --slippage-bps 50

apn bridge prepare --profile existing-local \
  --quote <quote-hash> --route <returned-route-id> \
  --idempotency-key bridge-example-001
```

`routes` saves the raw bounded response and a profile-bound snapshot, then shows
alternatives and the gates still required. Select one returned route ID and
its exact quote hash. `prepare` obtains that step's transaction and validates
its complete call before creating the durable operation. Updated quotes may
change gas, fees and output within the caller's limits; they cannot change
the selected tool, chains, accounts, tokens, principal, recipient or slippage.
An idempotency replay returns the original operation before any new provider,
wallet or network dependency. A conflicting key is rejected across all money
operation kinds and profiles.

APN accepts one source bridge call, one admitted asset pair and no destination
contract call. The finite decoders require the reviewed LI.FI Diamond and FeeForwarder,
the `lifi-api` integrator, zero referrer and exact fee distribution. Across
requires an empty message and no exclusivity. Stargate requires Taxi with empty
compose message, options and `oftCmd`. Arbitrary calldata, swaps, Permit2,
typed-data requests, approval resets and provider-added effects are rejected.
Contract bytecode, Diamond selectors, the registry row's upgradeability
evidence and exact `decimals()`, protocol configuration and reciprocal Stargate
peers are checked against the reviewed pins on both chains. An upgrade or
unknown deployment fails closed.

## Fees and foreground approval

`--amount`, `--min-output` and `--max-route-fee` are decimal strings at the
selected asset's own precision, taken from its registry row: six fractional
digits for USDC and USDT, eight for WBTC, eighteen for native ETH.
`--max-native-debit-wei` is an integer native-coin budget on the source chain.
For a native principal it bounds the fees only (gas, L1/operator fees); the
principal itself is bound by `--amount`, and the funding check still requires
principal plus fees. APN uses integer arithmetic and rejects
exponent notation, signs, whitespace, excess precision and uint256 overflow.

The token loss bound is source principal minus the materialized minimum output;
it includes fees and slippage and must fit `--max-route-fee`. Included token fees
are counted once. Stargate's native messaging fee must equal transaction value
and one declared additional native fee. Approval gas is a separate paid effect.

Only zero allowance or an exact existing allowance to the LI.FI Diamond is
accepted. Zero allowance creates `approve(spender, principal)` and bridge
transactions with consecutive nonces. Exact existing allowance needs only the
bridge transaction. Other allowances require separate operator review; this
flow never resets, increases an existing nonzero allowance, revokes or requests
a refund automatically.

Before allowance exists, APN independently estimates approval and freezes a
bounded provisional bridge gas ceiling with RPC-derived fee caps. Once approval
is included and the exact allowance is visible, APN independently estimates the
bridge and refuses to exceed those frozen caps. Waiting for safe approval is
not required before sending the bridge, but safe approval is required before
successful completion.

### Stated fee headroom

A bridge is priced at preparation and signed later, so the frozen EIP-1559
prices are deliberately **not** the quote. Each envelope freezes the quoted
`maxFeePerGas` and `maxPriorityFeePerGas` raised by exactly
`BRIDGE_FEE_HEADROOM_BPS`, currently **5000 basis points (+50%)**, rounded up,
under the policy identity `apn.bridge-fee-headroom.v1`. That raised pair is the
**owner-approved maximum**: it is what the envelope freezes, what custody signs,
what bounds the debit on chain, and what `--max-native-debit-wei` is checked
against. Because the maximum includes the headroom, the native budget you
approve must cover the worst case, not the quote.

Before each first send APN re-estimates and refuses
`fresh_execution_estimate_over_cap` only when the current gas limit,
`maxFeePerGas` or `maxPriorityFeePerGas` exceeds that approved maximum. A price
that rises within the headroom no longer ends the operation. APN never reprices
a consented envelope: the fingerprint, the signature and the on-chain cap are
all the maximum the owner approved, and the headroom is stored per envelope as
`feeCeiling` with the quote it was derived from, re-derived and re-checked on
every durable read. There is no other multiplier anywhere in the rail, and
there is still no paymaster equivalent of the token fee cap.

```sh
apn bridge approve --operation <operation-id>
```

The foreground terminal shows both chains, the admitted asset rows with their
symbols, decimals and upgradeability, each chain's native coin, sender,
recipient, principal, minimum output, declared and implicit fees, native budget,
separate effect nonces and gas ceilings, the stated fee headroom with both the
quoted and the approved maximum execution fee, RPC origins, policy, fingerprint
and expiry. Approval
requires the six-character approval code bound to the full fingerprint within 60 seconds
or the earlier operation expiry. APN checks the same intent again after consent.
The transaction materialization lasts at most 300 seconds, shortened by Across
protocol timing; at least 15 seconds must remain after checks before each first
send. Paid approval does not extend the bridge deadline.

The native budget includes approval, execution, messaging value and estimated
L1/operator fees. Base fee quotes use a 16 KiB signed-transaction upper bound.
**Base's total native fee is checked before sending; it is not an on-chain
total-spend cap.** L1 and operator fees can change between that check and
inclusion. Source actual fees are later proved independently: Ethereum
execution gas, Arbitrum's inclusive gas total without double-counting poster
gas, and Base execution plus explicit L1 fee plus a receipt-block operator
oracle result. Base requires the reviewed GasPriceOracle 1.6.0, L1Block 1.7.0
and Jovian configuration. A missing operator receipt field never implies zero.

## Native ETH principal

A native principal is carried by Across V4 only, between any two of Ethereum,
Base and Arbitrum One, and from Ethereum to Linea. There is no approval effect: the approval cap is zero,
the account's allowance is the constant zero, and the principal is the bridge
transaction's `value`. The decoder accepts exactly the call LI.FI returned in the
read-only captures of 18 September 2026:

- `swapAndStartBridgeTokensViaAcrossV4` (`0x1794958f`) on the Diamond with
  `value == amount` and `bridgeData.sendingAssetId` the zero address;
- one FeeForwarder step with `forwardNativeFees` (`0x0e8ae67f`), native in and
  out, `fromAmount == amount`, one distribution of exactly
  `amount - bridgeData.minAmount` to the reviewed fee recipient;
- Across data whose input token is the source chain's pinned wrapped native and
  whose output token is the destination chain's pinned wrapped native, with the
  same recipient, refund, output, exclusivity and message rules as ERC-20.

The route estimate must state `skipApproval: true` and must not ask for an
approval reset. Every fee row is the native coin itself (`asset: "native"`);
LI.FI's fixed fee must equal the forwarded amount. A Stargate native route is
listed but not preparable, and a token request can never reuse native calldata.

Source proof replaces the three ERC-20 `Transfer` logs with the wrap: exactly
one wrapped-native log crediting the source SpokePool with the bridge amount
(`Deposit(dst)` from WETH9 on Ethereum and Base, a `Transfer` from the zero
address on Arbitrum's aeWETH), next to the unchanged `LiFiTransferStarted`,
`FeesForwarded` (token = zero address) and `FundsDeposited` checks.
Destination proof keeps the full `FilledRelay` tuple and replaces the recipient
`Transfer` with the unwrap: exactly one log of exactly the output amount from
the destination SpokePool (`Withdrawal(src)` from WETH9, or a `Transfer` to the
zero address from aeWETH). For Linea, the exact destination transaction must
also expose one bounded `debug_traceTransaction` call trace from the pinned
SpokePool to the bound profile owner for exactly the FilledRelay output. The
safe canonical transaction and block bind that trace; the previous-block to
receipt-block balance delta is corroborating evidence and cannot replace the
transaction-attributable transfer. The configured public Linea endpoint was
read-only checked on 20 September 2026 and returned `callTracer` output. Linea
deployment verification replays a pinned safe-block trace probe, so a configured
RPC without `debug_traceTransaction` support refuses the lane before execution.

Linea execution requires an active owner allowlist admission for the Ethereum
native asset on rail `bridge`, with mechanism `{ provider: "lifi", reference:
"across-v4" }`. Preparation freezes the policy revision, owner, self recipient,
asset, amount and mechanism. Foreground approval reserves the amount in the
shared UTC-day usage ledger before signing. Submitted, ambiguous, finalized
and confirmed-revert outcomes advance or release that one idempotent
reservation. A changed policy or non-self recipient refuses before signing.

```sh
apn bridge routes --profile existing-local \
  --from-chain eip155:1 --to-chain eip155:8453 \
  --from-token native --to-token native \
  --amount 0.001 --to <recipient> --min-output 0.00099 \
  --max-native-debit-wei 1000000000000000 \
  --max-route-fee 0.00001 --slippage-bps 50
```

On 18 September 2026 a read-only rehearsal ran this exact lane through APN's
own modules from a public address without signing: anonymous LI.FI routes and
step materialization, the finite decoder, the live deployment pins of both
chains at their safe blocks (Diamond, FeeForwarder, Across facet and SpokePool,
wrapped native), the account read and the envelope freeze with
`eth_estimateGas`. It produced one bridge effect with `value` 0.001 ETH, no
approval, and a fee quote of about 0.0001 ETH under a 0.001 ETH fee cap. The
same run refused 1 USDT Ethereum → Arbitrum as `asset_not_on_frozen_list`.

The immutable 20 September 2026 Ethereum-to-Linea capture is
`tests/core/lifi-fixtures/lifi-ethereum-linea-native-across-20260920.json`.
It contains the anonymous read-only route request/response and exact
step-materialization request/response with SHA-256 provenance. The captured
0.0002 ETH route is direct Across with only FeeForwarder and Across effects,
`value = 200000000000000`, bridge amount `199500000000000`, output
`189197517787962`, empty message and gas limit `533000`. No signature or send
was performed. BNB remains quote-only and outside the execution destination
set.

The matching public RPC baseline is
`tests/core/lifi-fixtures/deployment-linea-rpc-20260920.json`. It freezes Linea
block `32089068` (`0x313150b011d0f89dba2545a04c6f397482db04fdb82bca46ef8118d85f4dcae0`)
and the read-only code/configuration responses for the pinned Across SpokePool,
Linea WETH, 18 decimals, 3600-second quote-time buffer and 21600-second fill
deadline buffer.

## USDT on Ethereum

The Tether row is pinned the same way a token is admitted, plus the storage a
code hash cannot see: every deployment read requires `basisPointsRate()`,
`maximumFee()` and `deprecated()` to be zero, so a switched-on transfer fee or
a deprecation forward fails closed. Tether's `approve` returns no value and
reverts a nonzero approve over a nonzero allowance; APN never reads the return
value (it proves the approval by the exact `Approval` log and the observed
allowance) and only approves exactly the principal from a zero allowance, or
uses an exact existing allowance. The provider's `approvalReset` flag is
accepted only for this `zero_first` row and never acted on. The row has no peer
today, so every USDT route is refused before any provider call; admitting one
needs a listed USDT destination on an admitted chain.

## Allowlist gate for the bridge rail

The frozen list now bounds which identities the bridge registry may admit. The
owner allowlist policy (`docs/allowlist-policy.md`, rail `bridge` with a
`{ provider, reference }` mechanism pin) is **not yet enforced** by
`bridge routes` or `bridge prepare`: the seam is `BridgePreparation.prepare` in
`src/lifi/prepare.ts`, right after `validateBridgeRequest`, where
`loadActiveAssetPolicyRegistry` and a usage reservation for the source leg
would bind the operation to the policy digest. It is listed as follow-up work.

## Recovery and proof

```sh
apn operation status --operation <operation-id>
apn operation resume --operation <operation-id>
apn receipt get --operation <operation-id>
```

Status and receipt read the saved operation. Resume performs one bounded
recovery pass; omit `--wait-seconds`. An approved, not-yet-started effect may
progress only under its original deadline and checks. Signing commitment is
durable before custody is entered; a recovered commitment can load only its
original authenticated seal. Missing committed material blocks recovery and
never permits a replacement signature.

APN records the first submission attempt before calling the RPC. Once that
boundary is reached, all recovery observes the original hash without resend,
even if the acknowledgment was lost, the RPC returned a different hash, the
quote expired or no transaction is visible yet. An unresolved operation blocks
another money operation for the profile. If approval was paid but the bridge
was never submitted, failure waits for safe approval and retains its fee and
observed residual allowance.

`completed` requires safe, canonical source and destination evidence. Source
proof checks the reconstructed signature and frozen transaction, block
membership, receipt, token movements, LI.FI and protocol events and fees.
Across delivery matches the full relay tuple, origin/deposit ID, effective
recipient/output and a transfer of the admitted destination token. Across repayment credit is
preserved as its complete bytes32 value with its repayment chain; it need not
be an EVM address or equal the token payer. Slow fills require zero repayment
credit/chain and a transfer from the destination SpokePool reserves. Stargate delivery matches
nonzero GUID, source endpoint, receiver and amount with a transfer of the
admitted destination token, including a later successful retry of a cached
delivery.

LI.FI status supplies a hint, not completion authority. `PENDING`, not-found,
completed, partial, refunded, failed and unknown observations remain distinct.
The hint names the destination transaction in its own rail's form: an EVM
32-byte hash, lowercased exactly as before, or a canonical base58 Solana
signature of exactly 64 bytes. No other string is a transaction identity, and a
Solana signature can never address the EVM destination reader, so a
Solana-destination hint falls through to the exact event scan. Until 0.5.18 the
hint was forced through the EVM hex reader, which threw on a base58 signature
and silently collapsed the whole observation to `unknown` with a null hint.

A bridge takes the lock of the chain it signs on: every EVM source keeps the
`evm:<chain id>:<address>` domain it has always taken, while a source on LI.FI's
Solana chain id `1151111081099710` takes the same `solana:<genesis>:<address>`
domain a direct Solana transfer takes. One money operation per profile therefore
holds across both, and an EVM bridge and a Solana transfer never collide. An
account that is not its chain's own address form is refused rather than mapped.
Unproved partial/refund/failure observations stay unresolved. A bounded exact
event scan checks at most 1024 blocks and 128 logs per resume and validates its
canonical cursor before advancing. Reorgs discard provisional inclusion while
retaining submission identity; conflicts with a saved safe proof preserve that
proof and block completion until the original evidence can be verified again.

The receipt separates known fees, unresolved fee effects and final actual fees;
unknown cost is not rendered as zero. It includes both chain proofs, provenance,
source fee components, actual destination amount and residual allowance.
`rpc_safe_correlated` means evidence correlated through the configured RPCs,
not a trustless light-client proof. The operation is authoritative: interrupted
derived-receipt writes are repaired under the same locks. Raw calldata, signed
bytes, wallet secrets and raw provider errors are omitted from public output.

The five MCP tools are `apn_bridge_capabilities`, `apn_bridge_inventory`,
`apn_bridge_routes`, `apn_bridge_prepare` and `apn_bridge_approve`. They use the
same catalog and binder as the CLI. Approval through MCP returns only the exact
foreground CLI command without reading state or entering custody. Generic
status, resume and receipt tools handle the durable bridge operation.

## Evidence and remaining acceptance

The reviewed protocol revisions are [LI.FI contracts
`0f83f131`](https://github.com/lifinance/contracts/tree/0f83f131b4aff16cf774d9161465b8209f7453ec),
[Across contracts
`19e346a5`](https://github.com/across-protocol/contracts/tree/19e346a5415e2ebb18fafe590f76dc90f413d1b5)
and [Stargate V2
`50679756`](https://github.com/stargate-protocol/stargate-v2/tree/50679756e705fcc48b9642c20d4a40ded57c74d7).
Repository tests retain unsigned provider captures, an anonymous historical
Base fee RPC fixture and the exact deployment RPC responses for all six directed
chain pairs. The deployment replay exposed an incorrect initial owner pin:
FeeForwarder owner `0x08647cc950813966142a416d40c382e2c5db73bb` is distinct from
fee recipient `0xc06ebbefd94032b85424d51906e2a335efae264b`. The owner pin follows
the independent safe-block observations on all three chains; fee distribution
still binds the recipient. The original capture retains the mismatch, and
tests require the corrected owner while rejecting either identity changing.
The registry's WBTC rows were read from mainnet at a safe block: Ethereum WBTC
has no proxy slot set, and Arbitrum's bridged WBTC resolves through its EIP-1967
beacon slot to beacon `0xE72ba9418b5f2Ce0A6a40501Fe77c6839Aa37333` and
implementation `0x3f770Ac673856F105b586bb393d122721265aD46`. Route availability
for every admitted pair was confirmed with unauthenticated LI.FI `/v1/quote`
calls, which are rate limited to 75 per two hours per IP. Synthetic journeys
exercise both protocols in the three required directions, a WBTC route on a
second chain, the fee-headroom boundary on both sides, and recovery without
real payment submission.

| Required real mainnet acceptance | Status |
| --- | --- |
| Ethereum to Base canonical USDC | OPEN |
| Base to Arbitrum canonical USDC | OPEN |
| Arbitrum to Ethereum canonical USDC | OPEN |
| Arbitrum to Ethereum WBTC | OPEN |
| Named human receiving acceptance | OPEN |

The three live rows need fresh action-time quotes, at least two selectable
executable alternatives in the EVM family, explicit account/amount/fee and
recovery authority, independently verified transactions on both chains and a
durable APN receipt. Wallet/provider setup, funding, real transactions and public
release are separate actions. Existing direct-transfer and x402 state formats
remain unchanged; this implementation uses separate bridge stores without a
migration.

## Base to Solana USDC observation kernel (source only)

`src/lifi/solana-destination-candidate.ts` parses a finalized successful Solana
`getSignatureStatuses` and `getTransaction` pair into a **candidate** for a
Base-USDC to Solana-USDC delivery. It requires the exact recipient's existing
canonical USDC associated token account, the canonical mint and Token Program,
one unambiguous pre/post balance row, and a positive token increase meeting a
frozen minimum. Only the exact `completed` LI.FI outcome is accepted as a
candidate; every other outcome and malformed value is refused.

The candidate always has `sourceMessageCorrelation: "unverified"` and
`bridgeCompletion: false`. There is no admitted route, prepare, approval,
submission, completed operation or receipt for this lane. A later protocol
packet for the selected direct Circle CCTP V2 lane must bind its signed fee
quote, Base burn and CCTP message to the specific Solana USDC mint and receive
transaction before a bridge receipt can be supported. Public Circle/LI.FI
bridge/provider observation APIs supply the destination observations and their
normal provenance; APN does not require or implement its own Iris attester key,
signed-domain verifier or custom attestation cryptography. Until owner/provider
acceptance, the offline destination path remains `executionAdmitted: false` and
`bridgeCompletion: false`. This LI.FI-shaped candidate does not establish that
correlation. A recipient with no USDC associated token account is outside this
kernel's proof contract; its creation and rent payer need separate admission.

## Offline Base to Solana Mayan quote inspection

`src/lifi/mayan-offline.ts` inspects **one captured synthetic LI.FI quote shape**
for Base canonical USDC to Solana canonical USDC through `mayanMCTP`. Its
Mayan redemption fee value is pinned to that capture; other valid Mayan quotes
may be rejected. This is not general Mayan route acceptance. It is a pure
decoder and is not connected to route admission, preparation, approval,
execution, status or completion. Its result always says `bridgeCompletion:
false`. The fixture in
`tests/core/lifi-fixtures/base-solana-mayan-mctp-quote-synthetic-20260916.json`
uses public synthetic source and destination addresses and was captured with
the read-only `/v1/quote` endpoint for 100 USDC. It must never be submitted.

The decoder uses [LI.FI contracts commit
`4b4b8138`](https://github.com/lifinance/contracts/tree/4b4b8138a6f12e8c32ad72040fae5f1a763e3fc6):
`MayanFacet.sol`, `ILiFi.sol`, `LibSwap.sol`, `FeeForwarder.sol` and the Base
deployment record. It checks the Base Diamond and approval spender, current
nine-field Mayan ABI, one same-token FeeForwarder step, the included fee and
caller-supplied fee cap, source principal, source and destination identities,
non-EVM receiver bytes, refund recipient, zero native value, and the nested
MayanCircle `bridgeWithFee` selector and amount. It also binds the top-level
transaction ID and integrator, source amount, token chain IDs and decimals, and
both included steps' tools, amounts, assets, recipient and fee rows to the
decoded calldata. Its pinned MayanCircle address
and destination domain are observed from the synthetic quote, not an
independent deployment proof. Changes to either must be reviewed explicitly.

The captured 100 USDC source amount includes a **250,000 atomic USDC LI.FI
FeeForwarder fee**, leaving 99,750,000 atomic USDC for Mayan. The nested
`bridgeWithFee` carries a separate **1,647,869 atomic USDC `redeemFee`** and
zero `gasDrop`; the fee names and argument order follow [Mayan SDK commit
`c4c98031`](https://github.com/mayan-finance/swap-sdk/blob/c4c98031aaad9264d17630d7b4de0cb18688cf78/src/evm/evmMctp.ts#L36-L113).
The decoder reports `lifiFeeAmountAtomic` and `mayanRedeemFeeAtomic` separately.
Neither fee is an onchain destination output floor, and this synthetic fixture
does not establish current fee pricing.

The API's `estimate.toAmountMin` is an offchain estimate. The decoded source
call does not expose an onchain destination minimum or a quote expiry. The
captured `redeemFee` is a fixture guard, not a general fee cap. Mayan MCTP
remains a discovery and offline observation candidate and is not selected for
the first executable Base-to-Solana lane. Any later Mayan execution proposal
needs current deployment and bytecode proof, complete protocol semantics,
destination and refund proof, an enforceable output/timing contract, and a
separate admission review.

`src/lifi/mayan-source-receipt.ts` adds a pure, offline source receipt parser for
that same frozen quote shape. It checks the original Base transaction's chain,
hash, sender, Diamond target, zero value and exact quoted input, a successful
receipt with the same transaction hash, one Diamond `LiFiTransferStarted`, one
`BridgeToNonEVMChainBytes32` matching the quoted transaction ID and receiver,
and exactly one `MessageSent` from Circle's canonical Base CCTP V1
MessageTransmitter. It decodes the [CCTP V1 message
layout](https://developers.circle.com/cctp/v1/message-format), checks domains
6 to 5, V1 versions, canonical Base TokenMessenger sender, Circle's Solana V1
TokenMessengerMinter recipient, canonical Base USDC
burn token, MayanCircle message sender, and a positive burn amount no greater
than the bridge principal. The [Circle V1 deployment
table](https://developers.circle.com/cctp/v1/evm-smart-contracts) pins the Base
MessageTransmitter and TokenMessenger addresses. The [pinned LI.FI
facet](https://github.com/lifinance/contracts/blob/4b4b8138a6f12e8c32ad72040fae5f1a763e3fc6/src/Facets/MayanFacet.sol)
forwards the Mayan call and emits the two source events. [Mayan's MCTP
description](https://docs.mayan.finance/) identifies Circle CCTP as the value
transfer layer.

The parser returns a source message hash, nonce, burn amount/token and CCTP
mint recipient with `bridgeCompletion: false`. The CCTP mint recipient can be a
Mayan program; it is not claimed to be the user's final Solana recipient.
This is correlation within one source receipt, not destination delivery or
finality proof. The caller must supply an authenticated transaction and receipt;
the parser performs no RPC call, signature reconstruction, attestation lookup,
or execution.

`src/lifi/mayan-provider-status-offline.ts` accepts the frozen quote, an
independently observed Base source transaction hash and CCTP V1 message
hash/nonce, and caller-supplied responses from Circle
`GET /v1/messages/6/{transactionHash}` and LI.FI `GET /status`. It checks the
single Circle message's bytes, Keccak hash, V1 header and nonce; it also
requires one LI.FI `DONE`/`COMPLETED` response with the quote transaction ID,
source hash, Mayan tool, Base and Solana chain IDs, sender and recipient,
canonical USDC token identities, the source amount, a receiving amount at
least as large as the quoted minimum, and a canonical Solana receiving
signature. Missing fields or contradictions are rejected. The result
is a provider hint with `bridgeCompletion: false`. The caller obtains the
responses through the public Circle/LI.FI bridge/provider observation APIs and
passes their normal provenance; this offline parser does not fetch or replace
that external transport and attestation acceptance. It does not prove onchain
Solana delivery or admit execution. The source hash and message correlation
must first come from a separately verified source receipt. The parser uses only
fields shown in [Circle's V1 message response](https://developers.circle.com/cctp/migration-from-v1-to-v2)
and [LI.FI status schema](https://docs.li.fi/agents/reference/endpoint-specs).

## Offline direct Circle CCTP V2 source receipt candidate

`src/lifi/circle-v2-source-receipt.ts` parses one caller-authenticated successful,
safe Base transaction and receipt for the direct Circle `TokenMessengerWithFees`
address. It requires exactly one `DepositForBurn` emitted by the underlying Base `TokenMessengerV2`
with `TokenMessengerWithFees` as depositor and burn-body message sender, and one
`MessageSent(bytes)` emitted by Base `MessageTransmitterV2` with
`TokenMessengerV2` as the message-header sender. It compares the V2
message header and burn body to every expected burn field: Base USDC, amount,
sender, Solana USDC ATA bytes32, domain 5, Solana V2 TokenMessengerMinter,
zero destination caller, maximum fee, finality threshold, and hook data. The
`maxFee` in that burn event is the CCTP burn field, separate from the USDC
`FORWARD` fee collected by the wrapper. A `FORWARD`-only signed quote selects
Standard finality (2000) and a zero CCTP `maxFee`; live source submission
currently admits this exact quote shape and rejects additional fee items.
The V2 source message contains a zero nonce placeholder; the parser does not expose
or infer an attested nonce. Duplicate or ambiguous events fail closed. Its
result is source evidence only (`executionAdmitted: false`,
`bridgeCompletion: false`). The public bridge/provider observation API and its
normal provenance, followed by owner/provider acceptance, carry the RPC and
attestation trust boundary. This source evidence does not prove a destination
mint or admit execution; APN does not implement a separate attestation
verifier.
The event ABI and packed message format follow Circle's
[TokenMessengerV2](https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/TokenMessengerV2.sol),
[MessageTransmitterV2](https://github.com/circlefin/evm-cctp-contracts/blob/master/src/v2/MessageTransmitterV2.sol),
[technical guide](https://developers.circle.com/cctp/references/technical-guide),
[contract addresses](https://developers.circle.com/cctp/references/contract-addresses),
and [Solana programs](https://developers.circle.com/cctp/references/solana-programs).

## Direct NEAR 1Click lanes

`apn oneclick source submit --lane <lane>` sends one origin-chain deposit to the
`depositAddress` of a fresh NEAR Intents 1Click quote
(`https://1click.chaindefuser.com/v0/quote`, status from `/v0/status`). Only these pinned lanes exist; any other `--lane` value is refused before
any network call. Asset IDs match the public `GET /v0/tokens` list (2026-09-18).

| Lane | Origin effect | Destination | 1Click origin → destination | Loss bound (`--max-quoted-loss-atomic`) |
|---|---|---|---|---|
| `base-usdc-to-tron-usdt` | Base USDC `transfer` (6 decimals) | TRON USDT (6) | `nep141:base-0x8335…2913.omft.near` → `nep141:tron-d28a…f015.omft.near` | amount in minus quoted minimum, USDC atomic at par |
| `ethereum-eth-to-tron-trx` | Ethereum ETH value transfer (18) | TRON TRX (6, SUN) | `nep141:eth.omft.near` → `nep141:tron.omft.near` | quoted output minus quoted minimum, SUN |
| `ethereum-eth-to-solana-sol` | Ethereum ETH value transfer (18) | Solana SOL (9, lamports) | `nep141:eth.omft.near` → `nep141:sol.omft.near` | quoted output minus quoted minimum, lamports |
| `ethereum-eth-to-tron-usdt` | Ethereum ETH value transfer (18) | TRON USDT (6) | `nep141:eth.omft.near` → `nep141:tron-d28a…f015.omft.near` | quoted output minus quoted minimum, USDT atomic |

For different assets the only in-band valuation is the quote's own rate, so the
loss bound covers the quote's slippage floor; `--min-output-atomic` is the
owner's price floor. Recipients must be canonical: TRON base58check for TRX and
USDT, a 32-byte Solana base58 key for SOL. `refundTo` is always the payer.

Submission is keyless and fails closed: a dry quote (no deposit address), then an
actual quote whose echo must match the lane assets, payer, refund address,
recipient, amount and a request deadline at most 180 seconds ahead; the quoted
minimum must meet `--min-output-atomic`; the deposit address may not be zero,
the payer or the origin token, and no memo is accepted. Origin reads are pinned
to the safe block hash. For native ETH the transaction is exactly `amountIn` wei
to the deposit address with empty calldata; `eth_getCode` decides the gas: an
account without code uses 21000, a contract deposit is estimated at the same
block (plus 20 percent) and must fit `--max-gas-limit-atomic`. The max fee is
twice the larger of the safe and latest base fee plus the RPC tip suggestion;
value plus gas times that max fee must fit `--max-native-debit-wei` and the safe
balance. The record is staged, the owner types a six-character code in the
foreground terminal, and the reads repeat: the nonce and deposit code class must
be unchanged, gas may not grow, the approved max fee must still cover the fresh
base fee plus the approved tip, and the balance must still cover the approved
debit. The signed raw transaction is saved before the single send; an unknown
send result is recorded as `unknown_finality` and never resent. MCP exposes
`apn_oneclick_source_submit` only as an `APN_FOREGROUND_APPROVAL_REQUIRED`
handoff carrying the exact CLI command, plus the read-only status tool.

`apn oneclick source status --operation <id>` keeps three observations apart:
the safe source receipt, the provider's HTTPS status claim (bound to the saved
quote digest), and an independent destination proof for the Ethereum lanes. The
proof reads only transaction IDs the provider names in
`swapDetails.destinationChainTxHashes`: TRX needs a solidified `TransferContract`
to the recipient whose JSON re-encodes to the hashed raw data, with block
membership and a successful result (a first transfer may create the recipient
account); USDT needs the solidified TRC20 `Transfer` log; SOL needs the recipient's
finalized balance delta inside the named transaction. Credits in blocks older
than the quote request are refused, and `destinationFinalized` is true only when
the proven credits reach the saved minimum output. Source RPCs come only from
`APN_BASE_RPC_URL` or `APN_ETHEREUM_RPC_URL`, destination RPCs only from
`APN_TRON_RPC_URL` or `APN_SOLANA_RPC_URL`; there are no default endpoints. The
Base lane keeps its original status output, operation IDs and nonce reservation
path; v1 and v2 records remain readable as that lane, and v3 records carry the
lane. Ethereum nonce reservations are scoped under `eip155-1`.
