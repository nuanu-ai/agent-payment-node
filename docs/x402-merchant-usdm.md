# Finite x402engine USDm transfer proof

This provider supports only `GET https://x402engine.app/api/crypto/price?ids=bitcoin`, local payer `0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14`, MegaETH `eip155:4326`, and 0.001 USDm (`1000000000000000` atomic, 18 decimals) to `0x7dd5Be069f2d2eAd75eC7C3423B116fF043c2629`.

The pinned USDm proxy is `0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7`. Its runtime hash is `0xfdf85d183a122fe611bc878683b722b2b22633e13900c4b13767742b9f5f5a90`; EIP-1967 implementation is `0xAC37677261885fDB372A37Ac8D5d47044196073C`, code hash `0x781c9c39ab69e9b7d099ec75e5a28df41dc891c8fffbe0148c94ed5adc8b0c09`. The token's actual name/domain is MegaUSD/version 1, symbol USDm, decimals 18. Merchant requirement `extra: {name:"USDm",version:"2"}` is preserved as merchant data and never used as a signing domain. This provider signs an ERC20 transfer; it does not claim EIP-3009 or gasless support.

The owner policy must explicitly admit token USDm on the x402 rail with this exact mechanism:

```json
{"chain":"eip155:4326","kind":"token","identifier":"0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7","rail":"x402","maximumPerTransferAtomic":"1000000000000000","dailyLimitAtomic":"1000000000000000","mechanism":{"provider":"x402engine-erc20-transfer-proof","reference":"megaeth-usdm-crypto-price-v1"}}
```

The same finite x402 mechanism must additionally admit native ETH on `eip155:4326` with owner per-transfer/daily caps covering the frozen signed `gasLimit * maxFeePerGas` (at most the CLI native fee ceiling):

```json
{"chain":"eip155:4326","kind":"native","rail":"x402","maximumPerTransferAtomic":"100000000000000","dailyLimitAtomic":"100000000000000","mechanism":{"provider":"x402engine-erc20-transfer-proof","reference":"megaeth-usdm-crypto-price-v1"}}
```

This finite native row supports only this merchant gas hold and does not admit generic MegaETH direct transfers. Native wallet balance must cover the signed upper, rather than the broader unsigned owner ceiling. Successful finalized usage conservatively retains the signed upper; a proven reverted transaction charges its canonical actual gas consumption.

Listing does not activate this admission. Use normal owner policy stage/activate with the other required existing admissions preserved. Funding and policy activation are separate owner actions.

```sh
apn x402 merchant prepare --profile default --max-native-fee-wei 100000000000000 --idempotency-key external-usdm-20261009-0001
apn x402 merchant approve --operation <operation-id-from-prepare>
apn x402 merchant observe --operation <same-operation-id>
apn x402 merchant observe --operation <same-operation-id> --deliver
apn x402 merchant status --operation <same-operation-id>
```

Preparation freezes the full canonical v2 challenge, resource and exact selected requirement, the owner/provider binding, active policy activation, nonce and estimated MegaETH gas envelope. A 300-second local deadline and UTC-day guard apply before signature and broadcast. Foreground approval displays exact principal, payee, fee ceiling, policy and hashes and requires an eight-hex confirmation. RPC is pinned to `https://mainnet.megaeth.com/rpc`, paced through the shared provider coordinator and capped at 24 physical POSTs per invocation.

Before and after confirmation, the adapter verifies current proxy/implementation storage and code, token metadata/domain, empty owner code, pending nonce, balances, real `eth_estimateGas` and fees. It reserves common asset usage, records `signing_started` before custody and stores signed bytes in create-only AES-256-GCM material. It records the transaction hash and permanent first-send fence before the paced `eth_sendRawTransaction`. The entire foreground approval, key loading, signing and dispatch hold the distinct active-allowlist profile lock inside the wallet/operation/address locks. A private live authority binds the consent frame, both exact holds and signed material and ends at the earliest of the 60-second interval anchored immediately when foreground confirmation returns, operation deadline or policy expiration. It is disposed on return; persisted metadata cannot create it. Its trusted callback rechecks that authority on the authenticated TLS connection immediately before request.end sends the financial body. Independent create-only fsynced signing and submission claims and a pre-key retained-material check survive restored operation/usage state. A crash, timeout, wrong returned hash or lost response cannot invoke custody or broadcast again.

An observer independently checks the exact transaction envelope, canonical finalized receipt, implementation pins at the receipt block, actual fee ceiling, and exactly one matching token Transfer. Reverts remain separately proven. Only a successful finalized transfer can disclose canonical `PAYMENT-SIGNATURE` base64 JSON `{x402Version:2,payload:{txHash},resource:originalResource,accepted:originalRequirement}`. No token authorization signature is fabricated.

Payment finality does not prove merchant delivery. Completion additionally requires upstream HTTP 200, JSON media type and a finite Bitcoin price response with a positive numeric USD price. Response headers, body digest and parsed result are retained in the append-only operation. A failed or lost merchant response remains paid/delivery_unknown. Plain observe never requests merchant delivery; `--deliver` explicitly makes one request with exactly the same original tx proof. At most eight delivery attempts are retained. A delivery-start crash is recorded unknown before any explicit same-proof retry. New payment and resend are never recovery paths.

Primary merchant protocol source: https://x402engine.app/docs/ (MegaethScheme and crypto-price response). The original research packet and saved @x402 client/fetch sources establish the v2 PAYMENT-SIGNATURE envelope. `docs/evidence/merchant-usdm-20261009/` contains source/test proof only; no paid acceptance is claimed there.
