# Solana Orca Whirlpool: keyless guarded swap

## USDC to USDT market read (C2-05)

`apn swap solana orca stable-inventory` lists the pinned mainnet USDC/USDT
Whirlpool `4fuUiYxTQ6QCrdSq9ouBYcTM7bqSwYTSyLueGZLTy4T4` (tick spacing 1,
fee rate 100 = 0.01%). `apn swap solana orca stable-quote --amount 1000000
--slippage-bps 50 --maximum-price-impact-bps 50` reads it through
`APN_SOLANA_RPC_URL`. `--amount` is `<atomic_usdc>`: six-decimal USDC atomic
units (so `1000000` means one USDC). The quote is
exact-input A to B and uses the Whirlpool's local integer swap math.

The reader verifies mainnet genesis; exact pool owner, config, mints, vaults,
spacing and fee; absent adaptive-fee oracle; and both classic SPL vault mint,
authority and state. It derives three downward tick arrays from the first pool
read, then verifies the pool, arrays, oracle and vaults in a single
`getMultipleAccounts` result with one slot. It checks the output against the
destination reserve, computes a ceiling-rounded slippage floor, and refuses
when price impact exceeds the supplied cap. Current math supports a starting
tick of zero or a negative tick. It refuses other positive ticks until the
positive-tick math is separately implemented and verified.

This surface returns `mode: read_only`, `signable: false`, `signed: false`,
`broadcast: false`, and no transaction bytes. Inventory does not grant an
asset admission. There is no prepare, approval, signer, sender or payment
claim for this pool. Owner USDC funding, token-account existence, SOL fee
balance and account rent are unverified. The SOL/USDC execution route below
remains separate.

The pin and vault balances were observed on mainnet on 2026-09-26 near slots
450687682–450687913. A fresh quote re-reads the current state; those balances
are historical evidence, not a live reserve guarantee.

### Internal USDC to USDT snapshot preview (27 Sep source checkpoint)

Merged [PR #422](https://github.com/nuanu-ai/agent-payment-node/pull/422) added an offline unsigned v0 message preview from caller-supplied account data. Merged [PR #424](https://github.com/nuanu-ai/agent-payment-node/pull/424) adds an internal read-only adapter that checks Solana mainnet genesis and pinned program bytes, derives three tick arrays and the owner's classic USDC/USDT associated accounts, then reads the pool, arrays, vaults and owner accounts in one `getMultipleAccounts` slot. It recomputes the exact-input quote, price impact and output floor from those bytes and obtains a fresh blockhash and height for the preview. The adapter requires a fresh budget of at most 24 physical POSTs with persistent pacing of at least 750 ms between requests to the provider family; HTTP 429/403 remain terminal.

This adapter is absent from the public Orca CLI/MCP inventory and quote commands above. Its result is an untrusted, non-signable preview. The 22 focused tests used fake RPC responses; no live Solana RPC or paid USDC→USDT swap was proved. It does not fund the current profile with USDT, create an owner USDT policy admission, or close C2-05. The admitted SOL→USDC execution route below is separate.

Merged [PR #426](https://github.com/nuanu-ai/agent-payment-node/pull/426) defines a separate USDC→USDT mechanism pin and exact digest selector. Its owner admission helper checks the active sealed policy revision, local Solana account, both canonical mint rows, identical stable pin, per-transfer and daily caps, and exact pool/program/amount quote binding. Merged [PR #428](https://github.com/nuanu-ai/agent-payment-node/pull/428) adds an internal guarded candidate entry after those checks. It rechecks active policy and usage, the one-slot market and owner account identities, current fee and blockhash lifetime, and a same-result simulation. It decodes exactly two classic Tokenkeg `Transfer` CPIs in the pinned Whirlpool swap instruction: exact USDC input from the owner's existing ATA and USDT output to the owner's existing ATA at or above the minimum. Missing or unfamiliar traces and missing USDT ATA setup fail closed. Only then may it persist a recoverable prepared operation and return unsigned transaction bytes. The 47 focused tests used synthetic RPC and simulation results; they establish source behavior, not a live Solana simulation.

The guarded candidate has CLI/MCP stable preparation and status routes, with guarded one-shot foreground execution available through `stable-execute`. Owner execution requires separate foreground consent after principal reservation. This source still has no current-owner USDT funding and admission proof, on-chain receipt, or paid USDC→USDT swap acceptance. The snapshot preview remains untrusted and non-signable. C2-05 remains blocked.

The `stable-approve --operation` foreground CLI command shows the exact prepared USDC→USDT intent and reserves its USDC principal after rechecking the active owner policy, activation and daily cap. Its MCP route returns a CLI handoff. The approval response and reserved `stable-status` remain `signable: false`, `signed: false` and `broadcast: false`; while reserved, they report `executable: true` and `executionRequiresForegroundConsent: true`. Since phase-1 cleanup (SWAP-20) the one approval screen also authorizes the execution that follows in the same `stable-approve` command: after the reservation it refreshes the preflight, signs once and makes at most one send attempt, with no second prompt. `stable-execute --operation` remains for a reservation left unexecuted (an interrupted or refused execution) and asks for its own fresh consent. The prepared quote expires after 60 seconds, and a policy replacement or expired quote requires a fresh preparation. `stable-release --operation` retires a still unsigned operation and releases its exact lease, including an orphan left by an interrupted reservation write. `stable-status` performs that same local reconciliation after quote expiry. Both paths retain a terminal no-effect record and cannot cross a submission marker.

The phase 2C source includes a pure finalized-receipt verifier for a future already marked stable operation. It binds the returned signature to the saved v0 message and blockhash; matches finalized status, slot and transaction error; verifies exact owner USDC ATA debit, owner USDT ATA credit at or above the saved minimum, the two pinned Tokenkeg transfer CPIs, and the capped network fee and optional USDT ATA rent. A finalized revert yields a separate proof only when owner SOL lost the fee and token balances did not change. Missing or nonfinalized evidence remains pending; conflicting evidence is refused. The verifier makes no RPC call or state transition and is not wired to CLI/MCP.

The internal journal from [PR #451](https://github.com/nuanu-ai/agent-payment-node/pull/451) can persist a stable submission marker, exact execution binding and signed effect. Merged [PR #461](https://github.com/nuanu-ai/agent-payment-node/pull/461) exposes the guarded `stable-execute --operation <id>` foreground CLI path: after separate reservation approval, it requires fresh owner consent, refreshes execution preflight, signs once and makes at most one send attempt. MCP returns the exact CLI handoff and cannot sign or submit. An interrupted binding or signing write is observe only until local no-send recovery reads encrypted custody by operation ID, including when the binding is absent. All encrypted signed-effect writes and this operation-ID read use the same wallet lock, so concurrent operations cannot erase a saved effect through stale whole-wallet writes. Recovery holds the same cross-process operation lock as marker creation and sender, requires the exact material, owner identity and lease, and refuses any signed effect, unreadable custody, receipt or progressed state. It persists a marker-bound proof before releasing the reserved USDC lease and then records a terminal `failed_before_effect` operation that retains the marker and proof hash. A crash after the lease write is reconciled with that same proof. The current sender requires the persisted, verified signed effect before its send claim; a no-send proof bars later signing or sending. This source does not establish a live swap or receipt acceptance.

### Read-only guarded simulation (source surface)

`simulateOrcaStableGuardedReadOnly(rpc, ports, request)` exposes the current-owner
guarded proof as an exported TypeScript source API, not a CLI/MCP operator command. The caller supplies the
active owner policy and usage readers, local account reader, exact policy
revision, owner, amount, slippage, compute and fee caps, and a fresh Solana RPC
transport. The transport must have at most 24 physical POSTs and persistent
provider-family pacing of at least 750 ms. HTTP 429/403 are terminal. The
existing `SolanaRpcPacer` writes only provider POST timestamp and cooldown
metadata to maintain pacing across invocations; the simulation writes no
operation, policy, usage reservation, wallet, or key state.

It runs the same pinned program, one-slot market, policy, ATA, fee, blockhash,
and same-simulation classic Tokenkeg CPI checks used by the guarded candidate.
The result contains a quote and proof evidence, with `mode: read_only`,
`signable: false`, and `executable: false`. No operation repository, signer,
sender, or transaction bytes are reachable from this surface. A missing USDT
ATA and any unsupported setup or CPI trace fail closed. This source proof is
not a current-profile live simulation or a paid receipt; C2-05 remains blocked.

APN exposes `inventory`, `quote`, `prepare`, `status`, `approve`, and `execute`
under `apn swap solana orca`. The only admitted mechanism is native SOL to
canonical USDC, exact input, against one pinned Orca Whirlpool on Solana
mainnet. APN uses no API key, no route API and no off-chain quote: price,
expected output, slippage floor and price impact come from the pool's on-chain
state, APN builds every instruction locally, and the owner's local Solana key
is the only signer. Inventory reports `admitted: false` and grants nothing.

## Why this pool

Every SOL/USDC Whirlpool under Orca's main `WhirlpoolsConfig` was derived and
read on 2026-09-18. The tick-spacing-4 pool is the deepest by far: 91,742 SOL
and 15.1M USDC in its vaults and in-range liquidity about 1000 times the next
tick spacing. Raydium CLMM needs extra bitmap-extension accounts and Raydium
CPMM SOL/USDC is shallow; the Whirlpool `swap` instruction has 11 fixed
accounts, a fixed tick-array layout and a stable vanity program id.

## Pins (read on mainnet, 2026-09-18, slots 447989559-447994242)

| Role | Address |
| --- | --- |
| Whirlpool program (upgradeable loader) | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Whirlpool programdata | `CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD` |
| WhirlpoolsConfig | `2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ` |
| SOL/USDC pool (tick spacing 4, fee rate read at quote; 400 = 0.04% when reviewed) | `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE` |
| wSOL vault (token A) | `EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9` |
| USDC vault (token B) | `2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP` |
| SPL Token (upgradeable loader, no upgrade authority) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, programdata `3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2` |
| Associated Token (BPFLoader2, immutable) | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |

Programs are verified at quote time and again before signing by one
`getMultipleAccounts` of seven keys with `dataSlice {offset: 0, length: 45}`
(about 2 KB): each program account and the two ProgramData loader headers.
APN pins program identities and upgrade authorities, never executable bytes
(owner decision, APN 0.5.43):

- Whirlpool: the program account must point at ProgramData
  `CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD`, and that header's upgrade
  authority must be `GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV` (Orca's Squads
  v4 vault). A new deployment slot by that authority is accepted and recorded
  in the quote evidence; another authority, a removed authority or another
  ProgramData address refuses with `solana_program_authority_changed` or
  `solana_program_identity_changed`.
- SPL Token: ProgramData `3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2` with no
  upgrade authority, so its bytes can never change.
- Associated Token (BPFLoader2), System and ComputeBudget (native): loader and
  executable flag; none of them can be upgraded.

Safety rests on the exact-message simulation against the programs as deployed
now, the exact account list, the minimum output encoded in the swap
instruction and the finalized receipt delta check.

The pool must be owned by the Whirlpool program, carry the `Whirlpool`
discriminator, the pinned config, mints (wSOL A, USDC B), vaults and tick
spacing. The fee rate is read from the same account and priced by the local
swap math, so a retuned fee changes the quote instead of refusing it. The
pool's oracle PDA must be absent: an adaptive fee would add a variable fee the
local math cannot reproduce, so such a pool refuses with `orca_adaptive_fee`.

## Quote

`quote` takes the profile, the profile's Solana account (the owner is also the
recipient), the lamport amount, `--slippage-bps` no greater than
`--owner-slippage-cap-bps`, and the owner's `--compute-unit-limit` and
`--compute-unit-price` (micro-lamports). Nothing is defaulted. APN then:

1. proves the RPC serves Solana mainnet genesis and verifies the program pins;
2. reads the pool, derives the three tick arrays below the current tick
   (`["tick_array", pool, start]`, 352 ticks each), and reads the pool, the three
   tick arrays, the oracle PDA, both vaults, the owner, and the owner's wSOL and
   USDC associated accounts in one `getMultipleAccounts` at one slot;
3. prices the exact input with an integer port of the program's exact-input,
   A-to-B swap loop (fee on input, rounding as the program does, liquidity_net
   applied at each initialized tick) and refuses with `orca_tick_boundary` if
   the swap would reach the end of the passed tick arrays; the decoded price
   must lie inside the decoded current tick;
4. derives the minimum output `ceil(expected * (10000 - slippageBps) / 10000)`
   and the price impact against the pre-swap spot price after the 0.04% fee,
   and refuses when the impact exceeds the owner slippage cap;
5. builds the only instruction list APN signs: SetComputeUnitLimit,
   SetComputeUnitPrice, create-idempotent wSOL and USDC associated accounts,
   transfer exactly the input to the wSOL account, `SyncNative`, Whirlpool
   `swap` (amount, `other_amount_threshold` = minimum output, no price limit,
   exact input, A to B, with the pool, both owner token accounts, both vaults,
   the three tick arrays and the oracle), and close the wSOL account back to
   the owner;
6. validates the compiled v0 message: no lookup tables, the owner as the only
   signer and fee payer, only System, Token, Associated Token, ComputeBudget
   and Whirlpool invoked, exactly these eight instructions with exact accounts,
   roles and data, and no writable account beyond the owner, its wSOL and
   USDC accounts and the pool's swap accounts;
7. prices the message with `getFeeForMessage`, requires the owner balance to
   cover the input, the fee and both account rents (`orca_insufficient_sol`,
   `APN_INSUFFICIENT_ASSET`), and simulates the exact bytes with
   `sigVerify: false` and `replaceRecentBlockhash: true`, reading back the
   owner, the wSOL account and the USDC account: USDC received must reach the
   minimum, the wSOL account must be closed, and SOL spent must stay within
   input + fee + USDC account rent;
8. saves the quote, plan, bytes, evidence and simulation under the state root
   keyed by `quoteHash`. `load` re-derives every binding.

An existing owner wSOL account refuses with `orca_wsol_account_present`
(closing it would move unrelated wrapped SOL).

## Keyless mechanism pin and owner admission

`apn swap solana orca inventory` lists the pool, the program pins and, under
`keyless`, the route, the mechanism pin with its digest
`bf55422e985eaa33dc1ee952e3d71dde28af0fc2092fb47041a8b5ffff5d6081` and the
protocol registry digest
`83c4b5acac83b0a93a191f2fa8f7cd764660e4475a57ebfb1e4ebe7647e92d39`
(`orca-whirlpool-keyless.2026-10-17`, protocol version
`whirlpool-upgrade-authority.1`, which names no deployment). The slot 440170207
pin (`7cef079e…0295928`) and the slot 457152296 pin (`3daa0909…00dc442cb`) only
identify existing operations. Owners admit the route, which every generation
shares, so a policy that names any of these pins admits the current one and no
Whirlpool upgrade needs re-admission. `prepare` needs the profile's active allowlist
policy to admit native SOL and canonical USDC on
`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` for the `swap` rail,
both with exactly that pin:

```json
{
  "schemaVersion": "apn.allowlist-policy-file.v1",
  "overlayVersion": "owner.2026-09-18.orca.1",
  "accounts": { "solana": "<the profile's local Solana account>" },
  "effectiveAt": "2026-09-18T08:00:00.000Z",
  "expiresAt": "2026-10-18T08:00:00.000Z",
  "admissions": [
    { "chain": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "kind": "native", "rail": "swap",
      "maximumPerTransferAtomic": "30000000", "dailyLimitAtomic": "30000000",
      "mechanism": { "...": "the complete keyless pin from inventory" } },
    { "chain": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "kind": "token",
      "identifier": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "rail": "swap",
      "maximumPerTransferAtomic": "10000000", "dailyLimitAtomic": "10000000",
      "mechanism": { "...": "the complete keyless pin from inventory" } }
  ]
}
```

Keep any admissions the profile already has and use a new `overlayVersion`.
Stage it with `apn allowlist policy stage` and activate it in the foreground
with `apn allowlist policy activate`. The caps are examples; nothing defaults
to them. Without an active admission `prepare` refuses with
`swap_owner_admission_required`; a policy changed after `prepare` refuses with
`swap_policy_drift`. The profile's local Solana account
(`apn wallet ensure-solana`) must be the quoted account (`swap_owner_account`).

## Approve, execute, status

- `approve` runs in the foreground CLI only. The screen shows the SOL input,
  the owner's USDC and temporary wSOL accounts, expected and minimum USDC,
  slippage, price impact, the pool and program, the compute unit limit and
  price, the network fee, the USDC account rent, the maximum SOL leaving the
  wallet, approval cap 0, and the quote, policy and mechanism digests. The
  owner types the six-character code. APN reads the clock again and reserves
  the input. The pre-sign guard then re-verifies the program pins, re-reads
  the pool (same tick arrays, local output still at or above the minimum),
  takes a fresh blockhash, rebuilds and re-validates the exact bytes, requires
  the chain fee to stay within the approved fee, and simulates those exact
  signed-to-be bytes with `replaceRecentBlockhash: false`. Any refusal before
  the submission marker releases the reservation as `failed_before_effect`
  with nothing signed. APN then persists the submission marker and the
  execution binding, signs with the profile's encrypted local Solana key,
  seals the signed bytes in the encrypted wallet state, and calls
  `sendTransaction` exactly once.
- `execute` continues an approved reservation that has no marker yet; after
  the marker it only observes.
- `status` never signs or sends. A finalized success with the exact signature
  and message, a fee within the approved fee, SOL spent within the approved
  maximum and a USDC delta on the owner's account of at least the minimum
  moves the operation to `finalized`. A finalized failed transaction moves it
  to `failed_confirmed_revert` and releases the reservation; only the fee was
  spent. A lost send answer is `unknown_finality` and is only observed.

MCP serves `inventory`, `quote`, `prepare` and `status`; `approve` and
`execute` return `APN_FOREGROUND_APPROVAL_REQUIRED` with the exact CLI handoff.

## Owner sequence for 0.01 SOL to USDC

`solana-local` and `GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki` are the
example profile and account; prepare and approve must finish within four
minutes of the quote.

```sh
export APN_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
apn swap solana orca inventory
QUOTE=$(apn swap solana orca quote --profile solana-local --account GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki --amount 10000000 --slippage-bps 50 --owner-slippage-cap-bps 50 --compute-unit-limit 200000 --compute-unit-price 1000 | jq -r .data.quoteHash)
OP=$(apn swap solana orca prepare --profile solana-local --quote $QUOTE --idempotency-key orca-001sol-2026-09-18-1 | jq -r .operation.operationId)
apn swap solana orca approve --operation $OP
apn swap solana orca status --operation $OP
```

Run `status` again until it reports `finalized` (Solana finality takes about
13 seconds).

## Whirlpool upgrade re-pin, 16 October 2026

Orca upgraded the Whirlpool program at slot 457152296 (2026-10-15
07:22:05 UTC). Transaction
`2Z156jvtGjumG6tAEqfMqctBRuh8YmNb5UbQzkqbnAw6xR4TtFgUC4DW8tykwgcibPfeyiEigZQ3x1Pp1kHNwzGT`
is a Squads v4 `VaultTransactionExecute` that runs the upgradeable loader's
`Upgrade` from buffer `GFAGqhnRdPaoyft7fNyoxxXEhwDQpxsc3j77wV7Wa2TW`, signed by
the unchanged authority `GwH3Hiv5…Rx4PV`. Every quote of APN 0.5.40 refused
with `orca_program_pin_drift` from then on. Pool accounts did not change: owner,
size, discriminator, config, bump, PDA, tick spacing, fee-tier seed, fee and
protocol fee rates, mints, vaults and oracle absence of the SOL/USDC and
USDC/USDT pools all still match their pins.

Two origins (`api.mainnet-beta.solana.com` and `solana-rpc.publicnode.com`)
returned identical 10,485,760 programdata bytes on 16 October. The capture,
with hashes, is in `tests/fixtures/whirlpool-runtime-c422b2/`. The trimmed
executable hash is `75d0cbf1…939c605c`, matching
`solana-verify get-program-hash` (previous generation `46328660…10154992`).

**Contract: runtime bytes only.** No reproducible source build is claimed.
`solana-verify` 0.4.9 is installed on the review machine, but its
verifiable-build Docker image is not, and installing it was out of scope; the
OtterSec registry reports this executable as not verified (its last verified
build is commit `e5f089bc`, February 2026). The source review covers the
orca-so/whirlpools `programs/whirlpool` commits between the two deployments:
`408c945` (rent reduction for Agave 4.2), `f6db412` (removes
`migrate_repurpose_reward_authority_space`), `4aac511` (u256 division add-back
edge case), `fb19ae2` (SIMD-0460 dynamic tick array refactor) and `f2a3d13`
(fee and reward checkpoint update). None changes the `swap` or `swap_v2`
arguments, their account lists, the Whirlpool, TickArray or Oracle layouts, or
their discriminators. The u256 fix only affects operands near 2^192; APN's
quote math uses exact big integers. The new executable no longer contains the
`MigrateRepurposeRewardAuthoritySpace` log string and still contains `Swap`,
`SwapV2` and `TwoHopSwap`, so the deployment includes the 6 October commits;
which exact commit was built cannot be proven without a reproducible build.

The header pin is now joined by a payload pin, so a pin match means these exact
executable bytes, not only "no upgrade since this slot". Verification costs one
genesis read, one account read and seven programdata reads. Measured on
mainnet: 9 physical POSTs for the pins, 15 for a complete keyless quote with
simulation, and 13 for a stable snapshot, all inside the 24-POST budget.

New mechanism identities, so every owner must admit them again:

| Mechanism | Slot 457152296 digest | Slot 440170207 digest (existing operations only) |
| --- | --- | --- |
| Keyless SOL→USDC | `3daa0909114ad86a7c4c95d17ddc9ecebbecd22e7b9b74452e3745500dc442cb` | `7cef079e773ae2cc19e53714edce77873e2d1abb4acee3bf5af70f7090295928` |
| Stable preview USDC→USDT | `27d5bdce74ccc5e9aa65df4ec3c596bdf4f9e202dd3444eb802835d57bb4764f` | `a64a464a26f017af9c57d7528e9baa95b3cb41322e7384e36b9beffd97e08095` |
| Stable guarded USDC→USDT | `f11383d8bb5344ca73f5af43c0640749d7bbb36344f43914ad3765684c7c2ce9` | `419bdd5d4a1f663ffa9c1a4b0e4dc5ff7428cb7f0882417ecb16c39115c5aefc` |
| Stable registry | `edd3f14d873a2e722923322a4137261441832afbab1eb3c66ae878f7d078ce49` (`orca-whirlpool-routes.2026-10-16`) | `c1651aabba1e93ba2c5f0f30a59ebce0e6cdec75b90022e203f933ca3a7bef98` (`orca-whirlpool-routes.2026-09-28`) |

The slot 440170207 identities remain registered for existing operations only.
Status, observation, release, expiry reconciliation and no-send recovery accept
either generation, and stable material must carry the registry of its own
generation. Preparation, approval, execution consent, the submission marker
and the single send accept only the current generation. Program bytes are
always checked against the current pins, so nothing can sign for the old code.

**No-money mainnet diagnostics, 16 October 08:09 UTC.** Through this source
build and the production Solana transport (24-POST budget, persistent
pacing, `api.mainnet-beta.solana.com`), using the public account
`GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki` and no key:

- all eight program pins passed;
- a keyless quote for 1,000,000 lamports read the pool at slot 457565610 and
  simulated the exact unsigned message (`sigVerify: false`,
  `replaceRecentBlockhash: true`) at slot 457565626: 106279 atomic USDC
  expected and received, minimum 105748, 1005200 lamports SOL spent, 49448
  compute units;
- a stable USDC→USDT snapshot for 100000 atomic USDC (existing ATAs) at market
  slot 457565686 returned expected 100105 and minimum 99605 atomic USDT, with
  `signable: false`.

The guarded stable simulation needs an active owner policy and was not run.
Nothing was signed or sent; there is no paid receipt for the new program
bytes.

## Program authority pins and the public-RPC diet (APN 0.5.43)

The byte pins of the 16 October re-pin are retired. One keyless quote now sends
8 Solana POSTs and receives about 46 KB (it was 15 POSTs and 14.3 MB: seven
1.5 MB ProgramData slices); the pre-signing guard sends one header read
instead of eight reads. Each Orca keyless command's physical request budget is
derived from its read plan (`src/swap/solana-read-plan.ts`): quote 8,
approve 12, status 4, plus 2 of headroom. The stable USDC→USDT route uses the
same header verifier and no fee-rate pin; its mechanism is
`whirlpool-stable-upgrade-authority.1`, with the slot 440170207 and 457152296
generations kept for existing operations.
