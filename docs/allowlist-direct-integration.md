# Direct transfers under the owner allowlist

Every direct transfer passes one gate: explicit-asset EVM (`apn pay transfer prepare-asset`), TRON (`prepare-tron`) and Solana (`prepare-solana`). The gate lives in `src/direct-allowlist-gate.ts`. EVM glue is in `src/evm-direct-allowlist.ts` and TRON/Solana glue in `src/rail-direct-allowlist.ts`.

## Owner workflow

1. Write an `apn.allowlist-policy-file.v1` file (see `docs/allowlist-policy.md`) with one `"rail": "direct"` admission for each asset the agent may send directly. Name the source account of every family you admit under `accounts`:
   - `evm`: the local wallet address (`apn wallet status --profile <profile>`);
   - `tron` and `solana`: the chain account address (`apn wallet ensure-tron|ensure-solana`).
2. Stage and activate it in a foreground terminal with `apn allowlist policy stage` and then `apn allowlist policy activate`.
3. For TRON and Solana, keep the chain policy (`apn policy admit-tron|admit-solana`). It now caps only the native fee, rent and resources, through `--max-fee-trx` and `--max-fee-sol`. The command still requires `--max-per-transfer` and `--daily-limit`, but direct transfers no longer enforce them. The allowlist policy is the only principal cap, so an amount is never counted twice.

Example direct admissions, using the owner's example caps:

```json
{ "chain": "eip155:1", "kind": "native", "rail": "direct", "maximumPerTransferAtomic": "1200000000000000", "dailyLimitAtomic": "4000000000000000" }
{ "chain": "eip155:8453", "kind": "token", "identifier": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "rail": "direct", "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000" }
{ "chain": "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", "kind": "native", "rail": "direct", "maximumPerTransferAtomic": "8900000", "dailyLimitAtomic": "29700000" }
{ "chain": "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", "kind": "token", "identifier": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "rail": "direct", "maximumPerTransferAtomic": "3000000", "dailyLimitAtomic": "10000000" }
{ "chain": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "kind": "native", "rail": "direct", "maximumPerTransferAtomic": "28600000", "dailyLimitAtomic": "95500000" }
```

## Behaviour change

- **No active policy means no direct transfer.** EVM direct transfers used to have no amount cap, only `--max-fee-wei`. They now refuse with `allowlist_policy_required` until the owner activates a policy that admits the asset on the direct rail.
- EVM accepts only frozen-list contracts. The arbitrary ERC-20 address path is gone, and decimals come from the list row. A supplied `--decimals` must equal the list row, and a contract that reports other decimals is refused with `APN_ASSET_MISMATCH`.
- EVM direct transfers are enabled on all eleven listed EVM networks (see `docs/evm-assets.md` for fee models and completion rules per network). `allowlist_network_not_enabled` remains the refusal for a listed network without a direct rail; no listed EVM network is in that state now.
- Solana gains the list's USDT as `--asset usdt`. It uses pinned mint `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` and follows the same SPL token path and evidence checks as USDC. Admit it with its own chain policy (`policy admit-solana --asset usdt`) and a direct allowlist admission.
- Records prepared before this gate still read, validate and resume. Approving one is refused with `allowlist_binding_missing` and ends it before effect. Prepare it again.

## Refusals

Every refusal is `APN_ALLOWLIST_REFUSED`, with `details.reason` and `details.rail: "direct"`. CLI and MCP return the same envelope.

| Reason | When |
| --- | --- |
| `allowlist_network_unlisted` | The network is not in the frozen list. Checked at the binder and again at prepare, before any RPC. |
| `allowlist_asset_unlisted` | The native coin or token contract is not listed for that network. |
| `allowlist_decimals_mismatch` | The supplied `--decimals` differ from the list row. |
| `allowlist_network_not_enabled` | The network is listed, but APN has no direct EVM rail on it yet. |
| `allowlist_policy_required` | No policy is active for the profile: it was never activated, or it was revoked. |
| `allowlist_policy_expired` / `allowlist_policy_not_effective` | The active policy is outside its `expiresAt` or `effectiveAt` bounds. |
| `allowlist_account_mismatch` | The policy's account for this family differs from the transfer's source account. |
| `allowlist_direct_not_admitted` | The policy does not admit this exact asset on the direct rail. |
| `allowlist_per_transfer_cap_exceeded` | The amount is above the direct per-operation cap. |
| `allowlist_daily_cap_exceeded` | Today's shared usage plus the amount is above the direct daily cap. The details report both values. |
| `allowlist_policy_changed` | At approval, the active digest or revision differs from the one bound at prepare. The operation ends before effect. |
| `allowlist_binding_missing` | The record was prepared before the gate. |

A tampered staged or activation file still fails closed with `APN_STATE_CORRUPT`.

## Lifecycle and journals

- **Prepare** lists the asset and loads the active policy. It evaluates the direct cap against the ledger's usage for the account, network and asset (all rails, UTC day), then freezes `allowlist: { schemaVersion: "apn.direct-allowlist.v1", policyDigest, policyRevision }` in the journal.
  - `apn.rail-operation.v1` keeps it inside the fingerprint.
  - `apn.state.v1` keeps it outside the fingerprint, because the custody signer recomputes the fingerprint from its payload. Journal writes can never add, change or drop it.
- **Approve** re-checks the same policy revision. It then reserves the exact amount through `DirectAssetUsageAdapter` under the idempotency key `apn.direct-usage:<operationId>`, and writes the sealed lease as `allowlistLease` before anything is signed.
  - On TRON and Solana, the lease is written with `signing_started` after the owner screen, or with `submitting` for a provider send.
  - On EVM, the native signer approves and signs in one call, so the lease is written with `started` immediately before that call.
- **Transitions:** the ledger follows the journal forward, idempotently, after each durable write and on every resume.

  | Journal state | Ledger |
  | --- | --- |
  | Signed but never sent | `reserved` |
  | Send attempted | `submitted` |
  | Unknown outcome or abandoned | `unknown_finality`, still charged |
  | `completed` | `finalized`: consumed on its UTC day |
  | `failed_before_effect` | Released |
  | `failed_confirmed_revert`, or EVM `failed_proven_superseded` | Released |

- **Crash semantics:**
  - A crash between the reservation and the journal write leaves a `reserved` entry that the journal does not name. The next approval replays that same reservation. If the operation instead fails before effect, it is released, because the reservation id is derived from the operation.
  - Resume never reserves.
  - An EVM approval declined in the native prompt stays `started` until `apn operation resume` proves that no signature exists. Resume then releases the reservation.
- On TRON and Solana, revoking or replacing the policy after signing but before the first send ends the operation before effect, and the reservation is released.

## Boundaries

These paths are not gated yet and keep their existing controls:

- the legacy Base-USDC `apn pay transfer prepare` without `--chain` and `--asset`;
- provider-direct routes (Coinbase Agentic Wallet, MetaMask);
- gasless, x402 and bridge.

The TRON and Solana approval screens show the frozen owner allowlist `policyDigest` and `policyRevision` on a separate line. The chain `Policy` hash remains shown separately.
