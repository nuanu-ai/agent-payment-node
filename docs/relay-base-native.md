# Finite Base native Relay funding

`relay native prepare`, `relay native execute`, `relay status`, `relay observe`, and `relay retire` support two separate fixed seller routes. Existing BNB routes and saved receipt identities remain valid.

| Mechanism reference | Source | Destination | Recipient | Minimum admitted output |
| --- | --- | --- | --- | --- |
| `base-native-mega-usdm-default-v1` | Base ETH | MegaETH USDm `0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7` | default `0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14` | `90000000000000000` atomic USDm |
| `base-native-polygon-native-buyer-v1` | Base ETH | Polygon POL | buyer `0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7` | `700000000000000000` wei POL |

Both use `evm-live-seller`, owner `0x991e254B5C8e0AAf6c244eaa2706BAd059809b04`, exactly `50000000000000` wei principal, and a `1000000000000` wei pre-submission full fee budget. The active Base native bridge policy must admit the exact mechanism reference. Use `mechanismOptions.bridge` to admit both alternatives with individual 50T principal caps and a combined owner daily cap. No policy is installed automatically.

```sh
apn relay native prepare --profile evm-live-seller --recipient 0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14 --amount-atomic 50000000000000 --min-output-atomic 90000000000000000 --max-deposit-network-fee-wei 1000000000000 --idempotency-key relay-base-mega-0001
apn relay native execute --operation <saved-operation-id> --rpc-url https://mainnet.base.org
apn relay observe --operation <saved-operation-id> --rpc-url https://mainnet.base.org --bnb-rpc-url https://mainnet.megaeth.com/rpc
```

For POL, use the buyer recipient and `700000000000000000` minimum. `--bnb-rpc-url` is the retained destination RPC option name; the observer verifies the saved destination chain. The CLI and MCP share the existing native prepare/execute command contracts. Execution requires foreground confirmation.

The quote validator recomputes the official vendored Relay settlement SDK order ID, recovers the pinned solver, and re-encodes the exact native deposit. It rejects extra steps/output calls, changed currencies/recipients, malformed status locators, lower outputs and changed refund rows. The Polygon output's USDC refund row is admitted only for this exact fixed route; final output remains native POL.

Source execution verifies the Base depository runtime `0x77df38a47ee0c4453bc1bdc5f322712f0104ba1d97c4798dd49f16d4ed2e6256`, fresh canonical balance/nonce and gas estimate. Its full fee check includes the GasPriceOracle L1 fee upper bound for at most 512 signed bytes and operator fee, before signing and before the single durable dispatch. OP Stack total fees have no transaction-level cap; the 1T budget is a verified pre-submission ceiling. An ambiguous send is observed using the saved hash and never repeated.

Base source finality requires a stable canonical safe checkpoint. Provider status is only an assertion and destination hash hint. Mega USDm credit requires a successful canonical receipt, the pinned token proxy/implementation, one matching Transfer log, and the exact adjacent balance increase. Polygon native credit uses the existing direct transfer or exhaustive trace proof. Operational acceptance additionally requires provider success and a source hash match. Neither result asserts cryptographic Relay order causality or an external merchant purchase.

Refund destinations remain signed-order-bound. Provider refund/failure status cannot release a confirmed source principal reservation or authorize another send. Untouched or proven no-effect attempts can be retired through the existing local lifecycle. Native gas acquisition and merchant payment are separate commands outside these funding lanes.
