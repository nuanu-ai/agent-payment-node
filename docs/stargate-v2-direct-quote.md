# Direct Stargate V2 quote

The direct Stargate V2 quote is one keyless, read-only Stargate V2 Taxi quote. The
[native execution lane](stargate-v2-native-execution.md) and the
[USDC with Polygon native drop lane](stargate-v2-token-native-drop.md) use it when they prepare and before they sign.

It calls the pinned source pool's `quoteOFT(SendParam)` and then `quoteSend(SendParam,false)` at one block. It returns:

- canonical source and destination identities and LayerZero EIDs;
- pool contracts and transfer limits;
- sent and minimum received amounts;
- protocol fee details;
- the native LayerZero message fee.

The quote itself has no command that prepares, approves, signs, journals, submits, or admits execution.
`executionAdmitted` is always `false`.

## Frozen official sources

- Stargate V2 deployment/ABI repository: commit `ce598b8d16472cd76ee47d30b8a40bc5c1b667bb`.
- LayerZero official address book: commit `7c800d680072ae6cc50edf95711fa601974a4a70`.
- LayerZero documents `quoteOFT` and `quoteSend` as permissionless OFT functions:
  `https://docs.layerzero.network/v2/developers/evm/stablecoin-oft/rbac-reference`.

The recorded ABI, source versions, and per-network blockers are kept in the repository as a test fixture
(`tests/core/stargate-v2-fixtures/official-registry-and-abi-20260920.json`) that pins the registry below. The fixture is
not shipped in the package.

## Registry

The finite registry is the exact intersection of those official Stargate deployments with APN's active eleven-network
EVM distribution. It contains 13 source rows. No provider discovery, token alias, wrapped asset, or unlisted Stargate
deployment can widen it.

| Network | Chain ID | LayerZero EID | Assets |
| --- | --- | --- | --- |
| Ethereum | `1` | `30101` | ETH, USDC, USDT |
| Base | `8453` | `30184` | ETH, USDC |
| Arbitrum | `42161` | `30110` | ETH, USDC |
| Optimism | `10` | `30111` | ETH, USDC |
| Polygon | `137` | `30109` | USDC |
| Avalanche | `43114` | `30106` | USDC, USDT |
| Unichain | `130` | `30320` | ETH |

Routes exist only between two different chains whose endpoints have the same exact asset identity. BSC, Linea, Monad, and
Sei have explicit blockers in the recorded fixture and are unavailable.

## Failure boundary

The quote fails closed. It:

- rejects unknown chain, token, EID, pool, and cross-asset routes before any RPC;
- verifies source `eth_chainId` before and after the quote;
- requires code at the pinned source pool;
- pins both quote calls to one block and rechecks that block;
- rejects noncanonical or oversized ABI returndata;
- rejects inconsistent quote amounts;
- detects request mutation across the asynchronous read.
