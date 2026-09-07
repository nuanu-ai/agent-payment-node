# Standard x402 offer lists

APN accepts a nonempty, schema-valid x402 v2 offer list within its existing
64 KiB encoded / 48 KiB decoded header budget. There is no independent
16-offer limit. Unsupported networks and payment mechanisms may coexist with
a supported offer; selection retains the offer's original index and exact
requirements rather than rewriting the merchant challenge.

The selected offer still has to match the selected network, canonical asset,
supported payment mechanism, token domain, timeout, balance and explicit
amount/policy caps. A larger list does not enable arbitrary x402 tokens,
Gateway, credit bundles, SIWX or additional wallet-provider capabilities.
Unknown optional extensions are not authorization to execute their protocols.

Durable records retain the selected index, exact requirement and existing
hashes. Every offer occupies bytes, so an index at or beyond the complete
decoded wire budget cannot have come from an accepted header and is rejected.
The byte bound replaces the unrelated16 ceiling without changing old record
schemas or fingerprints. The full seller offer list is not persisted;
the original index is metadata, not a substitute for protected requirement
and operation-integrity validation.

GET and absent, present-empty and nonempty POST requests retain their existing
frozen identity. Recovery reuses the same authorization, never a replacement.
Recovering a lost seller result also requires the merchant's supported
idempotent result-recovery contract; it cannot be inferred from arbitrary
extensions or application headers. Without that contract, APN may establish
settlement and honestly report an unavailable result instead of repaying.

The committed Quicknode21-offer fixture and synthetic late-index tests are
compatibility evidence, not a paid Quicknode purchase or live settlement on
Ethereum/Arbitrum. APN execution capabilities and live proof remain separate.
