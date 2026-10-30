# Direct Stargate V2 native execution

APN admits one Stargate V2 native execution lane: Ethereum mainnet native ETH to Unichain mainnet native ETH. The sender
and recipient must be the same imported local profile address. Quotes come from the
[direct Stargate V2 quote](stargate-v2-direct-quote.md).

## Frozen protocol identity

| Side | Chain ID | LayerZero EID | Stargate `StargatePoolNative` |
| --- | --- | --- | --- |
| Source: Ethereum | `1` | `30101` | `0x77b2043768d28E9C9aB44E1aBfC95944bcE57931` |
| Destination: Unichain | `130` | `30320` | `0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7` |

- ABI source: `IStargate.sol`, `StargateBase.sol`, and LayerZero `IOFT.sol` as imported by
  `stargate-protocol/stargate-v2@ce598b8d16472cd76ee47d30b8a40bc5c1b667bb`.
- The canonical send is `sendToken(SendParam, MessagingFee, refundAddress)` in taxi mode: empty `oftCmd`, compose
  message, and extra options.
- The source transaction value is exactly principal plus the fresh `quoteSend` native fee. The owner-supplied
  `maxNativeDebit` covers that value plus the complete EIP-1559 gas envelope.

## Admission

The profile's active owner allowlist policy must admit Ethereum native ETH on the `bridge` rail with the exact mechanism
pin `{ "provider": "stargate-v2", "reference": "eip155:1:0x77b2043768d28E9C9aB44E1aBfC95944bcE57931/eip155:130:0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7" }`.
Preparation freezes that admission (policy digest, revision and mechanism). Before signing, the active policy must still
be the prepared one, and the principal is held in the shared asset-usage ledger under the policy caps. A changed policy
is refused; prepare again.

## Commands and environment

```text
apn stargate native prepare --profile <profile> --amount-atomic <wei> --max-native-debit-atomic <wei> --idempotency-key <key>
apn stargate native execute --operation <operation-id>
apn stargate native observe --operation <operation-id>
apn stargate native status  --operation <operation-id>
apn stargate native receipt --operation <operation-id>
```

| Command | What it does | Signs or sends |
| --- | --- | --- |
| `prepare` | Reads both chains and writes a crash-durable unsigned operation (`prepared`). | Never |
| `execute` | Foreground confirmation (`approved`), fresh preflight, then one signature and one send. On an already attempted operation it only observes. | Exactly once |
| `observe` | Reads both chains and may advance only an already attempted operation from safe chain evidence. | Never; never resends |
| `status` | Reads the local journal. | Never |
| `receipt` | Reads the canonical receipt of an `observed` operation. | Never |

| Variable | Required | Meaning |
| --- | --- | --- |
| `APN_ETHEREUM_RPC_URL` | Yes | Credential-free public HTTPS source RPC, without query or fragment. |
| `APN_UNICHAIN_RPC_URL` | Yes | Credential-free public HTTPS destination RPC, without query or fragment. |
| `APN_STARGATE_NATIVE_PREPARE_BATCH` | No | `1` opts into strict read-only JSON-RPC batching for `prepare`. Unset or any other value uses scalar requests. |

Without both RPC URLs the runtime refuses with `APN_RPC_CONFIG`, reason
`APN_ETHEREUM_RPC_URL_and_APN_UNICHAIN_RPC_URL_required`.

Batching changes transport grouping only. A rejected or malformed batch aborts preparation without retry or scalar
fallback, and the final `quoteSend` fee is still rechecked before the envelope is frozen. On the success path a batched
prepare makes 38 logical reads in 16 physical POSTs, including the destination baseline reads; the scalar path makes
36 POSTs because the source quote block and destination baseline block are rechecked after their dependent reads. These
counts come from a synthetic model; provider support for batching and the live count are not verified.

## Lifecycle

States: `prepared` → `approved` → `submission_started` → `submitted` → `observed`, with `unknown_finality` and
`failed_confirmed_revert`. `observed` and `failed_confirmed_revert` are terminal.

### Prepare

Preparation reads `quoteOFT` and `quoteSend`, rejects any principal that the pool would round down
(`dust_amount_not_supported`), freezes the minimum received amount, encodes exact calldata, snapshots the Unichain
recipient balance, and records `prepared`. The prepared operation expires 60 seconds after preparation; `execute`
refuses an expired operation before signing with `APN_REPREPARE_REQUIRED` and releases any usage hold it took.

### Execute

Foreground approval records `approved`. Before signing, APN:

- refreshes the quote and requires it to match the prepared one (otherwise `APN_REPREPARE_REQUIRED`,
  `quote_changed_after_approval`);
- checks both chain IDs, code hashes, native token identity, local EIDs, pool type, status, source path credit and shared
  decimals;
- verifies the current balance and nonce;
- requires the frozen fee envelope to remain includable (otherwise `fee_spike`);
- simulates the exact frozen call with the frozen value and fee envelope;
- requires a fresh gas estimate to remain within the frozen gas limit;
- reopens the encrypted signer profile to verify its address (otherwise `signer_identity_changed`).

APN records `submission_started` and the signed transaction hash before its single `eth_sendRawTransaction` call. Any
exception or conflicting response becomes `unknown_finality`. Later calls only observe that transaction and never sign or
send again.

### Observe and completion

- Safe source confirmation must contain the exact official `OFTSent` event.
- Completion requires a safe Unichain `OFTReceived` emitted by the pinned destination pool and bound to the exact source
  EID, GUID, recipient and frozen received amount.
- A balance delta is recorded only as corroboration and never terminalizes delivery.
- The versioned route finality policy is frozen in the operation and canonical receipt: Ethereum and Unichain both use
  `safe`. The selected tag is never weakened to `latest` or `pending`.

## Journal and locking

The journal uses owner-only paths, atomic rename, file and directory `fsync`, and the repository's kernel advisory
operation lock. The kernel releases the lock on process death while its stable owner-only lock file remains reusable.

## Canonical receipt

The canonical receipt binds the route finality policy, the quote, the source receipt, the destination transaction/log
proof, contract addresses, EIDs, value, and debit cap.

The source receipt also keeps the send's `gasUsed` and `effectiveGasPrice` from the same canonical receipt. The canonical
receipt shows them as `actualSourceFee`:

- `networkFeeAtomic`: gas used × effective gas price;
- `sourceDebitAtomic`: the send's value (principal plus the quoted LayerZero fee) plus that network fee. A LayerZero
  refund inside the same transaction, if any, is not subtracted.

`maximumDebitAtomic` stays the consented ceiling. Numbers outside the signed gas limit or max fee per gas are not shown.
When the RPC omits either number, `actualSourceFee` is `null`; the gas envelope is never shown in its place.

## Compatibility

- New preparations use operation schema v3, which binds owner admission. Schema v2 records written by earlier releases
  still load; they carry no owner admission, so an unsent v2 record refuses `execute` with `APN_REPREPARE_REQUIRED`
  (`owner_policy_binding_required`) and must be prepared again. Both schemas require the pinned route finality policy
  with `pinned_v2` provenance. Records missing that policy, or with any policy or route drift, are corrupt before
  effects.
- Schema v1 was never written by a released version, but pre-release builds wrote it. A frozen read-only reader
  (`src/legacy/stargate-v2/`) still reads it. Such a record claims its Ethereum account until it is terminal (`observed`
  or `failed_confirmed_revert`), and nothing signs, sends or resumes it. While it is not terminal,
  `apn stargate native status` (and `apn operation status`) reads the account's nonce at the `finalized` block from
  `APN_ETHEREUM_RPC_URL`. Once that nonce is past the record's envelope nonce and none of its own transaction hashes is
  pending, it writes `stargate-v2-native/<operation-id>.legacy-closure.json` beside the record
  (`legacy_closed_nonce_consumed`), and the record is terminal from then on, also after the operation index is rebuilt.
- A record observed before `actualSourceFee` numbers were kept gains them on its next `observe` (or
  `apn operation resume`), after its usage hold is settled, read once from the same transaction in the same block. Until
  then `actualSourceFee` is `null`.
