# Nonce cleanup preparation snapshot correction

The independent full runtime witness reproduced snapshot_binding before TTY. Preparation validated a changed effect list with sealCircle, retaining the old transition snapshot. Earlier synthetic preparation and finalized-proof tests did not cover this production preparation seam.

The product correction is one line: validate the candidate through advanceCircle. The existing controller persists the legitimate nonce_retirement_cleanup_frozen transition through CircleRepository. The original transition prefix, historical policies/expiry, original approval/burn envelopes/material identities and held amounts remain unchanged. No digest or historical evidence is rewritten.

New tests enter the actual CircleEvmService.cleanupNonce method with current compatible activation and existing real reservations. They use actual preparation, repository continuity validation, current owner policy checks, retained original public material header check, durable claims, canonical finalized proof and AssetUsageLedger reconciliation. Only public wallet/signing and network boundaries use fixture responses. Cancelled TTY produces a valid prepared append, preserves every ledger hold and ordinary observation never signs/sends. Full finalized cleanup signs/sends once and records consumed amounts [0,0,0,1310720000000,0], retaining historical unknown approval and prepared burn. Changed activation and source burn attempt refuse financial work.

The separate unchanged independent executable passed all four actual current-policy cases after the correction. Pinned Node 24.15.0 production and focused strict compilation passed with pinned typeRoots. Repeat shipping dist bytes are identical and source modules remain at most 500 lines. Final runtime totals are in verification.json.

Source and disposable fixture tests only: no live policy, wallet, operation, ledger or payment effects. Independent exact-commit review and a newly produced consumer remain required.
