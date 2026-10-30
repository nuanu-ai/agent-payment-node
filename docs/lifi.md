# LI.FI EVM cross-chain assets

APN moves value between EVM chains through LI.FI with two bridge protocols, Across V4 and Stargate V2 Taxi. The
same rail hosts three direct lanes that do not execute through LI.FI: GasZip native funding of Sei and Mega, NEAR
Intents 1Click deposits to TRON and Solana, and status observation of the Circle CCTP V2 Base USDC to Solana burn.

| Commands | What they do | Effect |
| --- | --- | --- |
| `bridge capabilities`, `bridge inventory` | Offline capability rows; anonymous LI.FI inventory | Read only |
| `bridge routes`, `bridge prepare`, `bridge approve` | Find, freeze and approve one LI.FI route | `approve` signs and sends |
| `sei funding *`, `mega funding *` | GasZip direct Base ETH to the owner's own Sei SEI or Mega ETH | `approve` signs and sends |
| `oneclick source submit`, `oneclick source status` | One deposit on a pinned NEAR 1Click lane | `submit` signs and sends |
| `circle approval *`, `operation status` | Circle Base to Solana approval exits, residual allowance and delivery status | `approval execute` signs and sends |
| `operation status`, `operation resume`, `receipt get` | Recovery and receipts for bridge operations | Never resends |

Every effect needs foreground consent in a terminal. Recovery observes; it never signs a replacement or resends.

## Profiles

| Profile | Custody and execution | Bridge availability |
| --- | --- | --- |
| `local` | Existing local EVM wallet; APN signs and observes | Available for the routes below, subject to current quote, deployment, funding and approval checks |
| `metamask-smart-account` | Delegated owner/session | Unavailable; existing grants do not authorize LI.FI effects |
| `metamask-agent-wallet` | Provider custody and execution | Unavailable; no bridge execution and recovery contract |
| `coinbase-awal` | Provider custody and execution | Unavailable; no bridge execution and recovery contract |

No profile silently falls back to the local signer. Provider inventory is informational: a chain, token or tool that
LI.FI lists does not make it executable in APN. Solana and TRON bridge directions through LI.FI, Stargate Bus, Polymer,
Glacis, Mayan, LI.FI Intents, LI.FI's `gasZipBridge` tool and every other bridge tool are not executable.

## Configuration

### RPC endpoints

Each chain is configured explicitly. There is no default endpoint for these commands, and the generic EVM `--rpc-url`
option is not a fallback for bridge operations.

| Chain | CAIP-2 | Variable | Used for |
| --- | --- | --- | --- |
| Ethereum | `eip155:1` | `APN_ETHEREUM_RPC_URL` | Bridge source and destination; 1Click Ethereum lanes |
| Base | `eip155:8453` | `APN_BASE_RPC_URL` | Bridge source and destination; GasZip source; 1Click Base lane; Circle approval and burn |
| Arbitrum One | `eip155:42161` | `APN_ARBITRUM_RPC_URL` | Bridge source and destination |
| BNB Smart Chain | `eip155:56` | `APN_BNB_RPC_URL` | Bridge destination only |
| Monad | `eip155:143` | `APN_MONAD_RPC_URL` | Bridge destination only |
| Linea | `eip155:59144` | `APN_LINEA_RPC_URL` | Bridge destination only |
| Sei | chain 1329 | `APN_SEI_RPC_URL` | GasZip destination |
| MegaETH | chain 4326 | `APN_MEGA_RPC_URL` | GasZip destination (MegaETH's public RPC is `https://mainnet.megaeth.com/rpc`) |
| TRON | | `APN_TRON_RPC_URL` | 1Click destination proof |
| Solana | | `APN_SOLANA_RPC_URL` | 1Click destination proof; Circle delivery proof |

Bridge and GasZip RPC URLs must be public HTTPS without URL credentials, query parameters or fragments. APN verifies
the exact chain ID on every read, pins resolved public addresses, uses default TLS verification, and requires
hash-pinned state and safe blocks. Operations bind the chain and block hashes, not the endpoint: the RPC origin is
recorded for reference only, so a failing endpoint can be replaced while an operation is in flight.

Optional readers exist for each bridge chain (`ETHEREUM`, `BASE`, `ARBITRUM`, `BNB`, `MONAD`, `LINEA`):

- `APN_<CHAIN>_ARCHIVE_RPC_URL` serves historical reads: the native-fill balance witnesses pinned to a block hash and
  call traces. Without it the primary serves them, which works for recent blocks; a pruned primary surfaces as an RPC
  failure of that read. APN never infers an archive URL.
- `APN_<CHAIN>_RECEIPT_RPC_URL` serves only `eth_getTransactionReceipt` (and its chain identity). Without it, an empty
  or refused primary receipt is re-read through a configured archive.

No bridge command requires either reader. Every bridge command works on keyless primary endpoints alone.

LI.FI is reached at the fixed origin `https://li.quest/v1`. Set `APN_LIFI_API_KEY` to send authenticated requests; the
key is used only for that API base.

### Owner allowlist policy

Every executable route needs an active, unexpired owner allowlist admission (see [allowlist-policy.md](allowlist-policy.md))
for the exact source asset on rail `bridge`, naming the exact mechanism:

| Route | Mechanism |
| --- | --- |
| LI.FI Across V4, including the Ethereum to BNB composite | `{ "provider": "lifi", "reference": "across-v4" }` |
| LI.FI Stargate V2 Taxi | `{ "provider": "lifi", "reference": "stargate-v2-taxi" }` |
| GasZip Base ETH to Sei SEI | `{ "provider": "gaszip", "reference": "v2-direct-base-sei-self-0100f6.1" }` |
| GasZip Base ETH to Mega ETH | `{ "provider": "gaszip", "reference": "v2-direct-base-mega-self-010202.1" }` |

The GasZip admissions are Base native bridge admissions; an owner `recipients` pin on them must list the payer, who is
also the recipient.

Preparation checks the policy before materialization and freezes its digest, revision, owner, recipient, source asset,
amount and mechanism. Foreground approval rechecks that binding and reserves the amount in the shared UTC-day usage
ledger before signing. Submitted, ambiguous, finalized and confirmed-revert outcomes advance or release that one
idempotent reservation; terminal state follows the reservation without reconstructing a policy from provider data.
A changed policy refuses before signing (`allowlist_policy_changed`); prepare a new operation.

## Supported chains and assets

### Directions

Ethereum, Base and Arbitrum One are source chains. BNB Smart Chain, Monad and Linea are destination-only: they are
reached only from Ethereum with native ETH, and the recipient must be the profile owner's own address
(`bridge_self_recipient_required`). A destination-only chain presented as a source is refused before LI.FI step
materialization: `bridge routes` returns every row as `preparable: false` with `source_execution_unreviewed`, and
`bridge prepare` refuses the quote with the same reason, including a quote saved earlier.

### Native coins

A native coin is a first-class registry row, not a token with a sentinel address. Name it `native`
(`--from-token native --to-token native`). The provider's zero-address wire sentinel is never accepted as operator
input and is never a token. The native coin pays gas and Stargate's LayerZero messaging fee, and is a bridgeable
principal on these lanes:

| Chain | Native coin | Wrapped native pinned for Across | Native principal lanes |
| --- | --- | --- | --- |
| Ethereum | ETH, 18 decimals | WETH9 `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, code hash | Across to Base, Arbitrum, Linea, Monad (ETH to MON) and BNB (composite); Stargate Taxi to Base |
| Base | ETH, 18 decimals | WETH9 predeploy `0x4200000000000000000000000000000000000006`, code hash | Across to Ethereum and Arbitrum |
| Arbitrum One | ETH, 18 decimals | aeWETH `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`, EIP-1967 proxy | Across to Ethereum and Base |
| Linea | ETH, 18 decimals | WETH9 `0xe5D7C2a44FfDdF6b295A15c148167daaAf5Cf34f`, code hash | Destination from Ethereum |
| Monad | MON, 18 decimals | WMON `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`, code hash | Destination from Ethereum |
| BNB Smart Chain | BNB, 18 decimals | WBNB `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`, code hash | Destination from Ethereum (composite) |

Native principal over Stargate is admitted only from Ethereum ETH to Base ETH (pool asset ID 13); other directions
return `asset_tool_unreviewed`.

### Token rows

| Chain | Token | Decimals | Address | Contract shape | Tools | Peers |
| --- | --- | --- | --- | --- | --- | --- |
| `eip155:1` | USDC | 6 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | legacy proxy | Across, Stargate pool 1 | Base, Arbitrum |
| `eip155:8453` | USDC | 6 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | legacy proxy | Across, Stargate pool 1 | Ethereum, Arbitrum |
| `eip155:42161` | USDC | 6 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | legacy proxy | Across, Stargate pool 1 | Ethereum, Base |
| `eip155:1` | USDT | 6 | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | immutable; fee fields pinned at zero | Across | none |
| `eip155:1` | WBTC | 8 | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | immutable | Across | Arbitrum |
| `eip155:42161` | WBTC | 8 | `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f` | beacon proxy (beacon `0xE72ba9418b5f2Ce0A6a40501Fe77c6839Aa37333`, implementation `0x3f770Ac673856F105b586bb393d122721265aD46`) | Across | Ethereum |

Both sides of a route must be admitted rows of the same kind with the same pair key, the same decimals, and each other
in their peer sets (`admitted_asset_pair`). Peer sets are asymmetric on purpose: Base has no canonical WBTC, so no WBTC
direction touches Base. A row with no peer is refused as `asset_has_no_listed_peer`.

**USDT on Ethereum.** The row is admitted with the storage a code hash cannot see: every deployment check requires
`basisPointsRate()`, `maximumFee()` and `deprecated()` to be zero, so a switched-on transfer fee or a deprecation
forward fails closed. Tether's `approve` returns no value and reverts a nonzero approve over a nonzero allowance; APN
never reads the return value (it proves the approval by the exact `Approval` log and the observed allowance) and only
approves exactly the principal from a zero allowance, or uses an exact existing allowance. LI.FI's `approvalReset` flag
is accepted only for this row and never acted on. The row has no peer, so every USDT route is refused before any
provider call; admitting one needs a listed USDT destination on an admitted chain.

### The frozen allowlist binds the registry

Every native coin and every token row except WBTC must equal an entry of the frozen allowlist dataset
(`data/allowlist/2026-09-17/dataset.json`): chain, kind, contract, symbol and decimals. APN checks this before admitting
any route leg and treats a drift as an installation fault. An address the list does not name is refused as
`asset_not_on_frozen_list` and is never matched by symbol; a listed address without a bridge row is refused as
`asset_listed_not_bridge_admitted`. WBTC predates the list and stays a `legacy_pinned` row with its own pins.

### Quote-only destinations

Ethereum USDC to four further USDC deployments named by the frozen list can be discovered and decoded offline, but not
executed. Every returned row is `preparable: false` with `destination_execution_unreviewed`; `bridge prepare` refuses
it before opening any destination RPC, and no approval or send path exists. A tool not listed for the destination
returns `destination_tool_quote_unavailable`.

| Destination | USDC | Tools |
| --- | --- | --- |
| OP Mainnet (`eip155:10`) | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | Across V4, Stargate V2 Taxi |
| Polygon PoS (`eip155:137`) | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | Across V4 |
| Avalanche C-Chain (`eip155:43114`) | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | Stargate V2 Taxi |
| Unichain (`eip155:130`) | `0x078D782b760474a361dDA0AF3839290b0EF57AD6` | Across V4 |

The decoders check the same `swapAndStartBridgeTokensViaAcrossV4` (`0x1794958f`) and
`swapAndStartBridgeTokensViaStargate` (`0xa6010a66`) envelopes, exact chain and token identities, fee forwarding and
Taxi endpoint IDs, and reject altered calldata or fees.

### Assets refused rather than approximated

| Asset | Why it is refused |
| --- | --- |
| Native principal over Stargate outside Ethereum ETH to Base ETH | Only the Ethereum to Base asset ID 13 pool pair is admitted (`asset_tool_unreviewed`) |
| WETH on any chain | Not on the frozen list; LI.FI itself filters the route because Across does not send WETH to EOAs |
| USDT from Ethereum | No peer: LI.FI's Arbitrum USDT output is USD₮0 `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`, which the frozen list does not name, and LI.FI returns no Across or Stargate route from USDT to a listed USDC without a swap |
| Any token the frozen list does not name (DAI, cbBTC, USD₮0, ...) | `asset_not_on_frozen_list` |
| Stargate pools other than USDC asset ID 1 and Ethereum to Base native asset ID 13 | No admitted pool pair and correlated proof |
| Fee-on-transfer or rebasing tokens | The exact-amount `Transfer` proof cannot hold |
| A proxy with no stable implementation, admin or beacon slot | Nothing to pin an upgrade against |
| Any EVM chain not listed above | No registry row, deployment check, RPC policy, destination observation or execution path |

## Bridge commands

### Discover

```sh
apn bridge capabilities
apn bridge inventory
apn help bridge routes
apn help --json
```

Capabilities and help are offline; even `bridge capabilities --profile <profile>` does not read a wallet, APN state,
Keychain or the network. Capabilities list every chain, native coin and token row with tools, peers, approval kind and
listing, the four profiles, the RPC variable of each chain, the inventory-only refusals and the fee headroom policy.
Inventory anonymously reads LI.FI chains, tokens, tools and connections and shows bounded public fields with response
hashes; it grants no execution authority.

### Find routes

The profile must already have its local EVM wallet, the source asset and native funding for fees. The values below
show syntax; choose principal, recipient, output floor and fee limits for the intended payment.

```sh
apn bridge routes --profile existing-local \
  --from-chain eip155:1 --to-chain eip155:8453 \
  --from-token 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --to-token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --amount 10 --to <recipient> --min-output 9.9 \
  --max-native-debit-wei 20000000000000000 \
  --max-route-fee 0.1 --slippage-bps 50

apn bridge routes --profile existing-local \
  --from-chain eip155:1 --to-chain eip155:8453 \
  --from-token native --to-token native \
  --amount 0.001 --to <recipient> --min-output 0.00099 \
  --max-native-debit-wei 1000000000000000 \
  --max-route-fee 0.00001 --slippage-bps 50
```

All options are required and have no default.

| Option | Meaning |
| --- | --- |
| `--profile` | Existing local profile |
| `--from-chain` | `eip155:1`, `eip155:8453` or `eip155:42161` |
| `--to-chain` | A different admitted chain or a quote-only destination |
| `--from-token`, `--to-token` | `native` or an admitted token address; both legs must be the same pair |
| `--amount` | Positive decimal at the source asset's precision |
| `--to` | Nonzero recipient address |
| `--min-output` | Positive decimal output floor |
| `--max-native-debit-wei` | Integer source-chain native budget for approval, execution, messaging and L1/operator fees; it excludes a native principal |
| `--max-route-fee` | Cap on source principal minus minimum output, at the asset's precision |
| `--slippage-bps` | Integer from 0 to 1000 |

`routes` saves the raw bounded response and a profile-bound snapshot, then lists alternatives and the gates each still
needs. APN drops no route LI.FI returns: every route is listed, either preparable or with its gate. When LI.FI returns
no route, the output adds a `no_route` object with LI.FI's answer to the exact request: provider, endpoint, CAIP-2
chains, tokens, atomic amount, the tools APN allowed (`across` and `stargateV2` with no exchange and no destination
call; for the Ethereum ETH to BNB composite `across`, `fly` and a destination call), whether LI.FI sent
`unavailableRoutes`, and its `filteredOut` and `failed` rows (path, step, tool, error type, code, message). At most
eight rows of each kind are shown, control characters are stripped and each field is capped at 240 characters.

### Prepare

```sh
apn bridge prepare --profile existing-local \
  --quote <quote-hash> --route <returned-route-id> \
  --idempotency-key bridge-example-001
```

Select one returned route ID with its exact quote hash (64 lowercase hex characters). The idempotency key is 8 to 200
safe ASCII characters and is global across all money operation kinds and profiles; a conflicting key is rejected, and
a replay returns the original operation before any new provider, wallet or network dependency.

`prepare` obtains that step's transaction from LI.FI and validates its complete call before creating the durable
operation. An updated quote may change gas, fees and output within the caller's limits; it cannot change the selected
tool, chains, accounts, tokens, principal, recipient or slippage. The operation joins the shared money-operation locks,
so an unresolved operation blocks another money operation for the profile.

### Approve

```sh
apn bridge approve --operation <operation-id>
```

The foreground terminal shows both chains, the admitted asset rows with symbols, decimals and contract shape, each
chain's native coin, sender, recipient, principal, minimum output, declared and implicit fees, native budget, separate
effect nonces and gas ceilings, the fee headroom with both the quoted and the approved maximum execution fee, RPC
origins, policy, fingerprint and expiry. Approval requires the six-character approval code bound to the full
fingerprint within 60 seconds, or before the earlier operation expiry. APN checks the same intent again after consent
and attempts each frozen source effect once.

## Amounts, fees and time limits

### Amounts

`--amount`, `--min-output` and `--max-route-fee` are decimal strings at the selected asset's own precision: six
fractional digits for USDC and USDT, eight for WBTC, eighteen for native coins. `--max-native-debit-wei` is an integer
native budget on the source chain. For a native principal it bounds fees only; the principal is bound by `--amount`,
and the funding check still requires principal plus fees. APN uses integer arithmetic and rejects exponent notation,
signs, whitespace, excess precision and uint256 overflow.

When source and destination use the same denomination, the token loss bound is source principal minus the materialized
minimum output; it includes fees and slippage and must fit `--max-route-fee`. For a denomination-changing native route
(Ethereum ETH to Monad MON or to BNB), APN never subtracts the two atomic units: the public operation and terminal state
the ETH principal, included ETH route-fee cap, ETH execution-fee cap and maximum total ETH debit separately from the
expected, materialized minimum and owner minimum destination output, and the receipt field `token_loss_bound_atomic`
is `null`. These values come from the fingerprinted materialization request, not from display-only inputs. Included
token fees are counted once. Stargate's native messaging fee must equal transaction value and one declared additional
native fee. Approval gas is a separate paid effect.

### Allowance

Only zero allowance or an exact existing allowance to the LI.FI Diamond is accepted. Zero allowance creates
`approve(spender, principal)` and the bridge transaction with consecutive nonces. An exact existing allowance needs only
the bridge transaction. Any other allowance requires separate owner review (`residual_allowance_review_required`); APN
never resets, increases, revokes or requests a refund automatically. A native principal has no approval effect.

Before an allowance exists, APN independently estimates the approval and freezes a bounded provisional bridge gas
ceiling with RPC-derived fee caps. Once the approval is included and the exact allowance is visible, APN independently
estimates the bridge and refuses to exceed those frozen caps. The bridge may be sent before the approval is safe, but
a safe approval is required for successful completion.

### Fee headroom

A bridge is priced at preparation and signed later, so the frozen EIP-1559 prices are deliberately not the quote. Each
envelope freezes the quoted `maxFeePerGas` and `maxPriorityFeePerGas` raised by exactly `BRIDGE_FEE_HEADROOM_BPS`,
5000 basis points (+50%), rounded up, under the policy identity `apn.bridge-fee-headroom.v1`. That raised pair is the
owner-approved maximum: the envelope freezes it, custody signs it, it bounds the debit on chain, and
`--max-native-debit-wei` is checked against it. Because the maximum includes the headroom, the native budget must
cover the worst case, not the quote.

Before each first send APN re-estimates and refuses with `fresh_execution_estimate_over_cap` only when the current gas
limit, `maxFeePerGas` or `maxPriorityFeePerGas` exceeds the approved maximum. A price that rises within the headroom
does not end the operation. APN never reprices a consented envelope: the headroom is stored per envelope as
`feeCeiling` with the quote it came from and is re-derived and re-checked on every durable read. There is no other
multiplier in the rail and no paymaster equivalent of the token fee cap.

### Native budget and Base fees

The native budget covers approval, execution, messaging value and estimated L1/operator fees. Base fee quotes use a
16 KiB signed-transaction upper bound. **Base's total native fee is checked before sending; it is not an on-chain
total-spend cap.** L1 and operator fees can change between that check and inclusion. Actual source fees are proved
from the receipt: Ethereum execution gas (plus any EIP-4844 blob fee), Arbitrum's inclusive gas total without
double-counting poster gas, and Base execution plus the receipt's `l1Fee` plus the operator fee from
`operatorFeeScalar` and `operatorFeeConstant` (absent operator fields count as zero parameters).

### Time limits

The transaction materialization lasts at most 300 seconds, shortened by Across protocol timing. At least 15 seconds
must remain after checks before each first send. A paid approval does not extend the bridge deadline. Once the quote
has expired, an unsent operation ends: `failed_before_effect` before any effect, or `failed_after_approval` after a
safe approval (see [Recovery](#recovery-and-proof)).

## What APN accepts from LI.FI

### Calldata

APN accepts one source bridge call, one admitted asset pair and no destination contract call (the BNB composite below is
the one reviewed exception). The finite decoders require the LI.FI Diamond `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`,
the FeeForwarder `0xCE40449B773a3E6E5e769ADb4e567179d4828cbd`, the `lifi-api` integrator, a zero referrer and exact fee
distribution to the fee recipient `0xC06ebbefD94032B85424D51906e2A335EFAe264B`. Across requires an empty message and no
exclusivity. Stargate requires Taxi with an empty compose message, options and `oftCmd`. Arbitrary calldata, swaps,
Permit2, typed-data requests, approval resets and provider-added effects are rejected.

For a native principal the decoder accepts exactly:

- `swapAndStartBridgeTokensViaAcrossV4` (`0x1794958f`) on the Diamond with `value == amount` and
  `bridgeData.sendingAssetId` the zero address;
- one FeeForwarder step with `forwardNativeFees` (`0x0e8ae67f`), native in and out, `fromAmount == amount`, and one
  distribution of exactly `amount - bridgeData.minAmount` to the fee recipient;
- Across data whose input token is the source chain's pinned wrapped native and whose output token is the destination
  chain's pinned wrapped native, with the same recipient, refund, output, exclusivity and message rules as ERC-20.
  An ETH to MON conversion may use an output multiplier above one because the units differ; the exact multiplier
  equation and minimum output stay bound to the materialized calldata.

The route estimate must state `skipApproval: true` and must not ask for an approval reset. Every fee row is the native
coin itself (`asset: "native"`), and LI.FI's fixed fee must equal the forwarded amount. A token request can never reuse
native calldata.

The Ethereum to Base native Stargate Taxi call uses asset ID 13; transaction value equals the source principal plus
the separate LayerZero native fee. A LayerZero fee above `--max-native-debit-wei` is refused as
`APN_FEE_BUDGET_EXCEEDED` (`stargate_native_fee_exceeds_cap`) after the ABI, Taxi semantics, refund identity and
declared fee rows validate; malformed bindings stay `APN_PROVIDER_PROTOCOL`. Passing this check does not cover approval
and bridge gas: preparation still checks the aggregate native debit.

### Deployment check

One light check per invocation runs on the source chain, in the same batch as the account read, at the `latest` head
the transaction executes against. It reads the Diamond's selector routing and FeeForwarder whitelist, the facet's
protocol binding (Across SpokePool and wrapped native, Stargate messaging and pools), the SpokePool time buffers
(3600-second quote-time buffer and 21600-second fill deadline buffer), Stargate routing and peers, each asset's exact
`decimals()`, and Tether's owner-settable fee fields. Each answer must equal its reviewed value. Contract code hashes,
implementation/admin/beacon slots, the FeeForwarder's owner and the Base fee predeploys are not pinned, because they
change on legitimate upgrades; exact calldata decoding, the exact-amount allowance, the fresh simulation and the
receipt log proofs from the registry's emitters keep the effect bound.

A destination reads nothing before the send except the BNB composite's routing configuration. Within one invocation,
the re-check right before the send reads only the account batch; consent resets it.

### Ethereum ETH to BNB composite

The only BNB route is LI.FI fee collection followed by Across V4 to `ReceiverAcrossV4`, then one Fly destination swap
from BSC WETH to native BNB. APN decodes the full destination message and compressed Fly program. It requires exactly
the pinned WETH approval, one Balancer `GIVEN_IN` WETH/WBNB pool call, the WBNB unwrap, the Core native balance read and
the native return to the Fly router. The signed Fly header, raw payload hash, owner output floor, retention bound, self
recipient and source debit caps are part of the durable operation integrity binding.

| Contract (BNB Smart Chain) | Address |
| --- | --- |
| Across SpokePool | `0x4e8e101924ede233c13e2d8622dc8aed2872d505` |
| LI.FI ReceiverAcrossV4 | `0x33b255b5db44A78c34381f89f1a454bc0Ef49871` |
| LI.FI Executor | `0x2dfaDAB8266483beD9Fd9A292Ce56596a2D1378D` |
| Fly router | `0x20F6ee51340aDEed01A59B0e65cB3703f3dc860c` |
| Fly Core | `0x09ad820aac5779683b481c4674208a4e1b024afa` |
| Balancer Vault | `0xA82f327BBbf0667356d2935c6532D164B06cEceD` |
| WETH / WBNB | `0x2170Ed0880ac9A755fd29B2688956BD959F933F8` / `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` |

Before execution APN reads the Fly signer allowlist, Fly/Core linkage and whitelist, the Receiver's Executor and
SpokePool, the Across buffers, and the Vault pool registration with its complete five-token list in exact order, WETH
as input and WBNB as output. Completion requires the canonical Across message hash and a safe BNB transaction whose
complete bounded `callTracer` subtree matches the SpokePool, Receiver, Executor, Fly, Core, Vault, pool swap, WBNB
unwrap and native-return hierarchy; the digest covers the whole validated subtree. Vault output must equal the unwrap
amount, retention math must equal the Fly-to-Executor and Executor-to-self value, and the self balance delta must cover
that delivery.

Destination outcomes are durable across restart: `completed_native` is the only successful BNB delivery;
`recovered_weth` (unswapped WETH returned to the recipient), `below_floor` and `protocol_mismatch` end as
`destination_failed`; unavailable evidence stays unresolved.

## Recovery and proof

```sh
apn operation status --operation <operation-id>
apn operation resume --operation <operation-id>
apn receipt get --operation <operation-id>
```

Status and receipt read the saved operation. Resume performs one bounded recovery pass; omit `--wait-seconds`.

| Bridge state | Meaning |
| --- | --- |
| `awaiting_approval` | Prepared; run `bridge approve` before the expiry |
| `execution_pending`, `source_pending`, `destination_pending`, `unknown_finality` | Not finished; `operation resume` continues or observes |
| `completed` | Safe, canonical source and destination evidence |
| `destination_failed` | Source landed; destination delivery proved to have failed (for example `recovered_weth`, `below_floor`, `protocol_mismatch`) |
| `failed_before_effect` | Nothing was sent |
| `failed_after_approval` | A safe approval was paid; the bridge was never sent |
| `failed_confirmed_revert` | The source transaction reverted at the safe head |

### Signing and sending

- An approved, not-yet-started effect may progress only under its original deadline and checks.
- Every route writes create-only SIGN and SEND claims outside the operation and usage journals. The same claim again
  is the same effect; a different one is refused. A SEND claim the journal has not recorded (an interrupted send step
  or a restored journal) is recorded as an attempt from the sealed material and observed, never sent again. Only a
  SEND claim blocks ending an expired unsent remainder.
- The signing commitment is durable before custody is entered; a recovered commitment loads only its original
  authenticated seal. Missing committed material blocks recovery and never permits a replacement signature.
- An effect left at `signing_started` with no sealed material and no SEND claim signed and sent nothing. Resume returns
  it to `unsealed`, runs the full guard again and re-signs the identical envelope (RFC 6979 gives the same bytes), or
  ends it on the expiry path.
- APN records the first submission attempt before calling the RPC. From then on, recovery observes the original hash
  without resending, even if the acknowledgment was lost, the RPC returned a different hash, the quote expired or no
  transaction is visible yet. A timeout or rate limit on the raw send itself is final for that attempt.
- If an approval was paid but the bridge was never sent, failure waits for the safe approval and keeps its fee and the
  observed residual allowance.

### RPC failures before signing

If an RPC transport fails, or an endpoint answers HTTP 408 or 5xx after its one retry, during a pre-sign guard, nothing
has been sealed, signed or sent, so the operation is not ended. It keeps its state with reason
`pre_sign_rpc_unavailable` and adds a `pre_sign_rpc_failure` record naming the effect role, source or destination chain,
the guard stage, its category and the JSON-RPC method when the transport reached one. It never stores an endpoint,
header, provider message, calldata or signing material. A provider rate limit is handled the same way with reason
`pre_sign_rpc_rate_limited`.

The next action is `apn bridge approve` before consent and `apn operation resume` after it; the next run repeats the
full guard and clears the reason when it signs. Once the quote has expired, that run ends the operation:
`failed_before_effect` before any effect, or `failed_after_approval` with `unsent_apn_reprepare_required` and the observed
residual allowance after a safe approval. Deterministic refusals (identity, deployment, fee, allowance, nonce, balance)
keep their terminal outcomes. Source, destination and residual observation keep every RPC failure, including rate
limits, recoverable. An exhausted read budget defers to the next resume and never records `unknown_finality`.

### Completion evidence

`completed` requires safe, canonical source and destination evidence:

- **Source.** The reconstructed signature and frozen transaction, block membership, receipt, token movements, LI.FI and
  protocol events and fees. For a native principal the three ERC-20 `Transfer` logs are replaced by the wrap: exactly
  one wrapped-native log crediting the source SpokePool with the bridge amount (`Deposit(dst)` from WETH9 on Ethereum
  and Base, a `Transfer` from the zero address on Arbitrum's aeWETH), next to the `LiFiTransferStarted`,
  `FeesForwarded` (token = zero address) and `FundsDeposited` checks.
- **Across delivery.** The full `FilledRelay` tuple, origin/deposit ID, effective recipient/output and a transfer of the
  admitted destination token. Repayment credit is kept as its complete bytes32 value with its repayment chain; it need
  not be an EVM address or equal the token payer. Slow fills require zero repayment credit and chain and a transfer from
  the destination SpokePool reserves. A native fill replaces the recipient `Transfer` with the unwrap: exactly one log
  of the output amount from the destination SpokePool (`Withdrawal(src)` from WETH9, or a `Transfer` to the zero
  address from aeWETH).
- **Linea and Monad native fills.** The destination transaction must also expose one bounded `debug_traceTransaction`
  `callTracer` call from the pinned SpokePool to the bound profile owner for exactly the `FilledRelay` output. The safe
  canonical transaction and block bind that trace; the balance delta from the previous block to the receipt block
  corroborates it but cannot replace it. For Linea, Monad and the BNB composite, the destination primary RPC, or its
  archive reader, must support `debug_traceTransaction` with `callTracer`.
- **Stargate delivery.** A nonzero GUID, source endpoint, receiver and amount matching `OFTReceived` from the pool,
  with a transfer of the admitted destination token, including a later successful retry of a cached delivery.
- **Ethereum to Base native Stargate.** Source observation requires `OFTSent.amountSentLD` to equal the bridge amount
  rounded down to shared precision (18 local decimals, 6 shared: a 10^12 wei quantum); the frozen calldata and source
  proof keep the raw value and the correlation stores the normalized sent value. All other Stargate and Across amounts
  use exact equality. Delivery is the canonical `OFTReceived` from the Base native pool
  `0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7`, binding source GUID, source endpoint ID, recipient and amount; the
  decoded route and source correlation bind the destination endpoint ID and sender. At that pool `OFTReceived` follows
  a successful native outflow, so a native call trace or balance snapshot is validated when supplied but not required
  (the recipient may spend in the same block). A cached failure without a successful event does not prove delivery.

LI.FI status is a hint, not completion authority. APN asks LI.FI for the status of the source transaction to learn the
destination transaction hash, then proves that transaction independently from the destination chain. `PENDING`,
not found, completed, partial, refunded, failed and unknown observations stay distinct. Only an EVM 32-byte hash
addresses the EVM destination reader; a Solana signature is kept as itself and is never widened into an EVM lookup.
Without an EVM destination hash the operation keeps waiting. For Linea, Monad and BNB native delivery, LI.FI must report
completed with the destination hash. Unproved partial, refund or failure observations stay unresolved. Reorgs discard
provisional inclusion while keeping submission identity; a conflict with a saved safe proof keeps that proof and blocks
completion until the original evidence verifies again.

A bridge takes the lock of the chain it signs on: an EVM source takes the `evm:<chain id>:<address>` domain, so one
money operation per account holds across rails. An account that is not its chain's own address form is refused rather
than mapped.

### Receipt

The receipt separates known fees, unresolved fee effects and final actual fees; an unknown cost is never shown as zero.
It includes both chain proofs, provenance, source fee components, the actual destination amount and the residual
allowance. `rpc_safe_correlated` means evidence correlated through the configured RPCs, not a trustless light-client
proof; a successful delivery reads `delivery_correlated`. A proven delivery records a zero residual allowance at the
safe bridge block without a read, because the exact-amount allowance was consumed by the proven exact source
`Transfer`. On the failure paths an unavailable residual read is reported as `residual_allowance_status: unavailable`
and never blocks the terminal state. The operation is authoritative: interrupted derived-receipt writes are repaired
under the same locks. Raw calldata, signed bytes, wallet secrets and raw provider errors are omitted from public output.

## RPC behavior and limits

- Both transports (LI.FI and RPC) have bounded JSON bodies, at most two concurrent requests, a 15-second request
  deadline, and no redirects or automatic retries beyond the rules below.
- Bridge preparation uses one command-scoped RPC read session across source and destination. Strict JSON-RPC batches
  hold at most 33 items; identical ordered batches are deduplicated, and every response is decoded before any eligible
  result enters the cache. A session permits at most 96 logical items and 180 seconds; its request cap is the step's
  read plan with explicit retry headroom. Each provider family keeps its requests at least 750 ms apart.
- Mutable state (head, balances, allowance, nonces, fee inputs, the planned simulation and the deployment check) is read
  in one batch at the moving `latest` head, with the pending nonce read as pending. Mutable account, fee and estimate
  data is never kept across an approval or signing boundary. A fresh simulation runs before signing and again before
  the one send.
- Observation reads one batch of transaction, receipt and safe head, then the inclusion header. Only the native-fill
  balance witnesses and call traces need history. Block-hash reads use EIP-1898 with `requireCanonical: true`, so the
  node refuses a non-canonical hash.
- dRPC's keyless plan refuses batches over three requests, so a `*.drpc.org` endpoint receives each logical batch in
  three-item chunks, counted once. `https://mainnet.base.org` is scalar-only, so APN sends chain ID and receipt there as
  two sequential JSON-RPC objects.
- Session and invocation caps are derived from the operation's read plans (the sign-and-send step when an effect is
  unsent, plus one source observation, one destination observation and the residual read), with explicit retry
  headroom and a floor of 24 POSTs per invocation. An exhausted budget stops before signing and resumes cleanly.
- HTTP 429 is a typed cooldown, `APN_RPC_RATE_LIMITED`, with a sanitized `retryAfterMs`; APN does not retry it. JSON-RPC
  rate-limit codes -32005, -32007, -32011 and 429 are typed the same way. HTTP 408, 5xx and approved transport timeouts
  may receive one retry after at least two seconds when the command deadline still permits it. Permanent HTTP errors,
  JSON-RPC errors and malformed JSON fail immediately. A budget or deadline failure is typed and occurs before another
  queued request, wait or attempt.
- No separate RPC capability check is needed before `bridge prepare`; prepare performs the chain, deployment,
  configuration and block identity checks its operation needs.

On keyless primary endpoints alone, one Base USDC to Arbitrum USDC Across bridge takes about 21 RPC POSTs over six
invocations (prepare 2, approve 5, then the resume steps).

## MCP

The MCP tools `apn_bridge_capabilities`, `apn_bridge_inventory`, `apn_bridge_routes` and `apn_bridge_prepare` use the
same catalog and binder as the CLI. Approval is not an MCP tool: `apn_foreground_handoff` returns only the exact
foreground CLI command for `bridge approve` without reading state or entering custody. The same applies to
`oneclick source submit`; `apn_oneclick_source_status` is a read-only tool. The generic status, resume and receipt tools
handle durable bridge operations.

## Discovery-only lanes: Solana and TRON

`bridge capabilities` reports these rows with `executable: false`. `bridge routes`, `prepare` and `approve` refuse them.

- **`selected_direct_lane`: Base USDC to Solana USDC through Circle CCTP V2** with the Forwarding Service and a signed
  upfront fee quote. Circle collects the quoted fee on Base with the burn and mints the full burned amount to the
  Solana recipient; for Solana, `mintRecipient` is the recipient's USDC associated token account (ATA), and ATA
  creation needs the forwarding hook and the quoted recipient setup cost
  ([upfront fees](https://developers.circle.com/cctp/concepts/how-upfront-fees-work),
  [Forwarding Service](https://developers.circle.com/cctp/concepts/forwarding-service)). Within the bridge rail this row
  is a design entry; the Base burn itself runs through `apn circle source submit`, and its status is described
  [below](#circle-cctp-v2-base-usdc-to-solana-approval-and-delivery-status).
- **`candidate_lanes`: Base USDC to Solana USDC through LI.FI.** LI.FI Solana chain ID `1151111081099710`, Solana USDC
  mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (per LI.FI's
  [Solana documentation](https://docs.li.fi/introduction/lifi-architecture/solana-overview)).
- **`candidate_lanes`: Base USDC to TRON USDT through LI.FI tool `near` (NEAR Intents).** LI.FI TRON chain ID
  `728126428` (`TVM`), destination contract `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`. This lane has no CCTP implication;
  the direct NEAR 1Click lanes below are separate.

`bridge inventory` makes one extra anonymous `/connections` read for the Solana pair, and reads the TVM chain, token,
bridge tool and exact NEAR-filtered connection for the TRON pair. A returned connection is provider inventory, not an
amount-specific route, source call, fee bound, delivery proof or recovery contract (the
[LI.FI API reference](https://docs.li.fi/agents/reference/endpoint-specs) distinguishes connections from routes). If a
candidate read fails, disagrees with these identities or does not fit the response bound, that candidate is reported as
`unavailable` or omitted, while the admitted EVM inventory stays usable.

## GasZip direct funding: Sei and Mega

Two finite lanes fund the profile's own account on another chain with native Base ETH (chain 8453) through GasZip's V2
direct deposit. LI.FI does not execute them. Any local profile may use them: the payer is the profile's own wallet,
`--expected-payer` must equal it, and the deposit pays that same address on the destination (self only).

| Lane | Destination | Calldata (GasZip short ID) | Schema |
| --- | --- | --- | --- |
| `sei` | Sei SEI, chain 1329 | `0x0100f6` (246) | `apn.sei-gaszip-operation.v1` |
| `mega` | Mega ETH, chain 4326 | `0x010202` (514) | `apn.mega-gaszip-operation.v1` |

The source sends the amount to the official GasZip direct deposit address `0x391E7C679d29bD940d63be94AD22A25d25b5A604`,
which must have empty code, with exactly the lane's calldata; the calldata selects the sender as recipient. No token
approval is involved. Each lane has its own commands, journal directory, schema, mechanism pin and create-only
signing/send claims. Set `APN_BASE_RPC_URL` and the destination variable (`APN_SEI_RPC_URL` or `APN_MEGA_RPC_URL`).
The GasZip API origin is fixed to `https://backend.gas.zip`.

```sh
apn sei funding prepare --profile <profile> --expected-payer <profile-wallet-address> --amount-atomic 10000000000000 --minimum-output-atomic 250000000000000000 --maximum-fee-atomic 1000000000000 --idempotency-key <new-key>
apn sei funding approve --operation <operation-id>
apn sei funding status --operation <operation-id>

apn mega funding prepare --profile <profile> --expected-payer <profile-wallet-address> --amount-atomic 10000000000000 --minimum-output-atomic 8000000000000 --maximum-fee-atomic 1000000000000 --idempotency-key mega-self-funding-01
apn mega funding approve --operation <operation-id>
apn mega funding status --operation <operation-id>
```

All prepare options are required. `--amount-atomic` (wei) is bounded by the admission's per-transfer and daily caps.
`--minimum-output-atomic` (the owner's delivery floor in destination wei) and `--maximum-fee-atomic` (the owner's Base
network fee ceiling) are the only output and fee bounds; no lane constant caps them. The idempotency key is 8 to 200
safe ASCII characters.

**Prepare** fetches the quote, which must meet the owner floor and have at least 30 seconds left, reads Base identity
and fees, and saves an unsigned exact deposit with the quote expiry, owner and provider binding, active policy digest,
source nonce and fee plan. The operation joins the shared EVM conflict and idempotency registry: its unresolved Base
spend blocks another operation for that owner on Base, and a Sei operation also holds the owner's Sei account.

**Fees.** The Base fee quote includes L2 gas, the OP GasPriceOracle L1 data fee upper bound for 512 signed bytes and the
operator fee; the paid fee counts the receipt's L1 and operator fees. The signed EIP-1559 gas price limits the L2
component; the Base total is a quoted ceiling, not an on-chain total fee cap. A fresh balance must cover the frozen
signed envelope's full fee upper bound even when a later estimate is lower. An actual Base fee above the ceiling is
reported as `feeCapExceeded`.

**Approve** needs a foreground terminal, at least 20 seconds of quote validity and fresh source checks. After consent
the owner binding, policy, custody, usage and Base conflicts are checked again; signing needs at least 10 seconds left.
The signing claim precedes signing and the send claim precedes the single send. The destination floor is checked when
the delivery is proved; the source transaction cannot enforce it.

**Status** never signs or resends. Completion requires:

1. the exact source transaction (sender, nonce, calldata, value and signed fee pair) with a successful canonical receipt
   at or below Base's safe head;
2. the provider's `/v2/deposit/<source-hash>` answer mapping that source hash, block, value, owner and short ID to one
   confirmed, non-refunded outbound; integer JSON lexemes are kept as exact decimal strings before any comparison;
3. the outbound proved on the destination chain alone: the exact signed payout (sender, nonce, native value, recipient),
   a successful receipt with empty input and no logs at or below the safe head, block membership, and an owner without
   code. The destination hash can be claimed by only one funding operation.

The provider's status alone cannot complete the operation. Missing or changed provider correlation fails closed;
provider responses must carry their required fields, and fields GasZip adds later are ignored.

| Outcome | When |
| --- | --- |
| `completed` | Source and payout proved, payout at or above the owner floor |
| `destination_failed` | Deposit or payout cancelled or refunded, or a proved payout below the owner floor; the spend stays counted |
| `failed_confirmed_revert` | Source reverted at the safe head; the principal is released, consumed network fees remain |
| `failed_before_effect` | Unsigned preparation expired; signed bytes never sent; a definite JSON-RPC refusal; a guard refused before transport; or an unlanded hash whose nonce the safe head already moved past. Signed bytes are scrubbed and the hold is released |

Open states are `prepared`, `signing_started`, `sealed`, `submitting`, `submitted` and `unknown_finality`; unknown
source or delivery outcomes keep the principal hold. The nonce-moved exit trusts the node's transaction lookup: a node
that pruned its transaction index (about 54 days of Base blocks) could report a very old landed deposit as absent.

Funding a Mega account does not establish USDm acquisition, a merchant payment or HTTP delivery. Protocol references:
[direct deposit format](https://dev.gas.zip/gas/code-examples/evm-deposit/direct-forwarder),
[quote and expiry](https://dev.gas.zip/gas/api/quote), [deposit correlation](https://dev.gas.zip/gas/api/deposit) and
[outbound correlation](https://dev.gas.zip/gas/api/outbound).

## NEAR 1Click direct lanes

`apn oneclick source submit --lane <lane>` sends one origin-chain deposit to the `depositAddress` of a fresh NEAR
Intents 1Click quote (`https://1click.chaindefuser.com/v0/quote`, status from `/v0/status`). Only these lanes exist;
any other `--lane` value is refused before any network call. Asset IDs match 1Click's public `GET /v0/tokens` list.

| Lane | Origin effect | Destination | 1Click origin → destination asset | `--max-quoted-loss-atomic` bounds |
| --- | --- | --- | --- | --- |
| `base-usdc-to-tron-usdt` | Base USDC `transfer` (6 decimals) | TRON USDT (6) | `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near` → `nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near` | Amount in minus quoted minimum, USDC atomic at par |
| `ethereum-eth-to-tron-trx` | Ethereum ETH value transfer (18) | TRON TRX (6, SUN) | `nep141:eth.omft.near` → `nep141:tron.omft.near` | Quoted output minus quoted minimum, SUN |
| `ethereum-eth-to-solana-sol` | Ethereum ETH value transfer (18) | Solana SOL (9, lamports) | `nep141:eth.omft.near` → `nep141:sol.omft.near` | Quoted output minus quoted minimum, lamports |
| `ethereum-eth-to-tron-usdt` | Ethereum ETH value transfer (18) | TRON USDT (6) | `nep141:eth.omft.near` → `nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near` | Quoted output minus quoted minimum, USDT atomic |

```sh
apn oneclick source submit --lane ethereum-eth-to-tron-trx --profile <profile> --expected-payer <ethereum-payer> \
  --recipient <tron-recipient> --amount-atomic 2000000000000000 --min-output-atomic 12500000 \
  --max-quoted-loss-atomic 200000 --max-gas-limit-atomic 60000 --max-fee-per-gas-wei 20000000000 \
  --max-priority-fee-per-gas-wei 2000000000 --max-native-debit-wei 2600000000000000 --idempotency-key trx-fund-1
apn oneclick source status --operation <operation-id>
```

All options are required. One deposit is at most 10,000,000 USDC on the Base lane and at most 1 ETH on the Ethereum
lanes, and `--max-priority-fee-per-gas-wei` may not exceed `--max-fee-per-gas-wei`. The idempotency key is 8 to 128
safe ASCII characters. For different assets the only in-band valuation is the quote's own rate, so the loss bound covers
the quote's slippage floor and `--min-output-atomic` is the owner's price floor. Recipients must be canonical: TRON
base58check for TRX and USDT, a 32-byte Solana base58 key for SOL. `refundTo` is always the payer.

**Submit** is keyless and fails closed. APN first requests a dry quote (no deposit address), then an actual exact-input
quote whose echo must match the lane assets, payer, refund address, recipient, amount and a request deadline at most
180 seconds ahead. The quoted minimum must meet `--min-output-atomic`, the loss must fit `--max-quoted-loss-atomic`,
the deposit address may not be zero, the payer or the origin token, no memo is accepted, and at least 45 seconds must
remain. Origin reads are pinned to the safe block hash.

- Base USDC lane: gas is the estimate plus 20 percent; the max fee is twice the base fee plus the RPC tip suggestion.
  Gas, max fee and tip must fit `--max-gas-limit-atomic`, `--max-fee-per-gas-wei` and
  `--max-priority-fee-per-gas-wei`. The native debit (gas times max fee plus the Base L1 fee upper bound and operator
  fee) must fit `--max-native-debit-wei` and the balance.
- Ethereum ETH lanes: the transaction is exactly `amountIn` wei to the deposit address with empty calldata.
  `eth_getCode` decides the gas: an account without code uses 21000; a contract deposit is estimated at the same block
  plus 20 percent and must fit `--max-gas-limit-atomic`. The signed tip is `--max-priority-fee-per-gas-wei` (it must be
  above zero); the max fee is twice the larger of the safe and latest base fee plus that tip and must fit
  `--max-fee-per-gas-wei`. Value plus gas times max fee must fit `--max-native-debit-wei` and the safe balance.

The record is staged, the owner types a six-character code in the foreground terminal, and the reads repeat: the nonce
and deposit code class must be unchanged, gas may not grow, the approved max fee must still cover the fresh base fee plus
the approved tip, the balance must still cover the approved debit, and at least 30 seconds must remain before the
effective deadline. A nonce sealed by an earlier operation refuses a new submit before consent; it is released once that
operation's deadline has passed and the node does not know its hash. The signed raw transaction is saved before the
single send; an unknown send result is recorded as `unknown_finality` and never resent.

**Status** keeps three observations apart: the safe source receipt, the provider's HTTPS status claim (bound to the saved
quote digest), and an independent destination proof. The proof reads only transaction IDs the provider names in
`swapDetails.destinationChainTxHashes`:

- TRX: a solidified `TransferContract` to the recipient whose JSON re-encodes to the hashed raw data, with block
  membership and a successful result (a first transfer may create the recipient account);
- USDT: the solidified TRC20 `Transfer` log;
- SOL: the recipient's finalized balance delta inside the named transaction.

Credits in blocks older than the quote request are refused, and `destinationFinalized` is true only when the proven
credits reach the saved minimum output. Status records the safe source receipt and the finalized destination proof once
and then answers from the journal. Source RPCs come only from `APN_BASE_RPC_URL` or `APN_ETHEREUM_RPC_URL`, destination
RPCs only from `APN_TRON_RPC_URL` or `APN_SOLANA_RPC_URL`; there are no default endpoints.

| State | Meaning |
| --- | --- |
| `prepared`, `signing_started`, `sealed`, `submitting`, `submitted_pending`, `unknown_finality` | Open |
| `source_observed` | The deposit landed; destination proof is reported separately |
| `failed_proven_superseded` | A signed source can never land |

A signed source with no receipt (sealed, submitting, submitted or `unknown_finality`) ends `failed_proven_superseded`
through status once the payer's nonce at the `finalized` tag is past the source nonce while a node whose transaction
index reaches the source block pinned before signing knows neither the transaction nor a receipt (the record keeps
`finalizedNonceAtomic`). A nonce that is not past keeps it open. The proof counts a missing transaction only from a node
that indexes the operation's era: it reads the pinned block's transaction count and first transaction, then asks for
the transaction by hash in the same batch as the nonce. A node that pruned its transaction index (geth
`--history.transactions`) does not return it, so nothing is proven and the source stays open for a receipt.

A deposit that lands late, even after the quote deadline, is still `source_observed`: the deposit address is 1Click's,
the quote is dead, and 1Click refunds such a deposit to the payer; its status is reported as provider data and no
destination proof is claimed. The operation index releases the payer's account at the deposit deadline plus 10 minutes,
even before an outcome: a signed source has one fixed nonce, so it and a later transaction at that nonce cannot both
land, and that release lets a later transaction take the nonce the never-lands proof needs.

## Circle CCTP V2 Base USDC to Solana: approval and delivery status

These rules cover the Base side of `apn circle source submit` and its approval family (`apn circle approval prepare`,
`revoke`, `execute`, `status`).

### Approval exits and residual allowance

`apn circle approval status --operation <id>` ends an approval without a safe receipt as `failed_proven_superseded` by
the same never-lands proof as 1Click, read on `APN_BASE_RPC_URL`. The approval holds the payer's account until then, so
no other APN operation takes that nonce. Once the preparation has expired, `apn operation abandon --operation <id>` ends
a possibly sent approval as `abandoned_unknown` behind terminal consent; it may still land and set the allowance.

The approval's `allowance` field says what it leaves. A completed approval leaves the Base USDC allowance it set for the
Circle V2 TokenMessengerWithFees wrapper, which `apn circle source submit` spends. A burn spends the principal plus
Circle's fee, so anything the approval granted beyond that stays on the wrapper. The `apn operation status` that records
a burn's finalized receipt reads that residual allowance once, at the same finalized head, and stores it with its block
(`residualAllowance`). Later statuses show the stored value without a chain read, unless the caller passes
`--refresh-allowance` or nothing is stored yet; an unreadable value is shown as `null` with its reason. When it is above
zero, status names `apn circle approval revoke --profile <profile> ...`: the same approval family with a zero cap,
prepared unsigned, confirmed in the foreground by `apn circle approval execute`, sent once and observed by
`apn circle approval status` (an `Approval` event with value 0 and a fresh zero allowance). A completed revoke sets the
payer's stored residuals to 0 at its own fresh-read block. Revoke refuses when the allowance is already 0. Every other
outcome changed no allowance.

### Daily cap settlement

The same status settles the burn's hold on the payer's Base USDC daily cap. A successful burn becomes a finalized spend
counted on the UTC day its finalized receipt was recorded (never before the hold's last write, never after this
status). A reverted burn moved no USDC and releases its hold. Every status of a recorded burn repeats the settlement, so
an interrupted one completes on the next status; the result shows the hold as `sourceUsage`. Only the hold this
operation reserved for the principal of its own burn is touched; a burn without a recorded receipt keeps its hold.

### Delivery on Solana

After a successful burn, `apn operation status` follows its delivery on Solana on every status until the delivery is
recorded, then never again. Circle's forwarding service, or any payer, receives the message there; APN only reads.

1. APN asks Circle's issuer API (`https://iris-api.circle.com/v2/messages/6?transactionHash=<hash>`) for the burn's
   message; that answer only locates it.
2. Once attested, the message bytes must be this burn's: domains 6 to 5, Base USDC, the journal's messenger, the
   recipient token account named by both the calldata and the admission, the principal, and an executed fee no larger
   than the attested max fee.
3. They must also be the message the burn emitted: its finalized Base receipt (in the block the source proof recorded)
   carries exactly one `MessageSent(bytes)` from MessageTransmitterV2 `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`, and
   the attested bytes equal that message in every byte except the four fields Circle fills after the burn (nonce,
   executed finality, executed fee, expiration block).
4. The receiving Solana transaction is Circle's `forwardTxHash` or, without one (a failed forward received by someone
   else), one of the successful finalized transactions naming the message's `used_nonce` account, checked oldest first
   within one page of 16. It is read at `finalized` on `APN_SOLANA_RPC_URL` only. It must have succeeded, carry a
   MessageTransmitterV2 (`CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC`) `receive_message` of exactly those bytes, write
   the `used_nonce` account (PDA `["used_nonce", nonce]`), credit the recipient's USDC account with exactly the principal
   minus the executed fee, and be later than the burn's Base block (`blockTime` against the block timestamp).
5. The message is then claimed for this operation (`circle-solana-delivery-claims-v2/<nonce>.json`, so one receipt never
   proves two operations), the proof is recorded once beside the journal (`<operation>.solana-delivery-v2.json`, with
   the source event's log index, the SHA-256 of its message, the burn block's time and the receive's block time), and
   `phase` reads `delivered`.

Until then `phase` is `source_finalized` and `delivery.state` names the step awaited: `awaiting_issuer_message`,
`awaiting_attestation`, `awaiting_forward` (with Circle's `forwardState`), `forward_failed` (any Solana payer may submit
`receive_message` with the attested message; APN does not sign on Solana for this route), `awaiting_solana_rpc` (set
`APN_SOLANA_RPC_URL`) or `awaiting_solana_finality` (an RPC that keeps no history that old returns nothing). A read that
fails, or an answer that is not this burn's, leaves `delivery.state` `unread` with `unreadReason`; the rest of the status
still answers and nothing is recorded. A candidate the node does not return or cannot be judged, or a full page without a
receipt, is `unread`, never "not received". A receive that happened before the burn (such as an older burn's with the
same terms) is not its delivery; found through `used_nonce` it is final, so status reads `unread` and offers no
resubmission. A reverted burn shows `source_reverted` and reads no delivery. The journal is never rewritten; its own
phase stays under `journal.phase`.

**Binding limit.** CCTP V2 assigns nonces off chain and this route's message names no payer (its sender is the fee
wrapper, its max fee is 0 and its hook is fixed by the recipient), so two burns of the same amount to the same token
account emit identical bytes. While two such burns are in flight together (a repeat payment landing before the first
one's Solana receive, about 15 to 20 minutes at the route's standard finality), Circle's attested nonce is the only
discriminator, and APN cannot check it on chain. Every recorded delivery states this as
`delivery.operationBinding: circle_attested_nonce`. If Circle mislabeled such a pair, the later operation would read
`delivered` with the earlier receive and the earlier one would stay `unread` (`circle_delivery_message_claimed`). APN
does not refuse a repeat payment of the same terms while the first is in flight.

## Reason codes and troubleshooting

| Code or reason | Meaning | What to do |
| --- | --- | --- |
| `asset_not_on_frozen_list` | Token address not on the frozen list | Use an admitted row |
| `asset_listed_not_bridge_admitted` | Listed token without a bridge row | Use an admitted row |
| `asset_has_no_listed_peer` | Row has no admitted destination (Ethereum USDT) | No route exists |
| `admitted_asset_pair` | Legs differ in kind, pair, decimals or peers | Choose a matching pair |
| `asset_tool_unreviewed` | Tool not admitted for this asset or direction | Use Across, or Stargate only for the admitted pairs |
| `source_execution_unreviewed` | Destination-only chain used as source | Use Ethereum, Base or Arbitrum as source |
| `destination_execution_unreviewed` | Quote-only destination | Not executable |
| `destination_tool_quote_unavailable` | Tool not listed for a quote-only destination | Not executable |
| `bridge_self_recipient_required` (`APN_ALLOWLIST_REFUSED`) | Linea, Monad or BNB native delivery to another address | Send to the profile owner's own address |
| `allowlist_policy_changed`, `bridge_binding_changed`, `bridge_mechanism_mismatch` | Policy or binding differs from preparation | Prepare a new operation |
| `APN_FEE_BUDGET_EXCEEDED` (`aggregate_native_debit`, `fresh_aggregate_native_debit`, `stargate_native_fee_exceeds_cap`) | Fees exceed `--max-native-debit-wei` | Raise the budget or retry later |
| `APN_FEE_BUDGET_EXCEEDED` (`fresh_execution_estimate_over_cap`) | Fresh estimate above the approved maximum including headroom | Prepare again |
| `APN_INSUFFICIENT_GAS` (`aggregate_native_funding`, `fresh_native_funding`) | Native balance below principal plus fees | Fund the source account |
| `APN_INSUFFICIENT_ASSET` (`source_asset_balance`) | Source token balance too low | Fund the source account |
| `residual_allowance_review_required` | Existing allowance is neither zero nor exact | Review the allowance yourself; APN never resets it |
| `APN_REPREPARE_REQUIRED` | Quote or materialization validity too short | Prepare again |
| `pre_sign_rpc_unavailable`, `pre_sign_rpc_rate_limited` | RPC failed before signing; nothing sent | `bridge approve` before consent, `operation resume` after |
| `unsent_apn_reprepare_required` | Quote expired after a paid approval; bridge never sent | Prepare a new operation; check the residual allowance |
| `APN_RPC_RATE_LIMITED` | Provider cooldown, with `retryAfterMs` | Wait, then rerun |
| `APN_RPC_BUDGET_EXCEEDED` | Read budget used up for this invocation | Run `operation resume` again |
| `no_route` in `bridge routes` | LI.FI returned no route for the exact request | Read the `filtered_out` and `failed` rows; try another amount or later |

Provider conditions seen in `no_route`: LI.FI may offer no direct Across or Stargate fill of native MON from ETH (with
exchanges allowed it routes through swaps, a graph APN does not admit), and the Ethereum ETH to BNB composite can be
absent at some amounts, with LI.FI reporting `Tool fly not applied.` (`TOOL_NOT_ALLOWED`) on its Fly step.

## Protocol references

The reviewed protocol sources are [LI.FI contracts
`0f83f131`](https://github.com/lifinance/contracts/tree/0f83f131b4aff16cf774d9161465b8209f7453ec), [Across contracts
`19e346a5`](https://github.com/across-protocol/contracts/tree/19e346a5415e2ebb18fafe590f76dc90f413d1b5) and [Stargate V2
`50679756`](https://github.com/stargate-protocol/stargate-v2/tree/50679756e705fcc48b9642c20d4a40ded57c74d7). Stargate
endpoint IDs are 30101 (Ethereum), 30184 (Base), 30110 (Arbitrum), 30111 (OP Mainnet) and 30106 (Avalanche). The
Stargate native pools (asset ID 13) are `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931` on Ethereum and
`0xdc181Bd607330aeeBEF6ea62e03e5e1Fb4B6F7C7` on Base. LI.FI's unauthenticated `/v1/quote` endpoint is rate limited to
75 calls per two hours per IP.

## Compatibility

- **Bridge journals written before the allowlist and usage-ledger checks** are read through a separate strict legacy
  decoder that verifies the original record, transition chain, intent fingerprint and receipt binding and keeps the raw
  bytes unchanged. Public status marks the missing allowlist, usage lease and newer native-delivery fields as
  `legacy_unknown`. These records still take part in operation ID, idempotency and account conflict scans, but they are
  read-only: status and a valid saved receipt work, while approve and resume fail closed, so they cannot sign, submit or
  resend. An operation without a frozen allowlist binding must be prepared again.
- **Earlier proofs stay valid.** Records frozen with the earlier full deployment proof, Base fee proofs that carry the
  older oracle evidence, and records that bind an RPC origin load and validate unchanged. Older journals keep the
  observation diagnostics `explicit_archive_RPC_required`, `distinct_archive_RPC_required` and
  `historical_receipt_unavailable`; journals that already hold `unsent_apn_rpc_ambiguous` keep their recorded final
  outcome. A journal with a long telemetry history loads and is compacted on its next real change; a poll that changes
  only telemetry adds no transition, and a transition keeps at most the latest 8 telemetry rows.
- **1Click records** of schema v1 and v2 are read as the `base-usdc-to-tron-usdt` lane with their original status output,
  operation IDs and nonce reservation path; v3 records carry the lane. Ethereum nonce reservations are scoped under
  `eip155-1`.
- **Non-EVM source journal.** Offline LI.FI-shaped Solana, Mayan, NEAR-via-LI.FI and Circle inspectors that no command
  reached were removed; the source journal (`apn.non-evm-source-journal.v3`) still reads every record a released
  version wrote.
- **Circle Solana delivery records.** Earlier records (`<operation>.solana-delivery.json`,
  `circle-solana-delivery-claims/`) were made without the source-event binding and are no longer read. The next status
  proves the delivery again and records `<operation>.solana-delivery-v2.json` and a claim under
  `circle-solana-delivery-claims-v2/`; the old files stay as they are.
