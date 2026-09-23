# Gasless USDT foundation (read-only)

This package is a no-money foundation for Ethereum USDT gasless capability checks. It contains the exact asset, chain and sponsor registry; quote, paymaster, UserOperation and receipt codecs; nonce, balance and allowance-slot reads; stable refusal classification; and a read-only rehearsal fixture.

It is foundation-only: **no signing, no custody, no settlement, no payment response, no reservation or dispatch, no CLI or MCP command, and no `eth_sendUserOperation` path**. A dormant local operation journal boundary persists and validates prepared records for status and read-only recovery classification; it does not sign, dispatch, or settle. The exported engine can quote, validate sponsor data, and observe canonical evidence only. The rehearsal loads no key, signs nothing and sends nothing.

Every request is bound to Ethereum chain 1, the pinned USDT contract, EntryPoint, delegate, paymaster and treasury, exact sender/recipient, gross amount, fee cap, minimum received amount, quote storage layout, gas price and paymaster validity. Any identity, chain, amount, expiry, prototype or excess mismatch fails closed with a stable `capability unavailable` or typed refusal reason. Provider text is bounded and never returned as a secret.

## Read-only rehearsal

After building the package, run the fixture with an explicit RPC URL:

```sh
APN_ETHEREUM_RPC_URL=https://example.invalid node scripts/gasless-usdt-rehearsal.mjs \
  --sender 0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7 \
  --to 0x000000000000000000000000000000000000dEaD \
  --amount 1 --max-fee 0.5 --min-received 0.5
```

This stops before any signature and does not read APN state.

## Policy bound local prepare core

`preparePolicyBoundUsdt` is a domain-only, unsigned preparation API. Its adapter must supply the authenticated active owner policy, combined daily USDT usage, a trusted clock, and account state at one canonical Ethereum safe block. The sponsor is the fixed keyless Pimlico endpoint. The API refuses a missing, revoked, expired, mismatched or unadmitted policy; the owner account, Ethereum USDT identity, gasless mechanism pin and positive per-transfer and daily caps must match exactly. It requires the signed paymaster rate to equal the quote rate and checks both against the fee budget, repeats the quote and policy reads after sponsor data, and returns an immutable copy of the prepared data with a binding hash covering the policy revision, safe block, account nonce, fee plan, paymaster data and unsigned operation.

The frozen account batch calls USDT `approve(paymaster, 0)`, then `approve(paymaster, F)`, then `transfer(recipient, N)`, in that order. The paymaster request sees this exact calldata. No signer, dispatch, journal write or usage reservation is exposed by this core API.

The separate `UsdtBoundOperationRepository` and `GaslessUsdtOperationService.prepareBound` persist the complete preparation as a private, integrity-checked local record. A complete, fsynced file is published through an exclusive link for each idempotency key before the final operation file; competing processes cannot claim the same key for different bindings. A retry returns the first saved record even when its original preparation time has passed. If publication stops after the claim, `statusBound` reads that complete claim and a matching retry restores the final file. Stale incomplete temporary files are cleaned up. `resumeBound` rechecks the active owner policy, usage admission, paymaster expiry and safe chain snapshot, returning a read-only classification. Revocation, policy changes and nonce drift fail closed. A later safe block without proof of the original block's canonicality requires recovery. The older dormant v1 journal remains readable for existing status callers and does not contain the complete binding. Neither journal reserves usage, signs or dispatches. A future runtime adapter must authenticate the safe block and policy, reserve shared usage atomically with its operation lifecycle, and recheck before any signature or effect. This package has no CLI or MCP execution path for the new bound preparation and no fresh mainnet transfer acceptance.
