# RPC configuration

[Documentation index](README.md) · [Product overview](../README.md)

This section was moved from the APN README without changes to its text.

APN needs no RPC account or API key. A command gets its RPC in one of two ways, and an error names the one to fix:

1. **An explicit flag on the command.** `--rpc-url` on direct EVM transfers and `wallet balance`, `x402 fetch`, `x402
   permit2`, `gasless transfer quote`, `operation resume` and `operation recover-transaction-settlement`; `--rpc-url`
   (source) and `--destination-rpc-url` on `relay execute` and `relay observe`. These commands have no environment
   fallback. Solana and TRON operations are the exception: their `pay transfer approve` and `operation resume` use
   `APN_SOLANA_RPC_URL` and `APN_TRON_RPC_URL`.
2. **`APN_<CHAIN>_RPC_URL` environment variables** for every other family: bridges, GasZip, 1Click, Stargate, Circle,
   gasless, MetaMask native transfers, swaps, Solana, TRON and the portfolio. The variable names the chain:

| Chain | Variable | Keyless default |
| --- | --- | --- |
| Ethereum | `APN_ETHEREUM_RPC_URL` | portfolio only |
| Base | `APN_BASE_RPC_URL` | portfolio only |
| Arbitrum One | `APN_ARBITRUM_RPC_URL` | portfolio; Circle CCTP source |
| OP Mainnet, Polygon, BNB, Avalanche, Unichain | `APN_OPTIMISM_RPC_URL`, `APN_POLYGON_RPC_URL`, `APN_BNB_RPC_URL`, `APN_AVALANCHE_RPC_URL`, `APN_UNICHAIN_RPC_URL` | portfolio only |
| Linea, Monad, Sei | `APN_LINEA_RPC_URL`, `APN_MONAD_RPC_URL`, `APN_SEI_RPC_URL` | portfolio; Circle CCTP destination |
| MegaETH | `APN_MEGA_RPC_URL` | none (x402 merchants use their pinned MegaETH endpoint) |
| Solana | `APN_SOLANA_RPC_URL` | every Solana command: `https://api.mainnet-beta.solana.com` |
| TRON | `APN_TRON_RPC_URL` | portfolio only |

Where a family has no default, a missing variable refuses with `APN_RPC_CONFIG` and a next action naming the variable;
APN never substitutes another endpoint. An empty variable counts as unset; an invalid value refuses and is never replaced
by a default. Every endpoint must be credential-free public HTTPS; APN checks the chain id or genesis, pins DNS to public
addresses and paces physical requests per provider across processes. Optional roles exist for bridges
(`APN_<CHAIN>_RECEIPT_RPC_URL`, `APN_<CHAIN>_ARCHIVE_RPC_URL`; no bridge command requires them), the Uniswap token lane
(`APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS`, a JSON array of up to three primaries) and Local gasless recovery
(`operation resume --observation-rpc-env <VARIABLE>`). Public RPCs can rate-limit: a 429 is reported as
`APN_RPC_RATE_LIMITED`, and rerunning the same command is safe because prepared operations are idempotent.
