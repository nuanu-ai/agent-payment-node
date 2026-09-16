# APN remaining sprint plan — 2026-09-16

This is the source-repository plan for the remaining APN work. It is outside
Tect; the dated 2026-09-15 plan was used only as local reference. The baseline
is `main` at APN `v0.5.21`, commit `94fabe3`.

Current source anchors: [`README.md`](../README.md) describes the 0.5.21
release and proof boundary; [`docs/gasless.md`](gasless.md) records the
Polygon offer and separate live rows; [`docs/lifi.md`](lifi.md),
[`docs/solana.md`](solana.md), [`docs/tron.md`](tron.md) and
[`docs/evm-assets.md`](evm-assets.md) retain the open acceptance boundaries.
The source gate commands are in [`package.json`](../package.json).

## Evidence boundary

Track every row with one explicit proof class:

1. **Source** — implementation, deterministic tests and static fixtures.
2. **Release** — exact tagged/archive bytes and release metadata.
3. **Installed** — the exact `v0.5.21` package, including legacy state reads.
4. **No-money installed** — installed journal, prepare and pre-send/recovery
   checks with no real signing, broadcast, provider submission or charge.
5. **Live acceptance** — owner-approved, real-wallet/mainnet/provider and,
   where applicable, receiving-human evidence.

Green source or installed tests never close a live row. Keep the evidence
artifact, exact version/commit, operation IDs, network, asset, recipient and
receipt together for every accepted row. Publication, Homebrew delivery and
installation are separate gates.

## P0 — clear the gate before claiming green

### P0.1 Stabilize the aggregate test gate

**Status: COMPLETE for the source aggregate at `a655c1c` (based on
`69c0974`).** One clean serial run passed `npm test` (1,447/1,447), cask
syntax (13 scripts), packaging behavior (58/58), supply chain (6/6), and
native `cargo fmt --check`, offline locked tests (29 unit and 4 integration),
and clippy. The first packaging failure was a 120-second timeout while its
reinstall fixture recursively copied the installed `node_modules` tree; the
fixture now links the exact first `npm ci` dependency closure. A subsequent
package identity failure exposed stale tracked `dist` bytes on merged main;
the generated output was synchronized with TypeScript source before this run.

The installed historical I745 test used a separately verified, neutral copy
of the retained archive (SHA256 `1883f117a84552e720319d2770ea9439fad30d8eb6f1bd3212f344854b0ce267`),
its 883 unchanged shipped files, and dependencies reconstructed from its
pinned lockfile. The reinstall fixture tests shipped archive bytes and recovery
with the first installed closure; it does not prove a second independent
dependency resolution. This source gate adds no release, installed, or live
payment acceptance proof; those remain separately recorded below. Exact
commands, log locations, and fixture hashes are in the local P0.1 aggregate
evidence artifact.

### P0.2 Verify the installed v0.5.21 no-money path

**Status: COMPLETE for installed no-money proof; live/payment gates remain
open.** The official GitHub release is published; its
manifest binds commit `94fabe3` to package `v0.5.21`. The downloaded manifest
SHA256 is
`2f445c02411e8ec1d8532c5ae3d33fd628ef25ca7f414a700eeba76c0dd0c6e5`, and the
archive SHA256 is
`34c4b04cc1ae95a3782b59fa3c7aff9581015440b503ff22cf84a8e92c1c4974` with
1,159,845 bytes; both match the release manifest and installed Homebrew
formula. The SBOM SHA256 is
`7b81c2627cabb8ef8e91a793d460e894a1aae53201402d73dfe12fa156de1984` with
1,642,630 bytes, also matching the manifest. **Installed no-money proof:
COMPLETE for this acceptance.** Homebrew `apn --version` returned `0.5.21`
(`apn version` is unsupported by this CLI); all `dist` and `package.json`
bytes across the 1,067 archive files match the installed package. The only
installed difference is the Homebrew-generated `bin/apn.js` shebang wrapper.

Use the exact release/package bytes, not the source tree, and preserve the
existing APN state directory. The disposable legacy gasless journal contained
23 operation files and 23 receipt files. Installed terminal `operation
status`, `receipt get` and `operation resume` probes returned saved terminal
evidence with unchanged terminal state; all 23+23 journal files remained
byte-identical, represented by the identical sorted 46-file byte-hash
manifest before and after
(`8ad52c99486f7185966e7b8ab3901ff41f98dfbf11beaae0f2819f498f690858`).
An isolated synthetic `awaiting_approval` record was accepted by the installed
validator; `operation status` and `operation resume` remained
`awaiting_approval`, the wait probe refused with `APN_INVALID_INPUT`, and its
operation hash stayed
`4904fd61d0fb0012918433e3eab0c7f0a31d03ee3cfbb189c2e748e9a159c` before and
after the checks. No signing or network request (including broadcast, RPC or
provider submission) occurred, and no money moved. This is recorded in the
local P0.2 audit artifact
(`artifacts/apn-p02-installed-no-money-20260916/evidence.md:3-13`, captured
2026-09-16; outside this repository).

**Depends on:** a verified v0.5.21 artifact and a disposable copy of legacy
state. **Accept when:** installed bytes, legacy journal compatibility and
pre-send/no-money behavior are all evidenced; this does not close live rows.

Run `operation status`, `receipt get` and `operation resume` only against the
disposable state copy: these commands may initialize directories or repair
saved local records. Compare the legacy journal bytes before and after
inspection; do not use live state.

### P0.3 Correct the Polygon row

Mark **Local gasless / Polygon live acceptance** historically complete on
`v0.5.18`.
The local slice records completed owner acceptance with delivery, sender debit,
fee and transaction evidence (`current-state.md:11-14`), and its handoff says
the 0.2 USDC transfer completed and the rehearsal passed again
(`handoff.md:20`). Commit `d3d750f` also released the execution-time pricing,
calibrated Polygon offers and mirror estimate. Do not carry the old unchecked
row into this plan.

The installed `v0.5.21` legacy-journal and pre-send no-money check is recorded
in P0.2. It did not trigger a fresh money transfer and is not a new Polygon
acceptance.

## Current acceptance matrix

| Row | Status | Evidence and next gate |
| --- | --- | --- |
| Local gasless / Polygon live acceptance | **COMPLETE historically on `v0.5.18`** | The existing owner proof records operation `106876bde0c4a8052fd34aefc277fe71add01c93e789fa9cac8809eee35f35e3`, 200000 atomic USDC delivered, sender debit 214536, fee 14536 and transaction `0x9b2ae9a8c04e727768d932e917df142c7456f38c0fccf335ab5c046233ea197e` (local Tect audit record, `current-state.md:11-14`; outside this repository). The execution handoff separately confirms the 0.2 USDC transfer and repeated Polygon rehearsal (local Tect audit record, `handoff.md:20`; outside this repository). |
| Installed `v0.5.21` legacy journal and pre-send path | **COMPLETE for no-money installed proof** | P0.2 proves release and installed code-byte parity, `23` operations plus `23` receipts, terminal status/receipt/resume recovery with the 46-file journal byte manifest unchanged, and a synthetic `awaiting_approval` pre-send guard whose operation hash remained unchanged through status/resume and refusal checks (local P0.2 audit artifact, `artifacts/apn-p02-installed-no-money-20260916/evidence.md:3-13`, captured 2026-09-16; outside this repository). The installed release still retains the older status classification; the source correction is unreleased. No approved nonterminal effect or fresh prepare was exercised, and no signing, send, provider submission, live bridge or live acceptance occurred. |
| Every other owner-only live acceptance row below | **OPEN** | No source, release, installed or historical operation evidence closes a live row. Keep Ethereum, Avalanche, MetaMask Agent, Smart Account, Coinbase, Solana, TRON, LI.FI and Direct EVM rows open until their fresh owner-approved evidence is recorded. |

## Owner-only live acceptance packet

Run only after P0.1–P0.2. Each row needs fresh action-time evidence and an
owner-approved recipient/amount/fee/recovery budget. Do not infer completion
from source tests, capability output, old operation IDs or package discovery.

| Priority | Row | Required evidence and acceptance |
| --- | --- | --- |
| P0 | Local gasless Ethereum | Fresh prepare/approval, zero-native-gas execution, exact recipient/fee receipt, independent settlement observation and recovery/no-resend proof on `v0.5.21`. |
| P0 | Local Avalanche alternative | Exercise the admitted x402 facilitator route; record facilitator response and independent on-chain settlement. The unavailable EIP-7702 Circle path is not acceptance. |
| P0 | MetaMask Agent, 8 chains | Ethereum, Optimism, Polygon, Monad, Sei, Base, Arbitrum and Linea; one bounded accepted transfer per row with provider debit, recipient delivery, receipt and no-resend recovery evidence. |
| P0 | MetaMask Smart Account Base | Fresh browser consent, exact USDC cap/expiry, zero-fee recipient delivery, owner/provider evidence and receipt. |
| P0 | Coinbase Base | Fresh provider approval and Base USDC delivery with provider debit/settlement and receipt; keep provider acceptance separate from source and install proof. |
| P0 | Solana local + Coinbase | Prove the four required rows separately: local SOL, local USDC, Coinbase SOL and Coinbase USDC. For Coinbase, record the provider’s explicit fee/rent capability refusal where sending remains blocked; account/balance inspection is not transfer acceptance. |
| P0 | TRON local | Local TRX and USDT, with activated sender, resource-fee evidence, solidified receipt, receiving proof and interrupted-execution/no-rebroadcast evidence. |
| P0 | LI.FI bridges | Canonical USDC remains **0/3**: Ethereum→Base, Base→Arbitrum and Arbitrum→Ethereum. Prove both chain effects, destination delivery, receipt and recovery; prove Arbitrum→Ethereum WBTC separately (it is not a fourth USDC row); include named receiving-human acceptance. |
| P0 | Dependency audit | **DONE (production graph, 2026-09-16):** 55 affected package records (5 high, 2 moderate, 48 low, 0 critical), collapsing to 3 advisories: [bigint-buffer GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) high chain with no npm fix; [stream-json GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x) moderate with a fix incompatible with jayson’s range; [elliptic GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84) low with no npm fix. Direct vulnerable dependencies: `@metamask/agent-sdk@6.1.4`, `@metamask/fox-sdk@2.7.0`. Remediation and upstream compatibility remain **OPEN**. |
| P0 | Direct EVM 9/9 | Re-run the complete nine-row direct-EVM acceptance matrix on `v0.5.21`, including the required gasless Base row. Do not promote the older six-row D4–D9 evidence to 9/9. |

The owner packet may use funded wallets, browser/provider consent and real
network transactions only under the owner’s separate live authority. Every
unfinished or refused row remains `OPEN` with its reason and next action.

## Source work after P0

Follow this order. Each card requires source tests, installed/no-money proof
where it changes the package contract, and a separate live acceptance record.

### Card 1 — Solana and TRON bridge directions (source/offline only)

The current bridge surface is EVM-only. The two selected directions below are
source/offline evidence; execution remains off. Carry the full contract through
route/quote, immutable prepare,
pre-send guard, foreground approval, single submit, source proof, destination
delivery proof and bounded recovery/no-resend. Bind the correct chain/address
forms, native fee/rent/resource caps, token identity and operation lock.

For the **first Base canonical USDC → Solana canonical USDC** lane, the
selected design is direct Circle CCTP V2 with Forwarding Service and a signed
upfront fee quote ([PR #77](https://github.com/nuanu-ai/agent-payment-node/pull/77),
[PR #85](https://github.com/nuanu-ai/agent-payment-node/pull/85)). The source
must pay the quoted fee separately from the burned principal so the full burned
amount mints on Solana. The merged preflight, draft, journal and source
observation work ([PR #88](https://github.com/nuanu-ai/agent-payment-node/pull/88),
[PR #90](https://github.com/nuanu-ai/agent-payment-node/pull/90),
[PR #91](https://github.com/nuanu-ai/agent-payment-node/pull/91),
[PR #93](https://github.com/nuanu-ai/agent-payment-node/pull/93)) remains
read-only/untrusted: Iris API access is unavailable for execution, so no route
is executable, no approved live transfer matrix exists, and no authenticated
Solana destination proof exists. Bind the signed quote and expiry, fee token
and total debit, Solana USDC ATA and any quoted ATA setup cost, source
burn/message, destination mint and recovery before any future execution
admission.
[Circle's upfront-fee flow](https://developers.circle.com/cctp/concepts/how-upfront-fees-work)
and [Forwarding Service](https://developers.circle.com/cctp/concepts/forwarding-service)
are the source contracts for this choice. The existing LI.FI Mayan MCTP quote,
source receipt and provider status parsers remain discovery/offline evidence:
the captured call has no onchain destination `minOut` or deadline. It is not
selected for execution. For the **second Base canonical USDC → TRON canonical
USDT** lane, the selected candidate is LI.FI 1Click/NEAR Intents. The read-only
preflight and structural source reconciliation
([PR #86](https://github.com/nuanu-ai/agent-payment-node/pull/86),
[PR #94](https://github.com/nuanu-ai/agent-payment-node/pull/94)) remain
untrusted source/offline evidence with execution off: no signing or sending,
no live TRON destination, and no authenticated destination or refund proof.
The candidate still needs its own source, destination and refund proof
requirements.

**Depends on:** an admitted provider/route contract for each destination,
canonical destination event/receipt evidence, and test fixtures for timeout,
partial delivery, reorg and lost response. **Accept when:** deterministic and
installed tests cover every boundary, CLI and MCP expose the same contract,
and a separately authorized live packet proves delivery on both chains.

### Card 2 — future dated multi-chain asset allowlist

This is future policy scope; no implementation is requested in this update. The
allowlist covers direct, gasless and bridge rails. Swaps are a separately
admitted rail under Card 3 and must not be implied by token-list admission.
Publish a dated, contract-pinned top-10 token list and an explicit matrix for
Ethereum, Base, Arbitrum, Optimism, Polygon PoS, BNB Chain, Avalanche C-Chain,
Unichain, Linea, Monad and Sei, plus TRON and Solana. The matrix names each
network's native coin (the required set includes ETH, POL, BNB, AVAX, TRX and
SOL) and gives an owner max-per-transfer and daily limit for every admitted
asset.

Define admission separately for direct, gasless, x402 and bridge rails, with
swaps admitted separately under Card 3. Every
top-10 token must have a gasless path, including a non-Circle paymaster where
Circle accepts only USDC; do not reduce scope to provider-supported rows. Add
batched balance reads (EVM Multicall and one Solana token-account request),
cache semantics, bounded retry/429 handling and an explicit “unable to read”
result that never becomes a zero balance. Record the expected full-balance RPC
count.

**Depends on:** the dated token/contract list, verified deployments, paymaster
and bridge contracts, and per-rail fee economics. **Accept when:** source and
installed tests cover every named network, native/token identity, owner limit,
rail admission, refusal for an unlisted network/token or unsupported rail,
batch/cache/retry behavior and CLI/MCP parity; owner live evidence covers a
native transfer and a non-USDC token transfer on every named EVM network and on
TRON and Solana.

### Card 3 — future separately admitted guarded swaps (no implementation now)

Keep Uniswap (Ethereum), SunSwap (TRON) and Jupiter (Solana) as a future,
separately admitted path. The protocol/API or SDK constructs the transaction;
APN validates and signs it. Show simulated
input/output and slippage before approval; enforce limit and approval caps;
persist submission before sending; and make status/resume durable and
observation-only after a possible send. Expose the same operation through CLI
and MCP.

**Depends on:** pinned router/program contracts, quote/route schemas,
simulation and receipt evidence for each chain, and asset policy from Card 2.
**Accept when:** source and installed tests cover slippage/limit/approve
refusals, crash/lost-response/no-resend recovery and CLI/MCP parity, followed by
a separately authorized live swap packet.

### Card 4 — Linux and Windows (optional)

Produce Linux and Windows packages, encrypted key storage without macOS
Keychain, and clean-system checks for installation, `apn version`, discovery
CLI and MCP. Keep this card behind P0 and Cards 1–3 unless the owner changes
the priority.

**Accept when:** each supported OS has reproducible package evidence and a
clean-system no-money smoke test; live payment acceptance remains a separate
owner packet.

## Immediate sequence

1. Finish P0.1 aggregate-gate diagnosis and the clean green run.
2. Finish P0.2 exact-installed legacy journal and pre-send/no-money proof.
3. Publish the corrected status matrix, with Polygon source/release complete
   and all unproven live rows open.
4. Hand the owner the live acceptance packet above.
5. Keep Card 2's allowlist and Card 3's swap path as future, separately
   admitted work with no implementation in this update; take Card 4 only if
   capacity remains.

No Tect artifact, claim, program state or dated plan is changed by this file.
