# Direct transfers under the owner allowlist

Every local-wallet direct transfer passes one gate that enforces the owner allowlist policy:

| Transfer | Command |
| --- | --- |
| Explicit-asset EVM | `apn pay transfer prepare-asset` ([EVM assets](evm-assets.md)) |
| Local-wallet Base USDC | `apn pay transfer prepare` |
| TRON | `apn pay transfer prepare-tron` ([TRON](tron.md)) |
| Solana | `apn pay transfer prepare-solana` ([Solana](solana.md)) |

**No active policy means no direct transfer.** Until the owner activates a policy that admits the asset on the `direct`
rail, these commands refuse with `allowlist_policy_required`.

The gate lives in `src/direct-allowlist-gate.ts`, with EVM glue in `src/evm-direct-allowlist.ts` and TRON/Solana glue in
`src/rail-direct-allowlist.ts`.

## Owner workflow

1. Write an `apn.allowlist-policy-file.v1` file ([allowlist policy](allowlist-policy.md)) with one `"rail": "direct"`
   admission for each asset the agent may send directly. Name the source account of every family you admit under
   `accounts`:
   - `evm`: the local wallet address (`apn wallet status --profile <profile>`);
   - `tron` and `solana`: the chain account address (`apn wallet ensure-tron|ensure-solana`).
2. Stage and activate it in a foreground terminal with `apn allowlist policy stage` and then
   `apn allowlist policy activate`.
3. For TRON and Solana, also keep the chain policy (`apn policy admit-tron|admit-solana`). It caps the native fee, rent
   and resources through `--max-fee-trx` and `--max-fee-sol`, and its `--max-per-transfer` and `--daily-limit` are
   enforced as shown on its consent screen: at prepare and again before signing, counting every unresolved transfer of
   the asset. A transfer must fit both the chain policy and the allowlist caps; the operation itself is never counted
   twice.

Example direct admissions (the caps are examples only):

```json
{ "chain": "eip155:1", "kind": "native", "rail": "direct", "maximumPerTransferAtomic": "1200000000000000", "dailyLimitAtomic": "4000000000000000" }
{ "chain": "eip155:8453", "kind": "token", "identifier": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "rail": "direct", "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000" }
{ "chain": "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", "kind": "native", "rail": "direct", "maximumPerTransferAtomic": "8900000", "dailyLimitAtomic": "29700000" }
{ "chain": "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", "kind": "token", "identifier": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "rail": "direct", "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000" }
{ "chain": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "kind": "native", "rail": "direct", "maximumPerTransferAtomic": "28600000", "dailyLimitAtomic": "95500000" }
```

## Asset rules

- **EVM** accepts only pinned contracts: the frozen inventory tokens plus the separately pinned direct-only identities
  listed in [EVM assets](evm-assets.md#networks-and-assets). Arbitrary ERC-20 addresses are refused. Decimals come from
  the pinned row: a supplied `--decimals` must equal it, and a contract that reports other decimals is refused with
  `APN_ASSET_MISMATCH`.
- EVM direct transfers are enabled on all eleven listed EVM networks (fee models and completion rules per network are in
  [EVM assets](evm-assets.md)). The reason `allowlist_network_not_enabled` exists for a listed network without a direct
  rail; no listed EVM network is in that state.
- **Solana** supports SOL, USDC and USDT. USDT (`--asset usdt`) uses the pinned mint
  `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` and follows the same SPL token path and evidence checks as USDC. Admit
  it with its own chain policy (`policy admit-solana --asset usdt`) and a direct allowlist admission.
- The local-wallet Base USDC record of `pay transfer prepare` uses the same direct row as `prepare-asset` for Base USDC
  and shares its caps.

## Refusals

Every refusal is `APN_ALLOWLIST_REFUSED`, with `details.reason` and `details.rail: "direct"`. CLI and MCP return the
same envelope.

| Reason | When | What to do |
| --- | --- | --- |
| `allowlist_network_unlisted` | The network is not in the frozen list. Checked when the command is bound and again at prepare, before any RPC. | Use a listed network. |
| `allowlist_asset_unlisted` | The native coin or token contract is not listed for that network. | Use a pinned asset. |
| `allowlist_decimals_mismatch` | The supplied `--decimals` differ from the list row. | Omit `--decimals` or pass the listed value. |
| `allowlist_network_not_enabled` | The network is listed, but APN has no direct EVM rail on it. | — |
| `allowlist_policy_required` | No policy is active for the profile: it was never activated, or it was revoked. | Stage and activate a policy. |
| `allowlist_policy_expired` / `allowlist_policy_not_effective` | The active policy is past its `expiresAt` or before its `effectiveAt`. | Activate a current revision, or wait for `effectiveAt`. |
| `allowlist_account_mismatch` | The policy's account for this family differs from the transfer's source account. | Fix `accounts` in a new revision. |
| `allowlist_direct_not_admitted` | The policy does not admit this exact asset on the direct rail. | Add a `direct` admission for it. |
| `allowlist_recipient_not_admitted` | The admission has a `recipients` list that does not include the recipient. | Send to a pinned recipient, or change the policy. |
| `allowlist_per_transfer_cap_exceeded` | The amount is above the direct per-operation cap. | Lower the amount or raise the cap. |
| `allowlist_daily_cap_exceeded` | Today's shared usage plus the amount is above the direct daily cap. The details report both values. | Wait for the next UTC day or raise the cap. |
| `allowlist_policy_changed` | At approval, the active digest or revision differs from the one bound at prepare. The operation ends before effect. | Prepare again. |
| `allowlist_binding_missing` | The record was prepared before APN enforced this gate. Approving it ends it before effect. | Prepare again. |

A tampered staged or activation file fails closed with `APN_STATE_CORRUPT`.

## Lifecycle and journals

**Prepare** checks the asset against the list and loads the active policy. It evaluates the direct cap against the
ledger's usage for the account, network and asset (all rails, UTC day), then freezes
`allowlist: { schemaVersion: "apn.direct-allowlist.v1", policyDigest, policyRevision }` in the journal.

- `apn.rail-operation.v1` keeps it inside the fingerprint.
- `apn.state.v1` keeps it outside the fingerprint, because the custody signer recomputes the fingerprint from its
  payload. Journal writes can never add, change or drop it.

**Approve** re-checks the same policy revision. It then reserves the exact amount through `DirectAssetUsageAdapter`
under the idempotency key `apn.direct-usage:<operationId>`, and writes the sealed lease as `allowlistLease` before
anything is signed.

- On TRON and Solana, the lease is written with `signing_started` after the owner screen, or with `submitting` for a
  provider send.
- On EVM, the native signer approves and signs in one call, so the lease is written with `started` immediately before
  that call.

**Transitions.** The ledger follows the journal forward, idempotently, after each durable write and on every resume.

| Journal state | Ledger |
| --- | --- |
| Signed but never sent | `reserved` |
| Send attempted | `submitted` |
| Unknown outcome or abandoned | `unknown_finality`, still charged |
| `completed` | `finalized`: consumed on its UTC day |
| `failed_before_effect` | Released |
| `failed_confirmed_revert`, or EVM `failed_proven_superseded` | Released |

**Crash semantics.**

- A crash between the reservation and the journal write leaves a `reserved` entry that the journal does not name. The
  next approval replays that same reservation. If the operation instead fails before effect, it is released, because the
  reservation id is derived from the operation.
- Resume never reserves.
- An EVM approval declined in the native prompt stays `started` until `apn operation resume` proves that no signature
  exists. Resume then releases the reservation.
- On TRON and Solana, revoking or replacing the policy after signing but before the first send ends the operation before
  effect, and the reservation is released.

The TRON and Solana approval screens show the frozen allowlist `policyDigest` and `policyRevision` on a separate line.
The chain `Policy` hash is shown separately.

## Scope

This gate covers the `direct` rail of local wallets only. These paths do not pass through it and keep their own
controls:

- provider-managed direct routes (Coinbase Agentic Wallet, MetaMask);
- gasless, x402 and bridge transfers, which are governed by their own rail rules and admissions described in their
  guides.

## Compatibility

Records prepared before this gate existed still read, validate and resume. Approving one is refused with
`allowlist_binding_missing` and ends it before effect; prepare it again.
