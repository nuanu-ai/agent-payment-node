# x402 ERC-20 transfer-proof merchants

`apn x402 merchant` pays an x402 v2 merchant whose `exact` requirement is settled by a plain ERC-20 `transfer` on MegaETH
(`eip155:4326`) and proven with the transaction hash (the MegaethScheme of x402engine). The payer signs an ERC-20
transfer itself and pays the gas. This is not EIP-3009 and not gasless.

Identity comes only from explicit inputs: the payer is the local wallet of `--profile` (any local profile), the merchant
is `--url`, and the payee, amount and asset are the single challenge row that names a pinned asset.

Merchant protocol source: <https://x402engine.app/docs/> (MegaethScheme).

## Pinned assets

`src/x402-merchant/asset-pins.ts` is the per-asset registry: chain, token address, name, symbol and decimals.

| Chain | Asset | Token | Decimals |
| --- | --- | --- | --- |
| MegaETH `eip155:4326` | USDm (MegaUSD) | `0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7` | 18 |

MegaETH is the only chain whose fee model APN implements for this mechanism. A challenge row naming any other asset is
not payable.

The payment is bound by the exact token address and chain, the exact signed `transfer(payee, amount)` and the receipt's
single `Transfer` log from the payer to the frozen payee for the exact amount. Name, symbol and decimals are read at
prepare and at approval. New operations carry no contract-code pins, so a legitimate token upgrade does not stop them.

## Requirements

- A local wallet profile.
- USDm for the price and native ETH on MegaETH for gas.
- An active owner allowlist policy whose `accounts.evm` is the payer, with two `x402` admissions under the asset's own
  mechanism `{"provider":"x402-erc20-transfer-proof","reference":"eip155:4326/<token>"}`: one for the token and one for
  native ETH. See [Owner admission](#owner-admission).
- No RPC option: the RPC is pinned to `https://mainnet.megaeth.com/rpc`.

## Commands

```sh
apn x402 merchant prepare --profile <profile> --url <merchant-https-url> --max-native-fee-wei 100000000000000 \
  --native-fee-reserve-wei 2000000000000 --idempotency-key merchant-0001
apn x402 merchant approve --operation <operation-id>          # foreground terminal
apn x402 merchant observe --operation <operation-id>
apn x402 merchant observe --operation <operation-id> --deliver
apn x402 merchant status --operation <operation-id>
apn x402 merchant retire-unsent --operation <operation-id>
```

| Option | Meaning |
| --- | --- |
| `--profile` | An existing local wallet profile; its wallet is the payer. |
| `--url` | Credential-free public HTTPS URL in canonical form, at most 2048 bytes. |
| `--asset` | A pinned token; required when the challenge offers several pinned assets. |
| `--max-native-fee-wei` | Required. Positive integer, at most 1 ETH: the full native pre-submission admission budget. |
| `--native-fee-reserve-wei` | Optional explicit fee headroom frozen at prepare ([Native fee hold](#native-fee-hold)). |
| `--idempotency-key` | 8 to 200 safe ASCII characters. |
| `--deliver` (observe) | Make one merchant request with the original transaction proof. |
| `--operation` | The operation id returned by prepare. |

`prepare`, `observe`, `status` and `retire-unsent` are also MCP tools. `approve` is foreground only; over MCP it returns
the CLI handoff.

## Owner admission

The owner policy of the profile must name the payer as its EVM account and admit the token on the `x402` rail with the
asset's own mechanism:

```json
{"chain":"eip155:4326","kind":"token","identifier":"0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7","rail":"x402","maximumPerTransferAtomic":"1000000000000000","dailyLimitAtomic":"1000000000000000","mechanism":{"provider":"x402-erc20-transfer-proof","reference":"eip155:4326/0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7"}}
```

The challenge amount must fit that row's caps. An optional `"recipients": [...]` pin on the token row restricts the
merchant payee; it is checked at prepare, approval, reservation and immediately before the send. Without it the policy
does not restrict payees: the payee is shown on the foreground consent screen and bound into the signed transfer.

The same mechanism must also admit native ETH on `eip155:4326`, with per-transfer and daily caps covering the frozen
full admission estimate `gasLimit * maxFeePerGas + L1 fee upper estimate` (at most the CLI native budget):

```json
{"chain":"eip155:4326","kind":"native","rail":"x402","maximumPerTransferAtomic":"100000000000000","dailyLimitAtomic":"100000000000000","mechanism":{"provider":"x402-erc20-transfer-proof","reference":"eip155:4326/0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7"}}
```

This native row only covers the merchant gas hold; it does not admit MegaETH direct transfers. Listing a pinned asset
does not activate anything: stage and activate the policy as usual ([allowlist policy](allowlist-policy.md)), keeping
the other admissions you need. Funding and policy activation are separate owner actions.

## Challenge rules

- Exactly one `accepts` row must be `scheme: "exact"` on a pinned asset, with a canonical positive amount, a non-zero EVM
  `payTo` and a positive `maxTimeoutSeconds`. Otherwise prepare refuses with
  `merchant_exact_requirement_missing_or_ambiguous`.
- When the challenge offers rows for several pinned assets, `--asset <token>` chooses one. Without it prepare refuses
  with `merchant_asset_choice_required`, and the message lists every offered asset.
- A token that is not pinned (`merchant_asset_not_pinned`) or not offered (`merchant_asset_not_offered`) is refused.
- Rows for other networks or assets are ignored.
- `maxTimeoutSeconds` is the merchant's payment window (standard x402 merchants use about 60 seconds). It runs from the
  challenge read APN acts on and is shown on the consent screen. Once it has passed since the latest read, prepare or
  approval refuses with `merchant_payment_window_expired`, checked before consent, before signing and before the send.
- A requirement's `extra` is kept as merchant data and never used as a signing domain.
- The transport pins DNS to public addresses, refuses redirects and bounds the response body.

## Prepare and approval

**Prepare** freezes the merchant URL, the pinned asset entry, the full canonical v2 challenge, the resource and exact
selected requirement, the payer custody and provider binding, the active policy activation, the nonce, the estimated
MegaETH gas envelope and the canonical fee context. A 300-second local deadline and a UTC-day guard apply before
signature and broadcast.

**Approval** runs in the foreground terminal. It shows the exact principal, payee, full admission budget, signed
execution cap, estimated L1 component, policy and hashes, and requires an eight-hex confirmation code.

Before and after confirmation, APN verifies the token identity (name, symbol, decimals, and deployment pins for
operations that stored them), that the payer has no contract code, the pending nonce, balances, a real `eth_estimateGas`
and fees. Then:

1. It reserves the asset usage and records `signing_started` before custody is used.
2. It stores the signed bytes in create-only AES-256-GCM material.
3. It records the transaction hash and a permanent first-send fence before the paced `eth_sendRawTransaction`.

The whole approval, key loading, signing and dispatch hold the active-allowlist profile lock inside the wallet,
operation and address locks. The foreground authority binds the consent screen, both holds and the signed material.
It lasts at most 60 seconds after confirmation, and never past the operation deadline or the policy expiry. It exists
only in memory and cannot be recreated from saved state. It is rechecked on the authenticated TLS connection immediately
before the transaction body is sent.

Independent create-only, fsynced signing and submission claims, and a check of retained material before keys are
loaded, survive a restore of operation or usage state. A crash, a timeout, a wrong returned hash or a lost response can
never invoke custody or broadcast again.

RPC requests go to `https://mainnet.megaeth.com/rpc`, paced through the shared provider coordinator and capped at 64
physical POSTs per invocation.

## Fees

The fee estimate reads the MegaETH GasPriceOracle predeploy `0x420000000000000000000000000000000000000F` by address at
the prepare anchor, in one batch pinned by block hash: `getL1FeeUpperBound` for the exact unsigned length and
`getOperatorFee`. The L1 and operator estimates enter the admission estimate. New operations have no pins on the oracle
code, implementation, version or fork flags.

`--max-native-fee-wei` is a full pre-submission admission budget, not an onchain hard L1 cap. Only the execution gas
limit and max fee are signed caps. The L1 upper estimate uses current parameters and cannot guarantee future inclusion
fees. Fresh admission checks, and a ten-second witness taken before the RPC reads, guard signing and the queued DNS/TLS
dispatch; a late witness fails closed. The witness never extends the 60-second foreground authority.

A successful receipt's paid fee comes from its own fee fields: `gasUsed × effectiveGasPrice` plus the mandatory `l1Fee`
plus the operator fee (`gasUsed × operatorFeeScalar × 100 + operatorFeeConstant`; absent fields are zero). The total
must fit the original full reserve and the caller budget. Full block membership and EIP-1898 parent and block balances
bind the payer's block-wide debit against at most eight outgoing receipts of the same payer. Incoming transactions,
missing receipt components, unsupported transaction types or unmatched balance changes are refused rather than
guessed.

### Native fee hold

The native wallet balance must cover the exact frozen owner hold, not the broader unsigned budget.

- Without `--native-fee-reserve-wei`, the hold is the original full estimate, and any later increase refuses.
- `--native-fee-reserve-wei` freezes explicit headroom at prepare. It must cover the original full estimate and fit the
  caller budget, the current balance and the native policy. A declared reserve is never increased later.
- With headroom, a successful payment charges the actual execution plus L1 fee to native usage and releases the unused
  reservation. This is ledger accounting, not an onchain refund.
- A proven revert charges the actual execution plus L1 consumption.

## Observation, delivery and completion

`observe` independently checks the exact transaction envelope, the canonical finalized receipt, the deployment pins at
the receipt block (only for operations that stored them), the actual full fee against the original reserve and caller
budget, and exactly one matching token `Transfer`. Reverts are proven separately.

Only a successful finalized transfer can produce the canonical `PAYMENT-SIGNATURE`, base64 JSON
`{x402Version:2,payload:{txHash},resource:originalResource,accepted:originalRequirement}`. No token authorization
signature is fabricated.

Payment finality does not prove merchant delivery. Completion also requires the merchant's HTTP 200 from the same URL.

- Plain `observe` never contacts the merchant. `observe --deliver` makes exactly one request with the same original
  transaction proof.
- Response headers and the body digest are kept in the append-only operation, with the body itself: parsed when its
  media type is JSON (duplicate keys refused), otherwise as base64.
- A failed or lost merchant response leaves the payment paid and `delivery_unknown`.
- At most 16 delivery attempts are kept. When the last one leaves no HTTP 200, the payment ends `delivery_failed`: it is
  paid, and the receipt, proof hashes and charge stay. Plain `observe` also closes a record already at that limit.
- A crash at the start of a delivery is recorded as unknown before any explicit retry with the same proof.
- A new payment or a resend is never a recovery path.

## Attempts without a payment receipt

Every attempt without a receipt has an exit that never signs, sends or delivers.

- **`failed_before_effect`**: `observe` ends the attempt once its 300-second deadline has passed and nothing signed left
  the process: custody was never asked (this also releases holds that a crash left reserved before signing started),
  or a signing claim exists but there are no sealed bytes, no send claim and no submission.
- **`failed_proven_superseded`**: sealed or sent bytes end this way once the payer's nonce at the `finalized` tag is past
  the payment nonce, while a node whose transaction index reaches the prepare-time fee anchor block knows neither the
  transaction nor a receipt. The deciding batch also looks up one of that block's transactions by hash; a node that
  pruned its index proves nothing. A nonce that is not past keeps the attempt open with its holds.
- Both release the token and fee holds.
- **`abandoned_unknown`**: when no proof decides, `apn operation abandon --operation <id>` after the deadline asks for
  TTY consent and ends the attempt, with both holds still charged.

### `retire-unsent`

An expired attempt that kept its independent signing claim but has no send claim, sealed material or transaction hash
can be closed with `apn x402 merchant retire-unsent --operation <id>`. The command never signs, submits, pays or
delivers. It requires:

- the operation's own custody and a fresh, current, finite policy;
- the 300-second deadline to have passed, and at least 60 seconds since the signing claim;
- a matching durable signing claim;
- unchanged native and token balances and nonce, re-read independently at `safe`.

Under the owner, operation, custody and policy locks it writes a permanent create-only retirement tombstone before
either unused hold is released; the terminal journal event follows both releases. The signing claim and the tombstone
stay permanently. A crash can only retry the retirement. A send claim, material or nonce change refuses, as do older
attempts without independent claims. A retired attempt counts as financially available only with its matching
tombstone.

## States

| Kind | States |
| --- | --- |
| Non-terminal | `prepared`, `signing_started`, `submission_started`, `unknown_finality`, `payment_finalized`, `delivery_unknown` |
| Terminal | `delivered`, `reverted`, `retired_unsent`, `failed_before_effect`, `failed_proven_superseded`, `abandoned_unknown`, `delivery_failed` |

## Reason codes

| Reason | Meaning | What to do |
| --- | --- | --- |
| `merchant_exact_requirement_missing_or_ambiguous` | No single valid `exact` row on a pinned asset. | The merchant is not payable by this lane. |
| `merchant_asset_choice_required` | Several pinned assets are offered. | Pass `--asset` with one listed in the message. |
| `merchant_asset_not_pinned` / `merchant_asset_not_offered` | `--asset` is not pinned, or not in the challenge. | Choose an offered pinned asset. |
| `merchant_payment_window_expired` | The merchant's `maxTimeoutSeconds` passed since the latest challenge read. | Prepare again. |
| `allowlist_recipient_not_admitted` | The payee is not in the token row's `recipients` pin. | Adjust the policy or do not pay this merchant. |

## Diagnostics

A failure after signing starts keeps only an allowlisted error code, reason and financial phase. Arbitrary exception
messages, RPC bodies, signatures and custody material are never logged.

## Compatibility

- Operations prepared by older versions as `apn.x402-merchant.v1` (the x402engine Bitcoin-price lane under
  `{"provider":"x402engine-erc20-transfer-proof","reference":"megaeth-usdm-crypto-price-v1"}`) keep loading, observing,
  delivering (with their Bitcoin-price check: JSON with a finite positive numeric USD price) and retiring under that
  reference. A new prepare never uses it: restage the policy once with the asset's own reference.
- Operations that stored deployment pins (the USDm proxy code hash, implementation
  `0xAC37677261885fDB372A37Ac8D5d47044196073C` and its code hash) keep checking what they stored.
- Fee contexts recorded as `apn.merchant-mega-fee.v1` keep their pinned oracle (runtime and implementation hash,
  version 1.4.0, Ecotone/Fjord/Isthmus, zero operator fee) for estimation and inclusion, and keep requiring a zero
  operator fee. New operations use `apn.merchant-mega-fee.v2`.
- Older operations without the optional fee context keep their hashes and can still be read, but cannot continue
  financially.
- Historical estimate-only operations keep their original fee accounting.
- Older operations whose errors were not recorded stay unknown; the diagnostics above do not rewrite them.
