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

The pinned official-source review is bundled at
`data/swap/jupiter-solana-abi-blocker-2026-09-17.json`. It records the verified
exact-input instruction discriminators and fixed accounts, plus the unresolved
route-dependent remaining-account, build-fixture, and deployed-artifact gaps.
