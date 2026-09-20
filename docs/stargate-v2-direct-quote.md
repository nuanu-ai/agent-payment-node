# Direct Stargate V2 quote

This module provides one keyless, read-only Stargate V2 Taxi quote. It calls the pinned source pool's `quoteOFT(SendParam)` and then `quoteSend(SendParam,false)` at one block. It returns canonical source and destination identities, LayerZero EIDs, pool contracts, transfer limits, sent and minimum received amounts, protocol fee details, and the native LayerZero message fee.

It has no command that prepares, approves, signs, journals, submits, or admits execution. `executionAdmitted` is always `false`.

## Frozen official sources

The recorded ABI, source versions, and per-network blockers are in `data/stargate/2026-09-20/official-registry-and-abi.json`.

- Stargate V2 deployment/ABI repository: commit `ce598b8d16472cd76ee47d30b8a40bc5c1b667bb`.
- LayerZero official address book: commit `7c800d680072ae6cc50edf95711fa601974a4a70`.
- LayerZero documents `quoteOFT` and `quoteSend` as permissionless OFT functions: `https://docs.layerzero.network/v2/developers/evm/stablecoin-oft/rbac-reference`.

The finite registry is the exact intersection of those official Stargate deployments with APN's active eleven EVM distribution. It contains 13 source rows on Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, and Unichain. Routes exist only when both endpoints have the same exact asset identity. BSC, Linea, Monad, and Sei have explicit blockers in the recorded fixture and are unavailable.

## Failure boundary

The adapter rejects unknown chain, token, EID, pool, and cross-asset routes before RPC. It verifies source `eth_chainId` before and after the quote, requires code at the pinned source pool, pins both quote calls to one block, rechecks that block, rejects noncanonical or oversized ABI returndata, rejects inconsistent quote amounts, and detects request mutation across the asynchronous read.
