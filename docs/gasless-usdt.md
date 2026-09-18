# Gasless USDT on Ethereum (keyless ERC-20 paymaster)

A local wallet can send USDT on Ethereum without holding ETH. The local key signs. Pimlico's ERC-20 paymaster, reached
through its public endpoint, pays the gas and takes its fee in USDT from the same account. No API key is involved.

Status: the engine, the production HTTPS adapters, the allowlist gate and a read-only mainnet rehearsal are in
`src/gasless-usdt/`. The `apn gasless transfer prepare/approve` commands, the operation journal and MCP do not call
it yet (see [Remaining work](#remaining-work)). USDT on Avalanche is blocked (see [Research](#research-2026-09-18)).

## Research (2026-09-18)

All calls below were read-only JSON-RPC calls, made without an API key. Nothing was signed with an owner key and
nothing was broadcast. The PR description has the exact requests and responses.

| Endpoint | Call | Result |
| --- | --- | --- |
| `https://public.pimlico.io/v2/1/rpc` | `pimlico_getTokenQuotes` USDT, EntryPoint v0.8 | Quote from paymaster `0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402`: `postOpGas` 0x4c2c, a USDT/ETH rate with a markup of about 10 %, balance slot 2, allowance slot 5 |
| same | `pm_getPaymasterStubData`, context `{token: USDT}` | ERC-20 mode stub data plus `paymasterPostOpGasLimit` |
| same | `pm_getPaymasterData` without paymaster gas limits | `-32602 paymasterValidationGasLimit is required for erc20 mode` |
| same | `pm_getPaymasterData` from the owner address (0 USDT) | Simulated, then refused: `AA50 PostOp Reverted ... ExecuteError(2, "")`. The USDT transfer reverts, and so does the fee pull. |
| same | `pm_getPaymasterData` from a funded EOA, simulation only | **Signed ERC-20 paymaster data**, valid for about 5 to 10 minutes |
| `https://public.pimlico.io/v2/43114/rpc` | `pimlico_getTokenQuotes` Avalanche USDT | Quote returned |
| same | `pm_sponsorUserOperation` with `eip7702Auth` | `-32602 EIP-7702 user operations are not supported on this chain` |
| `https://api.candide.dev/public/v3/1` | `pm_supportedERC20Tokens` | Keyless. Lists USDT (and USDC) for its token paymaster |
| `https://api.candide.dev/public/v3/43114` | `pm_getPaymasterStubData` / `pm_getPaymasterData` / `pm_sponsorUserOperation` with `eip7702Auth` | `-32602 eip7702Auth is not supported on this network` |
| Circle paymaster `0x0578cFB241215b77442a541325d6A4E6dFE700Ec` | `token()` on Ethereum and Avalanche | USDC only (`0xa0b8…eb48`, `0xb97e…8a6e`) |

Conclusion:

- A keyless ERC-20 paymaster for USDT exists on Ethereum. APN uses Pimlico's, because Local gasless already uses its
  public bundler. Candide's public token paymaster is a second keyless candidate on Ethereum.
- On Avalanche, both keyless sponsors refuse EIP-7702 UserOperations. The Local architecture keeps the owner's own
  address through a 7702 delegation, so it cannot sponsor Avalanche USDT. A counterfactual smart account would change
  the sender address, which this route does not do.

## Pinned identities

The adapter reads every identity below from `APN_ETHEREUM_RPC_URL` before quoting and again before signing. Any
difference refuses the action.

| Identity | Address | Pin |
| --- | --- | --- |
| USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | code hash `0xb44fb4e9…ea55`; `basisPointsRate() = 0`, `maximumFee() = 0`, `paused() = false` |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | code hash `0x44e632a2…1f86` (same as Local gasless) |
| 7702 delegate | `0xe6Cae83BdE06E4c305530e199D7217f42808555B` | code hash `0xcc7b633a…fcf3` (same as Local gasless) |
| Pimlico ERC-20 paymaster v0.8 | `0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402` | code hash `0xd90bf4b6…b308`, `entryPoint()` = v0.8 |
| Fee treasury | `0x4337Ff05c84B9A80Ea0a78dBE7B8E102F66d4c08` | must be the treasury named in every signed payload |
| Sponsor endpoint | `https://public.pimlico.io/v2/1/rpc` | fixed; it is part of the mechanism, not a configurable default |

## Amounts and fee

The command shape is the same as for USDC: `--amount` (gross G), `--max-fee`, `--min-received`.

- `F = min(max-fee, G - min-received)` is the whole fee budget and the exact allowance granted to the paymaster.
  If `F = 0`, the request is refused, because the sponsor charges in USDT.
- `N = G - F` is the recipient's exact credit.
- The worst-case charge is `ceil((all five gas limits + postOpGas) × maxFeePerGas × exchangeRate / 1e18)`. The
  paymaster charges `(actualGasCost + postOpGas × feePerGas) × rate / 1e18`, which can never exceed that figure. If
  the quote's worst case is above `F`, preparation refuses (`gasless_usdt_quote_above_max_fee`). The sponsor's signed
  rate is priced again before signing (`gasless_usdt_signed_rate_above_max_fee`).
- On chain, the allowance `F` is the hard cap. A higher charge makes postOp revert, and the sponsor then pays the gas.
- The account batch is `approve(paymaster, 0)`, `approve(paymaster, F)`, `transfer(recipient, N)`. USDT refuses to
  change a nonzero allowance to another nonzero value, which is why the batch resets it first.
- The fee A is pulled in postOp, after the batch. So `F - A` stays approved to the pinned paymaster until the owner's
  next USDT gasless batch resets it. Only a later UserOperation signed by this owner can use that allowance: postOp
  runs only from the EntryPoint and pulls only from `userOp.sender`. The approval screen says this.

Fixed gas offer: 75,000 verification, 130,000 call, 100,000 paymaster verification, 75,000 paymaster postOp and
100,000 pre-verification. With the Pimlico fast tier on 2026-09-18, the worst case was 0.22 to 0.27 USDT.

## Allowlist

The active owner policy must admit USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7` on `eip155:1` on rail `gasless`,
with exactly this mechanism:

```json
{ "chain": "eip155:1", "kind": "token", "identifier": "0xdAC17F958D2ee523a2206206994597C13D831ec7", "rail": "gasless",
  "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000",
  "mechanism": { "provider": "pimlico-erc20-paymaster", "reference": "eip155:1:0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402" } }
```

The caps shown are the owner's example values; APN does not default to them. The gate checks the policy's EVM
account, the rail, the pin field for field, the per-operation cap on the gross, and the daily cap against the shared
per-asset usage ledger. Approval reserves the gross in the ledger (`apn.gasless-usdt-usage:<operation-id>`) under the
same policy revision, and a replayed approval never reserves twice. Refusal reasons: `allowlist_policy_required`,
`allowlist_policy_expired`, `allowlist_policy_changed`, `allowlist_account_mismatch`,
`allowlist_gasless_not_admitted`, `allowlist_mechanism_mismatch`, `allowlist_per_transfer_cap_exceeded` and
`allowlist_daily_cap_exceeded`.

## Order of effects

1. Prepare (`quoteUsdtGasless`): check the pins, get the token quote and the gas price, compute F and N. No key is
   used.
2. The approval screen shows the network, token, sender, recipient, gross, fee cap, net, worst-case quote, sponsor,
   treasury, owner caps with today's usage, first-use delegation and the residual-allowance notice.
3. Approve (`approveAndSendUsdtGasless`), after the foreground decision and the ledger reservation:
   1. Check the pins again, and check that the frozen prices still clear the bundler's slow tier.
   2. Read fresh account state and refuse if the balance is below the gross.
   3. Request `pm_getPaymasterData` with a structural signature. On first use, the authorization is a stub with the
      real nonce.
   4. Validate the signed payload.
   5. Sign the 7702 authorization (first use only), then the UserOperation.
   6. Write the durable marker (`markSending`).
   7. Call `eth_sendUserOperation` once.
   A failed marker write means nothing is sent. A lost or rejected send response is recorded as unacknowledged and is
   never retried.
4. Status (`observeUsdtGasless`) only observes. The bundler's `eth_getUserOperationReceipt` is used only to locate the
   transaction. The canonical receipt must be at or below the `safe` head and on the canonical block.

A receipt completes the operation only if all of these hold:

- exactly one successful `UserOperationEvent` for this hash, sender and paymaster;
- exactly one USDT `Transfer` of N from the sender to the recipient;
- exactly one USDT `Transfer` of `0 < A <= F` from the sender to the treasury;
- no other USDT leaves the sender in that transaction.

Settlement reports the sender debit `N + A`, the fee `A`, the recipient credit `N`, the residual allowance `F - A`
and the gas cost in wei.

## Read-only mainnet rehearsal

```sh
npm run build:ts
APN_ETHEREUM_RPC_URL=https://rpc.mevblocker.io node scripts/gasless-usdt-rehearsal.mjs \
  --sender 0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7 --to 0x000000000000000000000000000000000000dEaD \
  --amount 1 --max-fee 0.5 --min-received 0.5
```

The rehearsal loads no key, reads no APN state, signs nothing and sends nothing. It stops at `pm_getPaymasterData`,
the last step before the first signature. Output on 2026-09-18T07:51Z for the owner's address:

```text
pins: USDT, EntryPoint v0.8, 7702 delegate and Pimlico ERC-20 paymaster code hashes match; USDT fee 0, not paused
quote.paymaster: 0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402
quote.postOpGas: 19500
quote.exchangeRate (USDT atomic per 1e18 wei): 2739495922
quote.exchangeRateNativeToUsd: 2488374695
price.maxFeePerGas (fast): 191020309 wei
approval.gross: 1 USDT (1000000)
approval.feeCap (F, allowance to the sponsor): 0.5 USDT (500000)
approval.net (N, recipient credit): 0.5 USDT (500000)
approval.worstCaseQuotedFee: 0.261389 USDT (261389)
account: USDT 0 atomic, EOA nonce 31, EntryPoint nonce 0, delegation empty
funding refused: APN_INSUFFICIENT_ASSET gasless_usdt_balance_below_gross
sponsor (pm_getPaymasterData) refused: APN_PROVIDER_EFFECT_UNAVAILABLE gasless_usdt_sponsor_simulation_refused
sponsor (pm_getPaymasterData) message: ... AA50 PostOp Reverted: UserOperation reverted during simulation with reason: 0x5a154675…02…
```

`0x5a154675` is `ExecuteError(uint256,bytes)`. The failing index is 2, the `transfer(recipient, N)` call, because the
address holds no USDT. This is the expected economic refusal after the quote.

The same read-only path was also run with a public funded USDT holder as the simulated sender. That address was
`0xF977814e90dA44bFA03b6295A0616a897441aceC`, and nothing was signed for it. The production validator accepted the
live keyless payload: mode `0x02` (ERC-20, Pimlico bundlers only), zero flags, the pinned treasury, `postOpGas` 19500,
paymaster validation gas 80,000 and a validity window of about 10 minutes.

## Remaining work

- Wire the engine into `apn gasless transfer prepare/approve`, `operation resume/status` and `receipt get`. That
  means an asset selector on the shared command surface (the forbidden-surface scan bans `--token`), a persisted
  operation schema with the journal behind `UsdtJournalPort`, and a foreground approval that shows the screen and
  asks for a code.
- Custody: implement `UsdtSignerPort` over the existing local-wallet custody (7702 authorization and UserOperation
  hash signing).
- Measure the gas offer with a mirror estimate of the exact first-use batch before the first live transfer.
- Recovery for an unacknowledged send: a bounded canonical `UserOperationEvent` scan, as in Local gasless.
- A live transfer needs USDT on the owner's address and an owner allowlist revision with the pin above.
