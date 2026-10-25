# LI.FI EVM cross-chain assets

## Sei through LI.FI

Sei and LI.FI's `gasZipBridge` tool stay outside the executable LI.FI chain, asset,
tool, allowlist, signer, sender and observer paths. The offline C2-08 LI.FI Sei quote
inspector (`src/lifi/sei-gaszip-quote.ts`) had no caller and was removed; Sei is funded
through the GasZip direct route below.

## Finite GasZip direct funding for Sei

The Sei and Mega GasZip direct routes are one implementation (`src/lifi/gaszip-direct-*.ts`)
driven by a protocol table keyed by destination chain (chain id, GasZip short id, calldata,
mechanism reference, destination RPC variable). Each route keeps its own commands, journal
directory, schema version and reference, so stored operations of either route load unchanged.

`sei funding` adds one separate local-wallet funding route: native Base ETH
(chain 8453) to the same owner's native Sei SEI (chain 1329). The source sends
the amount the asset policy and usage ledger admit to the official GasZip V2 direct deposit address
`0x391E7C679d29bD940d63be94AD22A25d25b5A604` with exactly `0x0100f6`.
APN requires that target to have empty code. The calldata selects the source
sender as recipient and GasZip short chain ID 246. No approval is involved.
LI.FI does not execute this route.

The active Base native bridge admission must name exactly
`{ "provider": "gaszip", "reference": "v2-direct-base-sei-self-0100f6.1" }`; an owner
`recipients` pin on it must list the payer, who is also the recipient.
The owner's `--minimum-output-atomic` floor and `--maximum-fee-atomic` ceiling are
the only output and fee bounds; no lane constant caps them. Base fee quotes include L2 gas,
the OP GasPriceOracle L1 data fee upper bound for 512 signed bytes, and the
operator fee, and the paid fee counts the receipt's L1 and operator fees. The
signed EIP-1559 gas price limits the L2 component; the Base total is a quoted
ceiling, not an on-chain total fee cap. The destination floor is an acceptance
requirement and is not enforced by the source transaction.

Set `APN_BASE_RPC_URL` and `APN_SEI_RPC_URL` to public HTTPS RPC endpoints. Each
RPC must return its exact chain ID, hash-pinned state and safe blocks. The API
origin is fixed to `https://backend.gas.zip`. Integer JSON lexemes are preserved
as exact decimal strings before any native output comparison.

```text
apn sei funding prepare --profile evm-live-buyer --expected-payer <owner-address> --amount-atomic 10000000000000 --minimum-output-atomic 250000000000000000 --maximum-fee-atomic 1000000000000 --idempotency-key <new-key>
apn sei funding approve --operation <saved-operation-id>
apn sei funding status --operation <saved-operation-id>
```

Preparation saves the quote expiry, exact owner and provider binding, active
policy digest, source nonce and fee plan. Approval needs a foreground terminal
and fresh source checks. Create-only signing and sending claims precede their
respective effects. The operation joins the shared EVM conflict and idempotency
registry, so its unresolved Base spend blocks another operation for that owner
on Base. Status never signs or resends. An expired unsigned preparation becomes
`failed_before_effect`; a signing interruption retains its hold.

Completion requires a successful canonical source transaction and receipt at
or below Base's safe head, including the exact sender, nonce, calldata, value
and signed fee pair. The provider's `/v2/deposit/<source-hash>` response must map
that source to exactly one successful, unrefunded Sei transaction. Sei RPC then
independently verifies the mapped transaction's sender, recipient, nonce, native
value, receipt, safe inclusion and exact recipient balance delta across its
inclusion block. A destination hash has one create-only operation claim. The
source receipt and the provider's status alone cannot complete this operation.
Missing, ambiguous, refunded or changed provider data retain the hold. Only an
independently safe source revert releases the principal as
`failed_confirmed_revert`; consumed source network fees remain separate.

Primary protocol contracts:
[direct deposit format](https://dev.gas.zip/gas/code-examples/evm-deposit/direct-forwarder),
[quote and expiry](https://dev.gas.zip/gas/api/quote),
[deposit correlation](https://dev.gas.zip/gas/api/deposit) and
[outbound correlation](https://dev.gas.zip/gas/api/outbound).
Local synthetic tests verify these guards and recovery states. Real funding,
installed consumer proof and the subsequent Sei direct receipt require their
own evidence.

This APN 0.5.26 package includes local-wallet route selection and execution for
the admitted assets between Ethereum, Base, Arbitrum One and the finite native
destinations below. It implements
Across V4 and Stargate V2 Taxi through the LI.FI API. Package availability,
source tests and installed-package tests are separate from real mainnet
acceptance, which is now **1/3**, and named human acceptance remains open.

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

### Ethereum native to BNB native composite lane

The sole admitted BNB execution graph is LI.FI fee collection followed by
Across V4 to `ReceiverAcrossV4`, then one Fly destination swap from BSC WETH
to native BNB. APN decodes the full destination message and compressed Fly
program. It requires exactly the pinned WETH approval, one Balancer
`GIVEN_IN` WETH/WBNB pool call, WBNB unwrap, Core native balance read and native
return to the Fly router. The signed Fly header, raw payload hash, owner output
floor, retention bound, self recipient and source debit caps are part of the
durable operation integrity binding.

Preparation refreshes the Fly signer allowlist, Fly/Core linkage and whitelist,
Receiver Executor/SpokePool immutables, Across buffers, contract code and the
Vault pool registration with the complete five-token list, exact order, WETH as
the input token and WBNB as the output token. Completion requires
the canonical Across message hash and a safe BNB transaction whose complete
bounded callTracer subtree matches the pinned SpokePool, Receiver, Executor,
Fly, Core, Vault, pool swap, WBNB unwrap and native-return hierarchy. The digest
covers the entire validated subtree. Vault output must equal the unwrap amount;
retention math must equal the Fly-to-Executor and Executor-to-self value; and the
self balance delta must cover that delivery. Recovery of unswapped WETH,
below-floor output, a protocol graph mismatch and unavailable evidence remain
distinct durable outcomes across restart. Only `completed_native` completes the
native BNB delivery.
The retained fixture is
`tests/core/lifi-fixtures/bnb-composite-fly-20260921.json`; it is read-only
evidence and its expired amounts and deadlines are never used as a live quote.

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
| `eip155:143` Monad | `APN_MONAD_RPC_URL` | MON, 18 decimals | WMON `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`, code hash; destination only from Ethereum |
| `eip155:8453` Base | `APN_BASE_RPC_URL` | ETH, 18 decimals | WETH9 predeploy `0x4200000000000000000000000000000000000006`, code hash |
| `eip155:42161` Arbitrum One | `APN_ARBITRUM_RPC_URL` | ETH, 18 decimals | aeWETH `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`, EIP-1967 implementation and admin slots |
| `eip155:59144` Linea | `APN_LINEA_RPC_URL` | ETH, 18 decimals | WETH9 `0xe5D7C2a44FfDdF6b295A15c148167daaAf5Cf34f`, code hash; destination only from Ethereum |

A native coin is a first-class registry row, not a token with a sentinel
address. It pays gas and Stargate's LayerZero messaging fee, and since this
change it is also a bridgeable **principal** over Across between Ethereum,
Base and Arbitrum, plus the reviewed Ethereum-to-Linea and
Ethereum-to-Monad self-transfer lanes.
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
| Native principal over Stargate outside Ethereum ETH to Base ETH | Only the Ethereum→Base asset ID 13 pool pair is pinned and admitted; other directions return `asset_tool_unreviewed` |
| WETH on any admitted chain | not on the frozen list; LI.FI itself filters the route because Across does not send WETH to EOAs |
| USDT from Ethereum | the row is pinned but has no peer: LI.FI's Arbitrum USDT output is USD₮0 `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`, which the frozen list does not name, and LI.FI returns no Across or Stargate route from USDT to a listed USDC without a swap |
| Any token the frozen list does not name (DAI, cbBTC, USD₮0, ...) | `asset_not_on_frozen_list` |
| Stargate pools other than USDC `assetId 1` and Ethereum→Base native `assetId 13` | no pinned pool pair and correlated proof |
| Any fee-on-transfer or rebasing token | the exact-amount `Transfer` proof cannot hold |
| A proxy with no stable implementation, admin or beacon slot | there is nothing to pin an upgrade against |
| Any EVM chain absent from `BRIDGE_CHAINS` | no reviewed registry row, deployment proof, RPC policy, destination observation or finite execution path exists for it |

RPC URLs must use public HTTPS without URL credentials, query parameters or
fragments. APN verifies the exact chain ID, pins resolved public addresses and
uses default TLS verification. It records both RPC origins in the intent for
reference only: guards and proofs bind the chain ID and block hashes, so a
failing endpoint can be replaced while an operation is in flight.
LI.FI uses the fixed `https://li.quest/v1` origin. Both transports have bounded
JSON bodies, two concurrent requests, a 15-second request deadline, and no
redirects or automatic retries. Bridge preparation uses one command-scoped RPC
read session across the source and destination. Strict JSON-RPC batches contain
at most 33 items; identical ordered batches are singleflighted, and every
response is decoded before any eligible result enters the cache. dRPC's keyless
plan refuses a batch of more than three requests, so a `*.drpc.org` endpoint
receives the same logical batch in sequential three-item chunks that the read
plan counts once. Every read goes to the primary `APN_<CHAIN>_RPC_URL`: mutable
state (head, balances, allowance, nonces, fee inputs, the planned simulation and
the light deployment check) is read in one batch at the moving `latest` head the
transaction will execute against, with the pending nonce explicitly pending.
Mutable account, fee and estimate data is never retained across an approval or
signing boundary. A session permits at most 96 logical items and 180 seconds;
its request cap is the step's read plan with explicit retry headroom. Each
provider family keeps one request at least 750ms apart.

Each admitted EVM chain also accepts optional
`APN_<CHAIN>_ARCHIVE_RPC_URL` and `APN_<CHAIN>_RECEIPT_RPC_URL` readers; no
bridge command requires either. A distinct receipt reader serves the exact
`eth_getTransactionReceipt` (and its chain identity) and nothing else; without
one, an empty or refused primary receipt is re-read through a configured archive.
The official Base `https://mainnet.base.org` reader is a known scalar-only
endpoint, so APN sends chain ID and receipt as two sequential JSON-RPC objects.
Reads pinned to a block hash or number (the native-fill balance witnesses) and
call traces use the archive reader when the owner names one, otherwise the
primary, which serves recent blocks; `requireCanonical: true` still makes the
node refuse a non-canonical hash. APN never infers an archive URL. Missing
historical data on a pruned primary surfaces as an RPC failure of that read.
Observation diagnostics
keep `explicit_archive_RPC_required`, `distinct_archive_RPC_required` and
`historical_receipt_unavailable` for old journals without exposing provider bodies or URLs.

Operators must not run a separate synthetic RPC capability preflight before the
real `bridge prepare`. The prepare command performs the exact chain, deployment,
configuration and block identity checks that its materialized operation needs.
HTTP 429 is a typed cooldown (`APN_RPC_RATE_LIMITED`) with a sanitized
`retryAfterMs`; APN does not retry it. JSON-RPC rate-limit codes (-32005, the
official Base endpoint's -32007 and -32011, and 429) are typed the same way. HTTP 408, 5xx and approved transport
timeouts may receive one retry after at least two seconds when the command
deadline still permits it. Permanent HTTP errors, JSON-RPC errors and malformed
JSON fail immediately. A command budget or deadline failure is typed and occurs
before another queued request, wait or attempt.

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

When source and destination use the same denomination, the token loss bound is
source principal minus the materialized minimum output; it includes fees and
slippage and must fit `--max-route-fee`. For a reviewed denomination-changing
native route such as Ethereum ETH to Monad MON, APN never subtracts the two
atomic units: the public operation and TTY state the ETH principal, included
ETH route-fee cap, ETH execution-fee cap and maximum total ETH debit separately
from the expected, materialized minimum and owner minimum MON output. The legacy
`token_loss_bound_atomic` receipt field is `null` for that route. These values
are projected from the fingerprinted materialization request rather than from
display-only inputs. Included token fees are counted once. Stargate's native
messaging fee must equal transaction value and one declared additional native
fee. Approval gas is a separate paid effect.

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

A native principal is carried by Across V4 between any two of Ethereum,
Base and Arbitrum One, and from Ethereum to Linea or Monad. The one reviewed Stargate
direction is Ethereum ETH to Base ETH via Taxi asset ID 13. There is no approval effect: the approval cap is zero,
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
  A reviewed ETH-to-MON conversion may use an output multiplier above one
  because the units differ; the exact multiplier equation and minimum output
  remain bound to the materialized calldata.

The route estimate must state `skipApproval: true` and must not ask for an
approval reset. Every fee row is the native coin itself (`asset: "native"`);
LI.FI's fixed fee must equal the forwarded amount. The captured Ethereum to
Base native Stargate Taxi calldata decodes with asset ID 13:
transaction value equals the source principal plus the separate LayerZero native
fee. Source observation requires `OFTSent.amountSentLD` to equal the bridge
amount rounded down to shared precision using the pinned native registry's
18 local decimals and 6 shared decimals (a 10^12 wei quantum). The frozen
calldata amount and source proof keep the raw value; the source correlation
stores the actual normalized sent value. Stored-correlation validation applies
the same exact calculation. This rule applies only to the admitted Ethereum
to Base native Taxi lane; other Stargate and Across amounts retain exact equality.
An offline destination decoder conditionally accepts the canonical
`OFTReceived` from the official Base native pool when a frozen code and
configuration pin matches historical deployment evidence at the receipt block.
The event must bind the source GUID, source EID, recipient and amount; the
decoded route and source correlation bind the destination EID and sender.
At the verified `StargatePoolNative` implementation, `OFTReceived` follows a
successful native outflow. A supplied native call trace or balance snapshot is
validated, but neither is required: the recipient may spend in the same block.
A cached failure without a successful event cannot prove delivery. The
[paired safe-block pin record](../reports/lifi-stargate-native-pins-2026-09-25.md) covers both
native pools, both LI.FI facets, code hashes, asset ID 13 mappings, address
configuration, TokenMessaging links and the executable selector. Preparation
and historical observation must verify fresh code/configuration at exact block
hashes. Live route preparation, source effect, destination delivery, receipt
recovery and paid two-chain acceptance remain outstanding. A token request can
never reuse native calldata.

Source proof replaces the three ERC-20 `Transfer` logs with the wrap: exactly
one wrapped-native log crediting the source SpokePool with the bridge amount
(`Deposit(dst)` from WETH9 on Ethereum and Base, a `Transfer` from the zero
address on Arbitrum's aeWETH), next to the unchanged `LiFiTransferStarted`,
`FeesForwarded` (token = zero address) and `FundsDeposited` checks.
Destination proof keeps the full `FilledRelay` tuple and replaces the recipient
`Transfer` with the unwrap: exactly one log of exactly the output amount from
the destination SpokePool (`Withdrawal(src)` from WETH9, or a `Transfer` to the
zero address from aeWETH). For Linea and Monad, the exact destination transaction must
also expose one bounded `debug_traceTransaction` call trace from the pinned
SpokePool to the bound profile owner for exactly the FilledRelay output. The
safe canonical transaction and block bind that trace; the previous-block to
receipt-block balance delta is corroborating evidence and cannot replace the
transaction-attributable transfer. The configured public Linea and Monad
endpoints were read-only checked on 20 September 2026 and returned `callTracer`
output. Destination deployment verification replays a pinned safe-block trace probe, so a configured
RPC without `debug_traceTransaction` support refuses the lane before execution.

Every executable LI.FI route requires an active owner allowlist admission for
the exact source asset on rail `bridge`. Across uses mechanism `{ provider:
"lifi", reference: "across-v4" }`; Stargate V2 Taxi uses `{ provider: "lifi",
reference: "stargate-v2-taxi" }`. Preparation checks the active, unexpired
policy before materialization and freezes its revision, owner, recipient,
source asset, amount and exact route mechanism. Foreground approval rechecks
that binding and reserves the amount in the shared UTC-day usage ledger before
signing. Submitted, ambiguous, finalized and confirmed-revert outcomes advance
or release that one idempotent reservation. A changed policy refuses before
signing. Provider-bound native delivery to Linea, Monad and BNB remains
self-recipient only.
Ethereum, Base and Arbitrum are the reviewed source chains. BNB Smart Chain,
Monad and Linea remain destination-only and are refused before LI.FI step
materialization when presented as a source. Route discovery from such a
source returns every otherwise reviewed row as `preparable: false` with
`source_execution_unreviewed`, and `bridge prepare` refuses that quote with the
same reason, including an otherwise intact quote saved before this gate.

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
was performed.

The matching public RPC baseline is
`tests/core/lifi-fixtures/deployment-linea-rpc-20260920.json`. It freezes Linea
block `32089068` (`0x313150b011d0f89dba2545a04c6f397482db04fdb82bca46ef8118d85f4dcae0`)
and the read-only code/configuration responses for the pinned Across SpokePool,
Linea WETH, 18 decimals, 3600-second quote-time buffer and 21600-second fill
deadline buffer.

The Monad deployment baseline is
`tests/core/lifi-fixtures/deployment-monad-rpc-20260920.json`. It freezes a
public safe block and the read-only code and configuration responses for WMON,
the Across SpokePool proxy and implementation, its 3600-second quote buffer,
21600-second fill deadline buffer, and `callTracer` capability. A prior
anonymous discovery returned a direct LI.FI/Across ETH-to-MON route, but a
20 September refresh returned no route. The deterministic tests use a
structurally valid synthetic route and do not claim current provider
availability. Live acceptance therefore still requires a fresh matching quote.

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

The frozen list bounds which identities the bridge registry may admit. Every
LI.FI execution requires the owner allowlist policy (`docs/allowlist-policy.md`,
rail `bridge`) with the exact Across or Stargate V2 Taxi mechanism pin. Prepare
freezes the policy digest and revision; approval reserves source usage in the
shared UTC-day ledger before signing and terminal state follows that
reservation without reconstructing a policy from provider data. A pre-upgrade
operation with no frozen allowlist binding remains readable, but cannot begin a
new signature or send and must be prepared again.

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

If an RPC transport fails, or an endpoint answers HTTP 408 or 5xx after its one
retry, during a pre-sign guard, nothing has been sealed, signed or sent, so the
operation is not ended. It keeps its state with reason `pre_sign_rpc_unavailable`
and adds `pre_sign_rpc_failure`. This integrity-bound record names the effect
role, source or destination chain, the finite guard stage, its category and the
exact JSON-RPC method when the transport reached one. It never stores an
endpoint, header, provider message, calldata or signing material. The next
action is `apn bridge approve` before consent and `apn operation resume` after
it; the next run repeats the full guard and clears the reason when it signs. Once
the quote has expired, that run ends the operation on the usual path:
`failed_before_effect` before any effect, or `failed_after_approval` with
`unsent_apn_reprepare_required` and the observed residual allowance after a safe
approval. A rate limit is treated the same way with `pre_sign_rpc_rate_limited`.
A timeout or rate limit on the raw send itself keeps the first-attempt rule: the
attempt is final, it is only observed and never resent. Journals written before
this change that already retain `unsent_apn_rpc_ambiguous` keep their recorded
final outcome.

Bridge journals written before the allowlist/usage-ledger upgrade remain
readable through a separate, strict legacy decoder. The decoder verifies the
original record, transition chain, intent fingerprint and receipt binding in
their historical shapes and keeps the raw durable bytes unchanged. Public
status marks the unavailable allowlist, usage lease and newer native-delivery
proof fields as `legacy_unknown`; it does not manufacture null policy pins or
ledger reservations. These records still participate in global operation ID,
idempotency and account conflict scans. They are read-only: status and a valid
saved receipt are available, while approve and resume fail closed, so a legacy
record cannot acquire/release a current usage lease or sign, submit or resend
an effect. Current journals continue to require every current schema field.

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

The four MCP tools are `apn_bridge_capabilities`, `apn_bridge_inventory`,
`apn_bridge_routes` and `apn_bridge_prepare`. They use the same catalog and
binder as the CLI. Approval is not an MCP tool: `apn_foreground_handoff` returns
only the exact foreground CLI command without reading state or entering custody. Generic
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

On 2026-09-22, repository commit
`8a2e0a56edf144690e6c7779246b0b9470acafeb` completed the Base canonical USDC
to Arbitrum canonical USDC live row. Operation
`15c26d9966e6b2e1c93656d0b6dfb75f9d85fa6541d7f4a970154edccdea9497`
recorded one source submission attempt in transaction
`0x2aee1da1c335d6b555f6a873205b871af3c73ed724568479006487349d3ee448`
and safe destination delivery in transaction
`0x2e81c54e5d99f876f3f0bbfdd4c1fdc1dc465a48dfc6dfebb91e744ea477253c`.
The durable receipt correlated 149,610 atomic USDC delivered from a 150,000
atomic source debit, 390 atomic total token loss, a 3,153,012,738,511 wei
source network fee, zero residual allowance and finalized usage. Its terminal
proof is `rpc_safe_correlated` / `delivery_correlated`.

| Required real mainnet acceptance | Status |
| --- | --- |
| Ethereum to Base canonical USDC | OPEN |
| Base to Arbitrum canonical USDC | ACCEPTED (2026-09-22) |
| Arbitrum to Ethereum canonical USDC | OPEN |
| Arbitrum to Ethereum WBTC | OPEN |
| Named human receiving acceptance | OPEN |

This acceptance closes only the Base-to-Arbitrum canonical-USDC row. The two
remaining canonical-USDC rows need fresh action-time quotes, at least two
selectable executable alternatives in the EVM family, explicit
account/amount/fee and recovery authority, independently verified transactions
on both chains and a durable APN receipt. The latest Arbitrum-to-Ethereum
canonical-USDC route was blocked by the provider deadline before an APN
operation or effect, so it remains open; Arbitrum-to-Ethereum WBTC and named
receiving-human acceptance also remain open. Wallet/provider setup, funding,
real transactions and public release are separate actions. Existing
direct-transfer and x402 state formats remain unchanged; this implementation
uses separate bridge stores without a migration.

On 28 Sep, the buyer's active r25 policy included a 0.00075 ETH per-operation
and daily Across Ethereum→Arbitrum native cap (29 total admissions, expiry
15 Oct 2026). A fresh route had an indicative minimum of about
`743603416950766 wei`, which was not an APN reservation or delivery. An old
expired lock was locally retired `failed_before_effect`. Subsequent archive
capability failures and a role-swapped prepare that stopped on HTTP 525
during primary Ethereum reads (three physical attempts including built-in 5xx
retry; exact failing origin not recorded) created no bridge operation or effect.
A later isolated Llama Ethereum batch returned HTTP 525; Arbitrum PublicNode
returned chain ID 42161 and a safe block. Anonymous PublicNode historical Arbitrum code
required a token and Llama Ethereum code returned JSON-RPC `-32602`; recent
Ethereum PublicNode safe-block code reads did work, while official Arbitrum
historical capability remained unverified. Arbitrum→Ethereum canonical USDC,
WBTC and named-recipient acceptance remain open.

## Removed offline inspectors

Earlier versions carried offline parsers that no CLI command or MCP tool ever
reached: the LI.FI-shaped Base to Solana destination candidate, the Mayan MCTP
quote, source-receipt and provider-status inspectors, the NEAR-via-LI.FI Base to
TRON kernel, the dormant non-EVM bridge operation, and the Circle CCTP V2
source-receipt, Iris and Solana destination inspectors. They were deleted
because nothing reachable from `apn` or `apn mcp serve` used them (checked with
an import and call graph built from the TypeScript compiler API). The live
Circle V2 Base to Solana source submission and the direct NEAR 1Click lanes are
unchanged, and the source journal still reads every record a released version
wrote (`apn.non-evm-source-journal.v3`).

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
send result is recorded as `unknown_finality` and never resent. Over MCP, submit
is reachable only through `apn_foreground_handoff`, which returns
`APN_FOREGROUND_APPROVAL_REQUIRED` with the exact CLI command; status is a read-only tool.

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

A signed source with no receipt (sealed, submitting, submitted or
`unknown_finality`) ends `failed_proven_superseded` through status once the
payer's nonce at the `finalized` tag is past the source nonce while a node whose
transaction index reaches the source block pinned before signing knows neither the
transaction nor a receipt (the record keeps `finalizedNonceAtomic`). A nonce that is
not past keeps it open. A deposit that
lands late, even after the quote deadline, is still observed as
`source_observed`: the deposit address is 1Click's, the quote is dead, and 1Click
refunds such a deposit to the payer (the refund address); its status is reported
as provider data and no destination proof is claimed. The payer's account is
released by the operation index at the deposit deadline plus 10 minutes even
before an outcome: a signed source has one fixed nonce, so it and any later
transaction at that nonce cannot both land, and that release is what lets a later
transaction take the nonce the never-lands proof needs. Like every nonce-moved
exit, the proof counts a missing transaction only from a node that indexes the
operation's era: after the first batch it reads the pinned block's transaction count
and first transaction (block data, never the whole body) and, in one deciding batch
with the nonce and both lookups, asks the node for that transaction by hash. A node that pruned its transaction index (geth
`--history.transactions`) does not return it, so nothing is proven and the source
stays open for a receipt or the owner's abandon.

`apn circle approval status --operation <id>` ends an approval without a safe
receipt the same way (`failed_proven_superseded`, read on `APN_BASE_RPC_URL`).
The approval holds the payer's account until then, so no other APN operation
takes that nonce; once the preparation expired, `apn operation abandon
--operation <id>` ends a possibly sent approval `abandoned_unknown` behind TTY
consent (it may still land and set the allowance).
Its `allowance` field says what the approval leaves: a completed approval leaves
the Base USDC allowance it set for the Circle V2 TokenMessengerWithFees wrapper,
which `apn circle source submit` spends. A burn spends the principal plus
Circle's fee, so whatever the approval granted beyond that stays on the
wrapper. The `apn operation status` that records a source burn's finalized
receipt reads that residual allowance once, at the same finalized head, and
stores it beside the journal with its block (`residualAllowance`); later
statuses show the stored value and read no chain, unless the caller passes
`--refresh-allowance` or nothing is stored yet (an unreadable value is shown as
`null` with its reason, never guessed). When it is above zero the status names
`apn circle approval revoke --profile <profile> ...`: the same approval family with a zero cap, prepared
unsigned, confirmed in the foreground by `apn circle approval execute`, sent
once and observed by `apn circle approval status` (Approval event with value 0
and a fresh zero allowance). A completed revoke sets the payer's stored
residuals to 0 at its own fresh-read block, without another read. Revoke
refuses when the allowance is already 0.
Every other outcome changed no allowance.

The same status settles the burn's hold on the payer's Base USDC daily cap.
A successful burn becomes a finalized spend counted on the UTC day its
finalized receipt was recorded (never before the hold's last write, never
after this status), so it no longer counts against later days. A reverted burn moved no
USDC and releases its hold. Every status of a recorded burn repeats the
settlement, so an interrupted one completes on the next status, and the result
shows the hold as `sourceUsage`. Only the hold this operation reserved, for the
principal of its own burn call, is touched; a burn without a recorded receipt
keeps its hold.

After a successful burn the same status follows its delivery on Solana. Circle's
forwarding service receives the message there; APN only reads. It asks Circle's
pinned issuer API for the burn's message (`/v2/messages/6?transactionHash=`),
bound to this burn by domains 6 to 5, Base USDC, the journal's messenger,
recipient token account and principal. Once Circle reports `forwardState`
`COMPLETE` with a `forwardTxHash`, it reads that transaction at `finalized` on
`APN_SOLANA_RPC_URL` only (no default endpoint; without the setting the status
names it). The transaction must have succeeded, called MessageTransmitterV2
(`CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC`), written that message's
`used_nonce` account and credited the recipient's USDC account with exactly the
principal minus Circle's executed fee. Then it is recorded once beside the
journal (`<operation>.solana-delivery.json`) and `phase` reads `delivered`;
later statuses read nothing. Until then `phase` is `source_finalized` and
`delivery.state` names the step still awaited (`awaiting_issuer_message`,
`awaiting_attestation`, `awaiting_forward` with Circle's `forwardState`,
`awaiting_solana_rpc`, `awaiting_solana_finality`). A reverted burn shows
`source_reverted` and reads no delivery. The journal itself is never rewritten:
its own phase stays under `journal.phase`.

## Stargate fee refusal and funding checkpoint, 2026-10-08

A correctly reconciled Stargate LayerZero fee above `maxNativeDebitWei` is now
classified as `APN_FEE_BUDGET_EXCEEDED` (`stargate_native_fee_exceeds_cap`). ABI,
Taxi semantics, refund identity and declared fee rows must validate first;
malformed bindings remain `APN_PROVIDER_PROTOCOL`. Equality at this decode
stage does not cover approval and bridge gas: preparation still checks the
aggregate native debit independently. No cap or execution admission changed.
Source/test compilation and 48 focused tests passed; 744 production JS matched
test emission after removing only the terminal TypeScript source-map comment.

A fresh normal Arbitrum→Ethereum canonical USDC preparation (100000 atomic
input, owner minimum 99000, native cap 680000000000000 wei) refused before
operation creation: aggregate native debit 825421587693206 wei, available
699562158869357 wei. No approval or bridge was signed or submitted. This lane
remains open pending bounded funding and its own correlated SAFE receipt.

Separate normal Across funding completed at 08:02:27 UTC: operation
`bec13b5a51d755eca9b6d7f93c9bf55e9ca50962f4d370d2e4ae749bdc990394`,
Ethereum source `0x38dbcf06888fdf9427406ef7686d2496e24f8d38fc3f4d73bec3f78e9ca2abb3`,
Arbitrum destination `0x608d8737634f4301f81970b79d6f9f3c8cc4b98c27c72d35b8d1721cfd1647de`.
Principal 400000000000000 wei, exact delivery 394497813408405 wei, actual
source gas 17239614285600 wei. Both chain proofs are SAFE; residual allowance
is zero and submission attempts remain one. A failed residual observation
was retried through normal `operation resume`, without resending.


## Fresh account reads within a bridge invocation, 2026-10-08

`BridgeRpc.account()` now reacquires the moving latest block and priority-fee
suggestion on every call. Approval inclusion or foreground consent can change
confirmed nonce, allowance, balance and fees within one invocation. Exact
block-pinned reads retain caching; financial caps, executable pins, send fences
and RPC budgets remain unchanged. A retained red control returned the previous
block after modeled approval inclusion. Both builds and 287 tests in 16 LI.FI
files passed, with all 1140 inputs unchanged and all 744 production JS matching
test emission. This latent cache defect does not establish the cause of an
earlier live RPC refusal whose precise transport failure was not retained.

A second Across native funding operation
`0d640f8a9a5dbb35eed4caaa36be8f143c1c2bf3c2021f1fd06c911b4221bda3`
completed through normal installed observation at 08:32:33 UTC. Principal
200000000000000 wei, exact Arbitrum delivery 195027287246397 wei, source gas
18817999880121 wei; source and destination proofs are SAFE, allowance zero,
submission attempts one and usage finalized. Native funding does not prove a
USDC bridge. Explicit Arbitrum receipt configuration uses the official
`https://arb1.arbitrum.io/rpc` reader after a retained PublicNode HTTP 403;
the frozen primary RPC origin remains unchanged.

## Base native Across observation budget, 2026-10-08

The canonical source transaction and complete Base fee proof consume ten POSTs.
The subsequent exact historical deployment proof previously exhausted the fixed
14-request source budget. Base native Across now uses the existing reviewed
Multicall path, while retaining every code/configuration check, exact historical
block binding, reviewed Multicall bytecode and `allowFailure: false`. Other
Across assets and chains retain their previous path. No executable identity,
financial cap, custody/sign/send rule or RPC budget changed.

A live read-only production-adapter observation and historical deployment proof
passed in 13 POSTs with unchanged frozen hashes and journal bytes. This is not
the normal installed terminal receipt. The retained pre-fix control fails the
14-request limit; configuration and Multicall-code mutations still refuse.
Both builds and 290 tests in 17 LI.FI files passed, with all 1142 inputs unchanged,
all 744 production JS matching test emission and the 500-line source check passing.
Cold Ethereum-to-Base native preparation now uses 16 rather than 19 POSTs;
archive chunks remain at most three items, and the shared physical cap remains 24.

Separately, normal installed Arbitrum-to-Ethereum canonical USDC operation
`7e509318bdc0933075eaff099e906cbf46c148250224ba0a56c5282d7ab8602c`
completed at 09:25:11 UTC with correlated SAFE source and destination proofs:
100000 atomic input, 99683 exact output, zero residual allowance, one bridge
submission and finalized usage. Existing SAFE approval was reused. The earlier
approval-only failure retains its own receipt and was never resent.

Normal CLI from the fresh d606b71f installation completed the existing Base-to-
Ethereum Across funding operation at 10:39:50 UTC: both proofs SAFE, exact
delivery 177003711461142 wei, actual source fee 899986077215 wei, zero residual
allowance, one send and finalized usage. The first fixed observation retained
both proofs before the unchanged shared POST cap stopped residual observation;
a subsequent normal resume completed the same operation without resending.

Ethereum-to-Base canonical USDC operation
`1a22ff7f91898188f3aaec67f1783d6c2e8292b04f3881585eff51dafe784add`
completed at 10:47:20 UTC with correlated SAFE proofs: 100000 input, 99689 exact
output, owner floor 99000, residual allowance zero and one bridge submission.
Source gas 85529811980376 wei plus messaging value 191812223813721 wei totals
277342035794097 wei, below the frozen 590000000000000-wei native cap. Existing
SAFE allowance was reused without another approval. Canonical-USDC delivery
across the three required directions is now evidenced; WBTC remains separate.

## Source observation budget derived from read plans, 2026-10-16

The source observation request cap was a hand-counted constant (15 on Base, 14
elsewhere) modelled on the compact Base native route. Base canonical USDC Across
is not compact: its historical deployment proof sends eight archive chunks after
the fee proof, so the exact sequence needs 18 POSTs, 19 with a scalar or fallback
receipt read, and every resume after a paid approval failed with
`APN_RPC_BUDGET_EXCEEDED`. The cap is now counted from the same deployment and
Base fee read plans the adapter sends (seven canonical requests, fee chunks, then
deployment chunks after exact cache reuse), plus two retry attempts. Base USDC
Across needs 19 and Ethereum USDC Stargate 16; no check, chunk size or the shared
24-POST invocation cap changed. Tests compare every admitted source route and
receipt route with its production trace.

The destination observation cap, a fixed 16, is counted the same way from the
destination deployment plan, plus five requests for a provider-bound native
delivery (pre-delivery header, archive chain identity, two hash-pinned balances,
trace). Ethereum or Arbitrum to Base USDC Across needs 17 with a scalar Base
receipt reader and the Ethereum to BNB composite needs 19; both previously failed
after the principal had left. Every admitted destination is tested the same way.

The step that signs and sends an unsent effect is counted from the guard's read
plans too: per chain a safe head and its deployment chunks, two account batches,
a second guard's two account batches after sealing and the raw send, plus two
more account batches when a foreground approval runs it. The 24-POST invocation
cap is raised to that step plus four retry POSTs: Base USDC to Arbitrum Across
sends at POST 24 of 28 (it had been 24 of 24), and its foreground approval step
fits in 30. Guards, the sign-before-send room check and continuation caps are
unchanged; an exhausted budget still stops before signing and resumes cleanly.

A provider rate limit during a pre-sign guard is not terminal. Nothing is sealed,
signed or sent; the operation keeps its state with reason
`pre_sign_rpc_rate_limited` and `apn operation resume` as next action, and the
next resume repeats the full guard (an expired quote then ends on the usual
`failed_after_approval` / `unsent_apn_reprepare_required` path). Deterministic
refusals (identity, deployment, fee, allowance, nonce, balance) keep their
terminal outcomes; a transport failure or HTTP 408/5xx in the guard is recoverable
in the same way (`pre_sign_rpc_unavailable`, see the pre-sign RPC section).
Source, destination and residual observation already keep any RPC failure,
including rate limits, recoverable.

## Finite Base to Mega native funding

`apn mega funding prepare`, `approve` and `status` use an independent GasZip
journal and mechanism pin. They preserve existing Sei operation hashes and do
not enable LI.FI GasZip execution. Any local profile may use it: the payer is the
profile's own wallet, `--expected-payer` must equal it, and the deposit pays that same
address on Mega (SELF). The route is Base source chain 8453 to Mega destination chain
4326. The direct target is the official EOA `0x391E7C679d29bD940d63be94AD22A25d25b5A604`,
whose code must be empty; calldata is exactly `0x010202` (short 514). The amount is the
caller's `--amount-atomic`, bounded by the admission's per-transfer and daily caps.
The owner's Base network fee ceiling includes L1 and operator
fees. A fresh balance must cover the frozen signed envelope's full fee upper
bound even when a later estimate is lower.

The active Base native bridge policy must admit
`{ "provider": "gaszip", "reference": "v2-direct-base-mega-self-010202.1" }`. An owner
`recipients` pin on that admission must list the payer, because the payer is the recipient.
`APN_BASE_RPC_URL` and `APN_MEGA_RPC_URL` must be public HTTPS RPC URLs. Production
Mega mainnet RPC is `https://mainnet.megaeth.com/rpc`; chain identity and safe
receipt inclusion are independently checked. Minimum delivered Mega ETH is the
owner's floor. This floor is checked during acceptance; the source
calldata cannot enforce it. Quote expiry, owner binding, custody, usage and
shared Base owner conflicts are checked before the single signature/send attempt.

```sh
apn mega funding prepare --profile <profile> --expected-payer <profile-wallet-address> --amount-atomic 10000000000000 --minimum-output-atomic 8000000000000 --maximum-fee-atomic 1000000000000 --idempotency-key mega-self-funding-01
apn mega funding approve --operation <operation-id>
apn mega funding status --operation <operation-id>
```

Schema `apn.mega-gaszip-operation.v1` and create-only signing/send claims are
separate from Sei. Status never resends. Unknown source or provider delivery
outcomes keep the principal hold. Completion requires the exact source
transaction and safe receipt, a provider deposit mapping bound to that source
hash/block/value/owner/short 514, and one confirmed non-refund Mega outbound.
The outbound is independently checked for native value, sender/nonce, recipient,
canonical safe receipt, empty recipient code and exact native credit; its hash
can be claimed by only one Mega funding operation. Missing or changed provider
correlation fails closed. Funding evidence does not establish USDm acquisition,
a merchant payment or HTTP delivery.

Protocol references: [GasZip direct forwarder](https://dev.gas.zip/gas/code-examples/evm-deposit/direct-forwarder),
[quote API](https://dev.gas.zip/gas/api/quote) and
[deposit API](https://dev.gas.zip/gas/api/deposit). Fresh unsigned RPC and quote
reads are separate from synthetic tests and actual funding acceptance.

Historical native-fill before/after balances are pinned to a nonzero EIP-1898 block hash with `requireCanonical: true`; they use the archive reader when one is configured and the primary otherwise. Primary canonical receipt/header witnesses remain required. Archive chain validation, provider pacing and command/session request limits still apply.

## Phase 1 cleanup, 2026-10-16

- **RPC endpoints.** Operations bind the chain, not the endpoint URL. Every read
  checks `eth_chainId`; inclusion and safe proofs are compared without their
  `rpcOrigin`, which stays informational. Records written by 0.5.40/0.5.41 load
  unchanged.
- **Observation telemetry.** A poll that changes only read telemetry adds no
  journal transition, and a transition keeps at most the latest 8 telemetry
  rows. A 0.5.41 journal with a long telemetry history loads and compacts on its
  next real change.
- **Invocation cap.** The per-pair WBTC and USDC continuation caps are gone. Each
  invocation's physical cap is derived from the operation's read plans: the
  sign-and-send step when an effect is unsent, plus one source observation, one
  destination observation and the residual read (at least the base 24). An
  exhausted read budget defers to the next resume and never records
  `unknown_finality`.
- **Residual allowance.** A proven delivery records a zero residual allowance at
  the safe bridge block without a read: the exact-amount allowance was consumed by
  the proven exact source `Transfer`. On the failure paths an unavailable read is
  reported as `residual_allowance_status: unavailable` and never blocks the
  terminal state.
- **Effect claims.** Every LI.FI route writes create-only SIGN and SEND claims
  outside the operation and usage journals. The same claim again is the same
  effect; a different one is refused. A SEND claim the journal has not recorded
  (an interrupted send step or a restored journal) is recorded as an attempt from
  the sealed material and observed, never sent again. Only a SEND claim blocks
  ending an expired unsent remainder.
- **Interrupted seal.** An effect left at `signing_started` with no sealed
  material and no SEND claim signed and sent nothing. Resume returns it to
  `unsealed`, runs the full guard again and re-signs the identical envelope
  (RFC 6979 gives the same bytes), or ends it on the expiry path.
- **GasZip.** Every outcome ends: signed bytes that were never sent, a definite
  JSON-RPC refusal, a guard that refused before transport, or an unlanded hash
  whose nonce the safe head already moved past end as `failed_before_effect`
  (bytes scrubbed, hold released); a cancelled or refunded deposit or a proved
  payout below the owner floor ends as `destination_failed` (spend kept); an
  actual Base fee over the quote ceiling is reported as `feeCapExceeded`. The
  nonce-moved exit trusts the node's transaction lookup: a node that pruned its
  transaction index (about 54 days of Base blocks) could report a very old
  landed deposit as absent.
- **NEAR 1Click.** A nonce sealed by an earlier operation refuses a new submit
  before consent, and is released once that operation's deadline passed and the
  node does not know its hash. After consent the Base lane only requires the
  signed max fee to cover the fresh base fee plus the signed tip. `status`
  records the safe source receipt and the finalized destination proof and then
  answers from the journal; the Base USDC to TRON USDT lane proves delivery like
  the other lanes.

## Public-RPC diet, 2026-10-17

Every bridge command now works on keyless primary endpoints alone; the archive
and receipt readers are optional. The safety properties are unchanged: exact
calldata decoding, the exact-amount allowance to the fixed Diamond, the nonce,
fee and debit caps, a fresh simulation before signing and again before the one
send, the durable sign and send markers, canonical receipt membership, log
proofs from the registry's emitters and the safe head before success.

- **Deployment check.** One light check per invocation, read in the same batch
  as the account at the `latest` head the transaction executes against: the
  Diamond's selector routing and fee-forwarder whitelist, the facet's protocol
  binding, the spoke's time buffers, Stargate routing and owner-settable token
  fees. Code hashes, implementation/admin/beacon slots, the fee forwarder's
  owner and the Base fee predeploys are no longer pinned; they change on
  legitimate upgrades. A destination reads nothing before the send except the
  BNB composite's routing configuration. The identity frozen at prepare is a
  record; the guard checks the reviewed pins directly. Within one invocation the
  re-check right before the send reads only the account batch; consent resets it.
- **Observation.** One batch of transaction, receipt and safe head, then the
  inclusion header (in the same batch on a re-poll). No deployment re-proof after
  the money moved, no header recheck after hash-pinned reads. Base fees come
  from the receipt (`l1Fee` and the Jovian operator fee fields); proofs written
  with the legacy oracle evidence keep validating and compare equal by inclusion.
- **History.** Only the native-fill balance witnesses and call traces need
  history; they use an owner-named archive and otherwise the primary.
- **Budgets.** Each session cap and the invocation cap are derived from these
  plans with explicit retry headroom; the invocation counter no longer adds a
  global 750 ms gap (each provider family keeps its own).
- **dRPC.** Its keyless plan refuses batches over three requests, so a
  `*.drpc.org` endpoint gets each logical batch in three-item chunks, counted once.

Measured POSTs for one Base USDC → Arbitrum USDC Across bridge through the
production adapter (`tests/core/lifi-public-rpc-lifecycle.test.ts`):

| Step | 0.5.42 (archive configured) | Now (primary only) |
|---|---|---|
| prepare | 21 (17 archive) | 2 |
| approve (approval guards and send) | 30 (18 archive) | 5 |
| resume: bridge guards and send | 43 (29 archive) | 6 |
| resume: both effects included | 18 (12 archive) | 3 |
| resume: source safe | 19 + 23 (two resumes) | 3 |
| resume: destination proof | 13 (7 archive) | 2 |
| **total** | **167 (108 archive), 7 invocations** | **21 (0 archive), 6 invocations** |

Other routes: Ethereum USDC → Arbitrum continuation after a paid approval 35 → 7;
WBTC Ethereum ↔ Arbitrum continuation 32/33 → 6; Base USDC → Arbitrum send step
24 → 3; captured mainnet Base native Across observation 13 → 4; Linea native fill
destination observation 11 → 7; a Circle approval state read about 25 → 1.

GasZip (Sei, Mega): a payout is proved from the chain alone (exact signed payout,
successful receipt with empty input and no logs at or below the safe head, block
membership, and an owner without code), with no historical balance delta: 11 →
6 POSTs per completed status. The source plan drops its header recheck (one POST
per prepare and approve), counts a nonzero Base operator fee instead of refusing
it, and no longer applies lane constants (30k gas, 0.1 gwei, global fee, floor and,
for Sei, amount caps) on top of the owner's ceiling, floor and asset policy.
Provider responses must carry their required fields; fields GasZip adds later are ignored.

## Empty route lists name the provider's answer (QA 0.5.51)

APN drops no route LI.FI returns: every route in the `POST /v1/advanced/routes`
answer is listed, preparable or with its gate. An empty `routes` list is
therefore LI.FI's own answer to the exact request APN sent, and `bridge routes`
(CLI and MCP alike) now adds `no_route`: the provider, endpoint, CAIP-2 chains,
tokens, atomic amount, the tools APN allowed (`across` and `stargateV2` with no
exchange and no destination call; for the reviewed Ethereum ETH to BNB composite
`across`, `fly` and a destination call), whether LI.FI sent `unavailableRoutes`,
and its `filteredOut` and `failed` rows (path, step, tool, error type, code,
message), at most eight of each, control characters stripped, each field at most
240 characters. A response with routes is unchanged.

QA rows BRIDGE-LIFI-008/009 (0.001 and 0.01 ETH): for Ethereum ETH to Monad MON
both captures have `response_hash`
`fadee8ede726896cd8294347660b236e767470485f59a014fff4447794395635`, the sha256 of
`{"routes":[],"unavailableRoutes":{"filteredOut":[],"failed":[]}}`, and a keyless
replay on 2026-10-20 returned the same bytes: LI.FI offers no direct Across or
Stargate fill of native MON from ETH and reports nothing it filtered or failed.
With exchanges open it routes ETH through a swap on Ethereum, Across and a
KyberSwap swap on Monad, a graph APN has not reviewed. For BNB the two QA
responses differ (`92d92a74…`, `2c250823…`) and were not captured; on
2026-10-20 the same request returned the reviewed across+fly composite at
0.001 ETH (APN's parser admits it as preparable) and no route at 0.01 ETH, where
LI.FI reported three failed paths, each "Tool fly not applied."
(`TOOL_NOT_ALLOWED`) on its fly step. Both are provider conditions.

