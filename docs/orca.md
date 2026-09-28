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

The guarded candidate has CLI/MCP stable preparation and status routes. There is still no production stable signer, send, current-owner USDT funding and admission proof, on-chain receipt, or paid USDC→USDT swap acceptance. The snapshot preview remains untrusted and non-signable. C2-05 remains blocked.

The source-only `stable-approve --operation` command shows the exact prepared USDC→USDT intent in a foreground terminal and reserves its USDC principal after rechecking the active owner policy, activation and daily cap. Its separate MCP route returns a CLI handoff. The approval and reserved status remain `signable: false` and `executable: false`; this phase has no stable signer or sender. The prepared quote expires after 60 seconds, and a policy replacement or expired quote requires a fresh preparation. `stable-release --operation` retires a still unsigned operation and releases its exact lease, including an orphan left by an interrupted reservation write. `stable-status` performs that same local reconciliation after quote expiry. Both paths retain a terminal no-effect record and cannot cross a submission marker.

The phase 2C source includes a pure finalized-receipt verifier for a future already marked stable operation. It binds the returned signature to the saved v0 message and blockhash; matches finalized status, slot and transaction error; verifies exact owner USDC ATA debit, owner USDT ATA credit at or above the saved minimum, the two pinned Tokenkeg transfer CPIs, and the capped network fee and optional USDT ATA rent. A finalized revert yields a separate proof only when owner SOL lost the fee and token balances did not change. Missing or nonfinalized evidence remains pending; conflicting evidence is refused. The verifier makes no RPC call or state transition and is not wired to CLI/MCP.

The internal journal from [PR #451](https://github.com/nuanu-ai/agent-payment-node/pull/451) can persist a stable submission marker, exact execution binding and signed effect, but has no sender or public execution command. An interrupted binding or signing write is observe only until local no-send recovery reads encrypted custody by operation ID, including when the binding is absent. All encrypted signed-effect writes and this operation-ID read use the same wallet lock, so concurrent operations cannot erase a saved effect through stale whole-wallet writes. Recovery holds the same cross-process operation lock as marker creation, requires the exact material, owner identity and lease, and refuses any signed effect, unreadable custody, receipt or progressed state. It persists a marker-bound proof before releasing the reserved USDC lease and then records a terminal `failed_before_effect` operation that retains the marker and proof hash. A crash after the lease write is reconciled with that same proof. Any future sender must hold that operation lock and require a previously persisted, verified signed effect and a nonterminal operation; it must refuse a no-send proof. The stable execute route remains disabled, and this source does not establish a live swap or receipt acceptance.

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
| SOL/USDC pool (tick spacing 4, fee rate 400 = 0.04%) | `Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE` |
| wSOL vault (token A) | `EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9` |
| USDC vault (token B) | `2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP` |
| SPL Token (upgradeable loader, no upgrade authority) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, programdata `3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2` |
| Associated Token (BPFLoader2, immutable) | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |

Program bytes are verified at quote time and again before signing, in one
`getMultipleAccounts` read each:

- Whirlpool: the program account must point at the pinned programdata, and
  the SHA-256 of the programdata's 45-byte header (deployment slot 440170207,
  upgrade authority `GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV`) must be
  `88fc1d0d…4ee1814`. Any upgrade rewrites that slot. The full 10 MiB
  programdata hashed to `b5ee20ce…58048fa0` at pin time.
- SPL Token programdata (108,645 bytes, no upgrade authority): full SHA-256
  `573971c9…1dde5fe3`.
- Associated Token program (105,032 bytes): full SHA-256 `6804554e…d2f7374d`.
- System and ComputeBudget: native loader with their exact loader names.

The pool must be owned by the Whirlpool program, carry the `Whirlpool`
discriminator, the pinned config, mints (wSOL A, USDC B), vaults, tick spacing
and fee rate. A fee change refuses with `orca_pool_fee_drift`. The pool's
oracle PDA must be absent; an adaptive-fee pool refuses with
`orca_adaptive_fee`.

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
`keyless`, the mechanism pin with its digest
`7cef079e773ae2cc19e53714edce77873e2d1abb4acee3bf5af70f7090295928` and the
protocol registry digest. `prepare` needs the profile's active allowlist
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
