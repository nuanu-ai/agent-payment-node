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
