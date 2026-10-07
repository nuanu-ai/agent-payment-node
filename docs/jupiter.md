# Dormant Solana Jupiter surface

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
