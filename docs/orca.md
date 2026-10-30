# Solana Orca Whirlpool: keyless guarded swap

`apn swap solana orca` swaps through two pinned Orca Whirlpools on Solana
mainnet. Every swap is exact input from token A to token B:

| `--pool` | Swap | Pool | Input |
| --- | --- | --- | --- |
| `sol-usdc` | native SOL to canonical USDC | `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE` (tick spacing 4) | native SOL, wrapped to wSOL and unwrapped inside the transaction |
| `usdc-usdt` | USDC to USDT | `4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4` (tick spacing 1) | the owner's USDC token account |

APN uses no API key, no route API and no off-chain quote. Price, expected
output, slippage floor and price impact come from the pool's on-chain state;
APN builds every instruction locally, and the owner's local Solana key is the
only signer.

The SOL/USDC pool is the deepest SOL/USDC Whirlpool under Orca's main
`WhirlpoolsConfig`. Whirlpool's `swap` instruction has 11 fixed accounts, a
fixed tick-array layout and a stable program id; Raydium CLMM would need extra
bitmap-extension accounts.

## Requirements and setup

- **Local Solana wallet.** The profile's local Solana account
  (`apn wallet ensure-solana --profile <profile> --provider local --accept-risk true`,
  see [Solana](solana.md)) must be the quoted `--account`; it is also the
  recipient. A different account refuses with `swap_owner_account`.
- **Solana RPC.** `APN_SOLANA_RPC_URL` is optional; when it is unset or empty,
  APN uses the anonymous `https://api.mainnet-beta.solana.com`. See
  [Solana](solana.md#account-and-rpc) for the endpoint rules.
- **Owner admission** of both assets of the pool, described
  [below](#owner-admission).

## Commands

| Command | What it does |
| --- | --- |
| `inventory` | Lists the program pins and, for each pool under `pools`, its route, mechanism pin and digest, and protocol registry digest. Grants nothing. |
| `quote --pool --profile --account --amount --slippage-bps --owner-slippage-cap-bps --compute-unit-limit --compute-unit-price` | Quotes from the named pool's on-chain state, builds the instructions locally and simulates the exact unsigned transaction. Signs nothing. |
| `prepare --profile --quote --idempotency-key` | Binds the saved quote of either pool to the owner policy. |
| `approve --operation` | Foreground terminal only. Shows the swap screen, takes the typed code, re-checks with a fresh blockhash, signs locally and sends once. |
| `execute --operation` | Continues an approved reservation that has no marker yet; after the marker it only observes. |
| `status --operation` | Observes the exact signature. Never signs or sends. |

`quote` requires `--pool`; nothing defaults it, and no other option has a
default either. `--amount` is in atomic units of the pool input: lamports for
`sol-usdc`, six-decimal USDC units for `usdc-usdt` (`1000000` is one USDC).
`--slippage-bps` must not exceed `--owner-slippage-cap-bps` (at most 10000).
`--compute-unit-limit` is at most 1,400,000 and `--compute-unit-price` is in
micro-lamports. `prepare` takes the pool from the saved quote, and `status`,
`approve` and `execute` take it from the operation, so one pool never runs in
another pool's runtime: a foreign saved quote refuses with
`orca_pool_mismatch`.

MCP serves `inventory`, `quote`, `prepare` and `status`. `approve` and
`execute` are reachable only through `apn_foreground_handoff`, which returns
`APN_FOREGROUND_APPROVAL_REQUIRED` with the exact CLI command.

### Example: 0.01 SOL to USDC

`prepare` and `approve` must finish within four minutes of the quote.

```sh
apn swap solana orca inventory
QUOTE=$(apn swap solana orca quote --pool sol-usdc --profile <profile> --account <solana-address> --amount 10000000 --slippage-bps 50 --owner-slippage-cap-bps 50 --compute-unit-limit 200000 --compute-unit-price 1000 | jq -r .data.quoteHash)
OP=$(apn swap solana orca prepare --profile <profile> --quote $QUOTE --idempotency-key orca-sol-usdc-0001 | jq -r .operation.operationId)
apn swap solana orca approve --operation $OP
apn swap solana orca status --operation $OP
```

Run `status` again until it reports `finalized` (Solana finality takes about
13 seconds).

### Example: 1 USDC to USDT

```sh
QUOTE=$(apn swap solana orca quote --pool usdc-usdt --profile <profile> --account <solana-address> --amount 1000000 --slippage-bps 50 --owner-slippage-cap-bps 50 --compute-unit-limit 250000 --compute-unit-price 1000 | jq -r .data.quoteHash)
OP=$(apn swap solana orca prepare --profile <profile> --quote $QUOTE --idempotency-key orca-usdc-usdt-0001 | jq -r .operation.operationId)
apn swap solana orca approve --operation $OP
apn swap solana orca status --operation $OP
```

## Pins

| Role | Address |
| --- | --- |
| Whirlpool program (upgradeable loader) | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Whirlpool ProgramData | `CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD` |
| Whirlpool upgrade authority (Orca's Squads v4 vault) | `GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV` |
| WhirlpoolsConfig | `2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ` |
| SOL/USDC pool (tick spacing 4) | `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE` |
| SOL/USDC pool wSOL vault (token A) | `EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9` |
| SOL/USDC pool USDC vault (token B) | `2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP` |
| USDC/USDT pool (tick spacing 1, fee-tier seed 1) | `4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4` |
| USDC/USDT pool USDC vault (token A) | `4oY1eVHJrt7ywuFoQnAZwto4qcQip1QhYMAhD11PU4QL` |
| USDC/USDT pool USDT vault (token B) | `4dSG9tKHZR4CAictyEnH9XuGZyKapodWXq5xyg7uFwE9` |
| SPL Token (upgradeable loader, no upgrade authority) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, ProgramData `3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2` |
| Associated Token (BPFLoader2, immutable) | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |

### Program pins

Programs are verified at quote time and again before signing by one
`getMultipleAccounts` of seven keys with `dataSlice {offset: 0, length: 45}`
(about 2 KB): each program account and the two ProgramData loader headers.
APN pins program identities and upgrade authorities, never executable bytes:

- **Whirlpool:** the program account must point at ProgramData
  `CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD`, and that header's upgrade
  authority must be `GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV`. A new
  deployment by that authority is accepted and recorded in the quote evidence.
  Another authority, a removed authority or another ProgramData address
  refuses with `solana_program_authority_changed` or
  `solana_program_identity_changed`. Nothing is signed.
- **SPL Token:** ProgramData `3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2` with
  no upgrade authority, so its bytes can never change.
- **Associated Token (BPFLoader2), System and Compute Budget (native):** loader
  and executable flag; none of them can be upgraded.

Safety rests on the exact-message simulation against the programs as deployed
now, the exact account list, the minimum output encoded in the swap
instruction and the finalized receipt delta check.

### Pool checks

The pool must be owned by the Whirlpool program and carry the `Whirlpool`
discriminator, the pinned config, mints, vaults and tick spacing; a different
config, mint, vault or tick spacing refuses with `orca_pool_pin_drift`. The fee rate is read from the
same account and priced by the local swap math, so a retuned fee changes the
quote instead of refusing it. Both pools use static fee tiers: the pool's
oracle PDA must be absent, because an adaptive fee would add a variable fee
the local math cannot reproduce; such a pool refuses with `orca_adaptive_fee`.

## Quote

APN then:

1. proves the RPC serves Solana mainnet genesis and verifies the program pins;
2. reads the pool, derives the three tick arrays below the current tick
   (`["tick_array", pool, start]`; each array holds 88 ticks, which spans 352
   tick indexes on the SOL/USDC pool), and reads the pool, the three tick
   arrays, the oracle PDA, both vaults, the owner and the owner's two token
   accounts at one slot;
3. prices the exact input with an integer port of the program's exact-input,
   A-to-B swap loop (fee on input, rounding as the program does, liquidity_net
   applied at each initialized tick). It refuses with `orca_tick_boundary` if
   the swap would reach the end of the passed tick arrays or cross too many
   ticks; the decoded price must lie inside the decoded current tick;
4. derives the minimum output `ceil(expected * (10000 - slippageBps) / 10000)`
   and the price impact against the pre-swap spot price after the pool fee,
   and refuses with `orca_price_impact` when the impact exceeds the owner
   slippage cap;
5. builds the only instruction list APN signs (below);
6. validates the compiled v0 message: no lookup tables, the owner as the only
   signer and fee payer, only System, Token, Associated Token, Compute Budget
   and Whirlpool invoked, exactly the expected instructions with exact
   accounts, roles and data, and no writable account beyond the owner, its two
   token accounts and the pool's swap accounts;
7. prices the message with `getFeeForMessage`, requires the owner's SOL
   balance to cover what the swap may spend (`orca_insufficient_sol`,
   `APN_INSUFFICIENT_ASSET`), and simulates the exact bytes with
   `sigVerify: false` and `replaceRecentBlockhash: true`;
8. saves the quote, plan, bytes, evidence and simulation under the state root
   keyed by `quoteHash`. Loading a saved quote re-derives every binding.

The quote is valid for 240 seconds.

### SOL to USDC (`--pool sol-usdc`)

- **Instructions:** SetComputeUnitLimit, SetComputeUnitPrice,
  create-idempotent wSOL and USDC associated accounts, transfer exactly the
  input to the wSOL account, `SyncNative`, Whirlpool `swap` (amount,
  `other_amount_threshold` = minimum output, no price limit, exact input, A to
  B, with the pool, both owner token accounts, both vaults, the three tick
  arrays and the oracle), and close the wSOL account back to the owner.
- **Existing wSOL account:** an owner wSOL account that already exists is
  reused and kept. The swap neither creates nor closes it (no close
  instruction), and the simulation requires its token balance and lamports to
  survive unchanged. It must be a plain token account of the owner; a frozen,
  delegated or otherwise controlled account refuses with
  `orca_wsol_account_unusable`.
- **Funds:** the owner balance must cover the input, the fee and the rent of
  any account created.
- **Simulation:** USDC received must reach the minimum, a temporary wSOL
  account must be closed, and SOL spent must stay within input + fee + USDC
  account rent.

### USDC to USDT (`--pool usdc-usdt`)

USDC to USDT shares the program pins, the market read, the local swap math,
the exact-message simulation, the single foreground consent, the submission
marker, the single send, the finalized receipt check and the finality, expiry
and abandon exits. What differs:

- **Instructions:** SetComputeUnitLimit, SetComputeUnitPrice, create-idempotent
  USDT associated account, Whirlpool `swap` from the owner's USDC account to
  the owner's USDT account. No wrap and no close.
- **Source account:** the owner's USDC account must exist, be a classic token
  account controlled only by the owner, and hold the exact input
  (`orca_source_account_absent`, `orca_insufficient_source`, both
  `APN_INSUFFICIENT_ASSET`).
- **Destination account:** a missing USDT account is created inside the swap;
  its rent is shown on the consent screen.
- **SOL:** SOL leaving the wallet is bounded by the network fee and that rent.
- **Simulation and receipt:** the USDC account must lose exactly the input,
  the USDT account must gain at least the minimum, and the SOL spent must stay
  within the approved maximum.

## Owner admission

`prepare` needs the profile's active allowlist policy to admit both assets of
the pool on `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` for the
`swap` rail, each with the pool's route or mechanism pin from `inventory`:

| Pool | Assets to admit | Mechanism digest | Protocol registry |
| --- | --- | --- | --- |
| `sol-usdc` | native SOL and USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `bf55422e985eaa33dc1ee952e3d71dde28af0fc2092fb47041a8b5ffff5d6081` | `orca-whirlpool-keyless.2026-10-17` (`83c4b5acac83b0a93a191f2fa8f7cd764660e4475a57ebfb1e4ebe7647e92d39`) |
| `usdc-usdt` | USDC and USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` | `c3eb94c36563119c3e1d47f43ea1a4e541dec4766e01b1d258559591d18efa0e` | `orca-whirlpool-keyless-usdc-usdt.2026-10-17` (`7352c69fc65fc16ffb5d5e2a36e97b5811c5d7ddee2919d22dfdb343a95ff1f6`) |

The `sol-usdc` mechanism names protocol version
`whirlpool-upgrade-authority.1`, which names no deployment. Owners admit the
route (protocol, program and pool accounts), which every generation of a pool
shares, so a policy that names any earlier pin of the same pool admits the
current one and no Whirlpool upgrade needs re-admission. The `usdc-usdt` route
is exactly the route of the earlier stable USDC/USDT lane, so a policy that
admitted that lane, by route or by any of its mechanism pins, admits this one.

An example policy file for `sol-usdc`:

```json
{
  "schemaVersion": "apn.allowlist-policy-file.v1",
  "overlayVersion": "<a new overlay version>",
  "accounts": { "solana": "<the profile's local Solana account>" },
  "effectiveAt": "<ISO instant>",
  "expiresAt": "<ISO instant>",
  "admissions": [
    { "chain": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "kind": "native", "rail": "swap",
      "maximumPerTransferAtomic": "30000000", "dailyLimitAtomic": "30000000",
      "mechanism": { "...": "the route or the complete keyless pin from inventory" } },
    { "chain": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "kind": "token",
      "identifier": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "rail": "swap",
      "maximumPerTransferAtomic": "10000000", "dailyLimitAtomic": "10000000",
      "mechanism": { "...": "the route or the complete keyless pin from inventory" } }
  ]
}
```

Keep any admissions the profile already has and use a new `overlayVersion`.
Stage the file with
`apn allowlist policy stage --profile <profile> --file <absolute-policy-file>`
(add `--expected-revision <revision>` when the profile already has one) and
activate it in the foreground with
`apn allowlist policy activate --profile <profile> --revision <revision>`. The
caps are examples; nothing defaults to them. Without an active admission
`prepare` refuses with `swap_owner_admission_required`; a policy changed after
`prepare` refuses with `swap_policy_drift`.

## Approve, execute, status

- **`approve`** runs in the foreground CLI only. The screen shows the input,
  the owner's token accounts (and the temporary wSOL account for `sol-usdc`),
  expected and minimum output, slippage, price impact, the pool and program,
  the compute unit limit and price, the network fee, any account rent, the
  maximum SOL leaving the wallet, approval cap 0, and the quote, policy and
  mechanism digests. The owner types the six-character code. APN reads the
  clock again and reserves the input. The pre-signing guard then re-verifies
  the program pins, re-reads the pool (same tick arrays, local output still at
  or above the minimum), takes a fresh blockhash, rebuilds and re-validates
  the exact bytes, requires the chain fee to stay within the approved fee and
  the funds to suffice, and simulates those exact bytes with
  `replaceRecentBlockhash: false`. Any refusal before the submission marker
  releases the reservation as `failed_before_effect` with nothing signed. APN
  then persists the submission marker and the execution binding, signs with
  the profile's encrypted local Solana key, seals the signed bytes in the
  encrypted wallet state, and calls `sendTransaction` exactly once.
- **`execute`** continues an approved reservation that has no marker yet;
  after the marker it only observes.
- **`status`** never signs or sends. A finalized success with the exact
  signature and message, a fee within the approved fee, SOL spent within the
  approved maximum and an output delta on the owner's account of at least the
  minimum moves the operation to `finalized`. A finalized failed transaction
  moves it to `failed_confirmed_revert` and releases the reservation; only the
  fee was spent. A lost send answer is `unknown_finality` and is only
  observed. Once the finalized block height passes the signed transaction's
  last valid height and the signature has no status, `status` records
  `expired_unlanded` and releases the reservation.

A finalized operation's `receiptProof.economics` records the input, the output
credited, the network fee and the native debit in lamports, including the rent
of a token account the swap created. `status` also returns them as
`actualEconomics` in its receipt slot.

If an operation has a submission marker but no execution binding, no
blockhash lifetime exists to settle it. After the quote window closes, the
owner may end it in a foreground terminal with
`apn operation abandon --operation <operation-id>`; it becomes
`abandoned_unknown` and its input stays charged as spent. Once a binding
exists, `status` settles the operation and abandon refuses.

## RPC use

Every account read goes out in requests of at most eight keys (PublicNode's
limit). The ten-key market read is therefore an eight-key request (pool and
tick arrays first, one slot) and a two-key request for the owner's token
accounts, at most 150 slots apart; they share one JSON-RPC batch where the
endpoint batches account reads.

Each command's physical request budget is derived from its read plan, plus 2
requests of headroom:

| Command | Planned Solana POSTs |
| --- | --- |
| `quote` | 9 |
| `prepare` | 0 |
| `approve` | 13, including the single send and its first observation |
| `execute` | 13 |
| `status` | 4 |

One quote receives about 46 KB. No budget is stored across commands, and
pacing between POSTs persists per provider; see [Jupiter](jupiter.md#rpc-use-and-limits)
for the shared Solana pacing and cooldown rules.

## Reason codes

| Reason | Meaning | What to do |
| --- | --- | --- |
| `orca_pool_mismatch` | The saved quote belongs to the other pool. | Use the matching pool's operation, or quote again. |
| `orca_pool_pin_drift` | The pool's config, mints, vaults or tick spacing differ from the pin. | Nothing can be signed; wait for an APN release. |
| `orca_adaptive_fee` | The pool has an adaptive-fee oracle. | Nothing can be signed; wait for an APN release. |
| `solana_program_authority_changed`, `solana_program_identity_changed` | A pinned program changed authority or identity. | Nothing was signed; wait for an APN release that reviews it. |
| `orca_tick_boundary` | The swap would leave the passed tick arrays. | Quote a smaller amount. |
| `orca_price_impact` | Price impact exceeds the owner slippage cap. | Quote a smaller amount or raise the cap. |
| `orca_insufficient_sol`, `orca_insufficient_source`, `orca_source_account_absent` (`APN_INSUFFICIENT_ASSET`) | The balance cannot cover the input, fee or rent, or the source token account is missing. | Fund the account and quote again. |
| `orca_wsol_account_unusable`, `orca_wsol_account_changed` | The owner's wSOL account is not a plain owner account, or it was created or closed since the quote. | Fix the account and quote again. |
| `orca_tick_array_moved`, `orca_output_below_minimum`, `orca_fee_drift`, `orca_rent_drift` | At approval the pool moved, the output fell below the minimum, or the fee or rent rose above the approved values. Nothing was signed. | Quote again. |
| `swap_owner_admission_required`, `swap_policy_drift`, `swap_owner_account` | No active admission, the policy changed after `prepare`, or the profile account is not the quoted account. | Activate a policy for both assets; quote again with the profile's account. |

## Stable USDC to USDT operations from earlier releases

Releases up to 0.5.45 ran USDC to USDT as a separate "stable" lane.
`stable-inventory`, `stable-quote`, `stable-prepare`, `stable-approve` and
`stable-execute` no longer exist; an old invocation fails and names its
`--pool usdc-usdt` replacement as the next action. Frozen readers keep every
stable record readable, and four commands finish them. None of them quotes,
prepares, approves, signs or sends.

- `apn swap solana orca stable-status --operation <id>` reads the operation.
  An unsigned preparation whose 60-second quote window closed is released
  (`failed_before_effect`).
- `apn swap solana orca stable-release --operation <id>` retires an unsigned
  preparation (quoted, prepared, awaiting approval or reserved) and releases
  its exact USDC principal reservation.
- `apn swap solana orca stable-recover-no-send --operation <id>` (foreground
  consent; MCP returns the CLI handoff) proves that a marked operation has
  neither a send claim nor a signed custody effect, then releases its
  reservation (`failed_before_effect`).
- `apn swap solana orca stable-observe --operation <id>` observes a signed or
  claimed operation through the RPC origin it was prepared with: it records the
  possible send, then the finalized receipt (`finalized`) or revert
  (`failed_confirmed_revert`). Once the finalized block height passes the
  bound blockhash lifetime and the claimed signature has no status, the
  operation becomes `expired_unlanded` and the reservation is released. A
  signed effect that was never claimed was never sent (the claim precedes
  transport), so it expires the same way.

`apn operation abandon` refuses stable operations and points to
`stable-observe` and `stable-recover-no-send`.

## Compatibility

- Two earlier `sol-usdc` mechanism pins, for the Whirlpool deployments at
  slots 440170207 (`7cef079e773ae2cc19e53714edce77873e2d1abb4acee3bf5af70f7090295928`)
  and 457152296 (`3daa0909114ad86a7c4c95d17ddc9ecebbecd22e7b9b74452e3745500dc442cb`),
  only identify existing operations. Their operations stay readable and
  observable; they cannot quote or sign. A policy that names either pin
  admits the current route.
- Stable USDC/USDT operations from earlier releases are finished with the
  `stable-*` commands above.
