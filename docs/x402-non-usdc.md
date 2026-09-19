# x402 Permit2 foundation (no-money boundary)

This package adds a pure, read-only foundation for evaluating non-USDC x402 offers. It does not sign, broadcast, settle, submit payment requests, or return payment responses.

## Scope

- Pins the Permit2 contract, x402 exact proxy, Avalanche USDT list asset, EIP-2612 domain and facilitator capability/refusal matrix.
- Selects and hashes an exact seller offer while preserving token, payee, amount, chain, timeout and extension bindings.
- Plans Permit2 and optional exact-amount EIP-2612 typed data. The plan is data only; no key material is accepted.
- Provides payer signature recovery/verification for externally supplied signatures.
- Provides receipt and Permit2 nonce bitmap evidence codecs plus read-only chain/facilitator fixtures.

## Explicit boundary

There is no signer port, approval UI, approve transaction, send RPC, settlement dispatcher, custody, journal transition, CLI/MCP route, or payment response codec in this change. Receipt verification records evidence only; it never claims that an HTTP response or facilitator assertion completed payment.

Ethereum USDT and native coins remain refused by the capability matrix when no keyless facilitator and token authorization path are proven. The fixtures under `docs/evidence/x402-non-usdc-2026-09-18/` are read-only observations collected without `/settle`.
