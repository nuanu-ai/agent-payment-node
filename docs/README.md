# APN documentation

[Product overview](../README.md) · [Security](../SECURITY.md) · [Contributing](../CONTRIBUTING.md) · [Website](https://agentpaymentnode.com)

Start with the installed command contract: `apn help --json`. The guides below describe each path. A guide for a route is
not a statement that the route has passed live mainnet acceptance; read the [proof boundary](custody-and-recovery.md#proof-boundary) first.

## Start here

| Need | Guide |
| --- | --- |
| Install and discover the commands | [Getting started](getting-started.md) |
| Make a first direct transfer | [First journey](first-journey-reference.md) |
| Pay an x402 seller | [x402 purchases](x402-purchases.md) |
| Connect an agent over local stdio MCP | [MCP setup](mcp.md) |
| Choose a wallet and connect a provider | [Provider wallets](provider-wallets.md) |
| Understand the model: profiles, owner limits, approval | [How APN works](how-it-works.md) |
| Understand keys, threat model and recovery | [Custody and recovery](custody-and-recovery.md) |
| Check a release | [Verify a release](release-verification.md) |
| Look up a command | [Command reference](command-reference.md) |
| Set RPC endpoints, read balances | [RPC configuration](rpc-configuration.md), [Portfolio](portfolio.md) |
| See which route families exist | [Families](families.md) |

## Networks, assets and routes

| Topic | Guides |
| --- | --- |
| EVM native and token transfers | [Explicit EVM assets](evm-assets.md), [Direct transfers under the owner allowlist](allowlist-direct-integration.md), [Owner allowlist policy: stage, activate, status, revoke](allowlist-policy.md) |
| Solana and TRON direct transfers | [Solana mainnet direct transfers](solana.md), [TRON mainnet direct transfers](tron.md) |
| x402 offers and settlement | [Standard x402 offer lists](x402-offer-selection.md), [x402 settlement transaction fields](x402-settlement-compatibility.md), [x402 Permit2 source boundaries](x402-non-usdc.md), [x402 to any seller (EVM and Solana)](x402-any-seller.md), [x402 ERC-20 transfer-proof merchants](x402-merchant-usdm.md) |
| USDC and USDT with gas paid from the amount | [USDC transfers with gas paid from the amount](gasless.md), [Gasless USDT staged implementation](gasless-usdt.md) |
| Cross-chain routing | [LI.FI EVM cross-chain assets](lifi.md), [Relay bridge routes](relay.md), [Direct Stargate V2 quote](stargate-v2-direct-quote.md), [Direct Stargate V2 native execution](stargate-v2-native-execution.md), [Direct Stargate V2 USDC with Polygon native drop](stargate-v2-token-native-drop.md), [Circle V2 EVM Fast runtime](circle-v2-evm-fast.md) |
| Guarded swaps | [Guarded Ethereum Uniswap swap](uniswap.md), [Solana Jupiter surfaces](jupiter.md), [TRON SunSwap V2: keyless guarded swap](sunswap.md), [Solana Orca Whirlpool: keyless guarded swap](orca.md) |
| MetaMask Agent Wallet | [MetaMask native-transfer public selector and private vendor admission](metamask-native-cli-sourceprep.md) |
| Platform, release and maintenance | [Platform support matrix](platform-support.md), [Local macOS Formula release](local-release.md), [Runtime SDK slices](runtime-sdk-vendor.md) |

These guides existed before the README was shortened and are unchanged. Some source documents are not shipped inside the
release package; repository documentation and the installed command manifest have different purposes.
