# x402 Permit2 foundation (no-money boundary)

This package adds a pure, read-only foundation for evaluating non-USDC x402 offers. It does not sign, broadcast, settle, submit payment requests, or return payment responses.

## Scope

- Pins the Permit2 contract, x402 exact proxy, Avalanche USDT list asset, EIP-2612 domain and facilitator capability/refusal matrix.
- Selects and hashes an exact seller offer while preserving token, payee, amount, chain, timeout and extension bindings.
- Plans Permit2 and optional exact-amount EIP-2612 typed data. The plan is data only; no key material is accepted.
- Provides a local-wallet Avalanche USDT prepare domain that binds the exact merchant challenge and selected offer to the active owner x402 admission, its Permit2 mechanism pin and caps, token balance/allowance/domain, contract code hashes and facilitator capability. The production read port loads the authenticated active policy and common usage ledger, checks the local payer and selected amount against its x402 admission, then reads Avalanche chain state at one finalized block through a configured RPC source. It checks the pinned token domain and Permit2/proxy code hashes from `eth_getProof`, rechecks the block hash, and reads PayAI `/supported` once over bounded HTTPS. The port returns only observations to the existing unsigned `preparePermit2WithPort` boundary.
- The prepare core accepts the decoded x402 v2 `PAYMENT-REQUIRED` shape. EIP-2612 sponsorship requires a valid `extensions.eip2612GasSponsoring` version-one declaration and matching facilitator capability; the declaration remains bound to the challenge hash. The read port can supply only owner admission and observations, not payer or merchant terms.
- Provides payer signature recovery/verification for externally supplied signatures.
- Provides receipt and Permit2 nonce bitmap evidence codecs plus read-only chain/facilitator fixtures.

## Explicit boundary

There is no signer port, approval UI, approve transaction, send RPC, settlement dispatcher, custody, public journal transition or payment response codec in this change. The production read port requires an explicitly configured RPC source, active owner profile, authenticated local account resolver and usage ledger. It rechecks that account after reading. A CLI-only current-owner preflight uses this read port; MCP exposes only existing intent status. Receipt verification records evidence only; it never claims that an HTTP response or facilitator assertion completed payment.

The adapter requires an Avalanche `finalized` block no older than 30 seconds at return and uses that exact block number for every contract read. It refuses a caller clock that differs from its trusted clock by more than one second. One read makes at most ten sequential RPC calls, with a two-second per-call timeout and a 15-second deadline checked before each RPC and at return, and never retries. Concurrent reads sharing a port or the same injected RPC source refuse. The injected RPC source must honor `AbortSignal`, support `eth_getProof`, remain bound to one trusted Avalanche endpoint, and enforce endpoint-wide rate limits across separately constructed sources. The port cannot independently prove the remote endpoint's identity or enforce a global public-endpoint quota. PayAI `/supported` advertises the v2 exact network and EIP-2612 extension, but does not name the token or Permit2 method. The token and proxy capability remain pinned from the prior read-only evidence, so a changed provider implementation can still refuse later. There is no live merchant or paid acceptance in this change.

Ethereum USDT and native coins remain refused by the capability matrix when no keyless facilitator and token authorization path are proven. The fixtures under `docs/evidence/x402-non-usdc-2026-09-18/` are read-only observations collected without `/settle`.

## Existing intent status

`apn x402 permit2 status --profile <profile> --operation <operation-id>` and MCP `apn_x402_permit2_status` read the same checked existing local intent. They return only operation ID, requested profile, chain, token, owner, recipient, `execution_blocked` capability/state and blocker codes. A missing root, directory or record returns `not_found` without creating anything. Wrong profile, malformed records, invalid operation IDs, unsafe permissions and symlinks fail closed.

Status uses the existing secure state's non-mutating checked JSON reader directly: no initialization, locks, repair, fsync, RPC, wallet, policy activation, usage reservation, signature or send. Typed data, authorization material, digests and secrets are omitted from output. The original internal `load()` remains an initializing journal API and is not used by status.

## Current-owner CLI preflight

`apn x402 permit2 preflight --profile <profile> --payment-required <base64-header> --expected-challenge-hash <64-lowercase-hex> --expected-index <index> --expected-terms <base64-json-of-selected-PaymentRequirements> --rpc-url <public-Avalanche-HTTPS-RPC>` takes an already inspected x402 v2 `PAYMENT-REQUIRED` header and the exact selected terms the operator expects. APN decodes the header strictly, checks the challenge hash, index and full selected requirement before any RPC, and then reads the current local wallet's checked public metadata and encrypted envelope identity. An external provider profile or disagreement in account binding refuses. The production port loads active x402 Permit2 policy, reads the existing common usage bucket without initialization or reservation, and checks pinned finalized chain and facilitator evidence. It rechecks wallet, policy and usage after the network reads.

Success returns only profile, `admissible_unsigned` state, `execution_blocked` capability, chain, payer, recipient, token, atomic amount, deadline, challenge/offer/policy/prepare hashes and `permit2_execution_not_exposed` blocker code. Failure returns a classified code and blocker reason. Typed data, nonce, authorization, signatures, private wallet data, and merchant resource content are omitted. The CLI never creates an intent, journal, reservation or payment request. The configured RPC is public HTTPS only, permits only four read methods, runs at most ten sequential calls with a 250 ms gap, and uses the read port's per-call and total deadlines. No MCP preflight tool exists. This is synthetic source verification; no live merchant or paid acceptance is claimed.
