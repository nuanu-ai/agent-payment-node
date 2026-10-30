# x402 settlement transaction fields

A seller's `PAYMENT-RESPONSE` header can name the settlement transaction. APN accepts two field names:

- `transaction`, the canonical x402 field;
- `txHash`, an alias some sellers use (for example AsterPay).

## Rules

- At least one of them must hold a non-zero, lowercase, 32-byte hexadecimal transaction hash.
- If both are present, both must be valid and identical; otherwise the response is refused
  ("PAYMENT-RESPONSE transaction and txHash conflict").
- A malformed `transaction` cannot be rescued by a valid `txHash`, and the reverse.
- The normalized value (taken from `transaction`) goes into the settlement digest. The original header bytes stay bound
  to the payment-response header digest.

These checks add to the existing ones, which still apply: strict base64 and JSON parsing, equivalence with the official
decoder, the frozen network, optional payer and amount validation, and independent on-chain settlement verification.
HTTP success alone never completes a payment.

## Compatibility

The alias is applied only when a response is processed. It does not rewrite terminal operations or receipts and does
not add payment or result-recovery attempts. A previously finalized failed receipt stays unchanged.
