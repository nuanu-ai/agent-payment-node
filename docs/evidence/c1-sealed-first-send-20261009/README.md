# Existing sealed C1 first-send authority

Baseline: `f738d103d9ae40bc299631994bec09f3feef05c3`.

The new CLI command is `apn gasless transfer approve-sealed --operation <operation-id>`. It supports only the admitted local Circle USDC chain/policy and a nonterminal expired unknown operation with checked once-disclosed original bootstrap plus an unchanged, once-sealed final UserOperation with zero final disclosure/submission attempts and no transaction claim or settlement.

The immutable operation frame, original consent/deadline, original bootstrap estimate, cryptographic signatures and both material hashes remain unchanged. Original material loading and signature/wire validation occur before the approval screen. No custody seal or estimate is invoked. Two existing signed-fee/current-state guard snapshots run, with owner policy/unknown reservation checks before and after each snapshot. Changed deployment/code, nonce, designation, allowance, balance, fee budget, active policy or reservation refuses dispatch.

Fresh consent is an optional append-only `firstSendApprovals` field, bound to operation/fingerprint/profile, envelope, both material hashes, original estimate hash, UserOperation hash, owner and exact original policy revision/activation/reservation. Absence stays absent in historical snapshots and receipts. Historical reconstruction explicitly discards the latest optional field before restoring the earlier snapshot. Approval and transition hashes bind the metadata; old transitions and fingerprints are unchanged.

Persisted metadata is never dispatch authority. An owned foreground approval issues a private WeakMap proof scoped to the same authority/root/controller instance and exact operation/material binding. Its fixed deadline is issue time plus 120 seconds; its eight-hex challenge binds the displayed draft. Proof is claimable once, checked before and after the final guard, and revoked on exit. Process loss requires a new foreground approval.

Only final submittedAt may exceed the original local deadline, backed by the exact fresh metadata interval. Original signing/disclosure deadline validation remains unchanged. The original local final path has no final UserOperation estimate, so no first or repeated estimate/disclosure is added. A permanent first-send fence is saved before dispatch. A trusted callback rechecks the claimed authority at the actual paced HTTPS POST. Expiry after fencing, lost responses and transport errors remain unknown and never permit another send.

Fixture production recovery uses nine physical POSTs: two fresh guard snapshots and one first send. Queued expiry consumes eight POSTs with no actual send, while preserving the permanent marker. The invocation cap remains 24 and is never reset within the command.

All execution validation in this packet used synthetic wallet/material/network fixtures. No live C1 operation, buyer policy, funds, signatures, submission or release was changed. New CLI help was checked from built dist. Build, focused test results and shipping surface scan are retained beside this document.

Validation passed: 141 focused tests across seven suites; the final 21 authority/first-send cases passed again after hardening private root/controller fields and freezing proof metadata. Typecheck, source/dist build, test build, diff whitespace check, and the shipping forbidden-surface/500-line scan passed. Source practical changes are confined to the dedicated modules and existing CLI/model/validator/guard/RPC seams; normal original-window and observation behavior remain covered by the existing suites.
