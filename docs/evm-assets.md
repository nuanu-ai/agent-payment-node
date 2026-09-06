# Explicit EVM assets (unreleased source)

The first EVM expansion Slice enables Base (`eip155:8453`) for the default local
encrypted disposable wallet. Ethereum and Arbitrum remain disabled until their
sequential Slices. Public APN/Homebrew remains 0.5.8; these source changes do not
alter that published artifact. No new mainnet payment is claimed here.

## One direct-transfer journey

```sh
apn wallet balance-asset --profile default --chain eip155:8453 --asset native --rpc-url <https-base-rpc-url>
apn pay transfer prepare-asset --profile default --chain eip155:8453 --asset native --to <recipient> --amount 0.000001 --max-fee-wei <owner-budget> --idempotency-key <unique-key> --rpc-url <https-base-rpc-url>
apn pay transfer approve --operation <operation-id> --rpc-url <https-base-rpc-url>
apn operation status --operation <operation-id>
apn operation resume --operation <operation-id> --rpc-url <https-base-rpc-url>
apn receipt get --operation <operation-id>
```

For ERC-20, replace `native` with the exact contract address. Symbol is not
identity. The same core reads balance and optional decimals at a pinned block;
if decimals are unavailable, supply independently verified `--decimals 0..255`.
Conflicting observed decimals fail. No implicit six-decimal fallback, rounding,
token whitelist, NFT, swap, approval or arbitrary calldata is supported.

`--amount` is a canonical exact positive decimal; `--max-fee-wei` is a positive
integer native-ETH **pre-submission quote budget**, not an onchain-enforced total
fee cap. The quote includes maximum EIP-1559 execution cost, Base L1 data upper
estimate for at most 512 signed bytes, and operator fee estimate. Native value
must also be funded. The quote is rechecked before signing and every submission.
Variable L1/operator fees may change at inclusion. Missing oracle evidence fails
closed. Changing nonce or transaction fee fields requires a new operation before
signing; a signed operation is never replaced or repriced automatically.

Exact foreground TTY approval precedes private-key access. MCP
`apn_wallet_balance_asset` and `apn_pay_transfer_prepare_asset` use the same
catalog/core. MCP direct approval returns the existing CLI handoff; it cannot
authorize or strand the operation. Status and receipt do not resume effects.

## Safety, recovery and proof

- Chain, asset kind/address/decimals, amount, recipient, payer, nonce and fee
  budget are frozen. Wrong-chain RPC fails before submission or recovery.
- Global idempotency and conservative per-profile exclusion remain. Repeating
  the same request returns the old operation before metadata refresh; changing
  material inputs under the same key conflicts, including another operation kind.
- A durable started record precedes signing. Encrypted signature material is
  saved before returning. Restart retrieves only that signature; if none exists,
  the operation fails before effect rather than signing a replacement.
- Native completion requires the exact included transaction and successful
  receipt. ERC-20 completion additionally requires its exact `Transfer` log and
  exact sender/recipient balance deltas across the receipt block. Reorgs,
  concurrent token activity, fee-on-transfer/rebasing behavior, false-return
  tokens, or unavailable historical reads can leave delivery unproven. A hash
  or successful receipt alone never proves an exact generic token payment.
- Completion reports **inclusion only**, not irrevocable finality. Terminal
  receipt fields must prove the same immutable operation; absent/altered receipt
  fails closed. No custodial aggregate balance or automatic funding is implied.
- Existing Base-USDC/ETH profile policy is Base-asset-specific. Other token
  balances are explicitly unassessed; generic direct permission is the exact
  operation approval, never conversion or reuse of a USDC allowance.

## Capability boundary

| Profile | Base native / arbitrary ERC-20 direct | Base-USDC direct | Standard x402 |
| --- | --- | --- | --- |
| Local encrypted wallet | Source/test capability; fresh paid proof held | Existing journey preserved | Existing Base-USDC exact EIP-3009 |
| Coinbase Agentic Wallet | Explicitly unsupported | Existing provider route | Existing Base-USDC route; pinned AWAL rejects present bodies, including empty |
| MetaMask Agent Wallet | Explicitly unsupported | Existing provider route | Existing Base-USDC route |
| MetaMask Smart Account | Explicitly unsupported | Existing bounded consent route | Existing advertised ERC-7710 route |

Arbitrary direct tokens do **not** imply arbitrary x402 tokens or merchant
support. Existing exact HTTP method/headers/absent/empty/nonempty body binding is
unchanged. Legacy 0.5.8 operations retain their old schema/hash and recovery path.
The earlier live provider proof was Local/Coinbase/MetaMask Agent on 0.5.6 and
Smart Account only after its pending-consent recovery fix on 0.5.7.

Local tests and local installation are not publication, Homebrew acceptance or
fresh mainnet payment proof. Required new paid rows remain held until separately
bounded wallet/recipient/asset/network/amount/fee authority is supplied.
