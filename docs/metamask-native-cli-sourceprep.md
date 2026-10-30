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
3. **Consent.** In a genuine foreground terminal (stdin and stderr must both be TTYs), the screen shows the profile and
   sender, the chain and USDC token, the recipient, the amount (atomic and decimal), the maximum full native fee, the
   Guard admission (recipient allowlisted, outflow limit), the quote hash and the operation ID. You type the approval
   code shown. Consent is valid for at most 60 seconds, or until the quote expires if that is sooner.
4. **Last guard.** APN rechecks the owner policy, profile binding and recipient pin, the account's conflict domain on
   that chain, and repeats the three MetaMask reads. The MetaMask project and the Guard policy must be unchanged since
   consent; otherwise the transfer is blocked before the hand-off.
5. **Hand-off.** After writing one durable effect marker, APN hands the transfer to MetaMask
   (`mm wallet send-transaction`) exactly once. MetaMask signs and broadcasts it under its own Guard policy and MFA.

The result is `acknowledged` (with a transaction hash) or `unknown` (pending MetaMask MFA, or an outcome APN cannot
prove). Both stay financially unknown until observed; run `native-transfer-observe` or `apn operation resume` to prove
the receipt and settle the actual fee. A proven no-hand-off ends `failed_before_effect`.

States: `prepared`, `effect_started`, `acknowledged` and `unknown` are non-terminal; `confirmed`, `confirmed_reverted`,
`failed_before_effect` and `abandoned_unknown` are terminal.

**Abandonment.** When the outcome is still unknown after the quote expired, `apn operation abandon --operation <id>`
asks for the exact acknowledgement and records `abandoned_unknown`. MetaMask may still have signed and broadcast the
transfer. An operation that never handed off and whose consent window has passed closes as `failed_before_effect`
instead.

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

## For contributors

The forbidden-surface scanner (`scripts/core-forbidden-surface.mjs`) admits the literal vendor argument `--chain-id`
only in `src/metamask-native-transfer-adapter.ts`, the private execution boundary that builds the MetaMask SDK call. The
value comes from the validated private quote after the adapter claims the owner-issued, single-use scope. This admits
no other forbidden pattern in that file, no nearby file, and does not relax the 500-line limit.
