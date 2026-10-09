# Finite Relay Base custody serialization

The two Base native funding lanes hold wallet custody outermost through foreground consent, wallet reads, local signing and the physical send response. Inner wallet profile, exact allowlist policy profile, owner and operation locks follow the state store order. Nested sealed-slot reads reuse an invocation-private scope tied to the exact saved operation; the scope ends in finally.

Permanent signing and broadcast claims apply only to Base8453. Legacy BNB saved identities and unsigned crash closure/retirement behavior remain unchanged. A Base operation with lost signed material stays unknown with its usage hold retained and cannot resend.

Verification: strict source and focused test builds,38 focused tests, both Base custody lock-order cases, the original independent native custody race witness, three legacy BNB retirement cases and emitted JS parity. No financial effects were performed.
