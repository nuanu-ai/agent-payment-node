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
