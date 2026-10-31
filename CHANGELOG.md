# Changelog

Release artifacts, their SHA-256 digests and provenance for every version are on https://github.com/nuanu-ai/agent-payment-node/releases.

## 0.5.83 — 2026-10-31

- MetaMask gasless: before anything is signed, `gasless transfer prepare` and `approve` check that the current MetaMask login's project holds the connected server wallet. If it does not, they refuse with `mm_gasless_project_has_no_wallets` or `mm_gasless_wallet_not_in_project` and say how to sign in with the right account or create a new server wallet, instead of sending a delegation the service rejects.
- Security: the vendored Relay order-id and TRON utility bundles are rebuilt with follow-redirects 1.16.2 (GHSA-mrwp-f3q8-3g9p); APN never sent HTTP through that code.
- Security: the MetaMask CLI's `@oclif/core` now resolves minimatch 11.0.1 (GHSA-g3hv-75wg-m249).

## 0.5.82 — 2026-10-30

- Documentation rewritten as references of current behaviour; `CHANGELOG.md` and `CONTRIBUTING.md` added. No runtime change.

## 0.5.81 — 2026-10-29

- MetaMask gasless: a submit that stops without a result now reports where it stopped (`submit_diagnostic`) in the operation's own output.
- MetaMask native transfers: a failed vendor read now names the read and how it failed.

## 0.5.80 — 2026-10-29

- MetaMask native transfers: a refusal names the vendor check that failed and suggests a next command that runs as typed.

## 0.5.79 — 2026-10-29

- Security: custody envelopes zero every intermediate cipher output before the store reads the decrypted plaintext, and the plaintext now lives in its own memory buffer.

## 0.5.78 — 2026-10-29

- Fixed: a create-only state write that loses a race (for example, parallel `operation status` calls) now reads the winning record instead of failing.
- Circle delivery status states which operation it is bound to (`circle_attested_nonce`).
- Dependencies: the release audit's time-limited exception for a `deepmerge` advisory now covers only the Torus helpers and the bundled MetaMask EVM SDK.

## 0.5.77 — 2026-10-27

- Circle Base → Solana: delivery is bound to the burn's own `MessageSent` event and to a Solana receive later than the burn's block (delivery proof v2).

## 0.5.76 — 2026-10-25

- Circle Base → Solana: `apn operation status` proves delivery on Solana from the attested message bytes and records it once.

## 0.5.75 — 2026-10-25

- Each command declares one idempotency-key length limit, applied the same way by help, the MCP schema, the CLI parser and the runtime.

## 0.5.74 — 2026-10-24

- Internal test and release-tooling changes; no product change.

## 0.5.73 — 2026-10-24

- MetaMask Smart Account: after a pending connect intent expires, `wallet status`, `wallet permission list` and the refused connect say so and point to checking MetaMask, `apn wallet permission forget` and a new connect, instead of suggesting a retry. Nothing is signed automatically.

## 0.5.72 — 2026-10-24

- MetaMask native transfers: a fee quote above the owner's native fee ceiling is refused as `APN_FEE_BUDGET_EXCEEDED` with the quote, ceiling and remaining limits, instead of a corrupt-state error.
- Security: zod 4.6.7 and fast-uri 3.1.9. A zod 3 advisory in the bundled Coinbase Agentic Wallet CLI has no upstream fix yet and is excepted for those copies until 2026-11-23.

## 0.5.71 — 2026-10-23

- MetaMask Smart Account: when `wallet connect` finds the official Base Smart Account not enabled, it now suggests enabling it in MetaMask and rerunning the same connect, instead of switching to a local profile.

## 0.5.70 — 2026-10-23

- Internal test changes; no product change.

## 0.5.69 — 2026-10-23

- Relay: when `relay prepare` cannot freeze a quote, the refusal names the check that failed: the quote outlives the owner's policy (with both dates), an approval or deposit fee is above your ceiling (with both amounts), or the quote changed.
- LI.FI bridge consent: the fee line names the source network and what its fee model caps, instead of always mentioning Base.

## 0.5.68 — 2026-10-23

- Solana x402: the suggested continue command shell-quotes the seller URL and other values, so a URL with `?` or `&` can be pasted into zsh as is.
- Solana x402: a payment saved just before a local index write failed is named in that error, so it can be continued with the same key.
- x402: `operation resume --wait-seconds` on an expired authorization that was never sent returns the operation (wait outcome `not_exposed`) and closes it once finalized chain time passes its expiry.

## 0.5.67 — 2026-10-22

- Solana x402: when `x402 solana pay` fails after saving the prepared payment, the error names that payment (operation id, state, whether it was signed or exposed) and the next step.
- x402 errors for a selected non-USDC token (for example MXNB or USD1) name that token and chain, with amounts in its own atomic units.

## 0.5.66 — 2026-10-22

- Internal test changes; no product change.

## 0.5.65 — 2026-10-22

- `receipt get` for local EVM direct transfers, the Base USDC lane and Coinbase Agentic Wallet gasless transfers now shows the profile, chain, token, sender, recipient and amount, as `operation status` does. Stored records are not rewritten.

## 0.5.64 — 2026-10-22

- Security: the vendored Relay order-id and TRON utility bundles are rebuilt with follow-redirects 1.16.1 (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c); APN never sent HTTP through that code. Release preparation now checks the package versions inside every vendored bundle against npm's advisory database.
- Help examples for Circle EVM, Uniswap, Uniswap token, SunSwap, Jupiter and Orca commands show every required option.

## 0.5.63 — 2026-10-21

- Help and the command manifest type `x402 fetch prepare --max-amount-atomic` and the atomic limits of `wallet policy set` in the selected asset's own units, not only USDC. Values and flag names are unchanged.
- State locks: on a heavily loaded Mac the lock helper gets 5 s (was 1 s) to start, so a slow start no longer fails with `APN_STATE_SECURITY`. A helper that never answers still fails closed.

## 0.5.62 — 2026-10-21

- Coinbase Agentic Wallet (AWAL) on Solana: `apn wallet ensure-solana --provider coinbase-awal` and balance reads now work. Sending on Solana through AWAL stays blocked.
- Help and the command manifest name non-EVM amounts in their own units (lamports, SUN, the asset's atomic units).

## 0.5.61 — 2026-10-21

- AWAL x402: a plain `apn operation resume` of a paid purchase now reads its Base USDC settlement; before, it stopped at `ambiguous_effect` unless `--wait-seconds` was given.
- Stargate native (Ethereum → Unichain): the receipt shows `actualSourceFee` and the full source debit; older records gain it on their next observe.
- MetaMask native transfers: a deadline that passed before the provider call carries a deadline diagnostic.

## 0.5.60 — 2026-10-21

- Circle Base USDC → Solana: `apn operation status` settles the burn's hold on the Base USDC daily cap. A successful burn counts on the UTC day its proof was recorded; a reverted burn releases the hold. Status shows it as `sourceUsage`.
- Relay Ethereum USDC: when an existing allowance already covers the amount, `relay prepare` refuses with `APN_OPERATION_BLOCKED` / `relay_existing_allowance` (was `APN_INTERNAL`) and points to `apn wallet allowance status` and `revoke`.

## 0.5.59 — 2026-10-21

- Security: MCP server SDK 2.0.0 → 2.3.1 for three high-severity advisories (GHSA-jm63-cq47-j5jp, GHSA-46jr-4wx8-v453, GHSA-rvq5-wwqv-78pq); that package's licence is now Apache-2.0.
- `apn gasless transfer revoke`: an `unknown` submission records redacted diagnostics of the MetaMask provider process; an empty response is `provider_response_empty`.
- Stargate native: a balance that cannot cover the bridge is refused before the gas estimate, naming the principal and the LayerZero fee.

## 0.5.58 — 2026-10-20

- Stargate native and token: a value the wallet's ETH or the owner's maximum native debit cannot cover is refused before the gas estimate, with its numbers in wei and ETH, instead of an RPC configuration error.
- `wallet capabilities-solana` lists the mints Solana x402 can pay (USDC, USDT).

## 0.5.57 — 2026-10-20

- `wallet capabilities-solana` (CLI and MCP) reports the local Solana x402 `exact` lane and what it needs: a local wallet, an owner-admitted classic SPL mint and `APN_SOLANA_RPC_URL`; native SOL and Token-2022 are refused.
- A repeated `pay transfer approve` of a direct transfer whose signing never finished now says the signature is unresolved and points to `operation resume`.

## 0.5.56 — 2026-10-20

- Security: for ERC-7710 x402, any transfer from the wallet to the payee inside the authorization window blocks the "expired unused" proof, so a partial or split redemption can never release the hold.
- Security: refusal messages never quote seller text; seller values appear only in structured details.
- Uniswap token: releasing a principal hold after a swap that never signed requires a finalized-chain proof for each swap nonce.
- Foreground Permit2 x402 refuses offers valid for less than 30 s and matches the resource by origin and path.

## 0.5.55 — 2026-10-20

- x402 works with more sellers: payment windows up to 3600 s, unknown `extra` fields carried unchanged, the resource matched by origin and path, and every refused offer named with its reason.
- A paid response is never lost: duplicate `PAYMENT-RESPONSE` headers count only when identical, and the body is always kept.
- Clearer refusals for a missing `--rpc-url` and MetaMask shortfalls; policy consent names the chain's own native coin.
- Recovery: an abandoned Uniswap token swap that never signed releases its principal through `execute`; a leftover allowance names `apn wallet allowance revoke`.

## 0.5.54 — 2026-10-20

- New `apn wallet allowance status|revoke --asset <token> --spender <address>`: revoke-only (approve to zero), with terminal consent.
- Uniswap token: a USDC → USDT execute needs 10 requests before the send (was 24); a stranded marker recovers through `execute`; `cleaned` now means no residual allowance.
- Fixed: the actual fee of Base direct transfers; Solana x402 amount display; a MetaMask `AWAITING_MFA` notice is kept as an MFA task.
- Security hardening: an unconsented revoke frees its chain after its window; a send refused before transport stays resendable.

## 0.5.53 — 2026-10-20

- x402 to any seller: EIP-3009 payments on any chain and token the owner admits in policy (`apn wallet policy set --chain eip155:<id> --asset <token>`), verified on chain before paying.
- Permit2 x402 on any admitted chain and token, unattended over MCP under the same caps; new `apn x402 permit2 allowance set|revoke` for an owner-bounded, never-unlimited approval.
- Solana x402 `exact` (SPL USDC/USDT): new `apn x402 solana pay` (CLI and MCP), with the facilitator as fee payer and settlement only from finalized chain evidence. Needs `APN_SOLANA_RPC_URL`.
- OP Stack chains (OP, World, Celo, Unichain, Ink, Soneium and others) are proven at `safe`, other new chains at `finalized`; no hidden Base USDC defaults remain.

## 0.5.52 — 2026-10-20

- Changed: the x402 result `sha256` is now the plain SHA-256 of the response body; the internal domain hash moved to `result_hash`.
- Receipts show actual economics: Circle net amount and issuer fee, the actual network fee of EVM direct transfers, and actual swap input, output and fee.
- New `apn gasless transfer revoke` disables a disclosed, unredeemed MetaMask delegation on chain (closes as `revoked_unused`); new `apn circle approval revoke` for a leftover Circle Base → Solana wrapper allowance.
- Fixed recovery for Uniswap token cleanups, Across batch fills, Relay observe and already-sent Circle/Relay commands; Solana block height reads; Jupiter approval blockhash.

## 0.5.51 — 2026-10-18

- Fixed: a "never lands" proof now needs an RPC node that indexes the operation's era; a node with a short transaction index could release a hold for a transaction that had landed. Older records close only by a receipt or owner abandon.
- A machine clock moved backwards no longer blocks payments; daily caps still hold.
- Owner abandon (with terminal consent; the hold stays charged) for a Circle V2 route or direct EVM transfer that no proof can decide.

## 0.5.50 — 2026-10-17

- Every remaining operation state now has an exit: a proof, a chain-proven "never lands", or owner abandon with terminal consent.
- Merchant x402: 16 failed deliveries end as `delivery_failed` (payment and receipt are kept); a crash during or before signing no longer holds the account.
- NEAR 1Click and Circle approval: an ambiguous send that can never land ends `failed_proven_superseded`. Uniswap token and Stargate token cleanups can be retried with fresh consent; LI.FI bridge journals close by a chain-proven nonce check.
- Fixed: the Uniswap token "never lands" check could not complete against a real RPC.

## 0.5.49 — 2026-10-17

- The operation index is updated after every command that names an operation, so an operation closed by its own status or resume no longer keeps its account and profile blocked.
- Fixed: a merchant x402 payment never approved, a Permit2 authorization never exposed, a Relay native `failed_before_effect` and frozen legacy bridge journals no longer hold their account forever.
- `apn operation abandon|resume` on a terminal operation says so and points to `operation status` / `receipt get`.
- A MetaMask native transfer that crashed before signing and whose consent expired closes as `failed_before_effect` and releases its holds.

## 0.5.48 — 2026-10-17

- Fixed a 0.5.47 regression: Stargate records in pre-release schemas are readable again (read-only) instead of blocking their account and whole profile. An open one closes through `apn operation status` once the signer's finalized nonce has passed it.
- An unreadable record now blocks only the accounts it names, not the whole profile.
- A prepare blocked by an open operation suggests `apn operation status --operation <id>`.

## 0.5.47 — 2026-10-17

- New operation index: a prepare reads open operations on its own accounts instead of scanning every record. The first command after upgrading indexes existing records once (about 1 s per 2,000 records).
- Every money family reserves its account before its first network read or signature; `apn operation status|resume|abandon` and `apn receipt get` work for every family.
- Breaking: Orca USDC↔USDT is now a pool of the keyless Orca route (`apn swap solana orca quote --pool usdc-usdt`); the `stable-*` creation commands are removed. Stable operations already in flight still finish with the existing commands.
- Security: one shared custody envelope replaces 13 copies (byte-compatible); a new Keychain secret is passed to `security` on stdin, never on its command line.

## 0.5.46 — 2026-10-17

- Circle CCTP v2 fast transfers: when a public relayer mints first, `circle evm observe` (and `approve-mint`) detects it and adopts the relayed mint; the operation ends `external_fulfilled` without signing or sending anything.
- `circle evm adopt-external-mint` no longer reads historical contract state, so it works on keyless public RPCs (about 43 reads instead of 150).
- Linea's default RPC is `https://rpc.linea.build`.

## 0.5.45 — 2026-10-17

- Breaking: the CLI goes from 170 to 150 commands and MCP from 122 to 83 tools. `apn_foreground_handoff` replaces 33 hand-off-only MCP tools; Relay is `relay prepare/execute/observe/status/retire`; `*-network` commands and `wallet balance-asset` became `--chain` options. Command manifest v2 maps each removed command to its replacement.
- Removed: the Circle V1 executing runtime, the Uniswap Trading API path, Jupiter V2/Quantum, the legacy SunSwap executor and one-off historical recovery code. Records written by earlier releases stay readable.
- HTTP 429 is `APN_RPC_RATE_LIMITED` everywhere; the README is now user documentation.
- Fixed: a Circle v2 mint or cleanup that never reached the network is re-broadcast with identical signed bytes; a Permit2 race refused a concurrent call instead of replaying the recorded exposure.

## 0.5.44 — 2026-10-17

- Lanes that only worked for preconfigured profiles now work for any profile: Relay (all eight lanes, with `--recipient`), Circle CCTP V2 Fast to Sei, Linea and Monad, GasZip to Sei and MegaETH, the x402 merchant flow (any `--url`) and MetaMask native transfers.
- Owner policies can pin allowed recipients for direct, x402 and bridge admissions, and allowed payees for local x402 (`--x402-payees`).
- Breaking for scripts: `--profile` is required on Relay status/observe and MetaMask native transfers; `relay native prepare` needs `--source-chain`/`--destination-chain`; merchant prepare needs `--url`. Policies naming old Relay or merchant references must be restaged once.

## 0.5.43 — 2026-10-16

- Every feature works on keyless public RPCs without archive endpoints or API keys, with far fewer requests (a LI.FI Base → Arbitrum bridge: 21 instead of 167). Direct EVM needs a batch-capable endpoint (see `docs/evm-assets.md`).
- Solana programs are pinned by program id and upgrade authority, so Orca and Jupiter keep working across program upgrades without re-admission.
- Gasless operations close on a safe receipt, so lagging safe heads on Arbitrum and Unichain no longer block closing.
- Fixed: a Jupiter status holding a finalized receipt could stay `submitted`; the lock-busy error names the configured wait.

## 0.5.42 — 2026-10-16

- Every check that can refuse runs before signing; a signed but unsent transaction is sent once, stays resumable, or ends when another transaction consumes its nonce.
- Every operation state has an exit (a proof, a chain-proven expiry, or `apn operation abandon`); upgrades no longer make old records corrupt; operations are bound to the chain, not one RPC URL.
- x402: settlement and expiry read `authorizationState` (2 RPC calls per poll instead of 9–11); paid results are delivered at once; concurrent purchases on one wallet are allowed.
- More lanes go through owner admission and the shared usage ledger (legacy Base USDC transfers, local x402, Solana and TRON limits, Circle gasless, Stargate native, Base → Solana CCTP); swaps are admitted by route.

## 0.5.41 — 2026-10-16

- Compatibility: Orca and Jupiter are re-pinned to Orca's upgraded Whirlpool program (2026-10-15); owners must admit the new digests.
- x402: the first EIP-3009 send requires a successful anchor revalidation in the same call.
- Fixed: GasZip payout signatures parse correctly, so delivered Sei/MegaETH funding closes; LI.FI RPC budgets match the real read plans and pre-sign rate limits, timeouts and 5xx errors are recoverable; MetaMask gasless no longer wedges its journal and works within public RPC log limits.
- Reverse Linea, Monad and BNB routes are no longer offered as preparable.

## 0.5.40 — 2026-10-11

- MetaMask gasless: SDK-sponsored single transfers on Monad and Sei deliver the full USDC amount with no token fee and no native debit for the sender. The paid batch route is unchanged.
- Monad simulation responses with very large numeric values are accepted without weakening validation; Across observation rechecks canonical headers on the primary public RPC, and historical state reads need an explicitly configured archive RPC.
- Known limitation: MetaMask gasless on Optimism is not supported (the relayer reports `relayTransactions=false`).

## 0.5.39 — 2026-10-11

- Circle CCTP V2 funding lanes are available through the normal commands, including proof-only adoption of an externally relayed mint.
- MetaMask: failed reads return closed, redacted diagnostics; native MetaMask transfers are bound to owned profiles.
- Jupiter batches historical finalized-height reads; the docs note that Uniswap needs an archive RPC.

## 0.5.38 — 2026-10-10

- Jupiter: swap lanes are bound to their configured pool and registered for the current Jupiter and Whirlpool programs.
- MetaMask: transient read failures return sanitized diagnostics (stage, provider status, error code); journal, hold and retry behavior is unchanged.
- The README separates the supported anonymous Solana path (Jupiter V1) from the dormant V2 Quantum path. No RPC-provider signup or API key is required for the supported baseline.
- Licensing note: the MetaMask Agent Wallet dependency chain includes `@toruslabs/ffjavascript` 6.0.0 (GPL-3.0), declared in the SBOM.

## 0.5.37 — 2026-10-10

- Jupiter quote fee and confirmed-height reads are batched, so they fit keyless public RPC endpoints; expiry guards are kept.
- Refusals before a quote is frozen show the lifetime values behind them.

## 0.5.36 — 2026-10-10

- Solana money routes default to an anonymous public RPC endpoint; EVM routes take any public HTTPS RPC URL. No RPC-provider signup or API key is required.
- New lanes for preconfigured profiles (opened to any profile in 0.5.44): foreground Permit2 x402 payments (`apn x402 permit2 approve|observe`), Circle CCTP V2 Fast funding, GasZip funding to Sei and MegaETH, MetaMask native transfers, a fixed-net MetaMask gasless mode and an x402 transfer-proof merchant flow.
- Fixed: foreground bridge continuation, guarded handling of expired partial operations, Circle finality status, Jupiter status actions and public RPC recovery.
- Coinbase gasless transfers enforce the owner allowlist.

## 0.5.35 — 2026-09-29

- Direct EVM transfer observation classifies evidence failures safely instead of failing generically.

## 0.5.34 — 2026-09-29

- Base and Arbitrum USDC direct transfers batch their RPC reads.

## 0.5.33 — 2026-09-29

- Fixed: Orca stable-swap receipts failed to verify because of BigInt instruction indices.

## 0.5.32 — 2026-09-29

- Arbitrum USD₮0 direct approvals batch their RPC reads.

## 0.5.31 — 2026-09-28

- Gasless USDT keeps RPC failure diagnostics instead of dropping them.

## 0.5.30 — 2026-09-28

- Native Sei balance reads use a bounded number of RPC requests.

## 0.5.29 — 2026-09-28

- Direct EVM balances report the network's own native gas symbol.

## 0.5.28 — 2026-09-28

- Gasless USDT discloses the effective fee and any persistent permissions before approval.
- x402 Permit2: a payload assembler and an unsigned CLI preflight; public RPC calls are paced after each transport completes.
- Jupiter checks captured Quantum AMM data for consistency.

## 0.5.27 — 2026-09-28

- Added: gasless USDT on Ethereum (policy-bound prepare, local signing, a single guarded send, recovery from safe receipts, foreground execute); a guarded Orca USDC → USDT stable swap; Relay bridges with durable journals and frozen fee ceilings (Ethereum USDC → Base ETH, BNB → Monad and Polygon native, Arbitrum USDC → Ethereum USDC); direct transfers of WETH and other pinned tokens.
- Local gasless is bound to the owner's asset policy, with an optional pinned recipient; read-only Ethereum gasless fee quotes.
- Changed: RPC reads are batched and capped per command across direct transfers, Solana, LI.FI, Uniswap and Relay; TRON RPC request spacing is configurable.
- Fixed and security: resuming an ambiguous direct transfer never rebroadcasts (observation-only resume); expired prepared swaps without effects are retired; the vulnerable Solana decoder path and a `stream-json` advisory are removed; Relay transitive security alerts are patched.

## 0.5.26 — 2026-09-23

- Added guarded Uniswap token-input swaps (token → token), with hardened, bounded RPC sessions.
- Fixed: a token swap cleanup with no on-chain effect now recovers.

## 0.5.25 — 2026-09-22

- Added Stargate V2 bridges: quotes, guarded native ETH and USDC native-drop execution, explicit EIP-1559 fee ceilings, and LayerZero delivery verification.
- LI.FI: guarded native Linea, Ethereum → Monad and BNB composite routes, an optional API key, more EVM quote destinations, and the owner bridge allowlist enforced. Public RPC reads are bounded, paced and batched; observation can use an archive RPC and resumes from checkpoints.
- x402: Permit2 signing inputs are revalidated; read-only Permit2 offer inspection and optional payer inspection (also over MCP).
- Also: balance reads for all direct EVM assets; the approval screen shows the frozen policy binding; MCP hands Jupiter swap approval to the foreground.

## 0.5.24 — 2026-09-18

- New `--priority-fee-wei` lets the owner set the priority fee for direct EVM transfers.
- Fixed: a Jupiter BigInt error, Uniswap late status, and slippage refusals now say what refused.

## 0.5.23 — 2026-09-18

- Direct transfers on eight more allowlisted networks.
- LI.FI bridges on allowlisted assets: native ETH over Across, a registry bound to the allowlist, and pinned USDT.
- Fixed: TRON no longer pins the node software version; Orca reads the finalized transaction version correctly; Uniswap receipt proofs accept multi-word Swap log data.

## 0.5.22 — 2026-09-18

- Portfolio: a batched, keyless balance read across every allowlisted network.
- Owner allowlist: a global asset policy registry, owner activation of multi-asset allowlist policies, a shared usage reservation ledger, and direct EVM, TRON and Solana transfers gated on the allowlist.
- Keyless swaps in the CLI and MCP: Uniswap V3 ETH → USDC/USDT, SunSwap V2 TRX → USDT and Orca Whirlpool SOL → USDC, each with a foreground single send.
- Cross-chain: Circle CCTP V2 Base USDC → Solana; NEAR Intents 1Click Base USDC → TRON USDT, Ethereum ETH → TRON TRX and → Solana SOL. Also a no-overwrite import of an existing local EVM wallet.

## 0.5.21 — 2026-09-16

- Fixed: MetaMask Agent records written before 0.5.20 were reported as corrupt and blocked new transfers on every rail; they are readable again.

## 0.5.20 — 2026-09-16

- MetaMask Agent and Solana transfers no longer expire while the owner reads the approval screen. MetaMask Agent reprices within what was approved (the fee never above the ceiling, the recipient never below the floor); Solana takes a fresh block reference after approval and simulates the exact transaction before the key is opened.

## 0.5.19 — 2026-09-16

- Local gasless: a transient RPC or bundler failure between approval and submission is retried inside the approval window instead of ending the transfer. A retry never re-signs or re-sends.
- A transport failure is now reported as `gasless_rpc_unavailable`; receipts written by earlier releases are accepted and repaired when next read.

## 0.5.18 — 2026-09-15

- Local gasless: gas prices are set when each step runs, never above the maximum USDC fee the owner approved. Ethereum and Polygon offers are sized from estimates with at least 20% margin.
- Before approval, APN checks the same operation with a throwaway key; if it does not fit, the operation ends `failed_before_effect` without loading the owner's key. Saved earlier intents are unchanged.

## 0.5.17 — 2026-09-15

- A local wallet on Avalanche C-Chain can send native USDC without holding AVAX, through PayAI's public x402 facilitator: one EIP-3009 authorization, the facilitator pays gas, no token fee.
- Owner abandon for an Avalanche facilitator transfer that cannot be proven, allowed only after the authorization has expired.

## 0.5.16 — 2026-09-15

- `apn operation resume --observation-rpc-env` accepts saved MetaMask Agent and Smart Account gasless operations. The named RPC is used for observation only, and the saved record keeps the variable name, origin and URL hash, never the URL.

## 0.5.15 — 2026-09-15

- An unresolved money operation now blocks new operations only on its own network and sending account, not the whole profile.
- Terminal approvals ask for a six-character code bound to the action instead of a long phrase.

## 0.5.14 — 2026-09-15

- Local gasless freezes the owner's whole fee limit, so a paymaster price move between preparation and signing no longer cancels an approved transfer.
- A failure before anything was disclosed ends `failed_before_effect` and releases the profile; `apn operation abandon` accepts Local and MetaMask gasless operations whose outcome is still unknown after the approval window.

## 0.5.13 — 2026-09-15

- Recovery for Coinbase Base gasless operations; Smart Account RPC reads are paced.
- The owner can abandon an expired Solana or TRON transfer that never landed, after APN proves its validity window passed with no transaction on chain. It is never resent.

## 0.5.12 — 2026-09-11

- Local gasless operations can be recovered through an explicitly named, verified, read-only observation RPC.

## 0.5.11 — 2026-09-11

- Added USDC-paid gas ("gasless") transfers for local wallets, plus gasless transfers for MetaMask Agent server wallets and MetaMask Smart Accounts.
- Added local Solana (SOL, USDC) and TRON (TRX, USDT) wallets with direct transfers, each with its own encrypted key.
- Added LI.FI EVM bridges with foreground approval and delivery checked on both chains.
- `apn operation abandon` lets the owner close a provider operation whose outcome cannot be determined; dependency advisories remediated.

## 0.5.10 — 2026-09-10

- Fixed: frozen EVM fee envelopes are validated by whether they can execute; an encoded zero priority fee is accepted.

## 0.5.9 — 2026-09-08

- Direct transfers and x402 on Ethereum and Arbitrum One, and explicit asset selection for Base transfers; stable Arbitrum fee approval.
- x402 accepts a `txHash` settlement alias and byte-bounded offer lists.

## 0.5.8 — 2026-09-06

- x402 works with any HTTP method: `x402 inspect` and `x402 fetch prepare` accept `--method`, `--headers-json` and `--body-base64` (MCP: `method`, `headers_json`, `body_base64`), and the request is frozen into the operation. Coinbase Agentic Wallet refuses requests with a body.

## 0.5.7 — 2026-09-05

- Fixed: a pending MetaMask consent recovers safely.

## 0.5.6 — 2026-09-05

- MCP foreground handoffs are rendered safely; an injected browser wallet must be selected explicitly.
- Security: hardened release supply chain; the UUID dependency advisory is closed.

## 0.5.5 — 2026-09-04

- Smart Account consent selects the real MetaMask provider through EIP-6963 and rejects Rabby or ambiguous legacy injection.

## 0.5.4 — 2026-09-04

- Fixed: closing an expired, unused ERC-7710 authorization works with RPC providers that limit log ranges, and accepts the finalized head moving forward.

## 0.5.3 — 2026-09-04

- Recognizes `eth_getLogs` range-limit errors phrased as `up to N block range` (for example on Blast RPC).

## 0.5.2 — 2026-09-04

- Fixed: MetaMask Smart Account recovery after an ambiguous paid HTTP response. An expired authorization is closed as unused only after a finalized, complete proof that no Base USDC transfer happened; otherwise it stays unknown.

## 0.5.1 — 2026-09-04

- MetaMask Smart Account uses the complete official ERC-7710 facilitator set on Base, rechecks the pinned Base block before execution and encodes the delegation salt exactly. Records with older facilitator sets stay readable.

## 0.5.0 — 2026-09-03

- New MetaMask Smart Account profile: one browser consent (ERC-7715) grants an exact Base USDC allowance and expiry; an encrypted local session account then executes exact delegated calls and pays gas, with no further MetaMask popups.
- Direct transfers and standard x402 (offers that advertise `assetTransferMethod: erc7710`) work through it, with the same operation, receipt and recovery model in the CLI and MCP.
- Note: npm audit reports the transitive uuid advisory GHSA-w5hq-g745-h8pq through the MetaMask packages; the affected code path is not used.

## 0.4.3 — 2026-09-02

- MetaMask Agent Wallet fixes: accepts the newline-delimited MFA output of 6.1.5 and the `evm` namespace; x402 settlement proof stays pinned to the captured safe block while the chain advances.
- Added recovery of provider requests in the CLI and MCP that never replays the request.

## 0.4.2 — 2026-09-02

- MetaMask Agent Wallet: matches the `mode: server` response of `@metamask/agent-wallet` 6.1.5 for Base USDC transfers and x402 signing, and catches sender drift before the transfer is created.

## 0.4.1 — 2026-09-02

- MetaMask Agent Wallet: browser sign-in through the official short-lived OTP pairing flow.

## 0.4.0 — 2026-09-02

- New MetaMask Agent Wallet profile: mobile QR connect, server wallet create or reuse, status and Base USDC balance.
- Base USDC direct transfers and EIP-3009 x402 payments through it, using APN's operation, receipt and recovery model.

## 0.3.10 — 2026-09-02

- Fixed: Coinbase x402 retries a transient Base RPC failure while collecting settlement evidence, within the original window, without calling the wallet provider again.

## 0.3.9 — 2026-09-02

- Coinbase Agentic Wallet x402 fixes: paid-response headers and checksummed addresses in seller JSON are accepted; settlement windows are timed exactly. The payment is never replayed.

## 0.3.8 — 2026-09-01

- Accepts the AWAL 2.12.1 x402 success response; existing `provider_result_invalid` operations can be recovered by their exact transaction, with no replay or second payment.

## 0.3.7 — 2026-09-01

- Recovers an older x402 payment that settled on chain but lost its seller result, by verifying the exact Base USDC transaction, without replaying the payment.

## 0.3.6 — 2026-09-01

- Coinbase x402: conflicting outer metadata is rejected, and transient observation failures recover only within the saved time window. The payment is never replayed.

## 0.3.5 — 2026-08-31

- Coinbase Agentic Wallet x402 accepts more seller JSON responses, within bounds.

## 0.3.4 — 2026-08-30

- Coinbase x402: a confirmed settlement without seller output ends as `failed_settled_without_result`, and its receipt keeps the settlement evidence.

## 0.3.3 — 2026-08-30

- Standard x402 through the Coinbase Agentic Wallet: inspect, policy and idempotency, a paid fetch by the provider, recovery without replay, and independent Base USDC settlement evidence, in the CLI and MCP.

## 0.3.2 — 2026-08-30

- Base USDC direct transfers through the Coinbase Agentic Wallet, with foreground approval, recovery without replay and an independent on-chain transfer proof.

## 0.3.1 — 2026-08-30

- Coinbase Agentic Wallet reuses an already signed-in session without a second OTP; `Base` balance output is normalized to `base`.

## 0.3.0 — 2026-08-29

- New Coinbase Agentic Wallet profile: connect, create or reuse, status, address, Base USDC balance and funding guidance. Payments through it are not enabled yet.

## 0.2.9 — 2026-08-29

- MCP grows from 7 to 15 tools: x402 inspect, prepare, approve, resume, status and receipt, and direct transfer prepare with a handoff to foreground CLI approval. MCP stays local-only and cannot sign or send on its own.

## 0.2.8 — 2026-08-29

- Fixed Homebrew installation by pinning zod 4.4.3; no behavior change.

## 0.2.7 — 2026-08-29

- Local stdio MCP server with discovery, wallet and policy tools, backed by the same core as the CLI. No payment tools yet.

## 0.2.6 — 2026-08-28

- Agent-readable CLI discovery: `apn --help`, hierarchical help and a full `apn help --json` manifest. Discovery runs before any state, Keychain, network or signing access.

## 0.2.5 — 2026-08-28

- Owner-set limits: each profile owner configures encrypted USDC and optional ETH ceilings; there are no built-in money limits.
- Unattended x402 fails closed before any payment when no policy is set, the offer exceeds the ceiling, or the wallet holds more than allowed. Settlement is awaited automatically for a bounded time.

## 0.2.4 — 2026-08-28

- x402 compatibility: the `PAYMENT-RESPONSE` header alias, strict UTF-8 media parameters and extra settlement metadata are handled.

## 0.2.3 — 2026-08-28

- Fixed: direct-transfer approval could hang after the confirmation phrase was typed; approval can now be cancelled.

## 0.2.2 — 2026-08-28

- Fixed decoding of Base ERC-20 `balanceOf` results.

## 0.2.1 — 2026-08-28

- Fixed creating the login Keychain secret on first use without a terminal. Use this version instead of 0.2.0 for Homebrew installs.

## 0.2.0 — 2026-08-28

- First public release: an encrypted disposable Base wallet under `~/.apn`, direct USDC transfers, standard x402 v2 payments, durable receipts and recovery, and Homebrew installation.
