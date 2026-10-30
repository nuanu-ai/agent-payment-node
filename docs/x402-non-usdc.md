# x402 Permit2 source boundaries

The foreground Permit2 lane pays one x402 v2 `exact` offer with `assetTransferMethod: "permit2"` from the local wallet,
on any EVM chain and token that the owner's active allowlist policy admits for x402 with the `x402-exact-permit2`
mechanism pin. It is a CLI-only flow with foreground approval: one exact paid GET, then settlement proven from public
chain evidence.

Unattended Permit2 through `x402 fetch`, the Permit2 allowance commands and the admission rules shared by every lane are
described in [x402 to any seller](x402-any-seller.md).

| Command | Purpose | MCP |
| --- | --- | --- |
| `x402 permit2 preflight` | Check that inspected terms are admissible, without signing or saving anything. | No |
| `x402 permit2 approve` | Foreground approval, signing and one paid GET. | Handoff only |
| `x402 permit2 observe` | Read-only continuation that proves settlement or unused expiry. | No |
| `x402 permit2 status` | Read one operation from the local journal. | `apn_x402_permit2_status` |

## Requirements

- A local wallet profile with a native custody binding. External provider profiles are refused.
- An active allowlist policy whose `accounts.evm` is the wallet, with a token row on the offer's chain that has the
  `x402` rail, caps and exactly this mechanism pin:

  ```json
  { "provider": "x402-exact-permit2", "reference": "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" }
  ```

- The token balance, and either an existing allowance to Permit2 that covers the price
  (`x402 permit2 allowance set`) or a seller-declared EIP-2612 sponsorship.
- A credential-free public HTTPS RPC of the offer's chain, passed as `--rpc-url`. It must accept JSON-RPC batches.

Native coins cannot be paid through Permit2: only token rows are admitted.

## What the lane checks

- The canonical Permit2 contract and the x402 exact proxy at their pinned addresses, verified on each chain: the proxy's
  runtime hash, and Permit2's runtime template with that chain's own immutables. Token symbol and decimals come from the
  owner's allowlist row.
- The selected offer and its hash, keeping the token, payee, amount, chain, timeout and extension bindings exactly as
  the seller sent them. The offer is the lowest-index offer the owner's policy admits.
- The Permit2 typed data and, only when needed, an exact-amount EIP-2612 permit. Planning is data only; no key material
  is accepted at that stage.
- The owner admission: the active policy and the shared usage ledger are loaded, and the local payer and the amount are
  checked against the x402 admission, its Permit2 pin and its caps.
- The decoded x402 v2 `PAYMENT-REQUIRED` challenge. EIP-2612 sponsorship requires a valid version-one
  `extensions.eip2612GasSponsoring` declaration with a matching facilitator capability, and the declaration stays bound
  to the challenge hash. The read side supplies only owner admission and chain observations, never payer or merchant
  terms.

APN does not query a facilitator. The seller chooses the facilitator, EIP-2612 sponsorship follows the seller's own 402
declaration, and a facilitator that cannot settle leaves the signature to expire unused at its deadline.

### Chain reads

- Reads are taken at the chain's `latest` block, which must be no older than 30 seconds, and every contract read is
  pinned to that block's hash (EIP-1898 `{blockHash, requireCanonical}`). These pre-sign facts only predict settlement
  and cannot move money; settlement and expiry stay `finalized` proofs.
- One read makes exactly two batched POSTs: chain id with the block header, then balance, allowance, the Permit2 nonce
  word and the Permit2 and proxy runtime code. A third pinned POST (token domain, EIP-2612 nonce) is made only when a
  short allowance needs a seller-sponsored permit.
- Each POST has a 5-second timeout, and a 15-second deadline is checked before each POST and at return. Reads are never
  retried. A caller clock more than one second away from the trusted clock is refused. Concurrent reads sharing the same
  RPC source are refused.
- Reads go through the shared direct-EVM transport: provider-family pacing across processes and a per-command POST cap,
  the same transport the signing fence and the observer use.
- APN cannot prove the remote endpoint's identity or enforce a global quota on a public endpoint.

HTTP status, response headers and facilitator assertions never prove a completed payment.

## Preflight

```text
apn x402 permit2 preflight --profile <profile> --payment-required <base64-header> \
  --expected-challenge-hash <64-lowercase-hex> --expected-index <index> \
  --expected-terms <base64-json-of-selected-PaymentRequirements> --rpc-url <public-HTTPS-RPC-of-the-offer-chain>
```

Preflight takes an already inspected x402 v2 `PAYMENT-REQUIRED` header and the exact terms the operator expects.

1. It decodes the header strictly and checks the challenge hash, the index and the full selected requirement before any
   RPC.
2. It reads the local wallet's checked public metadata and encrypted envelope identity. An external provider profile or
   a disagreement in account binding refuses.
3. It loads the active Permit2 policy, reads the usage bucket without initializing or reserving it, and reads the chain
   at its latest block.
4. It rechecks the wallet, policy and usage after the network reads.

On success it returns the profile, state `admissible_unsigned`, capability `execution_blocked`, chain, payer, recipient,
token, atomic amount, deadline, the challenge, offer, policy and prepare hashes, and blocker code
`permit2_execution_not_exposed`; preflight itself never executes a payment. On failure it returns a classified code and
reason. Typed data, nonce, authorization, signatures, private wallet data and merchant resource content are never
returned.

Preflight never creates an intent, payment journal, usage reservation or payment request. It writes only RPC pacing
metadata and lock files. A queued read that is cancelled or times out checks its abort signal before contacting the
RPC. When another process holds the endpoint lock through a slow RPC, preflight may return busy or time out before
starting its own request; try again once contention clears. The CLI does not retry automatically.

## Approve

The commands below are templates. Replace every placeholder with verified inputs; do not use example endpoints for
payment.

1. Verify the local wallet binding, the active Permit2 policy and its caps, the available funds, the merchant's exact
   Permit2 offer, and a credential-free public HTTPS RPC of the offer's chain. Choose a stable idempotency key of 8 to
   200 safe ASCII characters for this exact request. `--profile` defaults to `default` on approve; name the profile
   explicitly when another wallet owns the payment.
2. Run the approval in a foreground terminal:

   ```text
   apn x402 permit2 approve --url <verified-merchant-https-url> --rpc-url <verified-public-https-rpc-of-the-offer-chain> --profile <verified-local-profile> --idempotency-key <stable-request-key>
   ```

   Inspect the frozen request, payee and maximum debit at the prompt. Consent authorizes signing and at most one paid
   GET in that process. There is no sign-only approval. Keep the returned operation id.

What approve does:

- It permits GET only. There are no caller headers or body, and no approval bypass flag.
- Before the unsigned merchant request, it validates the local native custody capability and metadata binding. It
  does not decrypt the wallet or open the Keychain before approval.
- After consent it signs with the guarded native signer and makes one dedicated HTTPS attempt with a 20-second monotonic
  dispatch deadline and no retry.
- The response is reduced to an immutable, untrusted locator record. HTTP 200, a transaction hint or a timeout cannot
  mark the payment settled or failed.
- A matching operation that is already exposed, signed, request-pending or terminal returns sanitized status, with no
  HTTP, RPC, prompt, key access or ledger repair. A prepared, reserving or reserved operation resumes from its saved
  material without another 402 inspection or preparation.

Approve states: `prepared`, `reserving`, `reserved`, `exposure_unknown`, `request_pending`, `terminal_pending`; terminal
`settled`, `expired_no_effect`, `released_unsubmitted`.

## Observe

If the operation is held, continue only with observation. It never contacts the merchant, approves, decrypts, re-signs
or resends.

```text
apn x402 permit2 observe --operation <saved-operation-id> --rpc-url <verified-public-https-rpc-of-the-offer-chain> --profile <same-local-profile> --transaction <candidate-transaction-hash>
```

- An explicit non-zero transaction hash is a candidate to check, not proof of payment.
- Without `--transaction`, observation can use a saved transaction hint. A missing or bad hint leaves the operation
  held, and a later explicit candidate can still be checked.
- Only finalized chain evidence can finalize the payment; HTTP 200 and transaction hints do not. A proof finalizes the
  local journal and the shared usage ledger.

For an authorization that expired with no effect:

```text
apn x402 permit2 observe --operation <saved-operation-id> --rpc-url <verified-public-https-rpc-of-the-offer-chain> --profile <same-local-profile> --expired-unused
```

`--transaction` and `--expired-unused` are mutually exclusive. Expiry alone is not enough: this mode needs finalized
chain time beyond the saved deadline and evidence that the nonce is still unused.

Omit `--profile` on observe to use the saved owner, or give the same profile as a check. Unsigned operations do not
start RPC, and an operation whose ledger intent is already terminal can reconcile locally.

## Status

```text
apn x402 permit2 status --profile <profile> --operation <operation-id>
```

`status` and MCP `apn_x402_permit2_status` read the operation from the Permit2 journal (`permit2-production/`), the same
record `approve` and `observe` write. They return a redacted view: state, lifecycle, terminal flag, chain, payer,
recipient, token, amount, deadline and resource origin.

- A missing record returns `not_found` without creating anything.
- A wrong profile, malformed records, invalid operation ids, unsafe permissions and symbolic links fail closed.
- Status uses a non-mutating checked reader: no initialization, locks, repair, fsync, RPC, wallet, policy activation,
  usage reservation, signature or send. Typed data, authorization material, signatures and secrets are never shown.

Status states: `prepared`, `reserving`, `reserved`, `release_pending`, `exposure_unknown`, `request_pending`,
`terminal_pending`; terminal `not_found`, `released_unsubmitted`, `settled`, `expired_no_effect`.

The generic `operation status` and this command are separate. `approve` and `observe` have no MCP tools.

## Idempotency

- The same profile, key and exact request keep one operation. Changing the request under the same profile and key is an
  idempotency conflict.
- Prepared, reserving or reserved operations resume their saved material.
- Exposed, signed, pending and terminal operations never prepare, sign or send again.

## Trust boundary

- The read side has no signing or submission authority. It needs an explicitly configured RPC, an active owner
  profile, an authenticated local account resolver and the usage ledger, and rechecks the account after reading.
- Only the foreground `approve` path owns TTY consent and the private signing and dispatch context.
- Lower-level approval-authority APIs are trusted wiring: their proofs bind the issuer's decision and owned material,
  but do not themselves attest that a human approved in a terminal.

## Reason codes

| Reason | Meaning | What to do |
| --- | --- | --- |
| `x402_permit2_owner_admission_required` | No active allowlist policy admits a Permit2 token for the profile. | Stage and activate a row with the Permit2 pin. |
| `x402_permit2_allowance_required` | The allowance to Permit2 is short and no EIP-2612 sponsorship is available. | Run `x402 permit2 allowance set` for that chain and token. |
| `x402_offer_timeout_below_bound` | The lowest-index admitted offer's payment window is under 30 seconds. | Not payable in this lane. |
| `x402_resource_url_mismatch` | The challenge names another origin or path. | Check the URL. |

Other offer refusals are listed in [offer selection](x402-offer-selection.md#offer-terms-and-refusals).

## Compatibility

- Older records keep a facilitator `/supported` digest in `checkpoint.facilitatorSupportedDigest`; new records store the
  checked seller challenge hash there.
- Records prepared with a payment window shorter than 30 seconds still load.
