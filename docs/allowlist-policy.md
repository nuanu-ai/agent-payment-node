# Owner allowlist policy: stage, activate, status, revoke

The frozen candidate inventory (`data/allowlist/2026-09-17/dataset.json`) names networks and exact asset identities only. Every rail is disabled there and no caps exist. Money authority comes only from an owner policy that the owner stages and then activates in a foreground terminal.

```text
apn allowlist policy stage    --profile <profile> --file <absolute-policy-file> [--expected-revision <revision>]
apn allowlist policy activate --profile <profile> --revision <revision>
apn allowlist policy status   --profile <profile>
apn allowlist policy revoke   --profile <profile> --revision <revision>
```

`apn allowlist policy prepare` still stages the older single-admission (v1) record from flags. Use `stage` for several admissions, several families or swap pins.

## 1. Write the policy file

The owner writes one `apn.allowlist-policy-file.v1` JSON file. APN never fills in a missing cap, account, instant or pin: a missing or extra field refuses the whole file.

```json
{
  "schemaVersion": "apn.allowlist-policy-file.v1",
  "overlayVersion": "owner.2026-09-18.1",
  "accounts": { "evm": "<checksummed-evm-account>", "tron": "<tron-account>", "solana": "<solana-account>" },
  "effectiveAt": "2026-09-18T08:00:00.000Z",
  "expiresAt": "2026-10-18T08:00:00.000Z",
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

The rules for the file:

- `accounts` names exactly one canonical owner account for each family that the admissions use, and no other family. One profile can hold EVM, TRON and Solana together.
- Each admission is one exact frozen identity, one rail and the owner's positive atomic caps for that rail. The per-operation cap can't exceed the daily cap. The same asset may appear once per rail, and each rail keeps its own caps.
- `direct` takes no mechanism. `gasless`, `x402` and `bridge` need `{ "provider", "reference" }`. `swap` needs a complete `apn.swap-mechanism-pin.v1` pin for the admission's own network. The swap rail also requires the source and destination assets to carry the same pin.
- `expiresAt` is optional. If it is present it must be later than `effectiveAt`, and the activation stops being usable at that instant.
- The file must be a regular file with an absolute canonical path and no symbolic links in the path. It must be owned by you, not writable by group or others, and at most 256 KiB. On macOS, `/tmp` and `/var` are symbolic links, so pass the `/private/...` path.

The owner's example caps are about $3 per operation and $10 per day per asset. These are examples only; nothing in APN defaults to them.

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

`stage` binds the file to the frozen dataset and inventory digests. It compiles the file into a sealed `apn.asset-policy-registry.v2` registry, where each asset row carries one cap pair per admitted rail, and writes an immutable `staged_unadmitted` revision. The first revision omits `--expected-revision`. Every later revision must name the latest revision, and a stale value is refused. A profile keeps its account for each family, so a different account for the same family is refused as `APN_PROFILE_DRIFT`. Every revision needs a new `overlayVersion`. Staging never grants authority.

## 3. Activate

`activate` runs only in a foreground terminal. It shows the whole revision before anything is written:

- the profile, the owner accounts and the dataset digest;
- the effective and expiry instants;
- every admission: network, symbol, native or token contract, rail, and the per-operation and daily caps in display and atomic units;
- the full mechanism pin with its digest;
- the policy digest, the staged record digest and the decision fingerprint.

The owner types the six-character code printed under the screen. APN then appends one sealed, hash-chained entry under `allowlist-activations/<profile-hash>/`. That entry is the ACTIVE record: it holds the exact registry, the staged record digest, the fingerprint and an integrity digest.

Activation is refused if the revision is already active or has already expired. It is also refused if another decision or revision changed the state after the screen was shown (`APN_PROFILE_REVISION_CONFLICT`). A wrong code, a timeout or a missing terminal writes nothing. Activating another revision replaces the active one, and the screen says so.

Over MCP, `apn_allowlist_policy_activate` and `apn_allowlist_policy_revoke` never decide anything. They return `APN_FOREGROUND_APPROVAL_REQUIRED` with the exact `cli_handoff` command.

## 4. Status

`status` authenticates every staged revision and the whole activation chain, then reports:

- `activation`: one of `never_activated`, `active`, `scheduled` (before `effectiveAt`), `expired` or `revoked`;
- the latest staged revision and the active revision, each with its admissions;
- the last owner decision.

## 5. Revoke

`revoke --revision <active-revision>` shows the same screen and needs its own typed code. It then appends a `revoked` entry. After that no policy is active, and rails that require one refuse.

## Runtime loader for rails

```ts
loadActiveAssetPolicyRegistry(context: { state: { root }, clock }, profile): Promise<ActiveAssetPolicy | null>
loadActiveAssetPolicyRegistry(stateRoot: string, profile: string, now: Date): Promise<ActiveAssetPolicy | null>
// ActiveAssetPolicy = { profile, registry, digest, revision, accounts, activationDigest, activatedAt }
```

- The loader returns `null` when nothing is active.
- A tampered, missing or reordered staged or activation file throws `APN_STATE_CORRUPT`. So does a staged revision that no longer compiles against the frozen inventory.
- An activation whose `expiresAt` has passed throws `APN_OPERATION_BLOCKED` with reason `allowlist_policy_expired`.
- Evaluate the returned `registry` with `evaluateAssetPolicy`, and reserve usage with `AssetUsageLedger`, `DirectAssetUsageAdapter` or `GuardedSwapService`. `digest` is the policy digest to bind in operation journals.

Daily caps are per rail, but the usage ledger counts an asset's usage per account, network and asset across all rails. A rail's daily cap is therefore checked against the asset's combined usage for the UTC day. Spending on one rail can only narrow another rail; it never widens it.
