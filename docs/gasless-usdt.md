# Gasless USDT staged implementation

`apn gasless usdt` sends USDT on Ethereum from a local wallet without holding ETH. Pimlico's keyless ERC-20 paymaster
pays the gas and takes its fee in USDT from the same transfer. The flow has two stages: `prepare` saves an unsigned,
policy-bound operation, and `execute` signs it locally and sends it at most once after foreground approval.

This is separate from the USDC path in [gasless.md](gasless.md). No mainnet transfer acceptance has been recorded for
this path yet, and public-RPC support for its block-hash-pinned sponsor checks is not yet verified.

## Fixed configuration

Every request is bound to these pins. Any identity, chain, amount, expiry, prototype or excess mismatch fails closed with
`capability unavailable` or a typed refusal reason.

| Item | Value |
| --- | --- |
| Chain | Ethereum, chain ID 1 (`eip155:1`) |
| Token | USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7`, 6 decimals |
| EntryPoint (v0.8) | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| EIP-7702 delegate | `0xe6Cae83BdE06E4c305530e199D7217f42808555B` |
| Paymaster (USDT spender) | `0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402` |
| Fee treasury | `0x4337Ff05c84B9A80Ea0a78dBE7B8E102F66d4c08` |
| Sponsor endpoint | `https://public.pimlico.io/v2/1/rpc` (keyless; 20 requests per minute per IP, shared with every other call) |
| Required RPC variable | `APN_ETHEREUM_RPC_URL` (no default) |

## Requirements

- A local EVM wallet profile.
- An active owner asset policy for the owner's Ethereum account and Ethereum USDT that admits the `gasless` rail with
  positive per-transfer and daily caps and exactly this mechanism:

  ```json
  { "provider": "pimlico-erc20-paymaster", "reference": "eip155:1:0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402" }
  ```

- `APN_ETHEREUM_RPC_URL` set to a public HTTPS Ethereum RPC for `prepare`, `execute`, `resume` and `observe`. Without
  it these commands refuse with `APN_RPC_CONFIG`.
- The sender needs at least the gross USDT amount. It needs no ETH.

## Commands

```sh
apn gasless usdt prepare --profile <profile> --to <recipient> --amount <gross-USDT> \
  --max-fee <USDT> --min-received <USDT> --idempotency-key <key>
apn gasless usdt status --profile-hash <hash> --operation <operation-id>
apn gasless usdt execute --profile-hash <hash> --operation <operation-id>
apn gasless usdt resume --profile-hash <hash> --operation <operation-id>
apn gasless usdt observe --profile-hash <hash> --operation <operation-id>
apn gasless usdt execution-status --profile-hash <hash> --operation <operation-id>
```

| Command | What it does | MCP tool |
| --- | --- | --- |
| `prepare` | Reads the active owner policy, a safe Ethereum account snapshot and the sponsor; saves only unsigned material. | `apn_gasless_usdt_prepare` |
| `status` | Reads the saved bound operation. No network access. | `apn_gasless_usdt_status` |
| `execute` | Foreground approval, local signing and at most one send. | none (CLI only) |
| `resume` | Observes a submitted hash (as `observe`), retires an interrupted unsent attempt, or returns the saved operation. Never signs or sends. | `apn_gasless_usdt_resume` |
| `observe` | Observes the original submitted hash through finalized Ethereum evidence. Never signs or sends. | none |
| `execution-status` | Reads the local bound and execution journals. No network access. | none |

`--amount`, `--max-fee` and `--min-received` are decimal USDT with at most six fractional digits. `--idempotency-key` is
8 to 128 safe ASCII characters. `--profile-hash` is the 64-character lowercase hex profile hash recorded in the prepared
operation (`profileHash`).

## Amounts and fees

Preparation computes the whole fee budget `F = min(max-fee, amount - min-received)` and the recipient amount
`N = amount - F`. A quote whose worst case exceeds `F` is refused; nothing is widened to fit it.

The frozen account batch makes three calls, in this order: USDT `approve(paymaster, 0)`, `approve(paymaster, F)`, then
`transfer(recipient, N)`. The paymaster sees this exact calldata. It charges its actual fee `A` (at most `F`) to the
fee treasury in `postOp`. After a successful charge, `F - A` may remain approved to the paymaster until a later gasless
USDT batch resets it.

The gas offer is fixed (verification 75,000, call 130,000, paymaster verification 100,000, paymaster post-op 75,000,
pre-verification 100,000), so your fee cap covers the worst case and the bundler cannot use more.

## Prepare

`prepare` reads the authenticated active owner policy and the combined daily USDT usage before any public RPC read. It
binds the owner's Ethereum account, the active policy digest, revision and activation, the exact USDT and paymaster
mechanism, positive transfer and daily caps, and one canonical safe-block account snapshot. It then saves the complete
unsigned operation. A missing, revoked, expired, mismatched or unadmitted policy is refused.

**Frozen economics.** The gas fields, initial prices, gross, fee cap, net amount and calldata are frozen. The initial
quote and fast price are recorded as information. The sponsor payload's authenticated exchange rate and post-op overhead
determine the signed fee bound, which must fit the same fee cap; the initial estimated fee may exceed the cap, but the
authenticated signed economics must fit. A later valid quote or price change is recorded with an exact list of changed
fields and does not reprice the operation. Signed bytes are never rewritten.

**Sponsor verification.** Before the operation is saved, one RPC batch at the canonical safe block verifies the pinned
paymaster's hash, EIP-191 signer recovery, signer membership and `getHash` parity. The sponsor payload must stay valid
for at least 60 seconds and at most one hour after the check.

**Reads.** Preparation permits at most 8 read admissions, with no retry, polling or fallback to single reads:

- Ethereum batch 1: chain ID and safe block identity.
- Ethereum batch 2, bound to that safe block hash: four pinned code hashes, four contract invariants, owner code, USDT
  balance, EntryPoint nonce and EOA nonce (needed for the unsigned EIP-7702 authorization stub when the account is not
  yet delegated).
- Sponsor: five calls (quote twice, gas price twice, paymaster data once). Malformed or wrong-route quotes refuse.
- Ethereum batch 3: sponsor membership and `getHash` parity at the saved safe block hash.

A malformed, missing, duplicate or mismatched batch response refuses preparation. A call pinned by block hash
(EIP-1898) that the RPC does not support refuses; APN never falls back to `latest` or a block number. Each command's
reads share a 60-second deadline. Each endpoint family shares one persisted in-flight slot and a fail-closed 429
cooldown. Pimlico requests start at least 3 seconds apart; other public RPC requests at least 750 ms apart. An admission
can be counted before scheduling rejects it, so the limit is not a count of physical requests.

**Idempotency and holds.** Retrying with the same key and the same request returns the first saved operation, even if
time, policy, safe block or sponsor data have changed since; it checks the saved claim before any policy or RPC read. A
different recipient, amount or profile under the same key is refused before those reads. The key is claimed across all
profiles in the gasless USDT journal, and prepare refuses a key that another money family already holds
(`APN_IDEMPOTENCY_CONFLICT`, `gasless_usdt_idempotency_other_family`). Other families do not yet refuse a key first used
here.

Prepare also refuses while another non-terminal operation holds the owner's Ethereum account. A prepared operation
alone holds nothing; an execution that can still sign, send or land (`planned`, `reserved`, `submitting`,
`submitted_pending`, `unknown_finality`) holds `evm:1:<owner>` for every money family.

**Durability.** Each preparation is written as a private, integrity-checked local record. The state root's parent
directory must exist, and APN syncs each directory it creates; a file system that cannot sync directories refuses
preparation. If writing stops after the idempotency claim, `status` reads the complete claim and a matching retry
restores the final file. Stale incomplete temporary files are cleaned up.

CLI and MCP results omit the raw sponsor payload, its signature and authorization bytes. The saved sponsor capture is
labelled `point_in_time_capture_not_current_authorization`: it is evidence of what was checked, not a current
authorization.

## Execute

`apn gasless usdt execute --profile-hash <hash> --operation <operation-id>` loads only an existing prepared operation
and needs a foreground terminal.

**Consent screen.** It shows Ethereum, the owner, the recipient, the gross amount, the exact recipient amount, the
requested maximum fee and the effective fee cap `F`, the quoted fee bound, the bound policy revision and digest, and the
saved paymaster quote validity. It names the Pimlico sponsor, the paymaster (USDT spender) and the signed fee treasury,
and states that the batch grants the paymaster exactly `F` USDT allowance. On first use it identifies the EIP-7702
delegate and warns that the on-chain designation can persist after the transfer. You type the displayed code.

**Checks after consent.** The command rechecks the active policy, the saved quote expiry and fee cap, and the safe
account state; it does not request a new sponsor quote. A later safe block is normal: it must be at or after the
prepared block and keep the same EntryPoint and EOA nonces and delegation, with at least the gross USDT balance. The
command then reserves shared usage. One fresh sponsor-authentication batch re-attests sponsor membership and `getHash`
parity at the fresh safe block, followed by a fresh owner-policy, usage and time check before the key is used.

**Key access.** A single-use permit binds the exact operation and wallet identity, expires after 5 seconds and is
consumed under the custody lock before key access. Missing, reused or delayed permits refuse without an automatic extra
read. Payload validity and the 5-second authentication age are checked again after the secret is retrieved, immediately
before each signature. Sponsor membership is point-in-time evidence, not an inclusion guarantee.

**Send.** APN signs locally, independently verifies the signed UserOperation, persists its hash and the `submitting`
state, and then makes one `eth_sendUserOperation` call to the fixed Pimlico endpoint. Execution permits seven read
admissions: four snapshot batches before custody, one authentication batch and two final snapshot batches.

**Failures.**

- If signing or a fresh check fails before `submitting`, the operation is marked `failed_before_effect` and its usage
  reservation is released. Only an operation with no submitting marker can take this path.
- On restart, `execute` repairs any leftover `planned` or `reserved` journal under the effect lock, refuses that old
  operation and requires a new preparation.
- A lost or mismatched send response is `unknown_finality`. Another `execute` never resends.
- A record prepared under different protocol pins is refused before any prompt with `APN_REPREPARE_REQUIRED`
  (`gasless_usdt_protocol_changed`). An expired or changed sponsor quote is refused with `APN_REPREPARE_REQUIRED`
  (`gasless_usdt_quote_expired_or_changed`). Prepare again in both cases.

## Recovery and observation

```sh
apn gasless usdt resume --profile-hash <hash> --operation <operation-id>
apn gasless usdt observe --profile-hash <hash> --operation <operation-id>
```

`resume` observes a submitted hash exactly like `observe`, retires an interrupted unsent `planned` or `reserved`
attempt (releasing its usage hold under the effect lock), and otherwise returns the saved operation. `observe` uses
the original saved hash and a finalized canonical receipt to update the journal. Neither signs nor sends.

One observation pass uses at most one keyless Pimlico read and nine public Ethereum reads, without retry:

- The bundler's receipt is only a locator. When it is missing, unavailable or contradicted by its own finalized
  receipt, APN scans Ethereum's canonical EntryPoint `UserOperationEvent` logs for the exact hash, sender and paymaster,
  from the prepared safe block through the last block that could still include the operation (the signed paymaster
  `validUntil`), in one batch of at most eleven ranges.
- Completion (`finalized`) requires Ethereum chain 1, a transaction receipt in a canonical finalized block, the
  EntryPoint event, and the exact USDT recipient and treasury transfers.
- A confirmed failed UserOperation event (`failed_confirmed_revert`) releases the usage reservation.
- When the scan covers a finalized block after `validUntil` without the event, the operation can never land: it
  becomes terminal `expired_never_landed` and its usage reservation is released.
- Missing or conflicting evidence stays `unknown_finality` and never triggers another send.

Terminal states: `finalized`, `failed_confirmed_revert`, `expired_never_landed`, `failed_before_effect`. Non-terminal:
`prepared`, `submitted_pending`, `unknown_finality`.

A saved record is loaded against its own integrity hashes and the schema it was written with, never against the
current pins. Status, resume, observation and the release of a hold therefore keep working for records written by an
earlier release; only `execute` checks the current pins.

## Compatibility

Operations prepared by earlier releases in the bound-operation v1 format keep their original strict quote, rate and
drift validation and exact bytes. They still load for `status`, but cannot execute: their paymaster payloads expired at
most an hour after preparation. Prepare them again. v1 and current records share one idempotency claim namespace; the
first claim wins.

## For contributors

A read-only mainnet rehearsal runs the production adapters up to the first signature. It loads no key, reads no APN
state, signs nothing and sends nothing. Build the package first:

```sh
APN_ETHEREUM_RPC_URL=<public-ethereum-rpc> node scripts/gasless-usdt-rehearsal.mjs \
  --sender <your-ethereum-address> --to <recipient> \
  --amount 1 --max-fee 0.5 --min-received 0.5
```

`tests/packaging/gasless-usdt-installed.test.mjs` (after `npm run build`) packs APN, installs the archive in a temporary
sandbox and exercises prepare, status, replay, refusals, the execution journal and the read budgets of the installed
package with synthetic inputs. It does not exercise public RPC compatibility, signing, broadcast or a mainnet payment.
