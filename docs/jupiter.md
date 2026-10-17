# Solana Jupiter surfaces

Normal Solana RPC uses the anonymous `https://api.mainnet-beta.solana.com` baseline when `APN_SOLANA_RPC_URL` is unset or empty. No RPC account, signup or API key is required. A custom HTTPS URL is optional; invalid nonempty overrides fail without fallback. Public RPC has no APN availability guarantee and may rate-limit or refuse requests.

A saved `quoteRpcLifetime` binds the exact full endpoint hash. Known origin mismatches refuse before public resolver reads, preparation, owner approval or observation, without rewriting the operation or releasing its holds. Set the original endpoint to read that material. Legacy material without a saved origin keeps its existing genesis, executable-pin and signed-operation fences; no origin comparison can be inferred for it.

The canonical runtime supports the finite owner-admitted Jupiter V1 lanes described below.

## Removed V2 Quantum prototype

Releases up to 0.5.44 carried a dormant Jupiter Swap API V2 / Quantum prototype: an injectable read-only builder, V2 codecs, a `signable: false` guard, an offline `route_v2` decoder and the bundled review file `data/swap/jupiter-solana-abi-blocker-2026-09-17.json`. No shipped runtime could reach it, and it never signed. It was removed after 0.5.44 together with the inventory's `v2Quantum` field and V2 catalog entries. Every `swap solana jupiter` command runs through the installed V1 runtime. The prototype's September source audits (the unverified `route_v2` / Quantum account ABI) are in the git history of this file.

## Additive Jupiter V1 lane, 7 October 2026

The implementation adds one Jupiter V1 ExactIn route beside the retained V2 prototype: 1,000,000 lamports of native SOL to canonical USDC through the direct Whirlpool pool `83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d`. The route uses one 100% A to B step, no platform fee, no delegate and the payer's own token accounts. V2 Quantum remains dormant and `signable: false`.

The V1 guard binds the official program identities, runtime executable bytes, raw and compiled account roles, mint/vault/tick/oracle relationships, lookup table contents and the exact unsigned message. Its provenance is `runtime_bytes_only`; source reproducibility is unproved. The API minimum uses ceiling arithmetic and the client expected instruction floor can differ by one atomic USDC unit. The approval shows both values, and simulation and the finalized receipt must meet both. APN preserves the official route bytes.

`createApnCore` installs `createJupiterV1Runtime` for the existing Jupiter commands. Quote requires the actual active owner policy admitting SOL swap, USDC swap and the exact V1 mechanism before network reads. Preparation stores the authoritative operation and its public/encrypted owner binding. `approve` opens the genuine foreground TTY, then performs the first local signature and single send. `execute` requests fresh foreground approval for the same unmarked operation; an existing effect marker makes it observe only. MCP approval and execution return the exact CLI handoff. No caller approval artifact or structural signer port can unlock the finite Native signer.

The signer owns a canonical `ChainAccountStore`. It checks the same operation, owner, public account, envelope and active policy before TTY approval and before normal Keychain/decryption/signing. The exact fresh read material and simulation are saved as content-hashed chunks before signing. A public signature marker and encrypted exact signed bytes precede the fsynced first-send claim. The sender consumes that claim under the operation lock before one `sendTransaction` with `maxRetries: 0`. Crashes, transport ambiguity, missing status and blockhash expiry retain `unknown_finality`; status never signs, resends, requotes or opens wallet secrets.

Each command's Solana reads are bounded by that command's own physical request budget, derived from its read plan (`src/swap/solana-read-plan.ts`: quote 15, approve and execute 19, status 4, plus 2 of headroom), and by persistent per-provider pacing. No read budget is stored or carried across commands (APN 0.5.43); the stage and cumulative caps of earlier releases are retired.

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

Two real unmarked attempts exposed the short lifetime remaining after the official build and repeated full executable reads. An unsigned production shadow completed both simulations, but only 41 blocks remained after the second full read. Before saving a new quote, the canonical runtime now obtains `getLatestBlockhash` at confirmed commitment from its validated mainnet RPC, with `minContextSlot` at least the largest completed account-read context. The bounded response must leave 100–151 blocks after exact-message fee and current-height reads. The normal RPC groups those two independent confirmed reads in one existing JSON-RPC batch, correlates both response IDs, and charges both logical reads. The preceding blockhash/minimum-context read stays separate. Alternate ports without batch support retain sequential reads. This accommodates the observed anonymous PublicNode response-shape discrepancy; it does not promise consistent provider responses or availability, and an out-of-window lifetime still refuses. An out-of-window response keeps the existing `APN_REPREPARE_REQUIRED` error and includes public `error.details`: `remainingBlocks`, `observedBlockHeight`, `lastValidBlockHeight`, `blockhashContextSlot`, `requiredMinimumContextSlot`, `minimumRemainingBlocks` (100), `maximumRemainingBlocks` (151), and `commitment` (`confirmed`). Heights, slots, and the signed remaining-block difference are decimal strings, preserving exact integer values. These details describe the completed reads; they do not diagnose provider lag or change the lifetime guard.

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
[closure ledger](../reports/apn-closure-status-2026-10-08.md).

### Historical signed material authentication (removed)

The CLI-only `historical-authenticate` and `historical-retire` routes for the three fixed historical operations were removed after 0.5.44. The operations closed as `expired_unlanded`; see [the legacy reader note](jupiter-historical-retirement-readers.md).

## Additive upgraded Esv and 4H registrations, 11 October 2026

The unreleased 0.5.38 candidate separately registers the existing Esv and 4H
WhirlpoolSwapV2 pools for the same `099da3…` JUP6 payload and complete
ProgramData hash recorded above. Each has its own runtime.2 mechanism and
registry. Both asset rows require the selected new mechanism; historical owner
admissions cannot authorize it. All six preceding registrations and their
mechanism/registry digests remain unchanged, including the default historical
quote selection. No pool identity, enum-47 instruction, 25-account role, Memo
requirement, Whirlpool/Token executable pin, CPI or decoder contract changes.

This is registered support under the existing `runtime_bytes_only` contract.
The historical Esv simulation and diagnostic mixed-slot 4H fixture do not prove
either pool's behavior under upgraded JUP6. Each lane still requires a fresh
normal quote, complete program and account reads, successful exact-message
simulation with the unchanged strict CPI/account checks, exact active owner
admission and genuine foreground approval before a single send. Paid acceptance
requires its own finalized receipt within the frozen minima and expense caps.
Any different ABI, account, CPI or callback behavior refuses and requires
separate review; registration does not accommodate it. Quantum V2 remains
dormant and `signable: false`; its paid criterion is not waived.

Local synthetic generation vectors are not live simulation or paid proof.
Version 0.5.38 is an unpublished candidate and still needs separate normal
release and installed-consumer qualification.

The candidate also closes a source-identified relationship check: for enum47,
the named raw Whirlpool pool must equal the pool selected by the quote and
registered mechanism. A rehashed 4H quote paired with Esv raw roles previously
passed the initial material guard. That observation did not demonstrate a
financial bypass; exact simulation and receipt authority checks were still
required. The relationship now refuses in the shared quote/build binder before
resolver reads or guard admission. Valid same-pool layouts remain unchanged.

## 2026-10-11 C3-04 generic Jupiter closure

The 23 September reconciled C3-04 criterion covered a generic Jupiter/Solana operative signer and observer path, no-money evidence, and paid acceptance; it did not specify Quantum or all Jupiter routes. This record closes the generic row through the existing V1 direct Whirlpool lane. The historical V2 Quantum prototype remains dormant and `signable:false`; its separate paid criterion remains open and is not waived. Its eleven route-dependent account roles and deployed provenance remain unresolved. No Quantum paid, all-route, Source29, new release, or installed-consumer acceptance is claimed.

The saved Source26 v0.5.37 normal operation used source commit `9f26cae91910216aae7c2702bc4f56f5efd59450`, policy r27 digest `75ae6a1a467a74dabf8e8cfe3a1f28ae9deac2d4d6e9bb23a0492c34659f3745`, and the `jupiter-v1-whirlpool-runtime.2026-10-09` registry. Its phase record shows a fresh quote at 16:17:36 UTC and prepare at 16:17:51, before genuine foreground approval, one acknowledged dispatch, and one APN status at 16:18:35. Operation `848aecec2c6958974f72ff3739aee57e17fd6a7bfb26742a065219d8c69f36c5` is `finalized`. This demonstrates the no-money quote/prepare prefix before the paid effect in one operative path; it does not represent a separate no-send operation.

The quote hash is `97498ff5639dd79dd129c40e536331b1de9407748a333dd5873fcc25043985c3`: 1,000,000 lamports input, expected output 110,338 and minimum 109,787 USDC atomic. The independent saved canonical receipt is a single anonymous `getTransaction` POST with finalized commitment and no authorization header. It returned HTTP 200, transaction status `Ok`, `meta.err=null`, slot 455318569, actual fee 6,400 lamports, payer debit 1,006,400 lamports, and payer-owned USDC credit of 110,335 atomic. The receipt hash is `3e29254795507a6e4f446f858f43442cea788cb85eceaabbeedc50667969cfb1` for signature `3vy9USCBGFbpf25xN5HeRK3niNi6f18LzRhqyPtFigaXVJcA9fqdnBaSePZzvYhhyY6fwhu9Sy72WnyAUN9RdFPx`.

Immutable evidence anchors:

- Normal operation report, workspace-root path `reports/apn-all-remaining-2026-10-07/integration/resumed-closure-20261008/parallel-closeout-20261009/jupiter-source26-beta-policy27-distinct-new-normal-financial2-20261010/report.json`, SHA-256 `31eea93e9d9a3cf9241e4bf2ac3517caff0a46e0c9b0d4ddd80a2683607298ad`; finalized operation snapshot at `reports/apn-all-remaining-2026-10-07/integration/resumed-closure-20261008/parallel-closeout-20261009/jupiter-source26-beta-policy27-distinct-new-normal-financial2-20261010/normal-finalized-operation.json`, SHA-256 `e2592e89dd52dca3469058b3eb174b3fa214736b443e8b8726e6c7fecc1031c5`.
- Canonical receipt decoded summary, workspace-root path `reports/apn-all-remaining-2026-10-07/integration/resumed-closure-20261008/parallel-closeout-20261009/source26-normal-finalized-receipt-one-public-readonly-post-20261011/decoded-summary.json`, SHA-256 `2236f96e0da90383459187dc05b5a07536d69718ec5e70d5c95f40fcc566b7fd`; raw response body SHA-256 `6f42261bf9ca0c32f515088c74168e407437db669403601e39f34d9fb3b30045`; packet manifest `SHA256SUMS.txt` SHA-256 `d699544e221f033b541fe0305060d4e95d6958ec6dd20b7e31eea4a99508edbf`.

The original Quantum V2 obligations remain route-specific and open. This generic-row closure does not change them.

## Whirlpool c422b2 registrations, 16 October 2026

Orca upgraded the Whirlpool program at slot 457152296 (2026-10-15 07:22:05
UTC, Squads vault `GwH3Hiv5…Rx4PV`, transaction `2Z156jvt…kHNwzGT`). All eight
preceding registrations share the Whirlpool executable pin `610b1e39…c350f9ae`,
so every finite lane refused at the resolver's runtime executable pin from then
on. The four historical lanes were already unusable on mainnet: their JUP6
pin `899161c0…e321850f` predates the 8 October JUP6 upgrade.

This change adds a ninth to twelfth registration, one per reviewed pool. Each
binds the registered JUP6 snapshot (`099da3a2…a8a79a5f`, ProgramData
`3bd95cf0…40dbc517`), the unchanged Token pin, and the new Whirlpool payload
SHA256 `c422b22f3eefe86dd55878a4f505b9c68c26e241dc96af1573ca032b24b8ee3f`
with complete ProgramData SHA256
`a49ebc534880f4aaf525b5fd1504aed6223928bdbbea6c83d40473eb17abd04e`. Two
mainnet origins returned identical 10,485,760-byte accounts; see
`tests/fixtures/whirlpool-runtime-c422b2/README.md`.

| Route | Mechanism digest | Registry digest |
| --- | --- | --- |
| `whirlpool-v1-83-sol-usdc-runtime-c422b2` | `4c46bcfd9d2e24985efca7cfe73e174cd0b36e8054daf0499a99f590bb94ee7e` | `330d187eee7db765183befcc319fda3075f8306093d890c84369210fe66851f8` |
| `whirlpool-v1-fp-sol-usdc-runtime-c422b2` | `1f321322bc0d384f6cad129b17e01c196087a371d7668ec6071578675c131ec5` | `440a4b7a38235c1f66a9eab49cbb4fc3420238bbc71e2220921ab7c72104bdb1` |
| `whirlpool-swap-v2-esv-sol-usdc-runtime-c422b2` | `30a73ea0637238081aeb70f29a538d196b03697163883ef04be502a51b5bacd5` | `6f0a7b4580be24ad0fa18e99d9388f0be67c0724fca850194f5ec98a27d0b3e9` |
| `whirlpool-swap-v2-4h-sol-usdc-runtime-c422b2` | `7cd3351d54a1d8ee3517269613fcbd56b10aebc5adfcbdd002f2dc588196099f` | `779bafe47c78d319e211d3e4053075faac81a414918d067ea7d7e6a1487add3c` |

All eight preceding mechanism and registry digests, their route order and the
default historical quote selection are unchanged. No pool identity, enum 17 or
47 instruction, account role, Memo requirement, Token pin, CPI or decoder
contract changes. Both active asset rows must admit the same new mechanism;
a 099da3 admission cannot select these bytes, and a mixed admission refuses.

Saved material still selects its generation from registered executable
identities. One JUP6 snapshot is now shared by two generations per pool, so
when the pool and JUP6 pin match more than one registration, every registered
executable pin, Whirlpool included, must match exactly once. Materials with a
single candidate select exactly as before, so all existing operations and
historical material keep their dispatch.

This is registered support under the existing `runtime_bytes_only` contract.
No reproducible source build is claimed; the source review of the five Orca
commits between the two deployments is in [Orca](orca.md#whirlpool-upgrade-re-pin-16-october-2026).
The synthetic mixed-slot vectors in this change are not a live simulation or
paid proof. No live Jupiter quote was run: the canonical quote path requires an
activated owner admission, and a diagnostic around it would be new tooling.
The Orca keyless quote did simulate the same Whirlpool bytes on mainnet. Each
lane still requires a fresh normal quote, complete program and account reads,
exact-message simulation, exact active owner admission and genuine foreground
approval before a single send.

## Program authority pins and one route per pool (APN 0.5.43)

Owner decision: Jupiter no longer pins executable bytes. Each upgradeable
program is pinned by its ProgramData address and upgrade authority, read from
45-byte loader headers: JUP6 `4Ec7ZxZS6Sbdg5UGSLHbAnM7GQHp2eFd4KYWRexAipQT` / authority
`CvQZZ23qYDWF2RUpxYJ8y9K4skmuvYEEjH7fK58jtipQ`, Whirlpool `CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD` /
`GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV`, SPL Token `3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2`
with no authority. ATA and Memo (BPFLoader2), System and Compute Budget
(native) are pinned by their loader. A new deployment by the same authority is
accepted; another authority refuses with `solana_program_authority_changed`.
There is no upgrade cooldown: the exact-message simulation against the
programs as deployed, the exact compiled accounts and privileges, the encoded
minimum output and the finalized receipt checks carry the safety.

The twelve byte-pinned generations (four pools × 899161, 099da3, c422b2)
collapse into one current route per pool:

| Route | Mechanism digest |
| --- | --- |
| `whirlpool-v1-83-sol-usdc-authority` | `661c34724fb8d84d21077056341f1d38725f106eecb56253d6f31eca1cc4303e` |
| `whirlpool-v1-fp-sol-usdc-authority` | `c1ea8de6f3359088e114f32d57e123f70ba236ad02c5bbd85fc8e1b028db4273` |
| `whirlpool-swap-v2-esv-sol-usdc-authority` | `798d533799a59c7706050700e2d4f310b88a8c7c23005a056bd042475ca60630` |
| `whirlpool-swap-v2-4h-sol-usdc-authority` | `c549ef3dd6d5fc9c1787a3411d0a98eb8232fcca41101965573c7e69374cd74c` |

The historical generations stay as read-only parsers: their saved operations
are observed, released and abandoned as before, but their saved quotes no
longer prepare (`jupiter_v1_historical_route`). Route admission is unchanged,
so a policy that names any generation of a pool admits its current route.
Materials store 45-byte headers instead of complete ProgramData (18.2 MB →
about 0.1 MB per quote and per execution); older chunked materials still load.

A quote freezes the configured RPC blockhash inside the one resolve, so it
needs one official build instead of two. Every account read sends at most
eight keys (PublicNode's limit), each request pinned to the quote's context
slot. Per quote: 2 official API calls (was 3) and 8 Solana POSTs including the
simulation (was 17), about 0.1 MB received instead of 18.4 MB. The approval's pre-consent re-resolve shrinks the
same way. Pool fee rates and adaptive-fee constants are read, not pinned.
