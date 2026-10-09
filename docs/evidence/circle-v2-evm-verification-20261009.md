# Circle EVM runtime verification

Pinned Node 24.15.0 source and test TypeScript builds passed. Runtime modules contain at most 197 lines each. Frozen node_modules were used read-only; unrelated generated declaration ordering was preserved.

- Protocol/runtime/shared conflict/MCP: 41 tests passed.
- Shared asset ledger/state-security: 25 tests passed.
- Command discovery: 13 catalog, parsing, manifest, README/build and state-security checks passed. Three actual compiled CLI checks failed because the effective-user ~/.apn metadata changed during the test interval. Their assertions remain unchanged; rerun in the owner-coordinated quiet window. These failures do not establish which actor changed metadata.

The source cap is approval 30e12 wei plus burn 30e12 wei plus optional cleanup 15e12 wei. Both signer domains, usage holds, immutable encrypted material and global idempotency are registered. Circle source queuing releases only its nonce domain after canonical inclusion and independently checked latest nonce advancement. Final success requires fresh independent source and destination canonical finality.

No runtime installation, owner policy edit, wallet unlock, signing, broadcast, payment, CI or runner action was performed. Local test fixtures use isolated temporary state.
