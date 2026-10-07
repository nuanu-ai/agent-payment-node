# Solana Jupiter surfaces

The canonical runtime supports the finite owner-admitted Jupiter V1 lanes described below. The retained Jupiter V2 Quantum prototype remains dormant. Its historical limitations in this section apply to that prototype.

## Dormant V2 prototype

APN exposes `inventory`, `quote`, `prepare`, `status`, `approve`, and `execute`
under `apn swap solana jupiter`. The offline inventory freezes Solana mainnet
genesis, Jupiter Swap API V2, JUP6, wrapped SOL, canonical USDC, and the empty
default-deny program snapshot. Inventory reports `admitted: false` and grants
no spending authority.

`quote` can run only when the caller explicitly injects a read-only builder.
The shipped CLI and MCP runtime install no builder or RPC. The binder requires
canonical 32-byte base58 Solana identities, a positive lamport amount, and
canonical slippage integers within the owner cap.

`prepare` refuses until the owner separately admits both exact assets and the
mechanism. `approve` and `execute` return
`jupiter_v6_instruction_unverified`: the current guard validates the outer V0
transaction envelope but does not claim a verified JUP6 instruction and
account ABI. APN therefore installs no signer, sender, or observer. `status`
only reads an existing guarded swap operation from local durable state.

The official-source review is bundled at
`data/swap/jupiter-solana-abi-blocker-2026-09-17.json` (reviewed 2026-09-26).
Jupiter's [Common Errors documentation](https://developers.jup.ag/docs/swap/v1/common-errors)
links to the [JUP6 program page and displayed IDL on Solscan](https://solscan.io/account/JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4#programIdl).
The review recorded the IDL version slot as `449568452`; the same program page
reported deployed slot `449280566`. The displayed IDL defines `route_v2`
(`bb64facc31c4af14`), its typed argument order, ten fixed account roles, and
`RoutePlanStepV2` with the `Quantum { side: Side }` swap variant. This makes the
outer instruction syntactically decodable from the current displayed IDL.

The IDL route step does not bind the quoted `routePlan.swapInfo.ammKey`: each
`RoutePlanStepV2` carries the swap enum, `bps`, and input/output indices. The
IDL also does not assign Quantum pool, vault, oracle, or token accounts to the
route-dependent remaining-account positions. Solscan's page reports the
program executable but not verified; neither it nor the reviewed Jupiter
sources provide a deployed executable digest or source/build attestation tied
to this IDL. The exact `/build` fixture gap is closed by the historical fixture
below, but these account-binding and executable-provenance gaps remain. APN's
guard therefore stays `signable: false`.

The source-only `decodeRawBuildResponse` codec accepts the raw instruction
response documented for `GET /swap/v2/build`, including the optional OpenAPI
`priceImpactPct`, route `usdValue`, and blockhash `fetchedAt` fields. The source
pin is Jupiter docs commit `16e9e9d51819331c636079945047a595a44c7ee0`:
[Build guide](https://github.com/jup-ag/docs/blob/16e9e9d51819331c636079945047a595a44c7ee0/swap/build/index.mdx)
and [Swap V2 OpenAPI](https://github.com/jup-ag/docs/blob/16e9e9d51819331c636079945047a595a44c7ee0/openapi-spec/swap/v2/swap.yaml).
The sanitized fixture at
`tests/core/jupiter-fixtures/official-sol-usdc-quantum-build-20260924.json`
records one keyless HTTP 200 response from the official endpoint on
2026-09-24T23:00:22Z. Its public request used taker
`GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki`, 1,000,000 lamports
of wrapped SOL, and canonical USDC. The returned exact-input Quantum route
quoted 116,603 USDC atomic units at 50 bps slippage. The fixture includes
seven instructions, 39 account metas, five program IDs, and one address lookup
table. A deterministic test decodes the saved response and checks its exact
historical hash, including instruction bytes, account roles, and lookup-table
address order. This assertion is test-only; it does not accept a new quote.

The capture does not prove a deployed JUP6 or Quantum executable matches the
reviewed sources, and it is not a live transaction observation. No Solana
simulation, transaction assembly, signing, delivery, or finalized swap is
verified. The legacy assembled `decodeBuildResponse` and the `signable: false`
guard remain separate.

An offline-only `route_v2` decoder now reads the captured Quantum instruction's
typed arguments and checks all ten fixed account identities and privileges
against caller-supplied expectations. In this capture, the optional
`destination_token_account` is absent and uses the read-only JUP6 sentinel at
position eight. The decoder leaves the eleven remaining accounts opaque and
always returns `signable: false`. Its fixture tests do not establish the Quantum
remaining-account ABI, or deployed executable provenance.

The offline `checkQuantumBuildConsistencyOffline` check now reconciles that
decoded instruction with the raw `/build` fields for the captured single-step
ExactIn SOL to USDC layout. It requires matching input and quoted output
amounts, slippage, pair mints, caller-supplied fixed accounts, and the Quantum
side 0 / 10,000 bps / index 0 to 1 step against one 100% route leg. It rejects
nonzero platform fees or positive slippage, a remaining-account count other
than eleven, other unsupported route layouts, and a minimum output above the
quote. For this captured layout only, it also requires the quoted `ammKey` to
equal instruction account index 14; a mismatch is rejected. This observed
equality does not establish an account-role ABI for Quantum routes. The eleven
remaining account roles and deployed executable provenance remain unverified. The check
returns `signable: false`; it does not enable transaction assembly or execution.

## 29 Sep 2026 authoritative source audit

Jupiter's [official Common Errors page](https://developers.jup.ag/docs/swap/v1/common-errors)
links the JUP6 [IDL displayed on Solscan](https://solscan.io/account/JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4#programIdl).
I inspected the pinned upstream
[IDL](https://github.com/jup-ag/jupiter-amm-implementation/blob/cc068c9d1df0060c62f9a8a4fc37ea13ea7b9b39/idls/jupiter_aggregator_v6.json)
and [`jupiter/src/lib.rs`](https://github.com/jup-ag/jupiter-amm-implementation/blob/cc068c9d1df0060c62f9a8a4fc37ea13ea7b9b39/jupiter/src/lib.rs)
at commit `cc068c9d1df0060c62f9a8a4fc37ea13ea7b9b39`. Neither contains
`route_v2` or `Quantum`, so these repository files do not substantiate the
route ABI shown by the Solscan IDL. No build or executable attestation was
found tying this source and IDL snapshot to the deployed JUP6 executable. The
eleven route-dependent account roles remain unverified; APN remains
`signable: false`.


## Additive Jupiter V1 lane, 7 October 2026

The implementation adds one Jupiter V1 ExactIn route beside the retained V2 prototype: 1,000,000 lamports of native SOL to canonical USDC through the direct Whirlpool pool `83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d`. The route uses one 100% A to B step, no platform fee, no delegate and the payer's own token accounts. V2 Quantum remains dormant and `signable: false`.

The V1 guard binds the official program identities, runtime executable bytes, raw and compiled account roles, mint/vault/tick/oracle relationships, lookup table contents and the exact unsigned message. Its provenance is `runtime_bytes_only`; source reproducibility is unproved. The API minimum uses ceiling arithmetic and the client expected instruction floor can differ by one atomic USDC unit. The approval shows both values, and simulation and the finalized receipt must meet both. APN preserves the official route bytes.

`createApnCore` installs `createJupiterV1Runtime` for the existing Jupiter commands. Quote requires the actual active owner policy admitting SOL swap, USDC swap and the exact V1 mechanism before network reads. Preparation stores the authoritative operation and its public/encrypted owner binding. `approve` opens the genuine foreground TTY, then performs the first local signature and single send. `execute` requests fresh foreground approval for the same unmarked operation; an existing effect marker makes it observe only. MCP approval and execution return the exact CLI handoff. No caller approval artifact or structural signer port can unlock the finite Native signer.

The signer owns a canonical `ChainAccountStore`. It checks the same operation, owner, public account, envelope and active policy before TTY approval and before normal Keychain/decryption/signing. The exact fresh read material and simulation are saved as content-hashed chunks before signing. A public signature marker and encrypted exact signed bytes precede the fsynced first-send claim. The sender consumes that claim under the operation lock before one `sendTransaction` with `maxRetries: 0`. Crashes, transport ambiguity, missing status and blockhash expiry retain `unknown_finality`; status never signs, resends, requotes or opens wallet secrets.

The root-approved runtime cap is 64 logical network attempts for quote (including official quote/build HTTP and RPC), 64 for execution and 64 for observation, at most 192 for one operation. Preparation reads local state. Failed attempts count before transport; execution and observation counters survive restarts. This is a `runtime_cap`, not a field in the owner's asset policy. The approved maximum native expense is 6,000,000 lamports including input, rent, base and priority fees; each live frozen build still needs its own fee proof.

Tony waived CI for this task. Local implementation and fixture tests do not establish paid acceptance. The historical September rows retain their original identifiers, titles and statuses. A fresh exact owner policy, real foreground approval, actual first send and finalized receipt remain required before the generic Jupiter row can close. The saved 7 October diagnostic build is expired and cannot be used for live signing.

## Additional finite WhirlpoolSwapV2 contract, 8 October 2026

A separate mechanism supports the reviewed `Esvfxt3jMDdtTZqLF1fqRhDjzM8Bpr7fZxJMrK69PB7e` pool alongside the preserved historical 83 mechanism. This is Jupiter Swap API V1's enum 47, a 37-byte single-step route with 25 exact raw roles. It is separate from dormant V2 Quantum. Both active asset policy rows must admit the same exact Esv mechanism digest `c0ba30b8f7e47ce275c198599be046822dd5204740cc4985c27e0374041728b6`; the old digest cannot authorize Esv. The canonical runtime selects a finite registry asynchronously inside existing commands, with no user pool selector or change to synchronous core creation. Historical registry/material/admission hashes remain intact.

The Esv guard binds classic WSOL/USDC mints and accounts, spacing 2, fee 200 and PDA fee-tier seed 1027, three source-ordered fixed/dynamic tick arrays, the populated adaptive oracle and the immutable Memo executable bytes. Memo is a readonly account; Memo CPI, Token-2022, transfer fees, hooks and supplemental accounts are refused. Native SwapV2 CPI must be exactly one invocation with input 1,000,000, threshold 0, sqrt limit 0, ExactIn, A to B and no remaining-account information. Exactly two classic Token TransferChecked invocations must bind both mints, decimals, authorities, amounts and vault movements. Only source-declared swap fields may change; uninitialized reward growth, tick tags/bitmap/liquidity and static account identities remain fixed. The approval names the actual variant and pool while retaining the existing minima, caps, frozen message and single-send rules.

The initial retained Esv diagnostic bytes contained no successful simulation/CPI or finalized receipt. The later 8 October canonical quote (hash `861e26b855bdcf65421461b1d2de7b1b9c6f7943aa3c8713e49826f1469f5ea1`) passed the complete exact-message mainnet simulation with expected output 115889 atomic USDC and acceptance minimum 115310. Its approval stopped before the effect marker because the frozen blockhash expired or its exact fee was unavailable; it did not produce a paid receipt. Explicitly labelled synthetic unit vectors exercise parser, policy and runtime refusal behavior; they do not prove live or paid acceptance. Genuine fresh exact-message simulation, actual Jupiter self-event bytes and finalized delivery remain pending. Any native CPI tuple differing from the strict zero/zero/None contract refuses and requires contract review. The integrated unmodified TEST-key PTY cases passed locally, including revocation and single-send recovery. These use a separate test key and mocked transport; live and paid acceptance remain separate.

## Separate 4H WhirlpoolSwapV2 lane, 8 October 2026

The official quote later selected `4HppGTweoGQ8ZZ6UcCgwJKfi5mJD9Dqwy6htCpnbfBLW`. APN refused it before signing or sending. Its public on-chain configuration, pool/tick/oracle PDAs and classic SOL/USDC vaults were checked independently of the builder. The finite `jup6-route-v1-whirlpool-swap-v2-4h.1` mechanism has its own registry and requires matching owner admission for both assets. An Esv policy cannot authorize 4H; historical 83 and Esv digests remain unchanged.

4H uses the same exact enum-47 instruction contract and 25 raw roles, with spacing 4, fee 400, fee-tier seed 1028 and adaptive-fee control factor 60000. Both V2 pools retain strict immutable configuration, tick ordering, PDA, mint, vault, oracle, executable, simulation and exact-message checks. Tick and oracle records must belong to the selected pool. Financial caps, minimum-output checks, foreground approval and the single-send fence are unchanged.

The 4H TEST fixture combines seven fresh public account records with historical ancillary records whose original slots are retained. Its manifest marks that mixed provenance. It proves parser and refusal behavior only; it is not a uniform live snapshot, successful simulation or paid acceptance. Fresh production simulation and finalized delivery remain required.

## Coherent simulation balances and official RPC instruction encodings

The 8 October readonly mainnet capture at `tests/fixtures/jupiter-v1-live-simulation-83/` contains the untouched unsigned RPC response and its earlier resolved public material. The pool snapshot is at slot 454306430; the simulation is at slot 454306483. Its transaction succeeded in simulation, while the former APN checker refused because unrelated swaps changed the vault balances between those banks. This capture is a parser regression fixture and proves no paid swap.

When RPC returns the complete pre/post lamport and token vectors, APN derives monetary effects from that single simulation response. Every token role, owner, mint, decimal count and program is bound; vector amounts must match returned account bytes, exact native debit, vault movement and CPI transfer amounts. Partial, duplicate, mismatched or unbound evidence refuses. Without those vectors, the earlier conservative snapshot comparison remains in place. The read-only canonical USDC mint may have a changed supply between banks; authority, decimals, initialized state and freeze authority remain byte-identical, and the message cannot write the mint.

The [official simulation RPC documentation](https://solana.com/docs/rpc/http/simulatetransaction) documents parsed and partially decoded inner instructions. APN accepts those forms alongside compiled account indices through a finite strict decoder. Each supported parsed SPL/System operation is converted into its exact opcode, atomic amount and account tuple before the existing Whirlpool/CPI checks. Unknown fields, operations, token extensions, accounts, authorities or mixed encodings refuse. Financial limits and signature/send rules are unchanged.

The legacy 83 lane requests the documented `maxAccounts=12` inner-swap limit. A fresh public diagnostic selected the reviewed legacy pool at 12, while limits 14 and 16 selected SwapV2 pools. This filter narrows route discovery; it cannot admit a returned unknown pool, alter the frozen route or bypass simulation. Esv and 4H retain their own finite contracts and normal discovery. See [Jupiter quote parameters](https://developers.jup.ag/docs/swap/v1/get-quote#max-accounts).

## Quote lifetime and bounded public reads, 8 October 2026

The canonical quote constructor reads the full deployed executable bytes before requesting a second official build for the same quote. Only blockhash lifetime and documented timing metadata may differ. Instructions, account identities and privileges, lookup addresses, economic fields and route bytes must match exactly. APN assembles and simulates that final official message before saving the quote. Execution re-resolves the frozen build and reads the full executable bytes again; it does not replace the approved lifetime or message. The 90-second quote deadline and all financial limits remain unchanged.

Independent small account groups, the three pinned ProgramData headers, and fee/height/rent reads use bounded JSON-RPC batches. Each logical read still consumes the durable 64-attempt stage cap before the shared physical POST; the physical budget, persistent pacing and 192-attempt cumulative limit remain enforced. Large ProgramData chunks remain separate, and their complete bytes are hashed against the original executable pins. A batch does not establish one shared bank or relax individual context-slot checks. Financial sends cannot use the public read batch.

The Solana HTTPS transport requests gzip and bounds both compressed and decoded bodies at 2097152 bytes. Identity and gzip are the only supported encodings. Invalid, truncated or oversized compressed evidence fails before parsing; atomic integers still use the original BigInt JSON parser. This reduces transport overhead without omitting executable bytes.

After quote expiry, an operation in a pre-effect state with no submission marker is reconciled to `failed_before_effect` under the same operation lock used by the signer, and its usage reservation is released. An existing effect marker prevents this release. Signed or possibly sent operations retain their original signature and become observe only; neither expiry nor a failed observation permits another send.

### 8 October discovery and public mainnet compatibility

A fresh `maxAccounts=12` official quote selected an unadmitted pool while unfiltered discovery selected the reviewed legacy 83 pool. The legacy builder now permits one official unfiltered quote read after a strict finite-route refusal, before build and quote freeze. The same decoder, selected owner-policy pool, exact input, output/slippage, raw-message and simulation guards remain mandatory. HTTP/malformed failures and V2 policy selections do not trigger this retry. Unknown pools still refuse before resolver, persistence or private entry.

Fresh public mainnet account batches returned HTTP 429 with method limit zero; the identical single account request succeeded. `api.mainnet-beta.solana.com` therefore uses sequential account-method POSTs, charged and paced individually, selected before dispatch. An error ends the sequence without retry. Other endpoints retain bounded read batching. Production HTTP 429 now preserves its bounded JSON response and `Retry-After` for the existing RPC classification and persisted cooldown. Gzip wire/decoded limits and terminal error behavior remain unchanged. These compatibility rules do not extend blockhash lifetime, TTL, financial limits or signing authority.

## Pre-freeze RPC lifetime, 8 October 2026

Two real unmarked attempts exposed the short lifetime remaining after the official build and repeated full executable reads. An unsigned production shadow completed both simulations, but only 41 blocks remained after the second full read. Before saving a new quote, the canonical runtime now obtains `getLatestBlockhash` at confirmed commitment from its validated mainnet RPC, with `minContextSlot` at least the largest completed account-read context. The bounded response must leave 100–151 blocks after exact-message fee and current-height reads.

The complete original official build response and its hash remain unchanged. A separate hash-bound `quoteRpcLifetime` records the configured RPC origin, confirmed context, minimum context, blockhash and last valid height. Assembly uses that lifetime before quote freeze, and the genuine TTY identifies its source. Every official instruction, privilege, lookup, economic field and runtime pin remains subject to the existing checks.

After quote freeze, execution reuses that exact lifetime. It does not call `getLatestBlockhash` or replace the approved message. Full executable rereads, simulation, fee, expiry, active owner policy, Native approval, the permanent first-send claim and observation-only recovery remain mandatory. The 90-second TTL, 64/64/64 logical-read caps, 192 cumulative cap and 6,000,000-lamport native-expense cap are unchanged. Existing materials without `quoteRpcLifetime` retain their original official lifetime and validation.

The current local Solana/Jupiter producer passed 663 tests with zero failures or skips; the targeted quote/Native pipeline producer passed 38. A real 1,000,000-lamport attempt reached the Native signature and permanent first-send claim, then returned `unknown_finality`. Its saved signature is `5CpyBQgZbRtVrMAMnAKf8H8xM1ChNMzbHELfQA14U33pQDNfwZ3g6k94NRrCBSMXsL2shfn3L9kWyPbvy73x6HkQ`; operation `67cec83fd91f78acb9decf9ef89dcf1f95c9551dcdf996d0a840db4c48cd8457`. Public readback at 20:44 UTC had no signature status or transaction and unchanged payer SOL/recipient USDC balances. The frozen blockhash is expired. The journal and usage lease remain unknown; no resigning, resending or manual release is permitted. Paid acceptance remains open.
