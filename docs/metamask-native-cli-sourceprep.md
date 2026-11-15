# MetaMask native-transfer public selector and private vendor admission

`apn wallet metamask native-transfer` sends an exact USDC amount from a profile's MetaMask Agent Wallet (Guard server
wallet) to a recipient. The network fee is paid in the chain's native coin. It works for any connected MetaMask
profile. The command is CLI only; MCP does not expose it.

## Chains

`--chain` takes exactly one of five names:

| `--chain` | Chain ID | Required RPC variable |
| --- | --- | --- |
| `ethereum` | 1 | `APN_ETHEREUM_RPC_URL` |
| `optimism` | 10 | `APN_OPTIMISM_RPC_URL` |
| `monad` | 143 | `APN_MONAD_RPC_URL` |
| `linea` | 59144 | `APN_LINEA_RPC_URL` |
| `sei` | 1329 | `APN_SEI_RPC_URL` |

Numeric selectors, aliases, casing variants and other chains are refused. The RPC variable has no default; a missing
one refuses with `APN_RPC_CONFIG`, and the URL must have no query or fragment.

## Requirements

- A MetaMask Agent Wallet profile connected with
  `apn wallet connect --profile <profile> --provider metamask-agent-wallet --auth-method browser`.
- An active owner policy for the profile on the direct rail that admits the amount: per-transfer and daily USDC caps,
  and the native fee cap. If the policy row pins recipients, the recipient must be on that list; the pin is enforced
  at prepare, at reservation and at the last guard before the hand-off to MetaMask.
- MetaMask Guard mode on the paying server wallet.
- A MetaMask Guard policy for the paying wallet that:
  - has `schema_version: 1`;
  - names the paying wallet in `wallet_address`;
  - allowlists the recipient for this chain (`addresses.allowlist` entry with this `address` and `chain_id`) and does
    not blocklist it;
  - lists the chain in `evm.allowed_chains`, when that list is present;
  - carries a positive limit in `evm.outflow_limits_usd`.

  Other sections of the policy are ignored here; MetaMask enforces them itself. Guard mode and the policy belong to the
  MetaMask project, so a sign-in that created a new project needs both set again. (MetaMask gasless transfers in
  [gasless.md](gasless.md) do not read Guard mode.)
- Enough USDC for the amount and enough native coin for the quoted fee, on the paying wallet.

## Commands

```sh
apn wallet metamask native-transfer --profile <profile> --chain ethereum \
  --recipient <address> --amount-atomic <usdc-atoms> --idempotency-key native-0001
apn wallet metamask native-transfer-status --operation <operation-id>
apn wallet metamask native-transfer-observe --operation <operation-id>
```

- `--profile`, `--chain`, `--recipient`, `--amount-atomic` and `--idempotency-key` are all required. There is no
  default profile, payer, recipient or amount.
- `--amount-atomic` is a positive whole number of USDC atomic units (6 decimals; `1000` is 0.001 USDC).
- `--recipient` is a non-zero EVM address.
- `--idempotency-key` is 8 to 200 safe ASCII characters. Repeating the same request with the same key returns the saved
  operation; a different request under the same key is refused.
- `native-transfer-status` reads the durable journal only. `native-transfer-observe` reads canonical RPC evidence for
  the stored transaction and settles the actual native fee; it never sends again. `apn operation status`,
  `apn operation resume` (without `--wait-seconds`) and `apn operation abandon` also work on these operations.

## What the command does

1. **Vendor checks.** Before any operation exists, three MetaMask reads (`auth status`, `wallet trading-mode get`,
   `wallet policy get`) confirm the signed-in session, Guard mode and a Guard policy that admits this payer, chain and
   recipient. A failure refuses with one of the reasons below.
2. **Quote and balances.** APN quotes the native fee under the owner's native fee cap and checks the wallet's native
   and USDC balances.
3. **Consent.** First APN reads the login-Keychain wrapping secret that will seal the MetaMask request ID (see
   [The sealed request reference](#the-sealed-request-reference)), or creates the first one if the state holds nothing
   sealed. A secret that is missing over sealed state, or a Keychain that refuses, ends the transfer
   `failed_before_effect` here, before consent and before any hand-off.
   In a genuine foreground terminal (stdin and stderr must both be TTYs), the screen shows the profile and
   sender, the chain and USDC token, the recipient, the amount (atomic and decimal), the maximum full native fee, the
   Guard admission (recipient allowlisted, outflow limit), the quote hash and the operation ID. You type the approval
   code shown. Consent is valid for at most 60 seconds, or until the quote expires if that is sooner.
4. **Last guard.** APN rechecks the owner policy, profile binding and recipient pin, the account's conflict domain on
   that chain, and repeats the three MetaMask reads. The MetaMask project and the Guard policy must be unchanged since
   consent; otherwise the transfer is blocked before the hand-off.
5. **Hand-off.** APN names the MetaMask request itself (a UUID v4) and seals its ID (see
   [The sealed request reference](#the-sealed-request-reference)). Then it writes one durable effect marker that names
   the ID's hash, and hands the transfer to MetaMask exactly once (see [The hand-off](#the-hand-off)). MetaMask signs
   and broadcasts it under its own Guard policy and MFA.

The result is `acknowledged` (with a transaction hash) or `unknown` (pending MetaMask MFA, or an outcome APN cannot
prove). Both stay financially unknown until observed; run `native-transfer-observe` or `apn operation resume` to prove
the receipt and settle the actual fee. A proven no-hand-off ends `failed_before_effect`.

## The hand-off

Up to 0.5.107 APN handed the transfer to `mm wallet send-transaction`. That command creates the MetaMask request ID
itself and keeps it only in its own local request list, and only after MetaMask answered. When `mm` failed after its
POST without printing the ID, nothing could find the request again. From 0.5.108 APN sends the same request with its own
ID, through the sandboxed helper of the MetaMask gasless lane ([gasless.md](gasless.md)). `mm` is still used for the
sign-in, the Guard mode and policy reads and the project reads around an observation; only the send moved.

The helper reads `mm`'s own signed-in session from `~/.metamask` and refuses before any network call when the session's
project does not hash to the transfer's project hash, or when its selected server wallet is not the paying wallet. It
then makes the SDK's own server-wallet call (`EvmServerAdapter.submitTransaction`, `@metamask/fox-sdk` 2.7.0). Its
network policy admits exactly one request: a POST to `/v1/projects/<project>/transaction-requests` with the session's
own token and exactly these bytes, which are what `mm` 6.1.5 sent for the same payload and intent:

```json
{"requestId":"<APN's UUID v4>","namespace":"evm","chainId":<chain>,
 "tx":{"from":"<sender, lowercase>","to":"<USDC, lowercase>","chainId":<chain>,"data":"<transfer calldata>","value":"0x0",
       "nonce":<nonce>,"gasLimit":"0x<gas>","maxFeePerGas":"0x<fee>","maxPriorityFeePerGas":"0x<priority fee>"},
 "txIntent":"APN <operation-id>: <amount> atomic USDC to <recipient>"}
```

Another body, URL or token, or a second request, is refused before it leaves. The policy also checks the consent
deadline at the request, and again once the TLS session is up, right before the request is written: nothing of it is
handed to the socket while DNS, TCP or the handshake run. The exchange's timeout is the time left to the deadline (at
most 15 seconds), so the request is destroyed at the deadline, written or not. The parent kills the helper at that
deadline, as it killed the `mm` child.

The helper also watches the APN command that spawned it. The first statement of its bootstrap records its parent's
pid, before any other module loads. Every 100 ms, and right before a send's request is written, it checks that its
parent has not changed. When the command died (and its operation lock with it), the helper exits, and the gate refuses
a send with nothing written (`check: "parent_exited"`, `post: "not_reached"`). Not covered: a command that dies during
Node's own startup of the helper, before that first statement, and a request already written when the command died.
Either may still reach MetaMask, and the transfer stays `unknown` as recorded. The deadline gate bounds every send in
all cases: nothing is written after the deadline, and the exchange ends there.

It returns only bound fields of MetaMask's answer for this very request ID: its status, a transaction hash
when there is one and, for `AWAITING_MFA`, the approval's `expiresAt` and the session's `authMethod`.

The hand-off's answer decides the journal's state. A `pending` answer is not a state of its own: the journal records
it as `unknown`, with no transaction hash.

| MetaMask's answer | Hand-off answer | Journal `state` |
| --- | --- | --- |
| A transaction hash, status not `FAILED`, `BROADCAST_FAILED`, `DENIED` or `EXPIRED` | acknowledged | `acknowledged` |
| `EVALUATING`, `AWAITING_MFA`, `SIGNING` or `BROADCASTING` with no hash | pending | `unknown`, with the owner's MFA task for `AWAITING_MFA` |
| `FAILED`, `BROADCAST_FAILED`, `DENIED` or `EXPIRED`, or another status | unknown | `unknown`, with the hash when MetaMask named one |
| No answer, a refusing HTTP status, an answer that names another request, the deadline, a helper timeout or exit | unknown | `unknown` |

Every outcome after the effect marker keeps the request ID, so observe reads that request. The journal's `diagnostic`
has stage `sdk_send`; its `code` is `ok` for an answer, otherwise `refused` (an HTTP refusal), `timeout`, `exit`,
`start`, `deadline`, `protocol` or `internal`, and `providerCode` is `auth`, `policy`, `mfa`, `funds`, `rate_limit`,
`other` or `none` from MetaMask's HTTP status and error code. None of them is proof that nothing was sent.

`mm` read the wallet's native balance right before its own POST. The helper does not, and needs not: the last guard
already reads the native and USDC balances and the nonce (`rpc_balance`), and the native balance must cover the quote's
full maximum fee, which is at least the gas limit times the maximum fee per gas.

**A command that ended after its marker.** The sending command holds the operation's lock from before the marker until
it has recorded the outcome and moved the usage holds. When observe or resume later holds that lock and still finds the
marker (`effect_started` with `handoffPath`), that command is gone. Before anything else it moves both holds that are
still `reserved` to `unknown_finality` and records the transfer `unknown`, with `diagnostic.stage: "post_handoff"` and
`code: "interrupted"`. Then it reads the request as for any `unknown` transfer: a transaction hash goes to receipt proof
and settles the actual fee, `AWAITING_MFA` records the owner's task, and a 404 keeps the transfer `unknown` with its
holds charged. `native-transfer-status` alone leaves such a marker as it is. A hold that is already `submitted` under
such a marker moves to `unknown_finality` too.

**A command that ended after its outcome.** The send records its outcome in the journal and then moves the usage holds,
in this release and in every earlier one. A command that ended between the two left the transfer `acknowledged`,
`unknown`, `confirmed` or `abandoned_unknown` with its holds still `reserved`, and settlement refuses such a hold ("no
durable effect hold"). `native-transfer-status`, observe and resume hold the operation's lock, so that command is gone.
Before any receipt or settlement they move each hold of the operation that is still `reserved` to the state the send
would have written: `submitted` for `acknowledged`, else `unknown_finality`. Both keep the hold charged, so this never
releases or settles usage; settlement still needs the receipt. A hold that already moved is left alone. A missing or
changed hold is left as it is, so its settlement still refuses. No journal field changes, so a record any release wrote
gets the same repair, and a second read does nothing.

**A command that ended after `failed_before_effect`.** The send, and the close of a transfer whose consent passed before
its marker, record `failed_before_effect` and then release the usage holds. A command that ended between the two left
holds `reserved` that counted against the daily limit forever. `native-transfer-status`, observe and resume release
them under the operation's lock: only for a journal `failed_before_effect` with no transaction hash (APN writes it only
when nothing was handed off), only the two holds of that very operation, only from `reserved` and only when each matches
the operation's quote, policy and amount. The release uses the send's own outcome digest. Any other hold is left as it
is.

States: `prepared`, `effect_started`, `acknowledged` and `unknown` are non-terminal; `confirmed`, `confirmed_reverted`,
`failed_before_effect` and `abandoned_unknown` are terminal.

**Abandonment.** When the outcome is still unknown after the quote expired, `apn operation abandon --operation <id>`
asks for the exact acknowledgement and records `abandoned_unknown`. MetaMask may still have signed and broadcast the
transfer. An operation that never handed off and whose consent window has passed closes as `failed_before_effect`
instead.

## The sealed request reference

The MetaMask request ID names the request that the owner's MFA approval waits on. APN keeps that ID encrypted. From
0.5.108 APN names the ID itself after consent and seals it under the login-Keychain wrapping secret, with the same
custody envelope as wallets and MetaMask x402 authorizations, in
`metamask-native-request-references/<profile-hash>/<operation-id>.json`. Then it writes the effect marker, which keeps
only the ID's hash (`providerRequestIdHash`, with `providerRequestId` null) and `handoffPath: "sdk_helper"`. Only then
does the helper start. A seal or a marker that fails ends the transfer `failed_before_effect` with nothing sent. 0.5.107
sealed the ID that the hand-off returned, right after the hand-off; those journals have no `handoffPath`.

Output never shows the ID of such a transfer:

| Field | Value |
| --- | --- |
| `mfa_task.request_id_hash` | The hash of the request ID, in place of `mfa_task.request_id` |
| `read_observation.request_id_hash` | The same hash, in place of `read_observation.request_id` |
| `mfa_task.owner_action` and the next actions after `EXPIRED` or `DENIED` | Name "the MetaMask request of APN `<operation-id>`". The MetaMask request's own intent starts with `APN <operation-id>:`, so the owner finds it in MetaMask. |

The hash is the one `provider_request_reference_hash` shows for a direct transfer:
SHA-256 of `provider-effect-reference`, `metamask-agent-wallet` and the ID, joined by NUL bytes.

APN opens the sealed ID only to read that request again: `native-transfer-observe`, `apn operation resume`, and the
observation `apn operation abandon` runs first. The read in the next section gets the ID itself. If the ID cannot be
opened, the read is refused and nothing is read or written:

| Cause | Refusal |
| --- | --- |
| The sealed file is missing or damaged, belongs to another transfer, or was sealed under another secret | `APN_STATE_CORRUPT`, `details.reason: "provider_request_reference_unmatched"`, next action `apn operation status --operation <id>` |
| The wrapping secret is missing | `APN_STATE_CORRUPT`, `details.reason: "wrapping_secret_missing"` and the step to restore the Keychain item |
| The Keychain refuses | `APN_NATIVE_REJECTED` |

The transfer keeps its state and its reserves. `native-transfer-status` and `apn operation status` never open the
sealed ID and still answer. `apn operation abandon` still asks for consent after a refused observation.

In 0.5.107, if the seal failed after the hand-off (the wrapping secret was read before consent, so only its write could
fail), APN dropped the ID, never kept it in plaintext, and recorded everything else the hand-off returned, its
transaction hash included. Such a journal holds `providerRequestReason: "provider_request_reference_unsealed"` with no
request, and the output shows `provider_request_reason`. It still loads as written. A kept transaction hash is still
observed on chain. Without one, observe reads nothing (`read_observation.reason: "provider_request_reference_unsealed"`)
and the exit is `apn operation abandon` once the quote has expired. From 0.5.108 the seal comes before the hand-off, so
this case no longer arises.

APN never deletes a sealed request reference, not even after its transfer ends. Each counts as sealed custody, so after
the first native transfer that sealed a request ID a lost wrapping secret refuses every command that would create a new
one with `wrapping_secret_missing`, including the next native transfer (before consent). The owner's options (restore
the Keychain item, or move the request-reference directories aside when nothing else is sealed) and what each does to
unresolved transfers are in the README section on the wrapping secret.

Transfers saved by APN 0.5.106 or earlier keep the request ID itself in their journal. They load, observe and project
exactly as before, need no wrapping secret, and a read never rewrites them. APN 0.5.106 and earlier cannot read a
journal that holds `providerRequestIdHash` (`APN_STATE_CORRUPT`). Do not downgrade to 0.5.106 or earlier once such a
transfer exists. A journal with no stored request stays readable by those releases.

From its effect marker on, every transfer 0.5.108 or later writes holds `handoffPath`. APN 0.5.107 and earlier cannot
read such a journal (`APN_STATE_CORRUPT`), so do not downgrade below 0.5.108 once one exists.

## Observing a pending MetaMask request

When a transfer has a stored MetaMask request ID and no transaction hash, `native-transfer-observe` reads that request
once. It never sends, signs or approves anything. A sealed request ID is opened first (see above).

**A transfer 0.5.108 or later sent** (`handoffPath: "sdk_helper"`) is never in `mm`'s local request list. Its read is:

1. `mm auth status` confirms the signed-in project. Its SHA-256 must equal the project hash stored with the transfer.
2. The server read below reads the request by its exact ID.
3. `mm auth status` confirms the project again.

`read_observation.watch_returned` is then `false`, and `read_observation.server_read` is present once step 1 passed. A 404 is
recorded as `metamask_request_not_found_on_server`; a refused read as `provider_request_read_unavailable`, with its
reason in `server_read.reason`. A transfer whose command ended at its effect marker (`effect_started`) also names the
observer. For `AWAITING_MFA` the read records the approval's `expiresAt` and the session's `auth_method`, as the send
did. When MetaMask's answer names no `approval.expiresAt`, the task keeps the expiry it already holds for the same
request, with the `evidence_hash` of the answer that named it.

**A transfer 0.5.107 or earlier sent** (no `handoffPath`) is read as before:

1. `mm auth status` confirms the signed-in project. Its SHA-256 must equal the project hash stored with the transfer.
2. `mm wallet requests watch <request-id> --wallet-timeout 1` reads the request.
3. `mm auth status` confirms the project again.

`mm` 6.1.5 looks the request ID up in its own local request list (`pendingJobs` in `~/.metamask/wallets.json`) before it
asks MetaMask. A new `mm login` starts that list empty. The watch then writes nothing to stdout and answers
`REQUEST_NOT_FOUND` on stderr. APN records where the request was not found, never what happened to it:

| `read_observation.reason` | Meaning |
| --- | --- |
| `metamask_request_not_in_local_state` | `mm`'s local request list does not hold this request ID (for example after a new `mm login`). The request itself may still exist. |
| `metamask_request_not_found_on_server` | MetaMask's server answered not found for this request ID. |
| `provider_request_not_found` | Another `REQUEST_NOT_FOUND` answer. |

None of them is proof. The transfer stays `unknown`, its reserves stay charged, and APN never sends it again.

**Server read.** For a transfer 0.5.107 or earlier sent, after `metamask_request_not_in_local_state`, and only then, APN
reads the request from MetaMask's server by its exact stored ID, between steps 2 and 3. The watch stays the first read,
so every other answer is recorded as before. For a transfer 0.5.108 or later sent, it is step 2. The read uses the
sandboxed helper of the MetaMask gasless lane
([gasless.md](gasless.md)): it uses `mm`'s own signed-in session from `~/.metamask`, and its network policy admits one
GET of this request's status in the session's project only.

- The session's project ID must hash to the project hash stored with the transfer. Another project refuses with
  `metamask_session_project_changed` before anything is read.
- The stored request ID must be a canonical UUID v4, the form `mm` and APN give their request IDs. Another form refuses
  with `provider_request_binding_invalid`.
- The answer must name this request ID, kind `transaction`, `tx.from` equal to the transfer's sender and `tx.chainId`
  equal to its chain. A transaction hash, when present, must be 32 bytes of lowercase hex.

A verified answer is recorded exactly as a `requests watch` answer of the same request: a transaction hash moves the
transfer to receipt proof, `AWAITING_MFA` records the owner's approval task as a watch status does, and `EXPIRED` or
`DENIED` gives the same next actions as a watch. After a watch (a transfer 0.5.107 or earlier sent), the task's
`expires_at` and `auth_method` are null, as before. A 404 is recorded as
`metamask_request_not_found_on_server`. After a watch, a refused read keeps `metamask_request_not_in_local_state`.

`read_observation.server_read` is present only when the server read ran:

| Field | Value |
| --- | --- |
| `outcome` | `verified`, `not_found` or `refused` |
| `response_hash` | SHA-256 of the server's answer bytes (`verified` only), otherwise `null` |
| `reason` | Why a `refused` read read nothing: `metamask_session_project_changed`, `provider_request_binding_invalid`, `provider_request_identity_conflict`, an `mm_gasless_*` reason of the helper (for example `mm_gasless_session_expired` or `mm_gasless_provider_unavailable`), or `metamask_server_read_unclassified`; otherwise `null` |
| `check` | The answer check that refused it (`response_request_id`, `response_kind`, `response_status`, `response_tx`, `response_hash`, `response_body`), otherwise `null` |

While the read runs, `read_observation.stage` is `server_read`.

## Refusals and next steps

Each vendor-check refusal happens before any operation exists. It is `APN_OPERATION_BLOCKED` with `details.reason`
naming the failed check and `next_actions` naming your step. APN runs none of these steps for you.

| `details.reason` | Meaning | Next step |
| --- | --- | --- |
| `metamask_session_required` | MetaMask has no signed-in session. | `apn wallet connect --profile <profile> --provider metamask-agent-wallet --auth-method browser` |
| `metamask_wallet_mismatch` | Another wallet is selected than the paying profile's. | `mm wallet select <payer>` |
| `metamask_guard_mode_required` | Guard mode is not reported. `observedTradingMode` is `unreported` (unset or the read failed; MetaMask reports both as null), `beast` or `unrecognized`. | `mm wallet trading-mode get --json`, then `mm wallet trading-mode set guard` and approve the MetaMask email |
| `metamask_guard_policy_missing` | No Guard policy for the paying wallet (none set, or the read failed; MetaMask reports both as empty). | `mm wallet policy get --json`, `mm wallet policy template`, then `mm wallet policy set --policy <yaml>` |
| `metamask_vendor_read_failed` | A MetaMask read did not answer. `failedRead` names it. A read the runner itself failed (such as a timeout) keeps its own error code and retry advice and adds `readFailure`. | The failed read to run by hand, for example `mm auth status --json` |
| `metamask_session_project_changed` | While reading a pending MetaMask request, MetaMask is signed in to another project than the one the transfer was quoted in. | None is given |
| `metamask_guard_policy_schema_unsupported` | The policy's `schema_version` is not 1. | `mm wallet policy get` |
| `metamask_guard_policy_wallet_mismatch` | The policy names a different wallet. | `mm wallet policy get` |
| `metamask_guard_recipient_not_allowlisted` | The recipient is not allowlisted on this chain. | `mm wallet policy get` |
| `metamask_guard_recipient_blocklisted` | The recipient is blocklisted. | `mm wallet policy get` |
| `metamask_guard_chain_not_allowed` | `evm.allowed_chains` is present and omits this chain. | `mm wallet policy get` |
| `metamask_guard_outflow_limit_missing` | `evm.outflow_limits_usd` has no positive limit. | `mm wallet policy get` |
| `metamask_guard_policy_unreadable` | The policy is not in the supported YAML form. | `mm wallet policy get` |
| `metamask_native_chain_unsupported` | The chain is not one of the five above. | Use a supported `--chain` name |

The `mm` steps in `next_actions` are written as the pinned `mm` client run by APN's own Node, so they run as typed.
Homebrew links only `apn`, so a bare `mm` is usually not on your `PATH`.

The policy reader accepts only the block YAML subset MetaMask writes (mappings, sequences, plain, quoted and numeric
scalars, comments). It refuses anchors, tags, flow collections other than `[]` and `{}`, and multi-line scalars rather
than guessing. Policies larger than 64 KiB are refused.

A native fee quote above the owner's native cap refuses with `native_fee_quote_above_owner_cap`, reporting
`per_transfer_cap_wei` and `daily_remaining_wei`; the next step is `apn allowlist policy status --profile <profile>`.

## Compatibility

- **`--chain` takes names.** Earlier releases selected the chain with a numeric option. Update saved command lines to
  `--chain <name>`. Backend requests, quotes and journals still record the numeric chain ID.
- **Journals.** Current journals (`apn.metamask-native-operation.v2`, quote `apn.metamask-native-fee-quote.v2`) store the
  recipient and amount in the quote and no APN home path, so moving or renaming the APN home does not invalidate them.
  Version 1 journals keep loading: their stored home path is kept as written and never compared, and their quote keeps
  its fixed recipient and amount.
- **Request reads.** The `REQUEST_NOT_FOUND` reasons and the server read change only the live
  `native-transfer-observe` output. Journals keep their schema, and an MFA task the server read records keeps
  `source: "watch"`.

## For contributors

The forbidden-surface scanner (`scripts/core-forbidden-surface.mjs`) admits the literal vendor argument `--chain-id`
only in `src/metamask-native-transfer-adapter.ts`, the private execution boundary that builds the MetaMask SDK call. The
value comes from the validated private quote after the adapter claims the owner-issued, single-use scope. This admits
no other forbidden pattern in that file, no nearby file, and does not relax the 500-line limit.
