# Gasless USDT foundation (read-only)

This package is a no-money foundation for Ethereum USDT gasless capability checks. It contains the exact asset, chain and sponsor registry; quote, paymaster, UserOperation and receipt codecs; nonce, balance and allowance-slot reads; stable refusal classification; and a read-only rehearsal fixture. The `gasless usdt prepare` CLI and MCP commands now save an unsigned, policy-bound operation. `gasless usdt status` reads that saved binding.

It is foundation-only: **no signing, no custody, no settlement, no payment response, no reservation or dispatch, and no `eth_sendUserOperation` path**. The local operation journal persists and validates prepared records for status and read-only recovery classification; it does not sign, dispatch, or settle. The exported engine can quote, validate sponsor data, and observe canonical evidence only. The rehearsal loads no key, signs nothing and sends nothing.

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

The separate `UsdtBoundOperationRepository` and `GaslessUsdtOperationService.prepareBound` persist the complete preparation as a private, integrity-checked local record. The state root's parent must exist; creating or reopening each private directory syncs its parent, and an unsupported directory fsync refuses preparation. A complete, fsynced file is published through an exclusive link for each idempotency key before the final operation file; competing processes cannot claim the same key for different bindings. This claim is shared across profiles **within the bound Gasless USDT journal only**. The same key can create a separate operation in another payment family, including the older dormant USDT journal. A matching retry checks the durable claim and frozen caller intent before reading current policy or public RPC, then returns the first saved bound record even if time, policy, safe block or sponsor data has changed. A different recipient, amount or profile under the same key is refused before those reads. If publication stops after the claim, `statusBound` reads that complete claim and a matching retry restores the final file. Stale incomplete temporary files are cleaned up. `resumeBound` rechecks the active owner policy, usage admission, paymaster expiry and safe chain snapshot, returning a read-only classification. Revocation, policy changes and nonce drift fail closed for recovery. A later safe block without proof of the original block's canonicality requires recovery. The older dormant v1 journal remains readable for existing status callers and does not contain the complete binding. Neither journal reserves usage, signs or dispatches. A future runtime adapter must reserve shared usage atomically with its operation lifecycle and recheck before any signature or effect. There is no fresh mainnet transfer acceptance.

## Unsigned command and read budget

`apn gasless usdt prepare --profile <profile> --to <recipient> --amount <gross-USDT> --max-fee <USDT> --min-received <USDT> --idempotency-key <key>` reads the authenticated active owner policy and combined daily USDT usage before public RPC. It binds the owner's Ethereum account, active policy digest/revision/activation, exact USDT and paymaster mechanism, positive transfer and daily caps, and one canonical safe-block account snapshot. It saves the complete unsigned operation. The idempotency key protects this bound journal across all profiles and does not reserve the key in other payment families. The matching MCP tool is `apn_gasless_usdt_prepare`. Read it with `apn gasless usdt status --profile-hash <hash> --operation <operation-id>` or `apn_gasless_usdt_status`.

One prepare permits at most **7 physical public RPC attempts**, with no retry, polling or fallback to single reads. Ethereum uses two strict JSON-RPC batches: chain ID plus safe block identity, then four pinned code hashes, four contract invariants, owner code, USDT balance, EntryPoint nonce and EOA nonce bound to that canonical safe block hash. A malformed, missing, duplicate or mismatched batch response refuses preparation. The EOA nonce is needed for the unsigned EIP-7702 authorization stub when the account is undelegated. The fixed sponsor still uses five separate calls: quote twice, gas price twice and paymaster data once. The second quote and gas price reads enforce the existing post-paymaster drift check. The command has a 60-second total read deadline; each endpoint family shares one persisted in-flight slot, at least 750 ms between starts and a fail-closed 429 cooldown. Public RPC batch compatibility and live payment acceptance are still unverified.

## Installed package no-money acceptance

After `npm run build`, run `node --test tests/packaging/gasless-usdt-installed.test.mjs`. The test packs APN, installs that archive in a temporary sandbox, and imports only the installed package. Deterministic local policy, safe-block and sponsor ports prepare one synthetic 1 USDT operation, verify its durable unsigned journal, status, exact replay and read-only recovery, and refuse an amount above the owner cap before public reads. It also drives the installed read-budget transport through seven physical attempts and verifies that an eighth is refused. This proves the local installed-package path with synthetic inputs; it does not exercise public RPC compatibility, signing, reservation, broadcast or mainnet payment acceptance.
