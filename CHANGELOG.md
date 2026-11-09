# Changelog

Release artifacts, their SHA-256 digests and provenance for every version are on https://github.com/nuanu-ai/agent-payment-node/releases.

## 0.5.101 — 2026-11-10

- **No zod 3 left in the npm dependency tree.** GHSA-mrhx-c7xc-m3w5 (high): zod before 4.6.6 can exhaust memory validating an oversized array. `@x402/core` and `@x402/evm` move from 2.23.0 to 2.30.0, which require zod 4. The header codecs APN calls now also refuse a decoded value that is not a JSON object; the payment types, the Permit2 proxy ABI and its addresses are unchanged. awal 2.12.1 declares zod 3 but its CLI never imports it, and its one x402 call now resolves to the shared `@x402/core` 2.30; an npm override pins its zod to APN's 4.6.7. The release audit's zod exception, and its install-path scope, are gone. awal's Electron companion, which runs `x402 pay`, still carries its own compiled copy of zod 3 inside its prebuilt bundle, where neither an override nor `npm audit` reaches; it validates the companion's own tool inputs, not the seller's 402 answer.
- **MetaMask Smart Account vendor bundle** regenerated for `@x402/evm` 2.30.0, with its new loader manifest pin.
- **CI** also runs the x402 and override pin tests, which used to run only in the local legacy packaging set. The release audit now refuses an exception with an unknown field instead of ignoring it.

## 0.5.100 — 2026-11-09

- **MetaMask Agent gasless, session token clock skew.** A Mac whose clock ran even one second behind MetaMask's saw a freshly issued CLI token as issued in the future and refused it as `mm_gasless_session_unavailable`; a new login could not fix that. The token's `iat` and `nbf` may now be up to 60 seconds ahead of the local clock. `exp` keeps no tolerance.
- **Tests and builds run on GitHub's runners.** The whole core suite now runs in CI on `macos-15` runners in eight shards, with the packaging tests and the forbidden-surface check. The other local release preparation gates run there too: supply-chain and platform tests, exact regeneration of the four vendor bundles, and the production and vendor-emitted audits. CI jobs publish the TypeScript build of `dist/` and the regenerated vendor bundles, and a manually dispatched workflow resolves the lockfile for dependency updates. Nothing about the installed CLI changes.

## 0.5.99 — 2026-11-09

Two LOW findings from QA's review of 0.5.98 (Codex, re-checked by Claude). No CRITICAL, HIGH or MEDIUM remained.

- **NEAR 1Click, the usage hold in status.** Status saved a safe source receipt as `source_observed` but settled the usage hold only at the end, after the 1Click status read and the destination proof. A failure in either left the hold `reserved` or `submitted`, counting against the daily limit (also on later UTC days) until a status got through. The hold now follows the saved journal first and again right after the source outcome is saved, before any provider or destination read. Deposits submitted before 0.5.98 were never held and are not added to the ledger afterwards, so on the day of the upgrade the daily limit does not count them.
- **LI.FI, a restored journal with a surviving send claim.** A journal restored from before its effect signed, already past its ordinary bound (as 0.5.96 could leave one), could not record a SEND claim that survived the restore: the catch-up's first step (`unsealed` → `signing_started`) was an ordinary transition, refused on every resume, so a send that may have moved money was never recorded or observed. Entering `signing_started` is now a send step and bounded evidence like the rest of the send; past the ordinary line it can happen at most once per effect, because the release back to `unsealed` is ordinary and the normal path signs only with room for its whole send. The bounds grow to fit both effects' full catch-up: up to 12 closing transitions past the 512th and then the end (the 525th at most), an open journal up to 1 MiB + 832 KiB and a finished one up to 1 MiB + 896 KiB.

**Downgrade.** 0.5.98 cannot read an open LI.FI journal with more than 519 transitions, any journal with more than 520, an open one over 1.5 MiB, a finished one over 1 MiB + 576 KiB, or a catch-up `signing_started` recorded past the 512th transition.

## 0.5.98 — 2026-11-09

Fixes from QA's second independent review (Codex, re-checked by Claude) of 0.5.97, and the NEAR 1Click owner-policy gap found while preparing it.

- **NEAR 1Click under the owner policy.** `oneclick source submit` never loaded the owner's active allowlist policy: no lane admission, per-operation or daily cap, recipient pin or usage hold applied, and a missing or expired policy did not stop it. Each lane is now its own `bridge` mechanism on the payer's origin asset, `{ "provider": "near-1click", "reference": "<lane>.v1" }` on Base USDC or Ethereum ETH. Submit checks the active policy (its EVM account must be the payer), the lane, the caps and the lane's `recipients` pin before any quote, checks them again after the foreground consent, and holds the principal in the usage ledger before signing. A failure before the seal releases the hold; the journal refuses to seal after the effective deadline (`oneclick_source_quote_expired_before_seal`) or once the run's hold is no longer held (`oneclick_source_usage_hold_not_held`), and status releases an unsigned record's hold once that deadline has passed. Status settles the hold from the journal (`submitted`, `unknown_finality`, `finalized`, `failed_confirmed_revert`, `released_unsubmitted`) and reports it as `usageHold`. Profiles that use 1Click need a policy revision admitting their lanes; until then submit refuses with `APN_ALLOWLIST_REFUSED` and `oneclick_source_active_owner_policy_required`, `oneclick_source_mechanism_not_admitted` or `oneclick_source_policy_refused` (asset, rail or lane not admitted, a cap or the policy window, named in `cause`). Records written before 0.5.98 hold nothing and are unchanged.
- **Stargate V2 native lane (Ethereum ETH to Unichain), expiry before the send marker.** After approval, nothing rechecked the prepared expiry until the send marker, so a wait for the usage hold, the signer check or the signing lock could carry the send past it. The expiry is now checked again after signing, as on the token lane; an operation that expired by then is refused with `expired_before_marker`. Any refusal between the usage hold and the send marker (a changed signer, a signing failure, a bad signed transaction, that expiry) now releases the hold at once, since nothing was sent, and the operation must be prepared again: a retry of it is refused with `APN_REPREPARE_REQUIRED` / `usage_released_before_send`.
- **Solana x402, a payment left signed.** A later `pay` of a payment that stopped right after signing checked only the blockhash lifetime and sent it, even if the owner had since changed the allowlist or the Solana x402 policy. `pay` now checks both again before exposing signed bytes. If either changed, nothing is sent, and `observe` ends the payment without effect once its lifetime passes.
- **Delivery trace root value.** 0.5.97 tied the trace root to the verified transaction's sender, target and calldata but not its value. The native-fill proof (Linea, Monad, BNB native) and the BNB composite proof now also require the root's value to equal the verified transaction's, and the BNB composite root must carry an explicit value and input. A mismatch is a wrong RPC answer: it is read again on the next resume and the operation stays observable. callTracer reports no transaction hash; the trace is requested by the verified one.
- **Owner recipient pins on gasless and swap admissions.** An owner's `recipients` list (1 to 16 addresses) can now be written on `gasless` and `swap` admissions, so the allowlist can restrict who receives money on local gasless transfers on every chain (before: Ethereum and Base only, one address), on the Avalanche facilitator, Coinbase and Ethereum USDT gasless lanes, and on every swap, including a Uniswap swap to another address. A swap is bound by the list on either of its two rows (the asset it spends and the asset it receives); swaps that pay only the owner (Jupiter, Orca, SunSwap) need the owner on the list. An unlisted recipient is refused with `APN_ALLOWLIST_REFUSED` / `allowlist_recipient_not_admitted` at prepare, approval, reservation and first send. The single gasless `recipient` keeps its meaning; a row cannot carry both (`recipient_pin_conflict`); Coinbase rows accept either. MetaMask Agent and Smart Account gasless transfers and direct transfers from provider wallets are not admitted by the allowlist at all (their limits are the provider's: Guard policy, the Smart Account permission, the Coinbase wallet's controls), and `docs/allowlist-policy.md` now states this boundary. Releases up to 0.5.97 cannot read a policy that uses the new fields: do not downgrade a profile after staging one.
- **Solana x402, the usage hold.** The hold was reserved under a second policy load taken after the check against the prepared admission. It is now reserved under the same load that matched it.
- **LI.FI journals an earlier release filled.** 0.5.96 and earlier wrote journal transitions with no reserve, up to 1 MiB. A journal grown to within about 44 KiB of 1 MiB before its bridge transaction was safe could never record that safe proof under 0.5.97's capacity rules: every resume was refused with `bridge_record_capacity`, and the operation stayed open with its claims and usage hold. Evidence a journal can add only a bounded number of times may now pass 1 MiB like the terminal transition, without its read telemetry: an effect's first safe proof, the destination proof, and the loss of an inclusion that was never safe (a reorg; at most once per effect past the line). Ordinary changes still cannot, and a provider hint passes only together with such evidence or the end. An effect now starts its send only when all of its send transitions fit under the ordinary bounds, and every step after signing (`sealed`, `submitting` and the save after the send, each at most once per effect) is always recorded, so a journal that reached its ordinary bound mid-send no longer leaves an effect sealed in custody or with its send claimed but unrecorded: it sends, ends at expiry in its usual halt, or is observed. On a two-transaction route the approval signs only when the journal also has room for the bridge's send and the approval's ordinary observations, so a nearly full journal no longer sends the approval and then refuses the bridge on the ordinary path (RPC failures between the two sends can still use that room, and the route then ends `failed_after_approval` at expiry). A guarded WBTC bridge whose run stopped after custody signed the bridge transaction but before the journal recorded it stayed open forever with its usage hold; the next resume now records the seal (signing nothing; a further confirmed resume sends those bytes) and, once the operation has expired, ends it as `failed_after_approval` with the transaction never sent (an expired unsent WBTC approval, or a bridge-only WBTC route, ends `failed_before_effect`). An open journal is now bounded at 1.5 MiB and a finished one at 1 MiB + 576 KiB (9 copies of at most 64 KiB, derived next to the constants). A full journal with an effect left `signing_started` and nothing sealed now saves the release to `unsealed` inside its expiry halt (`failed_before_effect`, or `failed_after_approval` once the approval is safe) instead of being refused forever. The operation index salvages a damaged bridge journal under the finished-journal bound (1 MiB + 576 KiB) instead of reporting `record_not_json`.

**Downgrade.** Do not go back below 0.5.98 in the middle of an operation or after staging a policy that uses the new fields:
- 0.5.97 and earlier cannot read an open LI.FI journal larger than 1 MiB, a finished one larger than 1 MiB + 64 KiB, or a lost inclusion or send step recorded past the 512th transition.
- 0.5.97 and earlier refuse a policy with `recipients` on a `gasless` or `swap` admission, or a Coinbase gasless admission pinned only by `recipients`; once such a revision is staged, they report the profile's whole policy state as `APN_STATE_CORRUPT`.
- 0.5.97 does not settle 1Click usage holds; holds 0.5.98 took stay open under it.

## 0.5.97 — 2026-11-08

Fixes from QA's independent review (Codex, re-checked by QA against `dist/`) of 0.5.96.

- **Owner recipient pins on bridges.** An owner's `recipients` list on a `bridge` admission, or on one alternative of it, was never checked by LI.FI (Across, Stargate) or by either direct Stargate V2 lane. Any recipient passed, against the documented contract. LI.FI checks the pin at prepare, approval, reservation and first send. The Stargate token lane checks it at prepare, before the approval and the send, and at the usage hold. The Stargate native lane checks it at prepare and at the usage hold taken right before signing, including a retried hold. A recipient the pin does not list is refused with `APN_ALLOWLIST_REFUSED` / `allowlist_recipient_not_admitted`. The lanes that may only pay the owner (BNB, Monad, Linea native; both Stargate lanes) are still bound by the pin: a pin that does not list the owner refuses them.
- **ETH to BNB (Across + Fly), a run that dies after saving the destination proof.** A resume that found a saved proof always wrote `completed`. For a saved `recovered_weth`, `below_floor` or `protocol_mismatch` proof that `completed` failed validation on every resume, and since bridges have no abandon, the operation stayed open. A saved proof now settles through the same outcome as a fresh one, and a new proof is saved in the same transition as its end, so a run can no longer die between them.
- **Linea, Monad and BNB native destinations, a recipient that also spends in the fill block.** The recipient's balance change across the block was required to cover the output, so a same-block spend left the operation unprovable forever (it held its profile and account claims), and on BSC turned a delivered fill into `protocol_mismatch`. The call trace is now the proof: its root must be the verified transaction itself (sender, target and calldata, with no error), and the delivery call and every call above it must have succeeded. The BNB composite trace now also checks the root's target, and a root that is not the verified transaction is read again on the next resume instead of ending the operation as `protocol_mismatch`. The balance change is kept as corroboration; a negative one is stored as `null`.
- **Stargate V2 token lane (OP Mainnet USDC to Polygon), native debit cap.** The cap counted value plus gas only. OP Mainnet also charges an L1 data fee and an operator fee on each transaction. Prepare now reads both upper bounds for each signed transaction at one pinned block (`getL1FeeUpperBound`, `getOperatorFee`), stores them, and counts them in the cap, the staged gas ceiling and the balance check. They are read again before the approval, after it and before the send. A failed read refuses. Once the approval has landed, the bridge's budget is charged the approval's real cost from its receipt; without the receipt's fee fields, it is charged its gas limit times its max fee plus the larger of the prepare and before-approval L1 and operator bounds. Optimism's L1 bound is a practical bound at the read block's L1 prices, not a hard maximum. The consent screen shows the bounds. Operations are now record v6. v5 records stay readable, but their only new signature can be the owner-consented allowance revoke in cleanup: `op_stack_fees_unbound_reprepare` before the approval, and cleanup once the approval has landed. A transient RPC error before the send now keeps the operation for the next run instead of sending it to cleanup; a reverted call or estimate is not transient and still goes to cleanup with its own reason. A usage hold that never reached its send marker is released as `failed_before_effect` on expiry, on the v5 refusal and when cleanup ends.
- **Stargate V2 token lane, approval window.** With an existing allowance the expiry was not checked again between the preflight and the send marker, so a lock wait could carry the send past `expires_at`. It is now checked before the marker, and a late send goes to cleanup with reason `expired_before_marker`.
- **Local gasless (EIP-7702), delegation revoked after a successful transfer.** The settlement proof required the delegation to still be in place at the latest head, so a revocation left a sent transfer at `unknown_finality` (`gasless_receipt_unresolved`). The safe receipt and the consumed nonces prove the transfer, and the delegation no longer has to persist: a revoked delegation completes the operation and shows `delegation_persists: false`. Delegation to another contract is still refused.
- **LI.FI bridge journal capacity.** Each transition copies the operation's state, so the 1 MiB journal could fill after about 90 transitions. After that every change was refused, including the terminal one, and the operation stayed open with its claims. Transitions are now classed:
  - ordinary transitions stop with 128 KiB still free;
  - proofs that close the operation keep 32 KiB and up to 7 slots past 512; a provider hint with no room left is carried to the end instead;
  - the destination proof is saved together with the operation's end, as its terminal transition, which is always recorded: without read telemetry if that is what does not fit, and in a journal an earlier release filled to 1 MiB, up to 64 KiB past it.

Downgrading in the middle of an operation is unsupported. 0.5.96 and earlier reject these new records:
- a native fill with a short or `null` balance change;
- a Stargate v6 record;
- a gasless record that completed after its delegation was revoked;
- a LI.FI journal longer than 512 transitions, or a finished one larger than 1 MiB.

## 0.5.96 — 2026-11-08

- Bridge RPC readers, primary receipt refused by PublicNode. PublicNode changed the text of its keyless historical-read refusal to `Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode`, and APN matched only the earlier text. A refused primary receipt on Base or Ethereum therefore stopped falling back to the configured `APN_<CHAIN>_ARCHIVE_RPC_URL`, and APN had never recognized the refusal on BSC or Arbitrum. QA's resume of a BSC operation hit this and needed a separate `APN_BNB_RECEIPT_RPC_URL`. APN now accepts both texts exactly from the keyless Ethereum, Base, BSC and Arbitrum roots. In a batch the receipt fails as a sub-error and APN reads it again on its own, so a receipt after either refusal now reaches the archive. Any other text or origin still fails without a fallback.
- Bridge RPC readers, status hint. When an unresolved bridge operation stores an RPC refusal as its `observation_rpc_failure` (an HTTP status, or a history the endpoint does not serve), its status, `bridge approve` and `operation resume` output get one more `next_actions` entry. The entry names the refusing endpoint role, the method and the status, plus the one variable to set. A refusal on the receipt route names the chain's receipt reader: the receipt reader itself, a receipt read, or an archive batch, which is how keyless Tatum's 402 shows up. Any other archive read, or a trace or native-fill balance the primary refused, names the archive. Anything else names the primary RPC. A proof that needed a missing archive names the archive. Receipts keep the plain next actions, so receipts stored by earlier versions still verify.
- Docs: which reader reads in JSON-RPC batches. On 2026-11-08 the keyless Tatum gateway refused batches with HTTP 402, which is what QA saw; it can serve as an archive only beside a receipt reader that accepts batches. The docs also list when a primary receipt falls back, and how daily caps count holds whose outcome is unproved: per UTC day, including what abandonment does to them in each family.

## 0.5.95 — 2026-11-06

- Ethereum ETH to BNB (LI.FI Across + Fly), completion: a fill whose Fly swap reverted no longer waits forever. LI.FI reports it as DONE/PARTIAL, and APN used to read the destination trace only after COMPLETED, so the operation stayed `unknown_finality` (`provider_partial_observed_unproved`) holding its Ethereum claim and usage reservation, with no way to close it. On this lane PARTIAL now leads to the same trace proof, and the trace decides: QA's real reverted fill (Across deposit 4886518) proves `recovered_weth` with the whole 286765125030554 WETH back at the recipient, and the operation ends as `destination_failed`. An operation already parked this way closes with `apn operation resume` and a BSC archive RPC that serves `debug_traceTransaction`; its usage reservation is finalized as spent. A BSC transaction LI.FI names that holds no fill of this deposit no longer ends the operation as `protocol_mismatch`: it stays observable (`evidence_unavailable`) and LI.FI is asked again on the next resume, even after COMPLETED.
- Same lane, approval window: Fly's unsigned route can carry its own deadlines. In QA's run a hop reverted `0x3e9e7bf1(deadline, now)` at 11:13:38Z, 241 s before the signed header's deadline that APN used, and the approval came at 11:15:14Z. APN now takes every 4-byte value in the route between the Across quote time and the header deadline as a possible route deadline, closes the approval window at the earliest, and refuses prepare when it has passed. The consent names the closing time and says the Across fill must reach BSC before it.

## 0.5.94 — 2026-11-06

- Ethereum ETH to BNB (LI.FI Across + Fly): prepare accepts Fly's retention up to 10000 basis points instead of 500. Fly signs retention per quote, and every quote QA drew on 2026-11-06 (0.0003–0.001 ETH) carried 10000, so 0.5.93 refused each prepare with `fly_economics`. Retention never touches the guaranteed floor: the router applies it only when the swap beats Fly's signed expected output, and then still pays at least that expected output, so at 10000 Fly keeps all output above expected. Above 10000 the router's subtraction would revert every swap that beats expected, so that stays refused. The approval screen says what the signed retention does.

## 0.5.93 — 2026-11-06

- Ethereum ETH to BNB (LI.FI Across + Fly): prepare no longer requires one frozen Fly program. Fly picks its route by liquidity and changes it from quote to quote (on 2026-11-05 a 704-byte WETH → BTCB → WBNB → BNB route replaced the 457-byte Balancer one APN pinned, so every prepare failed `fly_program_shape` or `fly_abi_bounds`). APN now reads only the header Fly's router reads and signs: the Executor as recipient, WETH in, native out, the exact input, deadline, output floor, expected output, retention (still at most 500 bps), consumer, no router transfer, a well-formed signature from the pinned Fly signer and no swap fees. The route after it is opaque, because the router itself reverts unless the Executor's native balance grows by at least the signed floor. The payload bound is 3072 bytes, and the Balancer Vault and pool reads before the send are gone.
- Same lane, completion: the delivery proof now matches what BSC actually executes. Checked against a public `callTracer` tree of another user's fill, the old check could not have passed any real fill: it expected no proxy `DELEGATECALL`s, no balance reads, the Executor's approval of exactly the input, and a fill equal to the Fly input. APN now looks through proxy calls and reads, accepts the Executor's allowance reset and raise or a standing allowance, reads Fly Core's route only for its native settlement (the router's payment must follow the signed retention rule), and records `returnedWethAtomic`. That is the WETH Across filled above the Fly input, which the Executor returns to the recipient (2–5% of the fill in the captured quotes), or the whole fill when the swap reverts, each proven by its Transfer log. A recovered fill is now matched against the fill amount instead of the smaller Fly input, and unrelated BNB reaching the recipient in the same block no longer fails it. Traces with a reverted contract creation, larger routes or batched fills are read up to the RPC answer's 1 MiB (a real fill's trace is about 62 KB) instead of failing.
- Same lane, consent: the approval screen no longer names a fixed WETH/WBNB pool. It says the destination runs Fly's unsigned per-quote route, that only the minimum native output is guaranteed, and how much WETH Across fills, how much Fly swaps and how much comes back as WETH after the swap without the router's protection; that WETH waits at LI.FI's shared Executor while Fly's route runs.

## 0.5.92 — 2026-11-06

- Direct transfers: when `pay transfer approve` stops at the foreground approval (it timed out, was refused or was interrupted), the error now carries `next_actions` instead of none, the first being `apn operation resume --operation <id> --rpc-url <url>` with the RPC of the approve call. Approval and signing are one native call, so the operation had already moved to `started` and reserved its amount in the usage ledger before the prompt, and the reservation stays held until resume. Native records a no-private-entry proof when the approval ends before the wallet is opened; the next actions are added only when that proof is present, and the resume then ends the operation as `failed_before_effect`, releases the reservation and asks for a new prepare. A failure after the wallet was opened, or one without that proof, keeps its own error and next actions as before. QA hit the empty `next_actions` after `APN_APPROVAL_TIMEOUT`.
- Local gasless: when `operation resume --observation-rpc-env` cannot finish its observation through the named RPC, the output now says why in `observation_rpc_diagnostic`: the RPC origin, `cause` (`http_<status>`, APN's transport reason such as `transport_request_deadline`, or the error code) and `rpc_error_code`, the numeric code of the last JSON-RPC error. It is shown with that call only and never stored; the endpoint's error message is not included. Before, every HTTP refusal, transport failure and exhausted request budget looked the same: `gasless_observation_rpc_unavailable` (or `gasless_receipt_unresolved` for other statuses) with empty `error.details`. QA hit this on Optimism with an endpoint that answered the same reads when they were sent directly.
- Stargate token: when the RPC stops answering (a non-200 status, a rate limit, a transport failure) while `stargate token execute` or `observe` observes a sent approval or bridge transaction, the error now adds `sent_effect`, `sent_transaction_hash` and `operation_phase`, and its next action says that rerunning the same command observes that transaction and never sends it again (after an approval, `execute` then continues with the bridge after its usual checks). A protocol or state refusal keeps its own error and advice. Before, an RPC refusal after the approval was sent read "Stargate native runtime unavailable: rpc_status" with the generic advice to correct the RPC setting. A non-200 Stargate RPC answer now names its status in `httpStatus`, and a 429 is `APN_RPC_RATE_LIMITED` instead of `APN_RPC_CONFIG`. QA saw the old text after an approval on Optimism; the rerun continued without a resend, as it does now.

## 0.5.91 — 2026-11-05

- MetaMask Smart Account: a permission now keeps one consent origin. MetaMask stores an Advanced Permission for the exact origin that requested it and lists it only to that origin, while APN served every consent page on a new random loopback port. So `wallet permission sync` asked from another origin, got an empty list, and would have recorded a live permission as `revoked` with `revocation_freshness: confirmed_absent`. MetaMask also asked to connect the page again on every run. The port of `http://127.0.0.1:<port>` is now saved in the permission record before its first consent and reused by every retry of the same connect and by sync. A busy port refuses with `APN_PROVIDER_UNAVAILABLE` (`consent_port_in_use`, retryable) before the browser opens; a sync that hits it records the permission's freshness as `unverified`, as for any sync whose consent did not run. A permission connected before 0.5.91 has no recorded origin: sync refuses it with `APN_PROVIDER_EFFECT_UNAVAILABLE` (`consent_origin_unrecorded`) and leaves it unchanged, and a pending intent from before 0.5.91 gets its port at its next connect. None of the live connects QA ran had completed, so no saved permission had been marked this way. A permission record that has a consent port cannot be read by 0.5.90 or earlier.

## 0.5.90 — 2026-11-05

- MetaMask Smart Account: when `wallet connect` or `wallet permission sync` stops in the browser consent page, the error now says where. `error.details.consent_step` is the page's last step: `provider_choice`, the wallet method whose call or answer stopped it (such as `wallet_getSupportedExecutionPermissions` or `wallet_requestExecutionPermissions`), or `owner_match` when a sync selects another account. When that wallet call itself threw, `provider_error_code` and `provider_error_message` carry the wallet's own code and message, unverified and reduced to printable ASCII of at most 160 characters. `consent_permission_requested` is true when the page had already sent MetaMask the permission request, so unless MetaMask answered with a rejection it may hold a grant. The page shows the step and code too. Before, every thrown wallet call other than a user rejection ended as "MetaMask returned an unsupported foreground consent result" with nothing more, and an error object whose properties throw left the page without any answer until the five-minute timeout. QA hit the first on a live connect on 0.5.89. Refusals and the pending intent are unchanged: retrying the same connect reuses the same session.

## 0.5.89 — 2026-11-04

- LI.FI bridges: an unsent operation whose call still names FeeForwarder v2.0.0 now gets no signature, not even for its token approval. `bridge approve` ends one still awaiting approval as `failed_before_effect` (`unsent_apn_reprepare_required`) before the approval prompt. `operation resume` ends an approved one that sent nothing the same way; a guarded WBTC one is ended only after its foreground confirmation. The transfer is then prepared again. In 0.5.88 the check before the send read only whether the Diamond allowlists v2.1.0, so such an operation could have had its approval signed and sent, and only the bridge call's pre-sign simulation would then have refused it. Such an operation cannot occur in practice: a prepared operation expires within five minutes, and the switch came hours before 0.5.88. QA reproduced it with a synthetic record and a fixed clock, without signing or sending.

## 0.5.88 — 2026-11-04

- LI.FI bridges: on 2026-11-04 LI.FI replaced its FeeForwarder v2.0.0 `0xCE40449B773a3E6E5e769ADb4e567179d4828cbd` with v2.1.0 `0xDe2b920506EE931a6A2ABDF566526220214FBbAE` on Ethereum, Base and Arbitrum, and every route from those chains now names v2.1.0, so each `bridge prepare` failed with `Bridge validation failed: fee_swap`. APN now accepts v2.1.0 for new routes, and the check at the head before the send reads the Diamond's allowlisting of it for `forwardERC20Fees`, as it did for v2.0.0. v2.1.0 is a Sourcify exact match of LI.FI's `FeeForwarder.sol` v2.1.0, has the same owner, and keeps `forwardERC20Fees` and `forwardNativeFees` unchanged. A route that still names v2.0.0 is refused at preparation (`fee_forwarder_retired`) because the Diamond would revert it. Operations prepared before the switch stay readable, and their source proof takes `FeesForwarded` from v2.0.0, the FeeForwarder their own call names.

## 0.5.87 — 2026-11-04

- MetaMask gasless: when APN refuses MetaMask's answer to the relay POST because of its `tx` (`check: "response_tx"`), `submit_diagnostic` now says how that `tx` differed from the request in `response_tx` (`tx` present or not, whether `from` is the bound server wallet, the chain id's form and whether it names the request's chain) and gives MetaMask's job status token in `provider_status`. `response_tx` is present on every `submit_diagnostic` and `null` for every other check. No address or number is included, and the only provider text is that short upper-case token. The outcome stays unknown and is proved on chain as before.
- MetaMask gasless: `resume` reports its own attempt to read MetaMask's job status as `provider_job_read`: the status APN accepted, or the reason, the answer check that refused MetaMask's answer (null when none did) and the same `tx` facts. It is shown with that call only and never stored.

## 0.5.86 — 2026-11-03

- MetaMask gasless: a refusal because the `mm` CLI token has expired now says so (`mm_gasless_session_expired`). Session refusals give `mm auth status --json`, which renews the token with the session's refresh token and leaves the project, wallet and trading mode as they are; if that answers `"authenticated": false`, `mm login` with the account that created the connected wallet; `mm logout` only when an active token keeps being refused, with a warning that it also deletes `mm`'s local wallet list and BYOK seeds. No step needs a wallet connect, so a session refusal no longer points at `apn operation abandon` of an earlier unresolved transfer. Approve and resume results with a session reason carry the same steps, and the project-wallet refusal's `mm logout` step now carries the same warning.
- MetaMask gasless: a dispatch the owner released with `apn operation abandon` (`abandoned_unknown`, its delegation possibly still redeemable) is now listed in `unresolved_beside` and on the approval screen of a new transfer from the same wallet and chain, and a new delegation repeating its hash is refused (`mm_gasless_delegation_reused`) at prepare and before approve's dispatch. It still holds nothing.

## 0.5.85 — 2026-11-02

- A prepare refused because an earlier operation of the same account is unresolved now observes that operation once and, when its outcome is proven final (its transaction landed, or its nonce was spent elsewhere and it can no longer land), closes it and runs again. The result lists what was closed in `closed_blockers`. This covers direct EVM transfers that were sent, allowance revokes, Circle approvals and legacy LI.FI and Stargate records. Nothing is signed or re-sent by this check; when nothing is proven, the refusal is the same as before and says why in `blocker_observation`.
- A refusal by a sent direct transfer now adds `apn operation resume` with the invocation's RPC after `apn operation status`, because status only reads a direct transfer's stored record. When the check could not run (no RPC, an RPC of another chain), the refusal says why in `blocker_error_code` and `blocker_error_message`; the earlier transaction's hash is never sent to an RPC of another chain.

## 0.5.84 — 2026-11-01

- MetaMask gasless: a transfer whose outcome is unknown no longer blocks new MetaMask gasless transfers from the same server wallet. The new transfer's approval screen and result list each earlier unresolved transfer (recipient and dispatched gross) and warn that it may still complete. Transfers that APN may still be sending, other rails and nonce-using operations keep blocking as before.
- MetaMask gasless revoke is admitted beside unresolved MetaMask gasless transfers of the same wallet; a new delegation that repeats an unresolved one's hash is refused (`mm_gasless_delegation_reused`).
- Gasless transfers (MetaMask, local, Smart Account, facilitator) that expired before anything was sent stop holding the account.

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
