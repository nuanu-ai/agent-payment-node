# Bounded Circle nonce retirement: source QA

This change adds the foreground `apn circle evm cleanup-nonce --operation <id>` command for an expired sealed unknown Monad approval with no attempted source burn. It freezes a distinct approve0 cleanup at the original nonce and permanently disables the original approval and burn. Only the exact finalized cleanup, canonical nonce consumption and zero allowance close unused holds through the normal ledger. The original approval stays unknown; the terminal result is `nonce_retired`, never a completed payment.

No live wallet, profile, policy, payment or ledger was changed for this packet. Tests use disposable fixtures. Independent review and a newly installed consumer remain required before a live command.

Verification on pinned Node 24.15.0:

- Full production strict TypeScript build passed. Two builds produced identical bytes for all 2,406 shipping dist files.
- Strict Circle test compilation passed. Final Circle and MCP runtime suite passed 91/91, including persisted-intent observation without consent/sign/send, restored journals, durable claims and actual queued TLS expiry with no POST body.
- The combined runtime suite passed 106/107. The existing effective-user HOME metadata snapshot assertion failed while shared ~/.apn metadata changed; all recovery, Circle and MCP tests passed. The earlier combined run passed 107/107, but the final combined run is retained separately and is not reported as a pass.
- Combined/MCP-only strict test compilation is unresolved: TS2379 in unchanged metamask-smart-account-consent.ts:56, ServerResponse missing setHeaders. A base archive compiled clean, so this is not classified as a baseline failure. No compiler flags were relaxed or unrelated HTTP source changed. Emitted MCP runtime tests do not establish strict test compilation success.
- All 802 shipping TypeScript source files are at most 500 lines. git diff --check passed.

The full build also reordered two declaration properties in the unchanged generated lifi/non-evm-source-journal.d.ts; no LiFi source or behavior changed.

The smallest new modules are nonce-retirement-store (create-only intent and claims), nonce-retirement (controller) and nonce-retirement-proof (pure proof validation). The runtime owns canonical chain verification and uses the existing ledger reconciler; custody checks private guards and durable claims before key access.

The command intended for the separately authorized new consumer is:

```sh
apn circle evm cleanup-nonce --operation 4b8e66d54922831315464a1a55f6e31fb1dee6af6c939501d759269ac5de4a0d
```

Ordinary observe only follows already claimed cleanup; a cancelled foreground approval cannot start money movement on observation.

Editing note: repeated staging language and inflated wording were removed; requirements and verification limits were preserved.
