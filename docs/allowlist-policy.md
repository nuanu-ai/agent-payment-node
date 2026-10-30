# Owner allowlist policy: stage, activate, status, revoke

APN ships a frozen candidate inventory (`data/allowlist/2026-09-17/dataset.json`). It names networks and exact asset
identities only: every rail is disabled there and no caps exist. Money authority comes only from an owner policy that
the owner stages and then activates in a foreground terminal.

The policy admits each exact asset on a rail (`direct`, `x402`, `gasless`, `bridge`, `swap`) with per-operation and
daily caps, plus the exact mechanism for every rail except `direct`.

## Commands

```text
apn allowlist policy stage    --profile <profile> --file <absolute-policy-file> [--expected-revision <revision>]
apn allowlist policy activate --profile <profile> --revision <revision>
apn allowlist policy status   --profile <profile>
apn allowlist policy revoke   --profile <profile> --revision <revision>
```

Read-only inventory commands:

```text
apn allowlist inventory
apn allowlist resolve --chain <exact-network-identity> --kind <native|token> [--identifier <exact-token-identifier>]
```

`inventory` lists the frozen networks, asset identities, verified deployments, disabled rails, provenance and digests.
`resolve` resolves one exact native or token identity, with no symbol or address fallback.

`apn allowlist policy prepare` stages the older single-admission (v1) record from flags. Use `stage` for several
admissions, several account families or swap pins.

## 1. Write the policy file

The owner writes one `apn.allowlist-policy-file.v1` JSON file. APN never fills in a missing cap, account, instant or
pin: a missing or extra field refuses the whole file.

```json
{
  "schemaVersion": "apn.allowlist-policy-file.v1",
  "overlayVersion": "owner.1",
  "accounts": { "evm": "<checksummed-evm-account>", "tron": "<tron-account>", "solana": "<solana-account>" },
  "effectiveAt": "2026-11-01T00:00:00.000Z",
  "expiresAt": "2026-12-01T00:00:00.000Z",
  "admissions": [
    { "chain": "eip155:1", "kind": "native", "rail": "direct",
      "maximumPerTransferAtomic": "1200000000000000", "dailyLimitAtomic": "4000000000000000" },
    { "chain": "eip155:1", "kind": "native", "rail": "swap",
      "maximumPerTransferAtomic": "1200000000000000", "dailyLimitAtomic": "4000000000000000",
      "mechanism": { "schemaVersion": "apn.swap-mechanism-pin.v1", "protocolFamily": "uniswap_ethereum", "...": "every pin field" } },
    { "chain": "eip155:1", "kind": "token", "identifier": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "rail": "swap",
      "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000", "mechanism": { "...": "the same swap pin" } },
    { "chain": "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", "kind": "native", "rail": "direct",
      "maximumPerTransferAtomic": "8900000", "dailyLimitAtomic": "29700000" },
    { "chain": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "kind": "native", "rail": "direct",
      "maximumPerTransferAtomic": "28600000", "dailyLimitAtomic": "95500000" }
  ]
}
```

### Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | yes | Exactly `apn.allowlist-policy-file.v1`. |
| `overlayVersion` | yes | The owner's version label. Every staged revision needs a new one. |
| `accounts` | yes | Exactly one canonical owner account for each family the admissions use (`evm`, `tron`, `solana`), and no other family. One profile can hold all three. |
| `effectiveAt` | yes | Canonical ISO instant from which the activation is usable. |
| `expiresAt` | no | If present, later than `effectiveAt`; the activation stops being usable at that instant. |
| `admissions` | yes | The list of admissions below. |

Each admission:

| Field | Meaning |
| --- | --- |
| `chain` | Exact network identity from the inventory. |
| `kind` | `native` or `token`. |
| `identifier` | Exact token identity; omitted for `native`. |
| `rail` | `direct`, `x402`, `gasless`, `bridge` or `swap`. |
| `maximumPerTransferAtomic` | Positive per-operation cap in atomic units; cannot exceed the daily cap. |
| `dailyLimitAtomic` | Positive daily cap in atomic units (UTC day). |
| `mechanism` | Required for every rail except `direct` (see below). |
| `mechanisms` | `bridge` only: 2 to 16 alternatives, instead of `mechanism` and `maximumPerTransferAtomic`. |
| `recipient` | Optional single recipient pin on some `gasless` admissions. |
| `recipients` | Optional list of 1 to 16 recipients on `direct`, `x402` and single-pin `bridge` admissions. |

Each admission is one exact frozen identity, one rail and the owner's caps for that rail. The same asset may appear
once per rail, and each rail keeps its own caps.

### Mechanisms

- `direct` takes no mechanism.
- `gasless`, `x402` and `bridge` need `{ "provider", "reference" }`.
- `swap` needs a complete `apn.swap-mechanism-pin.v1` pin for the admission's own network. The swap rail also requires
  the source and destination assets to carry the same pin.
- A `bridge` admission can instead provide `mechanisms`: 2 to 16 exact
  `{ "provider", "reference", "maximumPerTransferAtomic" }` entries. Omit `mechanism` and `maximumPerTransferAtomic` on
  that row. Each reference has its own per-operation cap; `dailyLimitAtomic` is one combined ceiling for the asset and
  rail. Duplicate pins, empty pins, wildcard references and extra fields are refused. The activation screen and status
  show every alternative and its cap.

### Recipient pins

**`recipients` (direct, x402, bridge).** A list of 1 to 16 unique, canonical, non-zero addresses (EVM in checksum form,
Solana base58, TRON base58).

- On `direct` and `x402` every address belongs to the admission's own network family. On `bridge` the recipient is on
  the destination chain, so any family is accepted.
- A `bridge` admission with `mechanisms` puts the optional `recipients` list on each alternative instead, and that
  alternative's list governs it; the row itself cannot carry one.
- When a list is present, an operation whose recipient (for x402, the payee) is not in it is refused with
  `APN_ALLOWLIST_REFUSED` and reason `allowlist_recipient_not_admitted`, at prepare, approval, reservation and first
  send.
- **Without `recipients` the policy does not restrict recipients.** The recipient stays a required per-operation input
  that the foreground approval screen shows. This is the documented meaning of an absent list, not a default.
- Activation and status list each pin as `Recipients pinned (n): …`.
- `swap` and `gasless` admissions cannot carry `recipients`.

**`recipient` (gasless).** Ethereum and Base `local` gasless admissions may add
`"recipient": "<canonical checksummed EVM address>"` to pin one exact transfer recipient.

- Base `coinbase-agentic-wallet` gasless admissions require it. Their mechanism is exactly
  `{ "provider": "coinbase-agentic-wallet", "reference": "awal@2.12.1:send_base_usdc:eip155:8453" }` for canonical Base
  USDC.
- A different recipient is refused before the prepare RPC and rechecked before approval, reservation and first send.
- `local` admissions without `recipient` do not restrict recipients.
- Other rails and networks cannot carry this field. Wildcard, zero and noncanonical addresses are refused.
- The activation screen and status show the pin.

### File requirements

The file must be a regular file with an absolute canonical path and no symbolic links in the path. It must be owned by
you, not writable by group or others, and at most 256 KiB. On macOS, `/tmp` and `/var` are symbolic links, so pass the
`/private/...` path.

### Example caps

The caps in the examples are about $3 per operation and $10 per day per asset at the prices used when they were
chosen. They are examples only; nothing in APN defaults to them.

| Asset | Per operation | Daily | Atomic per operation / daily |
| --- | --- | --- | --- |
| ETH (any listed EVM network) | 0.0012 | 0.004 | 1200000000000000 / 4000000000000000 |
| USDC, USDT | 3 | 10 | 3000000 / 10000000 |
| SOL | 0.0286 | 0.0955 | 28600000 / 95500000 |
| TRX | 8.9 | 29.7 | 8900000 / 29700000 |
| BNB | 0.0039 | 0.0133 | 3900000000000000 / 13300000000000000 |
| AVAX | 0.378 | 1.26 | 378000000000000000 / 1260000000000000000 |
| POL | 29.9 | 99.9 | 29900000000000000000 / 99900000000000000000 |
| MON | 126 | 421 | 126000000000000000000 / 421000000000000000000 |
| SEI | 65 | 217 | 65000000000000000000 / 217000000000000000000 |

## 2. Stage

`stage` binds the file to the frozen dataset and inventory digests. It compiles the file into a sealed
`apn.asset-policy-registry.v2` registry, where each asset row carries one cap pair per admitted rail, and writes an
immutable `staged_unadmitted` revision.

- The first revision omits `--expected-revision`. Every later revision must name the latest revision; a stale value is
  refused.
- A profile keeps its account for each family, so a different account for the same family is refused as
  `APN_PROFILE_DRIFT`.
- Every revision needs a new `overlayVersion`.
- Staging never grants authority.

## 3. Activate

`activate` runs only in a foreground terminal. It shows the whole revision before anything is written:

- the profile, the owner accounts and the dataset digest;
- the effective and expiry instants;
- every admission: network, symbol, native or token contract, rail, and the per-operation and daily caps in display and
  atomic units;
- the full mechanism pin with its digest;
- the policy digest, the staged record digest and the decision fingerprint.

The owner types the six-character code printed under the screen. APN then appends one sealed, hash-chained entry under
`allowlist-activations/<profile-hash>/`. That entry is the active record: it holds the exact registry, the staged record
digest, the fingerprint and an integrity digest.

- Activation is refused if the revision is already active or has already expired.
- It is refused if another decision or revision changed the state after the screen was shown
  (`APN_PROFILE_REVISION_CONFLICT`).
- A wrong code, a timeout or a missing terminal writes nothing.
- Activating another revision replaces the active one, and the screen says so.

Activate and revoke are not MCP tools. Over MCP, `apn_foreground_handoff` with `command: "allowlist policy activate"`
(or `revoke`) decides nothing: it returns `APN_FOREGROUND_APPROVAL_REQUIRED` with the exact `cli_handoff` command.

## 4. Status

`status` authenticates every staged revision and the whole activation chain, then reports:

- `activation`: one of `never_activated`, `active`, `scheduled` (before `effectiveAt`), `expired` or `revoked`;
- the latest staged revision and the active revision, each with its admissions;
- the last owner decision.

## 5. Revoke

`revoke --revision <active-revision>` shows the same screen and needs its own typed code. It then appends a `revoked`
entry. After that no policy is active, and rails that require one refuse.

## How caps are counted

Daily caps are set per rail, but the usage ledger counts an asset's usage per account, network and asset across all
rails, by UTC day. A rail's daily cap is therefore checked against the asset's combined usage for the day. Spending on
one rail can only narrow another rail; it never widens it.

The ledger does not record a mechanism reference. All alternatives of a `bridge` admission share its one daily limit.

## Example: both Ethereum USDC Relay routes

To admit both Ethereum USDC Relay routes for a profile:

1. Stage a new revision with one `bridge` admission whose `mechanisms` hold the BNB pin (`ethereum-usdc-bnb-native-v1`,
   for example `maximumPerTransferAtomic: "2500000"`) and the Base pin (`ethereum-usdc-base-eth-v1`, for example
   `maximumPerTransferAtomic: "300000"`), with one `dailyLimitAtomic` (for example `"2500000"`). Each mechanism may also
   carry an optional `recipients` pin.
2. Copy every other active admission and account unchanged, choose a new `overlayVersion` and a future `effectiveAt`.
3. Review the staged diff and the activation screen, then activate the new revision in the foreground.

The Base route then shares the 2.5 USDC daily asset budget with BNB and any swap usage. Because the ledger does not
record the mechanism, a higher combined daily limit would also allow more BNB spending; it needs route-specific daily
accounting before it is safe.

## Runtime loader for rails

```ts
loadActiveAssetPolicyRegistry(context: { state: { root }, clock }, profile): Promise<ActiveAssetPolicy | null>
loadActiveAssetPolicyRegistry(stateRoot: string, profile: string, now: Date): Promise<ActiveAssetPolicy | null>
// ActiveAssetPolicy = { profile, registry, digest, revision, accounts, activationDigest, activatedAt }
```

- The loader returns `null` when nothing is active.
- A tampered staged or activation file throws `APN_STATE_CORRUPT`. So does a missing staged revision, a gap or
  reordering in the activation chain, or a staged revision that no longer compiles against the frozen inventory.
- An activation whose `expiresAt` has passed throws `APN_OPERATION_BLOCKED` with reason `allowlist_policy_expired`.
- Evaluate the returned `registry` with `evaluateAssetPolicy`, and reserve usage with `AssetUsageLedger`,
  `DirectAssetUsageAdapter` or `GuardedSwapService`. `digest` is the policy digest to bind in operation journals.
- Direct transfers (explicit-asset EVM, TRON and Solana) use this loader at prepare and approval; without an active
  policy they refuse with `APN_ALLOWLIST_REFUSED` (`allowlist_policy_required`). See
  [direct transfers under the allowlist](allowlist-direct-integration.md).

## Integrity limits

Integrity here is tamper evidence, not tamper resistance. The digests are unkeyed, and nothing outside the state
directory anchors the newest activation entry. Deleting that one file therefore rolls the profile back to the previous
decision (for example, it undoes a revocation), and loading does not detect it. Anyone who can write `~/.apn` can also
forge entries. An anchor outside the state directory, such as in the Keychain, is not implemented.

## Reason codes

| Code / reason | When |
| --- | --- |
| `APN_PROFILE_DRIFT` | Staging names a different account for a family the profile already uses. |
| `APN_PROFILE_REVISION_CONFLICT` | The state changed after the activation or revocation screen was shown. |
| `APN_FOREGROUND_APPROVAL_REQUIRED` | Activate or revoke requested over MCP; run the returned `cli_handoff` in a terminal. |
| `APN_STATE_CORRUPT` | A staged or activation file was tampered with, or the chain is broken. |
| `APN_OPERATION_BLOCKED` / `allowlist_policy_expired` | The active policy passed its `expiresAt`. |
| `APN_ALLOWLIST_REFUSED` / `allowlist_recipient_not_admitted` | The recipient is not in the admission's `recipients` list. |
| `APN_ALLOWLIST_REFUSED` / `allowlist_policy_required` | No policy is active for the profile. |
