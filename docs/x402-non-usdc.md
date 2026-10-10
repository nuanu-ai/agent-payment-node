# x402 Permit2 source boundaries

The package includes the pure offer foundation, unsigned current-owner preflight and a CLI-only foreground Avalanche USDT Permit2 flow. The foundation and preflight remain unsigned. The foreground flow can sign and send one exact paid GET, then use genuine readonly chain evidence to finalize the owned journal. Source fixtures do not establish live merchant, human approval, manual QA or paid acceptance.

## Scope

- Pins the Permit2 contract, x402 exact proxy, Avalanche USDT list asset, EIP-2612 domain and facilitator capability/refusal matrix.
- Selects and hashes an exact seller offer while preserving token, payee, amount, chain, timeout and extension bindings.
- Plans Permit2 and optional exact-amount EIP-2612 typed data. The plan is data only; no key material is accepted.
- Provides a local-wallet Avalanche USDT prepare domain that binds the exact merchant challenge and selected offer to the active owner x402 admission, its Permit2 mechanism pin and caps, token balance/allowance/domain, contract code hashes and facilitator capability. The production read port loads the authenticated active policy and common usage ledger, checks the local payer and selected amount against its x402 admission, then reads Avalanche chain state at one finalized block through a configured RPC source. It checks the pinned token domain and Permit2/proxy code hashes from `eth_getProof`, rechecks the block hash, and reads PayAI `/supported` once over bounded HTTPS. The port returns only observations to the existing unsigned `preparePermit2WithPort` boundary.
- The prepare core accepts the decoded x402 v2 `PAYMENT-REQUIRED` shape. EIP-2612 sponsorship requires a valid `extensions.eip2612GasSponsoring` version-one declaration and matching facilitator capability; the declaration remains bound to the challenge hash. The read port can supply only owner admission and observations, not payer or merchant terms.
- Provides payer signature recovery/verification for externally supplied signatures.
- Provides receipt and Permit2 nonce bitmap evidence codecs plus read-only chain/facilitator fixtures.

## Explicit boundary

The foundation/read adapter has no signing or submission authority. It requires an explicitly configured RPC source, active owner profile, authenticated local account resolver and usage ledger, and rechecks that account after reading. CLI current-owner preflight uses this read port; MCP exposes only existing intent status. The separate foreground CLI closure owns its default TTY approval and private signing/dispatch context. HTTP status, response header and facilitator assertion never prove completed payment.

The adapter requires an Avalanche `finalized` block no older than 30 seconds at return and uses that exact block number for every contract read. It refuses a caller clock that differs from its trusted clock by more than one second. One read makes at most ten sequential RPC calls, with a two-second per-call timeout and a 15-second deadline checked before each RPC and at return, and never retries. Concurrent reads sharing a port or the same injected RPC source refuse. The injected RPC source must honor `AbortSignal`, support `eth_getProof`, remain bound to one trusted Avalanche endpoint, and enforce endpoint-wide rate limits across separately constructed sources. The port cannot independently prove the remote endpoint's identity or enforce a global public-endpoint quota. PayAI `/supported` advertises the v2 exact network and EIP-2612 extension, but does not name the token or Permit2 method. The token and proxy capability remain pinned from the prior read-only evidence, so a changed provider implementation can still refuse later. There is no live merchant or paid acceptance in this change.

Ethereum USDT and native coins remain refused by the capability matrix when no keyless facilitator and token authorization path are proven. The fixtures under `docs/evidence/x402-non-usdc-2026-09-18/` are read-only observations collected without `/settle`.

## Existing intent status

`apn x402 permit2 status --profile <profile> --operation <operation-id>` and MCP `apn_x402_permit2_status` read the same checked existing local intent. They return only operation ID, requested profile, chain, token, owner, recipient, `execution_blocked` capability/state and blocker codes. A missing root, directory or record returns `not_found` without creating anything. Wrong profile, malformed records, invalid operation IDs, unsafe permissions and symlinks fail closed.

Status uses the existing secure state's non-mutating checked JSON reader directly: no initialization, locks, repair, fsync, RPC, wallet, policy activation, usage reservation, signature or send. Typed data, authorization material, digests and secrets are omitted from output. The original internal `load()` remains an initializing journal API and is not used by status.

## Current-owner CLI preflight

`apn x402 permit2 preflight --profile <profile> --payment-required <base64-header> --expected-challenge-hash <64-lowercase-hex> --expected-index <index> --expected-terms <base64-json-of-selected-PaymentRequirements> --rpc-url <public-Avalanche-HTTPS-RPC>` takes an already inspected x402 v2 `PAYMENT-REQUIRED` header and the exact selected terms the operator expects. APN decodes the header strictly, checks the challenge hash, index and full selected requirement before any RPC, and then reads the current local wallet's checked public metadata and encrypted envelope identity. An external provider profile or disagreement in account binding refuses. The production port loads active x402 Permit2 policy, reads the existing common usage bucket without initialization or reservation, and checks pinned finalized chain and facilitator evidence. It rechecks wallet, policy and usage after the network reads.

Success returns only profile, `admissible_unsigned` state, `execution_blocked` capability, chain, payer, recipient, token, atomic amount, deadline, challenge/offer/policy/prepare hashes and `permit2_execution_not_exposed` blocker code. Failure returns a classified code and blocker reason. Typed data, nonce, authorization, signatures, private wallet data, and merchant resource content are omitted. This preflight command never creates an intent, payment journal, usage reservation or payment request. The configured RPC is public HTTPS only, permits only four read methods, runs at most ten sequential calls, and uses the read port's per-call and total deadlines. APN's kernel-backed lock and `rpc-provider-pacing` record serialize calls for each normalized endpoint across CLI processes; a transport starts at least 750 ms after the preceding transport completes, including failed and aborted in-flight calls. A durable 15.75-second pre-call cooldown covers a process crash or failed completion write, then successful completion clears it. This preflight writes only operational pacing metadata and lock files; it does not write payment state. A cancelled or timed-out queued read checks its abort signal before contacting the RPC. No MCP preflight tool exists. This is synthetic source verification; no live merchant or paid acceptance is claimed.

When another process holds the endpoint lock through a slow RPC, a queued preflight may return busy or time out before starting its own transport. After contention clears, the operator can make a fresh manual attempt. The CLI does not retry automatically.

## Foreground production CLI

Use an installed artifact whose provenance and `approve`/`observe` help match this
source contract. The source candidate is unreleased; its version number alone
does not establish installed support. No eligible live merchant URL is established
here. The following commands are templates. Replace every placeholder with
verified inputs before running them; do not use example endpoints for payment.

1. Verify the current local-native owner binding, active Permit2 policy and caps,
   available funds, the merchant's exact Avalanche USDT offer and a credential-free
   public HTTPS Avalanche RPC. Choose a stable 8 to 200 character safe ASCII
   idempotency key for this exact request. `--profile` defaults to `default` on
   approve; name the verified profile explicitly when another wallet owns it.
2. Run the approval command in a foreground TTY:

   ```text
   apn x402 permit2 approve --url <verified-merchant-https-url> --rpc-url <verified-public-avalanche-https-rpc> --profile <verified-local-profile> --idempotency-key <stable-request-key>
   ```

   Inspect the frozen request, payee and maximum debit at the prompt. Consent
   authorizes signing and at most one paid GET in that process. This command
   does not offer sign-only approval. Keep the returned operation ID.
3. If the operation is held (HOLD), continue only with observation. An explicit
   nonzero transaction hash is a candidate to check, not proof of payment:

   ```text
   apn x402 permit2 observe --operation <saved-operation-id> --rpc-url <verified-public-avalanche-https-rpc> --profile <same-local-profile> --transaction <candidate-transaction-hash>
   ```

   Without `--transaction`, settlement observation can use a saved transaction
   hint. A missing or bad hint leaves the operation held; a later explicit
   candidate can be checked. HTTP 200 and transaction hints do not prove public
   chain finality. Only genuine finalized chain evidence can finalize payment.
4. For an expired authorization with no effect, use the separate mode:

   ```text
   apn x402 permit2 observe --operation <saved-operation-id> --rpc-url <verified-public-avalanche-https-rpc> --profile <same-local-profile> --expired-unused
   ```

   `--transaction` and `--expired-unused` are mutually exclusive. Expiry alone
   is insufficient: this mode requires actual finalized chain time beyond the
   saved deadline and evidence that the nonce remains unused.

The same profile, key and exact request retain one operation. Changing the request
with the same profile/key returns an idempotency conflict. Prepared, reserving or
reserved operations resume saved material. Exposed, signed, pending and terminal
operations never prepare again, sign again or send again. Observation reads the
saved owner and operation, and may reconcile the owned local journal and usage
ledger; it performs no merchant request or signing. Omit `--profile` on observe
to use the saved owner, or provide the same profile as a check.

`apn x402 permit2 approve --help` describes the required owner-selected HTTPS URL, HTTPS RPC, explicit stable idempotency key and optional profile (default `default`). The command permits GET only, with no caller headers/body or approval bypass flag. Before unsigned merchant HTTP, it validates a genuine local-native capability and metadata binding; it does not describe/decrypt the wallet or load Keychain before approval. Matching exposed, signed, request-pending and terminal operations return sanitized status with no HTTP, RPC, UI, keys or ledger repair. Prepared/reserving/reserved operations resume from saved material without another 402 inspection or preparation.

The new same-process `signAndSubmitOnce` enclosure owns concrete default foreground TTY consent, original approval clock, journal and fence. Constructor-injected approval callbacks and public `run` cannot authorize this enclosure. After consent it uses guarded native signing, one private first-request grant and one dedicated HTTPS attempt, with a 20-second monotonic dispatch deadline and no retry. Response data is reduced to an immutable untrusted locator sidecar. HTTP 200, a transaction hint or a timeout cannot mark payment settled or failed.

`apn x402 permit2 observe --help` describes readonly continuation by operation ID, selected HTTPS RPC and either an explicit transaction candidate or `--expired-unused`. It performs no merchant request, approval, decryption, re-signing or resend. A later candidate can probe genuine chain evidence despite a bad saved hint; only the existing private observer proof can finalize the journal and common usage ledger. Unsigned rows do not start RPC, and matching terminal ledger intent can reconcile locally. Legacy Permit2 status and generic operation status remain separate; approve and observe have no MCP tools.

Lower-level configurable approval-authority APIs remain trusted wiring: their private proofs bind the issuer's decision and owned material, and do not independently attest an actual human TTY receipt. Synthetic tests may mock the concrete TTY prototype as a consent fixture. Those tests do not prove human approval. Global human-consent, installed/manual QA and live acceptance obligations remain open; the original 32 acceptance obligations are unchanged. No eligible live merchant URL is established by this source work.
