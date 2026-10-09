# Foreground consent absolute deadline correction

Parent: e7e5d5ad3d1c0357345fe2aadd1e625281dc924a. Source-only follow-up; no real wallet/profile/policy/payment/install action.

The service captures an immutable approvalEndsAt immediately when the normal foreground approval callback returns: that instant plus exactly 60 seconds. Async revalidation, reservations and fsynced claims cannot renew it. Checks after post-confirmation reads and reservation use the captured deadline, and the live grant receives it unchanged, clamped to original operation expiration and the active token/native policy window. Original operation TTL, frozen material, claims and unknown-outcome/no-resend behavior are unchanged. CLI advertises 60 seconds.

The original expensive unsigned preflight remains before TTY. Required fresh post-TTY policy/custody/nonce/code/economic/challenge checks remain; a delayed read now refuses before custody rather than minting a renewed interval afterward. Expiry after sealing/claim remains held unknown and cannot resend.

Witnesses include post-TTY async delay of 60,001ms (zero custody/sign/send), delayed issuer invocation, queued dispatch with operation TTL still valid (zero POST/no resend), production beforeKeyLoad expiration (zero decrypt/sign), and a delayed TLS handshake checking the actual private grant (zero request.end body dispatch). All state and HTTPS requests in these tests are temporary/synthetic. No positive real default-wallet signature is claimed.

Compilation and test execution use pinned Node24.15.0. Production rebuild parity covers 2,286 dist files with zero changed SHA-256 bytes. Shipping forbidden-surface/500-line scan passes 762 files. Receipt membership/reobservation remains with the separate integration packet and is not changed here.
