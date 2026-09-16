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

**Next packet:** reproduce the reported aggregate-gate flake using the normal
serial commands (`npm test`, the packaging behavior/supply-chain gates and the
legacy native contract gate as applicable). Save the first failure and the
environment, determine whether the cause is ordering, shared state, timing or
the gate itself, fix that cause in source/tests, and obtain one clean aggregate
run. A passing rerun without the cause and a clean rerun is not a green claim.

**Depends on:** clean `v0.5.21` checkout and the exact gate invocation.

**Accept when:** the flake is explained, the smallest corrective change is
tested, and the full required aggregate gate passes once from a clean state.

### P0.2 Verify the installed v0.5.21 no-money path

**Release proof: COMPLETE.** The official GitHub release is published; its
manifest binds commit `94fabe3` to package `v0.5.21`. Archive SHA256
`34c4b04cc1ae95a3782b59fa3c7aff9581015440b503ff22cf84a8e92c1c4974` matches
the release manifest and installed Homebrew formula; the SBOM hash and byte
counts also match the manifest. **Installed proof: partial:** `apn version`
observed `0.5.21`, but the installed artifact retains the old status
classification while the new local source fixes it. The disposable legacy
journal check and guarded installed rehearsal remain **OPEN**.

Use the exact release/package bytes, not the source tree, and preserve the
existing APN state directory. Verify `apn version` is `0.5.21`, a legacy
gasless journal loads unchanged, and the pre-send guard/recovery path refuses
or completes only from saved evidence without signing, broadcasting, provider
submission or money. Record archive/manifest/package hashes and the journal
fixture or redacted operation evidence.

**Depends on:** a verified v0.5.21 artifact and a disposable copy of legacy
state. **Accept when:** installed bytes, legacy journal compatibility and
pre-send/no-money behavior are all evidenced; this does not close live rows.

Run `operation status` and `receipt get` only against the disposable state copy:
either command may initialize directories or repair saved local records. Compare
the legacy journal bytes before and after inspection; do not use live state.

### P0.3 Correct the Polygon row

Mark **Local gasless / Polygon live acceptance** complete on `v0.5.18`.
The local slice records completed owner acceptance with delivery, sender debit,
fee and transaction evidence (`current-state.md:11-14`), and its handoff says
the 0.2 USDC transfer completed and the rehearsal passed again
(`handoff.md:20`). Commit `d3d750f` also released the execution-time pricing,
calibrated Polygon offers and mirror estimate. Do not carry the old unchecked
row into this plan.

The remaining Polygon work is the installed `v0.5.21` legacy-journal,
pre-send and regression check in P0.2. It must not trigger a fresh money
transfer or be presented as new live acceptance.

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

### Card 1 — Solana and TRON bridge directions

Implement bridge directions into Solana and TRON; the current bridge surface is
EVM-only. Carry the full contract through route/quote, immutable prepare,
pre-send guard, foreground approval, single submit, source proof, destination
delivery proof and bounded recovery/no-resend. Bind the correct chain/address
forms, native fee/rent/resource caps, token identity and operation lock.

**Depends on:** an admitted provider/route contract for each destination,
canonical destination event/receipt evidence, and test fixtures for timeout,
partial delivery, reorg and lost response. **Accept when:** deterministic and
installed tests cover every boundary, CLI and MCP expose the same contract,
and a separately authorized live packet proves delivery on both chains.

### Card 2 — dated multi-chain asset allowlist

Publish a dated, contract-pinned top-10 token list and an explicit matrix for
Ethereum, Base, Arbitrum, Optimism, Polygon PoS, BNB Chain, Avalanche C-Chain,
Unichain, Linea, Monad and Sei, plus TRON and Solana. The matrix names each
network's native coin (the required set includes ETH, POL, BNB, AVAX, TRX and
SOL) and gives an owner max-per-transfer and daily limit for every admitted
asset.

Define admission separately for direct, gasless, x402 and bridge rails. Every
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

### Card 3 — guarded swaps

Add Uniswap (Ethereum), SunSwap (TRON) and Jupiter (Solana). The protocol/API
or SDK constructs the transaction; APN validates and signs it. Show simulated
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
5. Start Card 1, then Card 2 and Card 3; take Card 4 only if capacity remains.

No Tect artifact, claim, program state or dated plan is changed by this file.
