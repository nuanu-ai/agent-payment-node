# Direct Stargate V2 USDC with Polygon native drop

This lane bridges Optimism USDC to Polygon USDC through Stargate V2, with an optional POL native drop to the recipient.
It is finite and pinned. The route is self only: the recipient is the imported profile's own address. Quotes come from
the [direct Stargate V2 quote](stargate-v2-direct-quote.md).

## Pinned route

| Item | Optimism (source) | Polygon (destination) |
| --- | --- | --- |
| Chain ID | `10` | `137` |
| LayerZero EID | `30111` | `30109` |
| USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Stargate pool | `0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0` | `0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4` |
| Stargate TokenMessaging | `0xF1fCb4CBd57B67d683972A59B6a7b1e2E8Bf27E6` | `0x6CE9bf8CDaB780416AD1fd87b318A077D2f50EaC` |
| LayerZero Executor | `0x2D2ea0697bdbede3F01553D2Ae4B8d0c486B666e` | `0xCd3F213AD101472e1713C72B1697E727C803885b` |
| LayerZero Endpoint V2 | `0x1a44076050125825900e736c501f859c50fE728c` | `0x1a44076050125825900e736c501f859c50fE728c` |

ABI provenance, the Type-3 options layout, and the `dstConfig` cap getter are recorded in the repository test fixture
`tests/core/stargate-v2-fixtures/official-registry-and-abi-20260920.json`.

## Admission

`prepare` requires an active owner allowlist policy admitting Optimism USDC on the `bridge` rail with the exact
mechanism pin
`{ "provider": "stargate-v2", "reference": "eip155:10:0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0/eip155:137:0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4" }`.
Records missing their policy, and any route or policy drift, are corrupt before effects.

## Commands and environment

```text
apn stargate token prepare --profile <profile> --amount-atomic <usdc> [--native-drop-atomic <wei>] --min-output-atomic <usdc> \
  --max-native-debit-atomic <wei> [--max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>] --idempotency-key <key>
apn stargate token execute --operation <operation-id>
apn stargate token cleanup --operation <operation-id>
apn stargate token observe --operation <operation-id>
apn stargate token status  --operation <operation-id>
apn stargate token receipt --operation <operation-id>
```

| Command | What it does | Signs or sends |
| --- | --- | --- |
| `prepare` | Reads both chains, the Executor cap, the policy and the allowance; writes exact unsigned approval and bridge envelopes. | Never |
| `execute` | Foreground TTY confirmation, then each frozen effect after fresh quote, cap, policy, allowance and simulation checks. | Each effect at most once |
| `cleanup` | Foreground TTY confirmation of one freshly simulated `approve(pool, 0)`. | One revoke; an ambiguous one is never resent |
| `observe` | Reads both chains and advances only an operation that already has an attempt marker, transaction hash, or pending usage reservation target. | Never |
| `status` | Reads the local owner journal; may reconcile only an operation-bound pending transition in the local shared usage ledger. | Never; no RPC |
| `receipt` | Reads the local canonical receipt after exact destination proof and finalized usage accounting; may reconcile the same ledger transition. | Never; no RPC |

Set credential-free `APN_OPTIMISM_RPC_URL` and `APN_POLYGON_RPC_URL`. `status` and `receipt` read only the local owner
journal and require no RPC configuration (except the compatibility closure check described below).

### Options

- `--amount-atomic`: USDC principal in atomic units; required, positive.
- `--native-drop-atomic`: optional POL native drop in wei, a canonical uint128. Omit it for a token-only transfer: it
  defaults to zero and then emits no LayerZero options. A nonzero drop must be within the onchain Executor native cap.
- `--min-output-atomic`: the owner minimum USDC output; required.
- `--max-native-debit-atomic`: the total native debit cap in wei; required. It must cover approval gas plus the
  LayerZero message value plus the bridge gas ceiling, all charged at the approved max fee.
- `--max-fee-per-gas-wei` and `--max-priority-fee-per-gas-wei`: optional, only as a pair. See
  [Optional EIP-1559 fee ceilings](#optional-eip-1559-fee-ceilings).
- `--idempotency-key`: required, 8 to 128 safe ASCII characters.

### Example

Prepare without signing or broadcasting, then review the prepared record before execution:

```sh
apn stargate token prepare \
  --profile <profile> \
  --amount-atomic 100000 \
  --native-drop-atomic 50000000000000000 \
  --min-output-atomic 99000 \
  --max-native-debit-atomic <wei> \
  --idempotency-key <key>

apn stargate token status --operation <operation-id>
apn stargate token execute --operation <operation-id>
apn stargate token observe --operation <operation-id>
apn stargate token receipt --operation <operation-id>
```

## Lifecycle

Terminal states: `observed`, `cleaned` and `abandoned_unknown`. Non-terminal states: `prepared`, `approved`,
`allowance_submission_started`, `allowance_submitted`, `allowance_unknown_finality`, `allowance_observed`,
`post_approval_quote_bound`, `submission_started`, `submitted`, `unknown_finality`, `cleanup_required`,
`cleanup_submission_started`, `cleanup_submitted` and `cleanup_unknown_finality`.

### Prepare

Preparation reads the shared usage ledger and the onchain Executor native cap, then performs same-request `quoteOFT` and
`quoteSend` with the exact Type-3 native-drop bytes. It freezes the principal, quoted minimum output, owner minimum
output, native drop, LayerZero fee, nonce, gas, EIP-1559 fees, total native debit cap, mechanism pin, and versioned route
finality policy. The preparation quote expires 60 seconds after preparation.

### Allowance and approval

ERC20 approval is a separate durable effect:

- A zero allowance creates an exact principal approval.
- An existing exact-principal allowance skips it. Bridge simulation then runs during preparation and again before send,
  without an approval-finality wait.
- Any other nonzero allowance refuses preparation and requires explicit cleanup.

When the allowance is zero, preparation simulates only the exact approval. It records the bridge simulation as
`pending_post_approval` and freezes a conservative bridge gas ceiling bounded by the protocol maximum and the remaining
owner native-debit budget after approval gas and the LayerZero message value.

The approval must be signed and durably marked for submission before the preparation quote expires. That marker freezes
a 30 minute `approvalFinalityWindowMs` and an exact `approvalFinalityDeadline`. Waiting for the exact approval
transaction at Optimism `safe` finality may continue after the preparation quote expiry, with no resend.

### Post-approval quote

After the approval is safely observed at the exact principal and before that deadline, execution obtains a new quote and
snapshots its hash, source block and 60 second local expiry. The integrity-bound `postApprovalQuote` freezes:

- the owner-approved minimum output and maximum quote loss, separately from its current quoted output;
- the current pool and token code, route finality policy, Executor native-drop cap and policy binding;
- source token and native balances, exact allowance, pending nonce and fee quote;
- a fresh finalized destination balance baseline;
- the exact `eth_call`, the exact `eth_estimateGas`, the bridge envelope and the recomputed maximum debit.

The fresh quoted output and LayerZero fee may differ from the preparation quote. APN accepts the fresh quote only when
its output is at or above the owner-approved minimum and the quote loss, native drop, mechanism, Executor cap, EIP-1559
fee ceilings, bridge gas ceiling, policy and total native-debit cap remain within the approved bounds. The preparation
quote is never used to sign this bridge.

A restart reuses the one stored post-approval snapshot. A missing snapshot can be recreated through read-only quoting;
a stored snapshot can never be rewritten. The bridge must be signed and durably marked before the stored post-approval
quote expires.

### Send safety

APN writes an attempt marker before each approval or bridge broadcast. A crash or ambiguous RPC result changes the
operation to observation only and never resends. Completion requires zero residual allowance.

Execution durably records the intended shared-ledger reservation before making it and records every later ledger
transition before applying it. A crash or ledger error is therefore retried idempotently by `execute`, `observe`,
`cleanup`, or `status` without another signature or broadcast. A reservation cap race or error after approval enters
`cleanup_required` so the live allowance can be revoked.

### Cleanup

The operation enters `cleanup_required` on any of:

- approval revert or mismatch;
- the 30 minute approval-finality deadline;
- an unavailable or degraded fresh quote;
- policy or mechanism drift, or a code/config change;
- nonce, balance or fee drift;
- simulation failure;
- post-approval quote expiry;
- an allowance left after expiry, failed bridge preflight, signing refusal, or a safely confirmed bridge revert.

A deadline or an ambiguous approval outcome requires the explicit cleanup command to submit a later `approve(pool, 0)`
even when the pending allowance read is zero.

`apn stargate token cleanup --operation <id>` may initiate one `approve(pool, 0)` only from an exact saved
`cleanup_required` record. It foreground-confirms one freshly simulated envelope, writes its attempt marker before
broadcast, never resends an ambiguous attempt, and is followed by the live exact allowance check. `observe` can recover
an attempted cleanup without signing. A cleanup that can no longer zero the allowance returns the operation to
`cleanup_required` for a fresh, consented cleanup. `cleaned` requires a safe successful cleanup receipt and a safe zero
allowance read.

### Abandon

`apn operation abandon --operation <id>` is the last-resort owner exit. It closes a token journal as
`abandoned_unknown` only past its prepare expiry and with no pending ledger step (otherwise `APN_OPERATION_BLOCKED`,
reason `stargate_token_abandon_not_eligible`; run `apn stargate token status` first to settle a pending ledger step).
Its foreground consent names any signed approval, send or cleanup and the pool allowance. It reads and writes only the
journal and never signs or sends.

## Delivery proof

### Source

Source receipts are members of the canonical safe chain only when an exact-height block read matches their block hash.
The source receipt must contain exactly one Endpoint V2 `PacketSent` and one pool `OFTSent`; their GUIDs must match, and
the packet must bind EID `30111`, the pinned Optimism TokenMessaging sender, nonce, EID `30109`, and the pinned Polygon
TokenMessaging receiver. Both TokenMessaging addresses are pinned. Their distinct chain-specific runtime code hashes are
checked at the source safe block and destination finalized block, because the deployments embed different immutable
configuration.

Source completion requires the bound safe `PacketSent` and exactly one `OFTSent` from the pinned Optimism pool with the
exact destination EID, GUID, owner, sent amount, and quoted received amount.

### Destination

Polygon destination observation uses the pinned `finalized` tag for its baseline, log horizon, token and POL balance
reads, `OFTReceived`, `PacketDelivered`, and `NativeDropApplied` proof, then rechecks the frozen baseline and every
evidence block hash. If Polygon `finalized` is unavailable, the operation fails closed without retrying `safe`,
`latest`, or `pending`.

- It scans the exact inclusive baseline-to-horizon range in contiguous chunks of at most 100 blocks, deduplicates
  identical provider rows, rejects conflicting duplicates, and refuses a horizon requiring more than 256 log queries.
- Exactly one successful native drop and exactly one delivery are required.
- The drop may finalize in an earlier transaction or in the delivery transaction; its packet origin, nonce,
  TokenMessaging OApp, owner, amount, and success must match.
- The delivery transaction must call the official Executor `execute302` with the same origin and GUID, emit
  `PacketDelivered` from Endpoint V2 to Polygon TokenMessaging, and emit the exact pool `OFTReceived`.
- The drop must precede delivery, and the OFT receipt must precede packet delivery when they share a block.
- Token and POL balance deltas are recorded only as corroboration and cannot replace or invalidate the exact event and
  calldata proof.

Destination completion requires the matching finalized LayerZero packet execution, Endpoint delivery, `OFTReceived`, and
successful native drop.

## Canonical receipt

Successful operations emit canonical receipt schema `apn.stargate-v2-token-receipt.v2`. Its `quoteLifecycle` records the
owner-approved minimum output and maximum quote loss separately from the initial and post-approval quoted outputs and
message fees. It also binds the preparation quote and expiry, the 30 minute approval-finality window, the exact approval
marker and deadline, and the post-approval snapshot hash, quote block and expiry. The receipt's effective quote, minimum
output, message fee, Executor cap and maximum debit come from the post-approval snapshot.

## Optional EIP-1559 fee ceilings

`prepare` accepts `--max-fee-per-gas-wei` and `--max-priority-fee-per-gas-wei` only as a pair. Both must be positive
canonical uint256 values, the priority ceiling cannot exceed the max-fee ceiling, and each ceiling must be at least the
fresh RPC quote.

- When omitted, APN preserves the exact quoted fee pair.
- When supplied, the journal, approval screen, unsigned approval and bridge envelopes, debit cap calculation, and receipt
  freeze the quoted pair and the separate owner-approved pair.
- Execution accepts a fresh fee quote only while both values remain within the approved pair. Exceeding either ceiling
  requires prepare again and triggers allowance cleanup when approval already happened.
- The signed envelope always uses the approved pair.

`maxNativeDebitAtomic` must cover approval gas plus the LayerZero message value plus the bridge gas ceiling, all charged
at the approved max fee.

## Compatibility

New preparations use operation schema v5 and require the pinned policy plus `pinned_v2` provenance. Every released
version wrote only v5. Schemas v1 through v4 were written only by pre-release builds, and records of those schemas can
still exist. A frozen read-only reader (`src/legacy/stargate-v2/`) reads them:

- Each claims its Optimism account until it is terminal (`observed` or `cleaned`). Nothing signs, sends, cleans up or
  resumes it.
- While it is not terminal, `apn stargate token status` (and `apn operation status`) reads the account's nonce at the
  `finalized` block from `APN_OPTIMISM_RPC_URL`. Once that nonce is past every nonce in the record's envelopes and none
  of its own transaction hashes is pending, it writes `stargate-v2-token/<operation-id>.legacy-closure.json` beside the
  record (`legacy_closed_nonce_consumed`), and the record is terminal from then on, also after the operation index is
  rebuilt.
- `apn operation abandon` does not apply to such a record (`stargate_legacy_closure_is_the_exit`); its exit is that
  closure.
- An allowance such a record left behind is not revoked by APN.
