# Historical Circle source fixtures

These files are verbatim public exports and RPC captures from `old-circle-historical-anchor-feasibility-20261009`. They cover the actual Linea operation `23f54a86…` and Monad operation `df077b00…`, their own approval/burn wires, canonical receipts, historical deployment reads, and numbered reanchors. They contain no private keys, plaintext stored material, or encrypted bodies.

Tests restore public material headers in a temporary StateStore with a deliberately invalid encrypted body and a test tag. No decrypt, wrapping-secret load, signing, submission, wallet or live RPC occurs. Signature reconstruction and material hashes use the authentic public transaction signatures, not a synthetic Buyer key.

All four archive transaction bodies omit `blockTimestamp`. The exact two-operation verifier derives that field only when its own property is absent, after canonical membership/signature/reanchor verification, and requires the complete saved transaction binding to match. Present null, undefined, or incorrect values refuse. Signature scalar quantities are decoded and padded only for wire serialization; original raw r/s fields and saved full bindings remain unchanged. No other raw metadata is normalized.

The verifier returns a private object-identity certificate bound to the exact StateStore and full durable operation. Its detached JSON evidence is audit material and cannot authorize settlement. Stage2 must independently certify destination proof and bind all durable usage rows before any ledger access.
