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

Independent small account groups and fee/height/rent reads use bounded JSON-RPC batches. Each ProgramData header is retained in its first full payload chunk, as described below. Each logical read still consumes the durable 64-attempt stage cap before the shared physical POST; the physical budget, persistent pacing and 192-attempt cumulative limit remain enforced. Large ProgramData chunks remain separate, and their complete bytes are hashed against the original executable pins. A batch does not establish one shared bank or relax individual context-slot checks. Financial sends cannot use the public read batch.

The Solana HTTPS transport requests gzip and bounds both compressed and decoded bodies at 2097152 bytes. Identity and gzip are the only supported encodings. Invalid, truncated or oversized compressed evidence fails before parsing; atomic integers still use the original BigInt JSON parser. This reduces transport overhead without omitting executable bytes.

After quote expiry, an operation in a pre-effect state with no submission marker is reconciled to `failed_before_effect` under the same operation lock used by the signer, and its usage reservation is released. An existing effect marker prevents this release. Signed or possibly sent operations retain their original signature and become observe only; neither expiry nor a failed observation permits another send.

### 8 October discovery and public mainnet compatibility

A fresh `maxAccounts=12` official quote selected an unadmitted pool while unfiltered discovery selected the reviewed legacy 83 pool. The legacy builder now permits one official unfiltered quote read after a strict finite-route refusal, before build and quote freeze. The same decoder, selected owner-policy pool, exact input, output/slippage, raw-message and simulation guards remain mandatory. HTTP/malformed failures and V2 policy selections do not trigger this retry. Unknown pools still refuse before resolver, persistence or private entry.

Fresh public mainnet account batches returned HTTP 429 with method limit zero; the identical single account request succeeded. `api.mainnet-beta.solana.com` therefore uses sequential account-method POSTs, charged and paced individually, selected before dispatch. An error ends the sequence without retry. Other endpoints retain bounded read batching. Production HTTP 429 now preserves its bounded JSON response and `Retry-After` for the existing RPC classification and persisted cooldown. Gzip wire/decoded limits and terminal error behavior remain unchanged. These compatibility rules do not extend blockhash lifetime, TTL, financial limits or signing authority.

## Pre-freeze RPC lifetime, 8 October 2026

Two real unmarked attempts exposed the short lifetime remaining after the official build and repeated full executable reads. An unsigned production shadow completed both simulations, but only 41 blocks remained after the second full read. Before saving a new quote, the canonical runtime now obtains `getLatestBlockhash` at confirmed commitment from its validated mainnet RPC, with `minContextSlot` at least the largest completed account-read context. The bounded response must leave 100–151 blocks after exact-message fee and current-height reads.

The complete original official build response and its hash remain unchanged. A separate hash-bound `quoteRpcLifetime` records the configured RPC origin, confirmed context, minimum context, blockhash and last valid height. Assembly uses that lifetime before quote freeze, and the genuine TTY identifies its source. Every official instruction, privilege, lookup, economic field and runtime pin remains subject to the existing checks.

After quote freeze, execution reuses that exact lifetime. It does not call `getLatestBlockhash` or replace the approved message. Full executable rereads, simulation, fee, expiry, active owner policy, Native approval, the permanent first-send claim and observation-only recovery remain mandatory. The 90-second TTL, 64/64/64 logical-read caps, 192 cumulative cap and 6,000,000-lamport native-expense cap are unchanged. Existing materials without `quoteRpcLifetime` retain their original official lifetime and validation.

The pre-dispatch local Solana/Jupiter producer passed 663 tests with zero failures or skips; the targeted quote/Native pipeline producer passed 38. A real 1,000,000-lamport attempt reached the Native signature and permanent first-send claim, then returned `unknown_finality`. Its saved signature is `5CpyBQgZbRtVrMAMnAKf8H8xM1ChNMzbHELfQA14U33pQDNfwZ3g6k94NRrCBSMXsL2shfn3L9kWyPbvy73x6HkQ`; operation `67cec83fd91f78acb9decf9ef89dcf1f95c9551dcdf996d0a840db4c48cd8457`. Public readback at 20:44 UTC had no signature status or transaction and unchanged payer SOL/recipient USDC balances. The frozen blockhash is expired. The journal and usage lease remain unknown; no resigning, resending or manual release is permitted. Paid acceptance remains open.

## Public dispatch diagnosis

The sender now retains an immutable dispatch observation after its one claimed RPC attempt. The record binds the operation, marker, claim hash, execution binding and saved signature. CLI `status`, `approve` and `execute` expose it as `data.dispatchObservation` when present. Old operations without a record remain readable; an earlier lost response is not reconstructed.

Only a request-ID-correlated JSON-RPC error can contribute a signed 32-bit numeric RPC code. Reasons use a fixed vocabulary; HTTP status and bounded cooldown may also be retained. Provider text, simulation logs and signed transaction bytes are excluded. The observation is diagnostic evidence: rejection or transport ambiguity keeps the permanent claim consumed and usage pending until independent chain finality. It never authorizes resend, resigning or manual release.

The current dispatch producer passed 703 Solana/Jupiter tests across 24 files, 130 Orca regressions and three shipped runtime-boundary tests. A focused 35-test producer includes a genuine TEST-key TTY rejection/reopen case, malformed/mismatched error-envelope refusal and claim-tamper refusal. All passed with zero failures or skips. Production JS matches tested emission after excluding only the compiler-generated source-map footer.

An 8 October production quote attempt stopped at the selected finite-lane gate before preparation or signing. A separate official unsigned quote at 04:04:52 UTC selected Whirlpool pool `9VuCJupdVXC1kKijULJQ2GPKPvk2kSMHtgvwDuQq3TDo`, outside the three reviewed pools. It has not been admitted. That later quote does not reconstruct either the preceding quote response or the older send failure. Any additional pool requires its own account/program/ABI review and owner policy admission; the route gate is retained.


## Finite Fp legacy lane and command routing, 8 October 2026

The separate `jup6-route-v1-whirlpool-fp.1` mechanism supports `FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q`. Its digest is `c859502204a2534d9356bc1139b83ce56d363aae5ebd7d46dc00477d48081ebe`; both asset rows must admit that exact mechanism. The pool uses legacy enum 17, 36 route bytes and 21 raw roles. Its immutable configuration binds spacing 2, fee 200, protocol fee 1300, fee-tier seed 2, both classic SOL/USDC vaults, pool bump and rederived pool/oracle PDAs. The static oracle is an empty System-owned account. Complete program bytes, account roles, ticks, minima, prospective expense, exact-message simulation and receipt checks remain mandatory. Historical 83/Esv/4H digests are preserved.

The public Fp fixture is explicitly diagnostic, has mixed original slots and contains no successful live simulation. Modelled full-guard and receipt vectors are labelled SYNTHETIC. The [reviewed Orca pool layout](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/state/whirlpool.rs) and [legacy swap accounts](https://github.com/orca-so/whirlpools/blob/f2a3d13fa04eb15cf5b5a309ef9b226fd5d34e36/programs/whirlpool/src/instructions/swap.rs) support the account review; this source reference does not attest the deployed executable.

CLI operation dispatch and inventory now use the same finite route registry. Previously the operation gate omitted 4H and Fp even though their runtime registry existed. Inventory continues to report no owner admission. Both legacy lanes may request `maxAccounts=12` and permit the existing single unfiltered discovery retry after a selected finite-route refusal; V2 lanes do not use that hint. Unknown or differently admitted pools still refuse.

## Signing lifetime reserve and failure diagnosis

A real quote failed with one millisecond left in its pacing window after the timer returned early. The scheduler now permits one additional wait for that remainder only when its clock advanced. A stuck or backward clock, or a second early wake, still refuses before the next physical POST. The request count, interval, persistent cooldown and retry rules are preserved.

Execution requires at least 24 blocks remaining after its final pre-signing height read. A smaller reserve returns `APN_REPREPARE_REQUIRED` before the submission marker or custody entry. No approved blockhash, message or economic field is replaced. The final sender still checks the frozen lifetime, deadline, owner policy and permanent claim boundary.

Failures while binding/signing or before the sender's permanent claim can now retain `data.executionFailure`: a create-only record bound to the existing marker, with a fixed phase, classified error, optional observed height and frozen last-valid height. It excludes provider text, logs, keys and signed payload. This diagnosis does not establish no-send finality, release usage or grant a retry. Old failures are not reconstructed retroactively.

The reserve-stage predecessor passed 914 Solana/Jupiter/Orca tests across 31 files with zero failures or skips; all 1227 source/test/script/config inputs stayed unchanged. The final full-read producer below covers the later resolver and simulation-diagnosis edits. Three shipped runtime-boundary tests and the 744-file/500-line source scan passed. All 744 production JS emissions match the tested build after excluding only the exact terminal compiler source-map comment. The retained older producers above describe their earlier source snapshots.

Operation `ea25d97d0da057bfab9a6b6ade2b5799d8b81333ab99c33c793a75c0a8bde5ee` reached a public signature marker on 8 October at 05:12:23 UTC but has no permanent send claim. Its saved fresh read left 12 blocks before expiry; the precise caught error was discarded by the previous implementation. It remains `unknown_finality`, with one million lamports held in usage. Public readback at 05:22 UTC found both this signature and the older `67cec83f…` signature absent, with unchanged SOL/USDC balances. Neither operation is resent or manually released. Paid Jupiter acceptance remains pending.


## Complete executable reads and current live checkpoint

ProgramData reads now retain the loader header in the first full payload chunk instead of making separate header-only requests. Each chunk is at most 1,500,000 bytes, whose base64 representation fits beneath the existing 2 MiB decoded RPC body cap. Every chunk checks owner, executable flag, lamports, declared space, exact slice length and minimum context. APN concatenates every executable byte and verifies the unchanged full payload pins. The semantic-account size bound, RPC origin, pacing, logical/physical caps and refusal behavior remain unchanged.

A fresh unsigned public check at 05:40:30 UTC on 8 October took 9,865 ms, with 14 physical POSTs and 16 logical reads rather than 22 and 24. The complete Token/JUP6/Whirlpool account bytes, frozen message and runtime pins matched. This is a public read benchmark; its old frozen message was expired and it did not sign, simulate a new effect or send.

Simulation refusal now exposes a fixed category: stale context, replacement blockhash, blockhash not found, insufficient funds for fee, instruction error or unclassified. Optional instruction index/custom code are bounded integers, including the transport's BigInt representation. Provider text and logs are excluded. The existing simulation refusal remains mandatory.

The final local producer passed 930 Solana/Jupiter/Orca tests in 32 files, with zero failures or skips. All 1228 source/test/script/config inputs remained unchanged. Source/test builds and the 744-file/500-line scan passed; all 744 production JS emissions match the tested build after removing only the exact terminal compiler source-map comment. A 22-test focused producer covers complete chunk assembly/refusals and sanitized simulation failures. The historical producers above retain their own source boundaries.

Current-candidate production MCP stdio passed live Jupiter quote, prepare and status in attempts 44 and 46, and returned exact foreground CLI handoffs for approve/execute. Attempt 44's unsigned operation retired after a pre-marker simulation refusal. Attempt 45 refused the selected finite pool gate before preparation. Attempt 46 received genuine foreground approval for 1,000,000 lamports, 50 bps and the existing 6,000,000-lamport expense cap. Its one send was acknowledged by RPC at 05:48:11 UTC, signature `5GVVqQgp6BF4crDgYkKmnEX8JL3HhjT33eoHJPiNHNnLLpYFoaTnzy4y3vacxAfuGX9Jo1yhF1vTHyu6s3k3mSmj`, operation `ed04535cb343db8bd5b7871b8725492c395206ccfe339661d15817c2ead7a738`. Public status was absent at 05:49:14 UTC and balances were unchanged. The journal remains submitted, with its permanent claim consumed. It is never resent or manually released. Paid acceptance remains open; source tests, MCP proof and RPC acknowledgement do not establish finalized delivery.

PublicNode compatibility (8 October 2026): account methods use individually paced POSTs and the resolver reads at most eight addresses per getMultipleAccounts. The endpoint accepted two eight-address controls and refused the equivalent sixteen-address request, even with a zero-length slice. The endpoint bound propagates through the durable Jupiter RPC; all accounts and executable bytes remain required, and every read consumes the existing caps. TypeScript builds and 46 focused tests passed.

A subsequent unsigned read refused at the Jupiter executable pin. Two independent RPCs returned identical ProgramData deployed at slot 454465850, payload hash `099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f`, while the admitted snapshot was slot 451957263/hash `899161c0e20b212c34671de0fbc2fcb7da4140fb837de431213e6ef6e321850f`. Historical pins and signed operations are preserved; no new program snapshot is admitted by this change.

## Separately registered runtime snapshot, 9 October local / 8 October UTC

The upgraded JUP6 runtime is registered for the existing legacy 83 and Fp pools
through separate mechanisms and registries. Historical four mechanism/registry
digests remain exact. Esv and 4H retain their historical snapshot and refuse
upgraded runtime bytes. No additional pool is admitted.

The new registrations bind payload SHA256
`099da3a26d336aa7174960f057546f192fc1ccda8e3e9d1b4aa5c69fa8a79a5f`
and complete ProgramData SHA256
`3bd95cf0775979fdaed8a383474461d538a6ef040303f161abf9ed8c40dbc517`.
Two independent mainnet origins returned identical 2,892,269-byte accounts,
deployment slot 454465850, unchanged upgrade authority and the canonical
executable Program pointer. Static ELF comparison found 60,192 additional
`.text` bytes. Neither source reproducibility nor whole-program semantic
equivalence is claimed; finite V1 retains its explicit `runtime_bytes_only`
contract. An unverified source-build record alone does not redefine that contract.

Both active asset rows must admit the selected new mechanism. The 83 mechanism
digest is `f8bcdf0e2beeb784153a7c7ffd114846f486c3ec2b1590b9509617420ccf1a5f`;
its registry digest is `32d64fc2b9fd97e96c9787a0fb1ab6618292fac536ff2fdd303ccab5e2387818`.
Historical owner policies do not authorize this version. Quote resolution and
the pre-sign reread use the selected registered code generation; full-payload,
header, pointer, ABI, account, CPI, expense, minimum and lifetime checks remain
mandatory. Saved material selects its generation from registered program
identities, without changing its historical JSON schema or digests.
Pinless historical diagnostics remain readable, but cannot select a runtime
generation, obtain a guarded proof or enter signing.

A fresh unsigned diagnostic on the official mainnet RPC passed all current
guards and exact-message simulation at 16:30:37 UTC on 8 October. The 83 route
input was 1,000,000 lamports; simulated recipient credit was 108,719 atomic USDC
against minimum 108,077, native spend 1,006,400 lamports and fee 6,400.
Simulation slot was 454598741, with 54,022 compute units. It used 3 official
API reads, 20 logical RPC reads and 18 physical RPC POSTs under a shared 64-read
bound. No owner admission, APN economic-state write, custody entry, signature,
send or paid receipt occurred. Fp has local model checks, without a fresh
successful mainnet simulation for this snapshot.

The preceding PublicNode diagnostic refused the unchanged lifetime guard:
its raw `getBlockHeight` response was 454598483 while the returned blockhash
expired at height 432636048. That inconsistent response is retained; no
height substitution or guard relaxation was applied. The official RPC
diagnostic used an independent fresh quote/build/lifetime.

All three existing marked operations still validate through their historical
83 generation. A pure read checked their operations and public material
chunks: 70 files retained exact hashes. Both public origins returned null
statuses and finalized transactions at 16:08 UTC; no usage hold was released
and no signed transaction was resent. New owner activation, normal installed
acceptance and finalized delivery remain separate work.

## Finalized receipt metadata compatibility, 8 October 17:05 UTC

The actual mainnet receipt for operation
`fae738543bf7cbe972115b49368dc9b461fca2d7a03c5db572b0dd75c3cabd1d`
contains top-level `transactionIndex: 1368`. The preceding strict decoder
refused that field and left the operation submitted even after both RPCs
reported successful finalized delivery. The primary [Agave response type](https://github.com/anza-xyz/agave/blob/db760d28d35aee77ce6c1dd1777aa4f029d5ed1e/transaction-status-client-types/src/lib.rs)
defines this optional field as `Option<u32>`.

APN accepts an absent or null index, or an integer from 0 through 4294967295.
Strings, fractions, negatives, overflow and every other unvalidated field
still refuse. The full response, including the supplied index, contributes
to the receipt digest. Signature, frozen message, finalized slot, loaded
addresses, CPI, native expense, token identities and both output minima
remain mandatory. Status observes the existing signature and never repeats
the financial effect.

The corrected source validator proved actual credit 107824 atomic USDC,
input plus fee 1006400 lamports and fee 6400 at finalized slot 454604807.
This read-only diagnostic did not mutate the operation or finalize its usage;
the normal freshly installed CLI checkpoint is recorded separately in the
[closure ledger](apn-closure-status-2026-10-08.md).
