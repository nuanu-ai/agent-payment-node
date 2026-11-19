# Families

[Documentation index](README.md) · [Product overview](../README.md)

This section was moved from the APN README without changes to its text.

| Family | Commands | Guide |
| --- | --- | --- |
| Direct EVM transfers | `wallet balance`, `pay transfer prepare-asset`, `pay transfer approve` | [EVM assets](evm-assets.md) |
| Solana / TRON transfers | `wallet ensure-*`, `wallet balance-*`, `policy admit-*`, `pay transfer prepare-*` | [Solana](solana.md), [TRON](tron.md) |
| Portfolio | `wallet portfolio` | [below](portfolio.md) |
| USDC with gas from the amount | `gasless capabilities`, `gasless balance`, `gasless transfer quote/prepare/approve/approve-sealed` | [Gasless](gasless.md) |
| Ethereum USDT gasless | `gasless usdt prepare/execute/resume/observe/status/execution-status` | [Gasless USDT](gasless-usdt.md) |
| MetaMask native-fee USDC transfer | `wallet metamask native-transfer[-status/-observe]` | [MetaMask native](metamask-native-cli-sourceprep.md) |
| LI.FI bridges, GasZip, NEAR 1Click | `bridge *`, `mega funding *`, `sei funding *`, `oneclick source *` | [LI.FI](lifi.md) |
| Relay bridges | `relay prepare/execute/observe/status/retire` | [Relay](relay.md) |
| Circle CCTP V2 | `circle evm *`; `circle approval *`, `circle source submit` (Base to Solana) | [Circle V2 EVM](circle-v2-evm-fast.md); [Base to Solana](lifi.md#circle-cctp-v2-base-usdc-to-solana-approval-and-delivery-status) |
| Stargate V2 direct | `stargate native *`, `stargate token *` | [quote](stargate-v2-direct-quote.md), [native](stargate-v2-native-execution.md), [token](stargate-v2-token-native-drop.md) |
| Swaps | `swap ethereum uniswap[-token] *`, `swap tron sunswap *`, `swap solana jupiter/orca *` | [Uniswap](uniswap.md), [SunSwap](sunswap.md), [Jupiter](jupiter.md), [Orca](orca.md) |
| x402 | `x402 inspect`, `x402 fetch *`, `x402 permit2 *`, `x402 solana *`, `x402 merchant *` | [above](x402-purchases.md) |

Each guide states its commands, recovery rules and which mainnet acceptance rows are proven or still open. Source tests
are not live payment proof.
