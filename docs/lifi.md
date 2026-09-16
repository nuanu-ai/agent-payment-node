# LI.FI EVM cross-chain assets

This APN 0.5.21 package includes local-wallet route selection and execution for
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

Offline capabilities identify Base USDC → Solana USDC as a discovery-only
candidate, using LI.FI Solana chain ID `1151111081099710` and the Solana USDC
mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Inventory makes one
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

Configure each selected chain explicitly. The generic EVM `--rpc-url` option is
not a fallback for bridge operations.

### Admitted chains and native coins

| Chain | RPC environment variable | Native coin |
| --- | --- | --- |
| `eip155:1` Ethereum | `APN_ETHEREUM_RPC_URL` | ETH, 18 decimals |
| `eip155:8453` Base | `APN_BASE_RPC_URL` | ETH, 18 decimals |
| `eip155:42161` Arbitrum One | `APN_ARBITRUM_RPC_URL` | ETH, 18 decimals |

A native coin is a first-class registry row, not a token with a sentinel
address. It pays gas and Stargate's LayerZero messaging fee, and APN translates
the provider's zero-address wire sentinel into that row at the parse boundary.
The zero address is refused as a bridgeable asset, and a native **principal** is
not admitted at all: the LI.FI fee forwarder call, the allowance model and the
exact three-`Transfer`-log delivery proof are all ERC-20 shaped.

### Admitted token rows

| Chain | Token | Decimals | Address | Upgradeability pinned | Tools | Peers |
| --- | --- | --- | --- | --- | --- | --- |
| `eip155:1` | USDC | 6 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | legacy proxy: implementation and admin slots | Across, Stargate pool 1 | Base, Arbitrum |
| `eip155:8453` | USDC | 6 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | legacy proxy: implementation and admin slots | Across, Stargate pool 1 | Ethereum, Arbitrum |
| `eip155:42161` | USDC | 6 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | legacy proxy: implementation and admin slots | Across, Stargate pool 1 | Ethereum, Base |
| `eip155:1` | WBTC | 8 | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | immutable: code hash only | Across | Arbitrum |
| `eip155:42161` | WBTC | 8 | `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f` | beacon proxy: EIP-1967 beacon slot, beacon code, `implementation()` | Across | Ethereum |

Both sides of a route must be admitted rows with the same pair key, the same
decimals, and each other in their peer sets. Peer sets are asymmetric on
purpose: Base admits no canonical WBTC, so no WBTC direction touches Base.

### Assets refused rather than approximated

| Asset | Why it is refused |
| --- | --- |
| Native ETH principal | fee forwarder, allowance and `Transfer`-log evidence are ERC-20 shaped |
| WETH on any admitted chain | LI.FI itself filters the route: Across does not send WETH to EOAs, so delivery would be native ETH with no `Transfer` log to prove |
| USDT (Ethereum) | the Tether contract carries an owner-settable `basisPointsRate` transfer fee; a storage-only change is invisible to a code-hash pin and breaks the exact three-`Transfer` proof |
| DAI, cbBTC on these lanes | LI.FI returns no Across route for them between these chains |
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
digits for USDC, eight for WBTC. `--max-native-debit-wei` is an integer
native-coin budget on the source chain. APN uses integer arithmetic and rejects
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
packet must bind an actual LI.FI source quote and Base CCTP message to a
specific Solana receive transaction before this candidate can support a bridge
receipt. A recipient with no USDC associated token account is outside this
kernel's proof contract; its creation and rent payer need separate admission.
