# x402 ERC-20 transfer-proof merchants

`apn x402 merchant` pays any x402 v2 merchant whose `exact` requirement is settled by a plain ERC-20 `transfer` on MegaETH
(`eip155:4326`) and proven with the transaction hash (x402engine's MegaethScheme). Identity comes only from explicit
inputs: the payer is the local wallet of `--profile` (any local profile), the merchant is `--url`, and the payee, amount
and asset are the single challenge row that names a pinned asset. This signs an ERC20 transfer; it does not claim EIP-3009
or gasless support.

**Pinned assets.** `src/x402-merchant/asset-pins.ts` is the per-asset registry: chain, token address, name, symbol and
decimals. MegaETH USDm (MegaUSD, `0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7`, 18 decimals) is the first entry. New
operations carry no contract-code pins (PHASE2 P5): a legitimate token upgrade does not stop them. The payment is bound by
the exact token address and chain, the exact signed `transfer(payee, amount)` and the receipt's single Transfer log from the
payer to the frozen payee for the exact amount. Name, symbol and decimals are read at prepare and approval. Operations that
stored deployment pins (v1, the 0.5.41-0.5.43 USDm proxy `0xfdf85d18…5a90` and implementation
`0xAC37677261885fDB372A37Ac8D5d47044196073C` / `0x781c9c39…0c09`) keep checking what they stored. A merchant
requirement's `extra` is preserved as merchant data and never used as a signing domain.

**Challenge.** Exactly one `accepts` row must be `scheme: "exact"` on a pinned asset, with a canonical positive amount, a
non-zero EVM `payTo` and a positive `maxTimeoutSeconds`; otherwise prepare refuses
(`merchant_exact_requirement_missing_or_ambiguous`). When the challenge offers rows for several pinned assets, `--asset <token>` chooses
one; without it prepare refuses (`merchant_asset_choice_required`) and its message lists every offered asset. A token that
is not pinned (`merchant_asset_not_pinned`) or not offered (`merchant_asset_not_offered`) is refused. `maxTimeoutSeconds` is the merchant's payment window (standard x402
merchants use about 60 seconds): it runs from the challenge read APN acts on, is shown on the consent screen, and prepare
or approval refuses (`merchant_payment_window_expired`) once it has passed since the latest read, before consent, before
signing and before the send. Rows for other networks or assets are ignored. The URL must be a
credential-free public HTTPS URL in canonical form; the transport pins DNS to public addresses, refuses redirects and
bounds the body.

**Admission.** The owner policy of the profile must name the payer as its EVM account and admit the token on the x402 rail
with the asset's own mechanism, `{"provider":"x402-erc20-transfer-proof","reference":"eip155:4326/<token>"}`, for example:

```json
{"chain":"eip155:4326","kind":"token","identifier":"0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7","rail":"x402","maximumPerTransferAtomic":"1000000000000000","dailyLimitAtomic":"1000000000000000","mechanism":{"provider":"x402-erc20-transfer-proof","reference":"eip155:4326/0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7"}}
```

The challenge amount must fit that row's caps. An optional owner `"recipients": [...]` pin on the token row (OD-1) restricts
the merchant payee; it is checked at prepare, approval, reservation and immediately before the send. Without it the policy
does not restrict payees: the payee is shown on the foreground consent screen and bound into the signed transfer.

The same mechanism must additionally admit native ETH on `eip155:4326` with owner per-transfer/daily caps covering the frozen full admission estimate `gasLimit * maxFeePerGas + L1 fee upper estimate` (at most the CLI native admission budget):

```json
{"chain":"eip155:4326","kind":"native","rail":"x402","maximumPerTransferAtomic":"100000000000000","dailyLimitAtomic":"100000000000000","mechanism":{"provider":"x402-erc20-transfer-proof","reference":"eip155:4326/0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7"}}
```

**Earlier operations.** Operations prepared by 0.5.41-0.5.43 (`apn.x402-merchant.v1`, the x402engine Bitcoin-price lane under
`{"provider":"x402engine-erc20-transfer-proof","reference":"megaeth-usdm-crypto-price-v1"}`) keep loading, observing,
delivering (with the Bitcoin-price check) and retiring under that reference. A new prepare never uses it: restage the
policy once with the asset's own reference.

This native row supports only the merchant gas hold and does not admit generic MegaETH direct transfers. Native wallet balance must cover the exact frozen owner hold, rather than the broader unsigned owner budget. Without a declared reserve, the hold remains the original full estimate and any later increase refuses. Optional `--native-fee-reserve-wei` freezes explicit headroom at preparation: it must cover the original full estimate, fit the caller budget, current balance and native policy. A declared reserve is never increased later. Successful headroom operations charge canonical actual execution plus L1 fees to native usage and release unused reservation capacity; this is ledger accounting, not an onchain refund. Historical estimate-only operations keep their original accounting. Proven reverts charge canonical actual execution plus L1 consumption.

Listing does not activate this admission. Use normal owner policy stage/activate with the other required existing admissions preserved. Funding and policy activation are separate owner actions.

```sh
apn x402 merchant prepare --profile <profile> --url https://x402engine.app/api/crypto/price?ids=bitcoin --max-native-fee-wei 100000000000000 --native-fee-reserve-wei 2000000000000 --idempotency-key external-usdm-20261009-0001
apn x402 merchant approve --operation <operation-id-from-prepare>
apn x402 merchant observe --operation <same-operation-id>
apn x402 merchant observe --operation <same-operation-id> --deliver
apn x402 merchant status --operation <same-operation-id>
```

Preparation freezes the merchant URL, the pinned asset entry, the full canonical v2 challenge, resource and exact selected requirement, the payer custody/provider binding, active policy activation, nonce, estimated MegaETH gas envelope, and immutable canonical OP fee context. A 300-second local deadline and UTC-day guard apply before signature and broadcast. Foreground approval displays exact principal, payee, full admission budget, signed execution cap, estimated L1 component, policy and hashes and requires an eight-hex confirmation. RPC is pinned to `https://mainnet.megaeth.com/rpc`, paced through the shared provider coordinator and capped at 64 physical POSTs per invocation; the generic direct RPC guard stays at 24.

Before and after confirmation, the adapter verifies the token identity (name, symbol, decimals, and proxy/implementation storage, code and domain when pinned), empty payer code, pending nonce, balances, real `eth_estimateGas` and fees. It reserves common asset usage, records `signing_started` before custody and stores signed bytes in create-only AES-256-GCM material. It records the transaction hash and permanent first-send fence before the paced `eth_sendRawTransaction`. The entire foreground approval, key loading, signing and dispatch hold the distinct active-allowlist profile lock inside the wallet/operation/address locks. A private live authority binds the consent frame, both exact holds and signed material and ends at the earliest of the 60-second interval anchored immediately when foreground confirmation returns, operation deadline or policy expiration. It is disposed on return; persisted metadata cannot create it. Its trusted callback rechecks that authority on the authenticated TLS connection immediately before request.end sends the financial body. Independent create-only fsynced signing and submission claims and a pre-key retained-material check survive restored operation/usage state. A crash, timeout, wrong returned hash or lost response cannot invoke custody or broadcast again.

An observer independently checks the exact transaction envelope, canonical finalized receipt, the deployment pins at the receipt block (only for operations that stored them), actual full fee against the original reserve and caller budget, and exactly one matching token Transfer. Reverts remain separately proven. Only a successful finalized transfer can disclose canonical `PAYMENT-SIGNATURE` base64 JSON `{x402Version:2,payload:{txHash},resource:originalResource,accepted:originalRequirement}`. No token authorization signature is fabricated.

Payment finality does not prove merchant delivery. Completion additionally requires the merchant's HTTP 200 from the same URL. Response headers and the body digest are retained in the append-only operation, with the body itself: parsed when its media type is JSON (duplicate keys refused), otherwise as base64. Version 1 operations keep their Bitcoin-price check (JSON with a finite positive numeric USD price). A failed or lost merchant response remains paid/delivery_unknown. Plain observe never requests merchant delivery; `--deliver` explicitly makes one request with exactly the same original tx proof. At most eight delivery attempts are retained. A delivery-start crash is recorded unknown before any explicit same-proof retry. New payment and resend are never recovery paths.

Primary merchant protocol source: https://x402engine.app/docs/ (MegaethScheme and crypto-price response). The original research packet and saved @x402 client/fetch sources establish the v2 PAYMENT-SIGNATURE envelope. `docs/evidence/merchant-usdm-20261009/` contains source/test proof only; no paid acceptance is claimed there.

Fee estimates read the MegaETH GasPriceOracle predeploy `0x420000000000000000000000000000000000000F` by address at the
prepare anchor (one canonical-hash batch: `getL1FeeUpperBound` for the exact unsigned length and `getOperatorFee`); its
L1 and operator estimates enter the admission estimate (fee context `apn.merchant-mega-fee.v2`). There are no oracle code,
implementation, version or fork-flag pins for new operations. Fee contexts recorded as `apn.merchant-mega-fee.v1` keep the
pinned oracle (runtime hash `0xfa8c9db6…7998`, implementation `0xc0d3…000f`, version 1.4.0, Ecotone/Fjord/Isthmus, zero
operator fee) for estimation and inclusion.

The CLI native fee value is a full pre-submission admission budget, not an onchain hard L1 cap. Only execution gasLimit/maxFee are signed caps. The L1 upper estimate uses current parameters and cannot guarantee future inclusion fees; fresh admission checks and a private ten-second witness anchored before its RPC awaits guard signing and queued DNS/TLS dispatch. This witness never renews the independent absolute sixty-second foreground authority. A delayed witness fails closed. The transport sync guard does not claim a new RPC query at TLS.

A successful receipt's paid fee comes from its own fee fields, as LI.FI's `bridgeActualFees` reads OP-stack receipts:
gasUsed×effectiveGasPrice plus the mandatory `l1Fee` plus the Jovian operator fee (gasUsed × operatorFeeScalar × 100 +
operatorFeeConstant; absent fields are zero). The total must fit the original full reserve and caller budget (v1 fee
contexts keep requiring a zero operator fee). Full block membership and EIP1898 parent/block balances bind an explicit block-wide payer debit against at most eight same-payer outgoing receipts. Incoming transactions, missing receipt components, unsupported variants or unmatched balance changes refuse rather than invent isolated per-transaction causality. Legacy operations without the new optional fee context retain their hashes/read support but cannot continue financially.

An expired new-protocol attempt with a retained independent SIGN claim but no SEND claim, sealed material or transaction hash can use `apn x402 merchant retire-unsent --operation <id>`. This command never signs, submits, pays or delivers. It requires the operation's own custody and fresh current finite policy, an expired300-second intent and at least60 seconds after SIGN, matching durable SIGN, unchanged independently reanchored original/SAFE native and token balances and nonce. Under owner/operation/custody/true-policy locks it writes a permanent create-only retirement tombstone before either unused hold is released; the terminal journal event follows both releases. SIGN and tombstone remain permanently. A crash can retry retirement only. SEND/material/nonce changes and legacy attempts without independent claims refuse. Retired state is accepted for financial availability only with the matching durable tombstone.

Future post-SIGN failures retain only an allowlisted error code, reason and financial phase. Arbitrary exception messages, RPC bodies, signatures and custody material are never logged. Earlier operations whose catches discarded their error remain unknown; the new diagnostics do not rewrite that history.
