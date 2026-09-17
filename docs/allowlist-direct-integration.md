# Direct rail allowlist integration seam

`DirectAssetUsageAdapter` is a dormant integration boundary for direct transfers. It validates a sealed asset policy registry, evaluates the exact network and asset with `rail: "direct"`, and durably reserves the shared `AssetUsageLedger` before it invokes a caller supplied signing or provider send callback.

The adapter exposes exact ledger transitions for pre-effect failure, submitted, unknown finality, and finalized outcomes. Its lease binds the APN profile to the durable reservation so the owning operation journal can persist and recover that authority without widening the ledger bucket, which remains account, network, and asset scoped.

No shipping command uses this adapter yet. The checked-in candidate dataset has every rail disabled and no owner supplied caps, so it cannot be sealed as a registry. Runtime registry resolution is also absent, and the existing EVM, Solana, and TRON operation journals do not yet contain an explicit migration field for a registry version and direct usage lease. Wiring a command before those mappings exist could either reject existing admitted commands or create a reservation that its operation cannot recover after a crash.

Command integration therefore requires an explicit migration that maps each existing account and asset identity to a sealed registry row, loads that exact registry at runtime, persists the returned lease before signing or provider send, and advances it from the owning operation transitions.
