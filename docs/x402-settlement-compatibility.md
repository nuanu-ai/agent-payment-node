# x402 settlement transaction fields

APN accepts the canonical `transaction` field in PAYMENT-RESPONSE and the
`txHash` alias observed in AsterPay responses. At least one must contain a
nonzero, lowercase, 32-byte hexadecimal transaction hash. If both are present,
both must be valid and identical. A malformed canonical field cannot be
rescued by a valid alias, or the reverse.

Normalization uses `transaction` for the settlement digest. The original
header bytes remain bound to the payment-response header digest. Strict
base64/JSON parsing, official decoder equivalence, frozen network, optional
payer/amount validation and independent on-chain settlement verification
remain required. HTTP success by itself does not complete the payment.

This compatibility change applies when processing a response. It does not
rewrite terminal operations or receipts and does not add payment or result
recovery attempts. A previously finalized failed receipt remains unchanged.
