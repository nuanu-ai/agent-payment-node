# x402 purchases

[Documentation index](README.md) · [Product overview](../README.md)

This section was moved from the APN README without changes to its text.

```sh
apn wallet policy set --profile agent --max-balance-usdc-atomic <limit> --max-x402-amount-atomic <limit> \
  [--max-balance-eth-wei <limit>] [--x402-payees <address,...|unrestricted>]
apn x402 inspect --url https://seller.example/resource
apn x402 fetch prepare --profile agent --url https://seller.example/resource \
  --idempotency-key buy-0001 --rpc-url https://mainnet.base.org
apn x402 fetch approve --operation <operation-id> --rpc-url https://mainnet.base.org
apn operation resume --operation <operation-id> --rpc-url https://mainnet.base.org --wait-seconds 60
```

Creating a policy or raising a limit needs the foreground terminal; a pure decrease does not. `--x402-payees` optionally
pins which sellers may be paid. `wallet policy show/set`, `x402 inspect` and `x402 fetch prepare` take
`--chain <caip2>` (any `eip155:<id>`) and `--asset <token>` to select the local-wallet x402 network and token; omitting
`--chain` means Base, omitting `--asset` means USDC on Base, Ethereum or Arbitrum and is refused elsewhere, and no
network or token inherits another's limits. Prepare proves the token's EIP-3009 identity on that chain, or, for a
seller that offers the token only through Permit2, the canonical Permit2 contracts and the wallet's allowance
([any seller](x402-any-seller.md)). `x402 fetch prepare`
uses the owner's maximum, and `--max-amount-atomic` can only lower it for one call. Approval creates exactly one frozen
authorization; `operation resume` owns the paid request, settlement observation and seller-result recovery. `--method`,
`--headers-json` and `--body-base64` send POST and other requests with opaque body bytes bound into the operation.

[Permit2 requests](x402-non-usdc.md) (`x402 permit2 *`, any chain and token the owner's allowlist policy admits
for Permit2, USDC included) and [ERC-20 transfer-proof merchants](x402-merchant-usdm.md) (`x402 merchant *`,
MegaETH USDm first) are CLI commands with foreground approval. `x402 permit2 allowance set|revoke` sets the wallet's
bounded allowance to Permit2 for an owner-admitted chain and token (foreground, one send, observed to proof).
`x402 solana pay` pays a Solana `exact` offer unattended (CLI or MCP) for a mint the owner's allowlist row admits
(inventory USDC or USDT), under the owner's Solana x402 policy (`wallet policy set --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp --asset <mint>`); the
seller's facilitator pays the fee and `APN_SOLANA_RPC_URL` must be set. `x402 solana observe` proves settlement or that
the payment can no longer land ([any seller](x402-any-seller.md)).
[Offer selection](x402-offer-selection.md) and [settlement fields](x402-settlement-compatibility.md) are
documented separately.
