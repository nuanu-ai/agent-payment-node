# Explicit EVM assets

The APN 0.5.11 package retains the released 0.5.10 EVM support for exactly
Base (`eip155:8453`), Ethereum mainnet (`eip155:1`) and Arbitrum One
(`eip155:42161`) for the local encrypted disposable wallet. Package availability
and a fresh mainnet payment remain separate proof layers.

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
fee cap. Ethereum uses execution-only EIP-1559 fees: its L1/operator extra fields
are explicitly zero and no Base oracle is queried. Base includes maximum
EIP-1559 execution cost, L1 data upper
estimate for at most 512 signed bytes, and operator fee estimate. Native value
must also be funded. The quote is rechecked before signing and every submission.
Variable L1/operator fees may change at inclusion. Missing oracle evidence fails
closed. Before signing on every supported EVM chain, the nonce must remain
exact, current required gas must fit within the frozen gas limit, and the
current derived base fee must fit within the frozen signed maximum-fee
envelope. Harmless lower gas estimates and fee-recommendation movement are
accepted without changing the approved transaction. A signed operation is
never replaced or repriced automatically.

Arbitrum uses its full inclusive `eth_estimateGas` result: L2 execution and L1
posting are paid within one gas envelope. Its `feeModel: arbitrum-inclusive`
is frozen and shown at approval and in receipts; zero *separate* L1/operator
surcharges do not mean posting is free. APN never calls the Base oracle or
adds posting costs twice. Priority fee is zero. Arbitrum additionally rechecks
the inclusive envelope after signing and before submission: required gas above
the frozen gas limit or current base fee above the frozen ceiling blocks the
existing signed operation rather than replacing it; resume only that operation
when its frozen envelope suffices. Before signing on any chain, nonce drift,
required gas above the frozen limit, or base fee above the frozen ceiling
requires a new operation. APN always signs the original approved transaction
unchanged.

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
- Base/Ethereum completion reports **inclusion only**, not irrevocable finality.
  Arbitrum additionally requires rechecked selected-RPC `safe` inclusion for
  success/revert and safe-chain nonce supersession; a sequencer-only receipt
  stays nonterminal. Its receipt says `rpc_safe_inclusion`, with observed safe
  block identity. This trusts the RPC and is not a trustless rollup proof or
  an independent challenge-finality guarantee. Terminal
  receipt fields must prove the same immutable operation; absent/altered receipt
  fails closed. No custodial aggregate balance or automatic funding is implied.
- Existing Base-USDC/ETH profile policy is Base-asset-specific. Other token
  balances are explicitly unassessed; generic direct permission is the exact
  operation approval, never conversion or reuse of a USDC allowance.

## Ethereum / Arbitrum x402 and policy

Use `wallet policy set-network --chain eip155:1` with explicit
`--max-balance-usdc-atomic` and `--max-x402-amount-atomic`, then
`x402 inspect-network` / `x402 fetch prepare-network --chain eip155:1` with the
existing URL, HTTP, RPC and idempotency options. Policy creation/increases require
foreground TTY approval; MCP returns the exact CLI handoff. Decreases are
noninteractive. `show-network` reports only the selected policy. Explicit Base
selection aliases the legacy Base policy. For Arbitrum use `--chain eip155:42161`
with the same commands and the selected-network RPC. All three policies are
separate; neither Ethereum nor Arbitrum inherits another network allowance.

Ethereum x402 supports only exact EIP-3009 canonical Ethereum USDC at
`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`. Name, version and domain separator
are independently read at a pinned safe block. Arbitrum uses native USDC at
`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, not bridged USDC.e. Arbitrary ERC-20 direct support
does not imply other x402 tokens or ERC-7710/Permit2 support. External wallet
profiles are refused before provider execution on non-Base networks.

Before new authorization and the first paid exposure, APN reloads the encrypted
network policy, payer, cap, balance and token domain. Lowering limits or changing
RPC/network/identity blocks new exposure, not read-only reconciliation of an
already-exposed authorization. RPC reconciliation checks the selected token and
safe/finalized chain evidence. Resume takes its network from the frozen operation,
not a new caller override. GET and absent/empty/nonempty POST envelopes remain
immutable across the same-material retry and result recovery.

Direct transfers and paid x402 purchases have separate acceptance records.
The bounded D4-D9 direct acceptance completed on
2026-09-10 for Arbitrum native ETH, USDC and USDT0 plus Base native ETH, USDC
and WETH: all six direct rows passed, both required Base WETH prerequisite
transactions were confirmed, and Base USDC funding was skipped as unnecessary.
That is pre-release source/live proof, not APN 0.5.10 publication, Homebrew
installation, merchant availability or x402 settlement proof.

## Capability boundary

| Profile | Base / Ethereum / Arbitrum native and arbitrary ERC-20 direct | Base-USDC direct | Standard x402 |
| --- | --- | --- | --- |
| Local encrypted wallet | APN 0.5.10 capability; bounded Base/Arbitrum D4-D9 direct proof passed on 2026-09-10 | Existing journey preserved; D5/D8 included in the bounded direct proof | Base plus APN 0.5.10 Ethereum/Arbitrum-USDC exact EIP-3009; fresh merchant proof held |
| Coinbase Agentic Wallet | Explicitly unsupported | Existing provider route | Existing Base-USDC route; pinned AWAL rejects present bodies, including empty |
| MetaMask Agent Wallet | Explicitly unsupported | Existing provider route | Existing Base-USDC route |
| MetaMask Smart Account | Explicitly unsupported | Existing bounded consent route | Existing advertised ERC-7710 route |

Arbitrary direct tokens do **not** imply arbitrary x402 tokens or merchant
support. Existing exact HTTP method/headers/absent/empty/nonempty body binding is
unchanged. Legacy 0.5.8 operations retain their old schema/hash and recovery path.
The earlier live provider proof was Local/Coinbase/MetaMask Agent on 0.5.6 and
Smart Account only after its pending-consent recovery fix on 0.5.7.

Local tests, the D4-D9 source/live result and a local installation are not
publication or Homebrew acceptance. Required merchant/x402 paid rows remain
held until separately bounded wallet/recipient/asset/network/amount/fee
authority is supplied.
