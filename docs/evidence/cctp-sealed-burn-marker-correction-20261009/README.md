# Original burn submission-marker refusal

The independent production witness reproduced a scope gap at parent c4957383802949a690f1e25722b2ec899ea1a48e: a legal original burn_submission_fence followed by unknown was accepted by the sealed-burn predicate, so replacement signing/submission and ledger retirement ran. The new predicate had bypassed the old approval variant's submission-history restriction.

The correction refuses only original burn submission/submitted transition reasons. It does not reject cleanup's own signing/submission/submitted transitions or durable claims. Both legal original histories (sealed→submission_started→unknown and sealed→submission_started→submitted→unknown) now fail through the actual production cleanupNonce before any TTY, authority sidecar, intent, SIGN or SEND. All five real ledger digests and the parent journal stay unchanged. Existing restored-parent, no-resend and positive finalized accounting cases remain passing.

The unchanged independent witness exits1 after the fix because its formerly accepted positive path now stops with exact_sealed_sei_burn_retirement_required. This is retained as refusal evidence, not counted as a passing test. The author full-runtime suite includes21 cases; combined Circle/MCP/discovery139 tests pass. No live keys, profiles, policies, ledger or financial effects were accessed or changed.
