# USDC transfers with gas paid from the amount

`apn gasless` sends canonical USDC on one chain with the network fee covered from the transfer itself or by a
sponsor. The sender needs no native gas balance. It works with an existing local wallet, a Coinbase Agentic Wallet, a
MetaMask Agent server wallet or a MetaMask Smart Account profile. The profile determines the supported networks, fee
calculation and recovery rules described below.

This is a same-chain USDC transfer only. It does not imply gasless x402 or bridge support. Ethereum USDT uses a
separate command group, described in [Gasless USDT on Ethereum](gasless-usdt.md). Avalanche USDT is blocked because
neither keyless sponsor accepts EIP-7702 there.

## Profiles at a glance

| Profile | Networks (chain ID) | Who pays native gas | USDC fee charged to sender |
| --- | --- | --- | --- |
| [Local wallet](#local-wallet-circle-paymaster) | Ethereum 1, Optimism 10, Unichain 130, Polygon PoS 137, Base 8453, Arbitrum One 42161 | Circle USDC paymaster, through a bundler | Actual fee `A`, at most the frozen budget `F` |
| [Local wallet on Avalanche](#local-wallet-on-avalanche-x402-facilitator) | Avalanche C-Chain 43114 | PayAI public x402 facilitator | 0 |
| [Coinbase Agentic Wallet](#coinbase-agentic-wallet-on-base) | Base 8453 | Coinbase CDP paymaster | 0 |
| [MetaMask Agent server wallet](#metamask-agent-server-wallet) | Ethereum 1, Optimism 10, Polygon PoS 137, Monad 143, Sei 1329, Base 8453, Arbitrum One 42161, Linea 59144 | MetaMask relay | Quoted fee `F`, inside your caps |
| [MetaMask Smart Account](#metamask-smart-account) | Base 8453 | Public MetaMask facilitator | 0 |

`apn gasless capabilities` lists the exact adapters, networks, pinned deployments, RPC variables and each profile's
`mainnet_acceptance` state. It reads no wallet, state, Keychain, RPC or provider.

## Rules common to every profile

- There is no default chain, arbitrary token option or native-payment fallback. The USDC address comes from APN's
  verified chain registry. USDC has six decimals; decimal amounts take at most six fractional digits.
- `--amount` is the gross amount, `--max-fee` the most you will pay in USDC fees and `--min-received` the least the
  recipient must get. Each profile below states how it turns these into a fee budget and a recipient amount.
- Preparation never signs or submits. Approval shows the chain, USDC contract, sender, recipient, amounts, fee ceiling
  and any permission granted, then asks for a six-character approval code typed in a foreground terminal. The code is
  derived from the full operation fingerprint, and for MetaMask also from the full operation ID, so it approves only
  that operation. MCP returns the exact CLI handoff and cannot satisfy the approval with injected automation.
- One global idempotency key space and the profile guards cover direct transfers, x402, Solana/TRON, LI.FI and gasless
  operations. Repeating an identical prepare returns the saved operation without another quote or signature; different
  inputs under the same key are refused.
- An approval never sends the same operation twice. A recorded signing, disclosure or send attempt is never repeated by
  approval replay, `operation resume` or any later command.
- A saved operation is checked on every read only against its own fields and hashes. A later APN release that changes a
  protocol pin (for example after a Circle USDC or paymaster upgrade), an asset row or the gas-offer calibration never
  stops `status`, `resume`, `abandon` or another family's commands. Before any new signature, disclosure or send, the
  operation must still match the current registry and offer rules; otherwise it stops with `gasless_protocol_upgraded`
  or `gasless_offer_outdated` and you prepare a new transfer.
- `operation status` and `receipt get` use saved evidence without network access. They may repair local operation or
  receipt records after an interrupted write. Receipts contain hashes and public accounting, never permits,
  signatures, raw UserOperations, encrypted keys, session tokens or provider response text.

## Commands

```sh
apn gasless capabilities [--profile <profile>]
apn gasless balance --profile <profile> --chain <chain-id>
apn gasless transfer quote --profile <profile> --chain 1 --owner <local-owner-address> \
  --to <recipient-address> --amount 0.005 --max-fee 0.004 --min-received 0.001 \
  --rpc-url <public-ethereum-rpc> [--rpc-max-batch-items <2-30>]
apn gasless transfer prepare --profile <profile> --chain <chain-id> --to <recipient-address> \
  --amount <gross-usdc> --max-fee <usdc> --min-received <usdc> --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
apn gasless transfer approve-sealed --operation <operation-id>   # local wallet only, see below
apn gasless transfer revoke --operation <operation-id>           # MetaMask Agent only, see below
apn operation resume --operation <operation-id> [--observation-rpc-env <APN_..._RPC_URL>]
apn operation status --operation <operation-id>
apn operation abandon --operation <operation-id>
apn receipt get --operation <operation-id>
```

`--chain` takes a numeric mainnet chain ID. `--idempotency-key` is 8 to 200 safe ASCII characters. MetaMask server
wallets also accept a fixed-net prepare (`--net-amount-atomic`, `--max-gross-atomic`, `--max-fee-atomic`), described
in their section.

### Ethereum fee quote (read only)

`apn gasless transfer quote` works for the local wallet on Ethereum (`--chain 1`). It reads one verified public RPC
snapshot for the explicit `--owner` and reports the calibrated upper bound in atomic USDC, the input fee cap, the
recipient amount it would prepare (`gross - cap`), gas assumptions, Circle fee configuration, paymaster and block.

- `fee_exceeds_cap`: the quote is valid but above your limits.
- A `fee_calibration` failure: no reliable quote was produced.

The quote reads and changes no local state, reserves no usage, creates no operation, and never signs or sends. Profile
binding, policy, usage and preparation admission are not checked; prepare checks them again. The result is an upper
bound for preparation, not a live execution estimate. `--rpc-url` applies to this invocation only. For a public RPC
that accepts at most three JSON-RPC items per batch, add `--rpc-max-batch-items 3`; the cap applies only to this
quote's Ethereum reads. Chunks run one after another under the 750 ms provider pacing and a 24-request budget, and any
failed chunk fails the whole quote.

## Local wallet (Circle paymaster)

The local path reserves a maximum USDC fee and sends the remainder. Circle's token paymaster supplies native gas; APN
approves and accounts for the fee in canonical USDC. On first use the wallet's address is delegated with EIP-7702 to a
pinned account implementation.

### Networks and RPC configuration

Use an existing local EVM wallet profile and an explicit public HTTPS RPC for the selected chain. APN checks the actual
chain, deployed bytecode, proxy implementation slots, linked signature checker, USDC domain and account state. A changed
or unavailable deployment fails closed.

| Network | Chain ID | USDC | Required RPC variable | Optional bundler variable |
| --- | --- | --- | --- | --- |
| Ethereum | 1 | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | `APN_ETHEREUM_RPC_URL` | `APN_ETHEREUM_BUNDLER_RPC_URL` |
| Optimism | 10 | `0x0b2c639c533813f4aa9d7837caf62653d097ff85` | `APN_OPTIMISM_RPC_URL` | `APN_OPTIMISM_BUNDLER_RPC_URL` |
| Unichain | 130 | `0x078d782b760474a361dda0af3839290b0ef57ad6` | `APN_UNICHAIN_RPC_URL` | `APN_UNICHAIN_BUNDLER_RPC_URL` |
| Polygon PoS | 137 | `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359` | `APN_POLYGON_RPC_URL` | `APN_POLYGON_BUNDLER_RPC_URL` |
| Base | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `APN_BASE_RPC_URL` | `APN_BASE_BUNDLER_RPC_URL` |
| Arbitrum One | 42161 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `APN_ARBITRUM_RPC_URL` | `APN_ARBITRUM_BUNDLER_RPC_URL` |
| Avalanche C-Chain (not executable on this adapter) | 43114 | `0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e` | `APN_AVALANCHE_RPC_URL` | `APN_AVALANCHE_BUNDLER_RPC_URL` |

The Circle USDC paymaster is `0x0578cFB241215b77442a541325d6A4E6dFE700Ec` on every row.

The available Avalanche bundler path does not support EIP-7702, so this adapter cannot run there. The capability matrix
keeps the Avalanche row with `executable_adapter: false`. Existing Avalanche records from this adapter, identical
prepare lookups, status, receipts and permission-invalidation observation remain available. New local transfers on
Avalanche use the [x402 facilitator route](#local-wallet-on-avalanche-x402-facilitator). See
[Pimlico chain support](https://docs.pimlico.io/guides/supported-chains#avalanche).

**RPC.** The RPC must support canonical block-hash state reads and safe-block observation. Credentials in the URL's
user-info and fragments are refused. Endpoint identities are frozen into each intent; changing an endpoint during an
operation does not create permission to submit through the new one.

**Bundler.** The default bundler is the chain's public Pimlico endpoint (`public_bundler_default` in
`apn gasless capabilities`). The [public Pimlico endpoint](https://docs.pimlico.io/references/bundler/public-endpoint)
needs no API key and permits 20 requests per minute per IP, shared with every other call from that IP. A configured
`APN_<NETWORK>_BUNDLER_RPC_URL` must be Pimlico-compatible: every snapshot calls `pimlico_getUserOperationGasPrice`, so
a bundler without that method fails every snapshot. Batch members and HTTP requests count separately; a batch does
not guarantee provider admission.

**Batch size.** APN sends independent RPC reads as JSON-RPC batches. For an endpoint that limits batch size, set
`APN_<NETWORK>_RPC_MAX_BATCH_ITEMS` (2 to 30, for example `APN_BASE_RPC_MAX_BATCH_ITEMS=3`). Every gasless command on
that chain then splits its batches to that size and derives its request budget at that size. An explicit observation
endpoint `APN_X_RPC_URL` takes `APN_X_RPC_MAX_BATCH_ITEMS` the same way.

### Owner policy

On every executable chain, prepare requires an active owner asset policy for the exact local wallet account and that
chain's canonical USDC, as for a direct transfer. The policy must admit the `gasless` rail with positive per-operation
and UTC daily caps and the chain's exact mechanism
`{ "provider": "local", "reference": "eip155:<chain-id>:<Circle paymaster>" }`, for example:

```json
{ "provider": "local", "reference": "eip155:8453:0x0578cFB241215b77442a541325d6A4E6dFE700Ec" }
```

```json
{ "provider": "local", "reference": "eip155:1:0x0578cFB241215b77442a541325d6A4E6dFE700Ec" }
```

- Preparation saves the active policy digest, revision, activation and mechanism.
- Approval reserves the gross amount in the common asset usage ledger before the first signature. APN rechecks the
  active policy and remaining cap before signing, disclosure and dispatch.
- A revoked or replaced policy blocks new effects. An already attempted transfer is then observation only and keeps its
  usage reservation until a proven outcome.
- A confirmed revert replaces the gross reservation with the proven USDC fee; the settlement record keeps that fee
  separate from the zero delivered amount.
- A safe permission invalidation releases usage when the payment was never submitted. Attempted submissions with
  unknown financial results stay reserved.

### Amounts and fee budget

```sh
apn gasless transfer prepare --profile default --chain 8453 \
  --to <recipient-address> --amount 10 --max-fee 0.2 --min-received 9.8 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
apn operation resume --operation <operation-id>
```

This permits a total of 10 USDC, a fee no greater than 0.2 USDC and delivery of at least 9.8 USDC. Preparation checks
that the current paymaster quote fits these limits and freezes the whole fee budget
`F = min(max-fee, amount - min-received)`, here 0.2 USDC. It fixes the recipient amount `N = amount - F`. A paymaster
price increase between preparation and signing does not cancel the transfer while a fresh quote still fits `F`; a
quote above `F` is refused at preparation.

If the actual fee `A` is lower than `F`, the unused `F - A` stays with the sender. The sender's successful debit is
`N + A`; APN does not move the spare fee budget to the recipient later.

A successful first send returns `submitted_pending` (or `unknown_finality` if its response is lost). Run
`operation resume` to observe canonical finality and settlement.

### Gas offer and prices

New operations size each gas field from estimates of the exact first-use UserOperation with at least 20 % margin:

| Chain | Verification | Call | Paymaster verification | Pre-verification, first use | Pre-verification, repeated use |
| --- | --- | --- | --- | --- | --- |
| Ethereum | 75,000 | 130,000 | 485,000 | 100,000 | 125,000 |
| Polygon PoS | 75,000 | 140,000 | 695,000 | 100,000 | 125,000 |
| Optimism, Unichain, Base, Arbitrum One | 100,000 | 200,000 | 500,000 | 150,000 | 125,000 |

Gas prices are set when each step runs, not when the transfer is prepared. The approval screen and the fee permit
freeze your maximum fee in USDC, and the Circle paymaster cannot charge more than that on-chain. After approval, before
each step until the UserOperation is signed, APN reads Pimlico's current prices, takes a priority fee of at least twice
the fast tier, and continues only while the whole offer at those prices fits your maximum fee. The UserOperation is
signed with the prices chosen just before signing. The check before sending still requires those prices to cover the
bundler's current slow tier. The `gas` prices shown in `operation status` are the preparation quote.

### Checks before approval and signing

**Mirror estimate.** Before the approval screen, APN estimates the same UserOperation signed by a throwaway key, with a
state override that gives that key the transfer's USDC. If the estimate does not fit the frozen offer, or the bundler
refuses the override, the operation ends `failed_before_effect` with `gasless_mirror_estimate_bounds` or
`gasless_mirror_estimate_unavailable`. Your key is not loaded, nothing is signed with it and nothing is disclosed. An
operation approved but not yet signed runs the same check on resume before signing.

**Guard snapshots.** Each snapshot groups bundler chain identity, EntryPoint support and the current Pimlico gas-price
quote into one read-only HTTP batch; APN verifies both endpoint chains and EntryPoint support once per snapshot. Each
signing and disclosure boundary still reads current account and protocol state. An approval runs three full snapshots:
before the approval screen (with the mirror estimate), before the bootstrap signature and before the UserOperation
signature. The send is preceded by one bundler batch proving the bundler chain, EntryPoint support and that the signed
prices still cover its slow tier. A seal from an earlier invocation always gets a full snapshot before its disclosure
or send. Each snapshot is three HTTP requests, so a whole approval takes 14; its request budget allows one more guard's
worth of requests for retries.

**Retries.** Inside the approval window, while the retry allowance still pays for the step, a check retries these
transient failures: a quote above your maximum fee, bundler price drift, a provider error, an RPC transport failure, or
a mirror estimate the bundler could not run. One guard retry, one mirror retry or three pre-send price checks fit. A
retry waits 5 seconds and stops while the window still leaves room for the remaining steps; interrupting the command
stops the wait at once. A retry never re-signs, re-discloses or re-sends. An HTTP refusal (such as 429) ends the
invocation at once.

These are never retried: an expired window, a changed owner binding, nonce or paymaster allowance, a balance below the
transfer, and a mirror estimate that does not fit the frozen offer.

A transport failure that never clears is recorded as `gasless_rpc_unavailable`. `gasless_guard_unavailable` means only
an error APN could not classify.

### Permissions the transfer leaves

On first use, approval includes an EIP-7702 delegation of the existing address to the pinned account implementation.
The delegation persists after this transfer; repeated use reuses it without a new authorization tuple. APN also signs
a permit for exactly `F` USDC to the pinned paymaster. The permit and the signed UserOperation have no on-chain expiry;
the five-minute APN deadline limits new APN actions, not the lifetime of already signed material.

The account batch sends exactly `N` USDC and clears the paymaster allowance. A failed transfer can still pay a USDC fee.
The receipt reports the observed prefund, refund, actual charge and residual allowance separately. The residual
allowance is informational: it is read at the latest head (`residual_allowance_read_at`) and never holds a close, so a
safe receipt ends the operation as `completed` or `failed_confirmed_revert` whatever it reads. A later gasless prepare
still refuses a non-zero paymaster allowance (`gasless_allowance_drift`) until the owner clears it. There is no
automatic revocation, extra cleanup transaction or new payment.

### Recovery and proof

```sh
apn operation resume --operation <operation-id>
```

Resume performs one bounded continuation or observation; omit `--wait-seconds`. An approved phase that has never been
attempted can continue before the deadline after fresh checks. Each signing attempt, permit disclosure and submission
has a durable marker. After an interruption, APN loads only the original seal and never repeats a marked estimate or
send. Missing material, lost responses and expiry after a signing marker keep an explicit unresolved state and retain
the profile guard.

**Completion.** The bundler supplies only a candidate transaction location. Completion needs independent canonical RPC
evidence: authenticated outer transaction and block membership, the exact EntryPoint event, USDC prefund, refund and
delivery logs, consumed nonces and the expected delegation. Another owner's operation batched in the same transaction is
allowed; several operations for this owner in one transaction are ambiguous and cannot close this payment. A reverted
outer transaction does not prove that signed permissions can no longer be used.

**Finality.** Polygon PoS uses the RPC `finalized` block (milestone finality); the other networks use `safe`. The saved
`safeBlock` field records this boundary for settlement and permission recovery. Unavailable finality never falls back
to `latest`.

**No archive node needed.** Observation reads no historical state, so a keyless public RPC that keeps only recent state
can close an operation at any later time. Success, revert and fee accounting come from the receipt logs; inclusion is
proven by header membership. The verdict waits until the receipt's block is at or below the safe head (Polygon:
finalized) and that block's hash still matches a header read at its height; a receipt above safe is "not yet" and a
hash mismatch is a reorg, never a terminal. The residual allowance, nonces and delegation are then read at the latest
head, which every keyless node serves even where the safe head trails by more than its state window (Arbitrum,
Unichain); nonces only grow, so they show the consumed permission. An invalidated-permission proof, which has no
receipt to anchor it, still reads the account at the safe head and at the latest head; on a node that refuses safe-head
state it stays unresolved until it can. An already-sent operation is observed through the contracts and protocol hash
saved in its own intent, so a later registry pin update cannot strand it.

**Scan limits.** Canonical recovery scans up to four windows of 256 safe blocks per resume (1,024 blocks), each window
one request of log ranges of at most ten blocks. Failed requests and invalid logs never advance the cursor; a
reorganization can rewind it, and the next observation cannot skip an unread range. The permission-invalidation probe
runs only once the scan has reached the current safe head.

### Invalidating disclosed permissions

If only the permit and the optional delegation authorization were disclosed, the owner can invalidate them outside APN
and then resume the same operation. APN closes it as `failed_permissions_invalidated` only after canonical safe and
current state prove the old permit nonce consumed, the authorization nonce invalid, zero paymaster allowance, an
unchanged EntryPoint nonce and no pending transaction. The original bootstrap seal must be known, and no final
UserOperation signing attempt may exist. Missing or conflicting proof keeps the guard.

This outcome records cleared permissions and that no final payment was submitted. Delivery, token fee/debit and native
cost stay unknown; any externally paid cleanup is separate. The original history is preserved, and a new transfer needs
a new prepare and approval. APN does not perform the external revocation or start another payment.

If a final UserOperation was already sealed, recovery also needs its exact original hash and a canonical scan with no
matching event through the safe block used by the proof. Both safe and current EntryPoint nonces must be greater than
the frozen nonce, in addition to the permit, authorization, allowance and pending-transaction checks. This keeps the old
signed operation from becoming usable again after a future delegation or approval. The resulting
`rpc_safe_final_permissions_invalidated` receipt releases the guard while keeping the original submission-attempt marker
and unknown past financial results. It never reports an unacknowledged attempt as a confirmed submission, successful
payment or zero-cost failure. External recovery fees remain separate.

### Failures before disclosure and owner abandonment

If APN stops after a local signature but before any signed material is disclosed or submitted (for example because a
fee, balance or nonce check fails right after signing), the operation ends `failed_before_effect` and releases the
profile. The sealed material is never sent.

When signed material was disclosed or submitted and the outcome is still unknown after the approval window, the owner
can release the profile with `apn operation abandon --operation <operation-id>`. APN first retries its read-only
observation, then asks for the exact acknowledgement and records terminal `abandoned_unknown` with
owner-acknowledgement-only proof. A signed delegation or UserOperation may still execute later, because the fee permit
and delegation do not expire.

### Fresh consent for an expired sealed operation

`apn gasless transfer approve-sealed --operation <operation-id>` applies only to an expired local Circle USDC
operation whose original bootstrap estimate was checked and whose original UserOperation was signed and sealed once,
with no final disclosure or submission attempt. It loads those same sealed bytes and asks for fresh foreground
confirmation of their exact hash, recipient, amounts, owner policy activation and charged usage reservation. It creates
no signature and repeats no estimate.

The original intent, approval deadline and signatures stay unchanged. A separate hash-bound local approval lasts at
most 120 seconds and requires an eight-character hexadecimal confirmation. Current owner, deployment, nonce, allowance,
balance, fee and policy checks run before and after confirmation, and any drift refuses dispatch. The permanent
first-send marker is written before the network request; expiry while waiting for the paced request, a lost response or
an ambiguous result keeps that marker and requires observation without retry.

Saved approval metadata cannot authorize execution after a process restart. Ordinary `operation resume` for the
expired operation remains observation only. After the first-send marker, `approve-sealed` refuses another attempt; use
normal observation to obtain the canonical receipt and accounting.

### Explicit observation RPC

When the RPC an operation was prepared with is unavailable, a saved Local, MetaMask Agent or Smart Account gasless
operation can be observed through another endpoint:

```sh
export APN_ETHEREUM_RECOVERY_RPC_URL='<verified-public-https-rpc-url>'
apn operation resume --operation <operation-id> \
  --observation-rpc-env APN_ETHEREUM_RECOVERY_RPC_URL
```

- The option names a local environment variable; it does not take a URL. Names must match `APN_[A-Z0-9_]+_RPC_URL` and
  contain at most 128 characters. MCP uses the same optional `observation_rpc_env` field.
- Do not combine it with `--rpc-url` or `--wait-seconds`. Other operation kinds refuse it.
- It only observes. It cannot access signing material, estimate fees, disclose permissions or send a transaction, even
  if an approved phase could otherwise continue. Unavailable or conflicting evidence keeps the guard.
- Local operations: APN verifies the selected chain and the saved intent against its own hashes before accepting
  evidence; no archive state is needed. It uses the canonical EntryPoint scan without a bundler locator and keeps the
  same scan, reorg, receipt, nonce and allowance rules described above.
- MetaMask Agent and Smart Account operations: the option applies only after the original dispatch or exposure. APN
  proves the selected chain and the operation's frozen safe block, then applies the family's usual finality and
  settlement rules. Approval, dispatch, verification and settlement never use the named RPC.

Accepted observations include `observation_source`: the recovery policy, environment variable name, RPC origin, a hash
of the full URL, and the binding to the original intent and preparation block. The URL itself is never stored. The
signed intent, original endpoint identities, sealed material and earlier transitions stay unchanged. A nonterminal
operation's next action repeats the option. Terminal resume, status and receipt calls use saved evidence without
network access.

## Local wallet on Avalanche (x402 facilitator)

A local wallet sends Avalanche C-Chain USDC without holding AVAX. The owner signs one EIP-3009
`transferWithAuthorization` for the exact recipient and amount. PayAI's public x402 facilitator verifies it and submits
the transaction, paying the gas. No token fee is taken: the recipient receives the full amount, and the account keeps no
delegation or allowance afterwards.

| Item | Value |
| --- | --- |
| Chain | Avalanche C-Chain, chain ID 43114 (`eip155:43114`) |
| Token | Native USDC `0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e`, 6 decimals |
| Required RPC variable | `APN_AVALANCHE_RPC_URL` |
| Facilitator | `https://facilitator.payai.network`, free public tier, x402 v2 `exact` |
| Approved relayer | `0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63` |
| Authorization validity | 120 seconds after approval |

```sh
apn gasless balance --profile <profile> --chain 43114
apn gasless transfer prepare --profile <profile> --chain 43114 --to <recipient> \
  --amount 1.5 --max-fee 0 --min-received 1.5 --idempotency-key <key>
apn gasless transfer approve --operation <operation-id>
```

`--max-fee` and `--min-received` keep the shared command shape. This route charges no fee, so any `--min-received` up
to the amount is satisfied.

**Owner policy.** Prepare requires an active owner asset policy for the local wallet account and Avalanche USDC
(`eip155:43114`, `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`) that admits the `gasless` rail with positive
per-operation and UTC daily caps and this exact mechanism:

```json
{ "provider": "payai-x402-facilitator", "reference": "eip155:43114:https://facilitator.payai.network" }
```

Approval reserves the gross amount in the common asset usage ledger before the owner signs and rechecks the unchanged
policy and caps right before the authorization leaves APN. After exposure the full amount stays charged until finalized
evidence proves delivery (`completed`) or an unused, expired authorization (`expired_unused`, which releases the
charge).

**Approval.** Preparation checks the bound local wallet, the chain ID, the USDC balance at a finalized block and the
facilitator's current support for Avalanche `exact` payments with an approved relayer. Approval asks for the
six-character code, repeats those checks, signs in memory and writes a durable marker before the authorization leaves
the process. It calls the facilitator's verify and settle endpoints once each and never repeats them. The signature is
never saved; state and receipts keep only its hash.

**Outcome.** After that marker only chain evidence ends the operation:

- `completed` needs a finalized successful receipt with exactly one `AuthorizationUsed` for the owner and nonce and
  exactly one USDC `Transfer` of the exact amount to the recipient. A settlement batched with other payments in one
  transaction is accepted.
- `expired_unused` needs a finalized block at or after the authorization's `validBefore` in which the nonce is still
  unused. EIP-3009 then rules out any later use.

A verification rejection, a failed settlement or a lost response does not end the operation. Run
`apn operation resume --operation <operation-id>` after the 120-second window to record the outcome. Recovery never
signs or contacts the facilitator. It reads whichever `APN_AVALANCHE_RPC_URL` is configured at that moment, so an
unavailable RPC can be replaced. A transaction hash reported by the facilitator is only a hint; the on-chain
authorization state decides.

An approval interrupted before the marker ends `failed_before_effect`, because nothing left APN. A resume after the
approval deadline ends an unapproved operation the same way. An unresolved operation blocks new transfers from the
same address on Avalanche only.

**Abandonment.** If the RPC cannot prove either outcome (for example, the nonce reads as used but no matching receipt is
found), the owner can release the address with `apn operation abandon --operation <operation-id>`. This is accepted only
once the authorization has expired and one more facilitator timeout (60 seconds) has passed. APN first retries its
read-only recovery, then asks for the exact acknowledgement and records `abandoned_unknown` with
owner-acknowledgement-only proof. The authorization cannot execute after it expires, but whether it executed before
then stays unknown.

## Coinbase Agentic Wallet on Base

Use an existing `coinbase-agentic-wallet` profile bound to the intended AWAL account. Set `APN_BASE_RPC_URL` to an
explicit public HTTPS Base RPC before prepare, approve and resume. APN rechecks the provider address and the frozen
smart-account proxy, implementation and EntryPoint deployment before the single provider invocation.

**Owner policy.** First activate a Base canonical-USDC `gasless` allowlist admission for the same Coinbase account, with
positive per-transfer and daily atomic caps, an exact recipient, and this mechanism:

```json
{ "provider": "coinbase-agentic-wallet", "reference": "awal@2.12.1:send_base_usdc:eip155:8453" }
```

Prepare checks the active policy and combined daily USDC usage before any RPC read and freezes its revision and
activation. Approval rechecks them after the foreground decision, reserves the gross amount in the shared usage ledger,
and checks the policy again before the provider invocation. A revoked, expired, changed or mismatched policy denies a
prepared operation. An uncertain provider effect keeps the reservation until positive terminal settlement; a proven
no-start releases it. Activating the policy does not send a transfer.

```sh
export APN_BASE_RPC_URL='<https-base-rpc-url>'
apn gasless balance --profile coinbase --chain 8453
apn gasless transfer prepare --profile coinbase --chain 8453 \
  --to <recipient-address> --amount 0.001 --max-fee 0 --min-received 0.001 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
apn operation resume --operation <operation-id>
apn operation status --operation <operation-id>
apn receipt get --operation <operation-id>
```

**Accounting.** Coinbase's CDP paymaster pays native gas. A successful transfer is `G = N`, `F = 0`: the sender's
canonical-USDC debit and the recipient's credit both equal `--amount`, the sender's native debit is zero, and no token
fee is deducted. Approval shows these values and asks for the six-character code bound to the operation fingerprint.
`receipt get` names the chain,
Base USDC, its decimals, the sender and the recipient beside the settlement.

**Dispatch.** APN writes `started` before exactly one `awal@2.12.1 send ... --chain base --asset usdc --json` child. A
returned transaction hash, or a single hash found in error text, is only a locator; a missing hash is allowed. After
`started`, approval replay and resume never invoke AWAL again.

**Recovery.** Each resume scans from the durable cursor to the current safe Base head, with `eth_getLogs` windows of up
to 2,000 blocks that halve when the RPC refuses the range (at most 24 log queries per resume). A rate limit stops the
pass and keeps the windows already read. Finite absence advances the cursor but never proves failure or permits
redispatch. Completion requires one independently verified EntryPoint v0.6 UserOperation for the frozen account call,
exact canonical-USDC sender debit and recipient credit, a unique native-fee sponsorship event, transaction/block
membership and safe inclusion, all from the receipt. No historical state is read, so a keyless non-archive RPC can
close the operation. The Coinbase deployment pins gate prepare and approval only. Multiple candidates, reorgs, nonzero
token fees, extra account calls or unavailable evidence keep the guard. Keep the bound Coinbase account exclusive to
this operation until its settlement is terminal.

**Secondary log source.** For a saved operation in `started` or `ambiguous_effect`:

```sh
apn operation resume --operation <operation-id> --rpc-url <frozen-primary-rpc-url> \
  --coinbase-observation-rpc publicnode-base
```

This uses `https://base-rpc.publicnode.com` for the bounded log scans only. The frozen primary RPC still supplies
deployment, state, transaction and receipt evidence. APN cross-checks the secondary chain and the frozen anchor, safe
head and scan boundary hashes, scans the full window for duplicate candidates, and binds the selected source into the
settlement evidence. The option accepts only the fixed `publicnode-base` preset, cannot approve or resend, and cannot be
combined with `--wait-seconds` or other observation options.

## MetaMask Agent server wallet

Use a profile already bound to the intended MetaMask Agent server-wallet address and its existing production session.
The currently selected wallet must resolve to that same address. This path does not create a wallet, change selection,
refresh a login or complete provider MFA. If the session is unavailable, complete the normal provider login separately
and continue the saved operation. Observing a dispatched operation never needs the session.

While an unresolved operation holds the profile, wallet connect for that profile waits for it, so a prepare refused for
a missing session names that operation instead: inspect it with `apn operation status`, and release an outcome still
unknown after its approval window with `apn operation abandon` before connecting again.

### Networks and RPC

| Network | Chain ID | Required RPC variable | Finality |
| --- | --- | --- | --- |
| Ethereum | 1 | `APN_ETHEREUM_RPC_URL` | safe |
| Optimism | 10 | `APN_OPTIMISM_RPC_URL` | safe |
| Polygon PoS | 137 | `APN_POLYGON_RPC_URL` | finalized |
| Monad | 143 | `APN_MONAD_RPC_URL` | safe |
| Sei | 1329 | `APN_SEI_RPC_URL` | safe |
| Base | 8453 | `APN_BASE_RPC_URL` | safe |
| Arbitrum One | 42161 | `APN_ARBITRUM_RPC_URL` | safe |
| Linea | 59144 | `APN_LINEA_RPC_URL` | safe |

MetaMask supplies the relay; no bundler configuration is used. The explicit public HTTPS RPC must provide canonical
block-hash state reads, the listed finality tag, complete transaction/receipt membership and bounded log queries. APN
checks protocol and USDC implementation code at preparation and settlement. Unichain and Avalanche belong to the
local-wallet paths above.

APN has no per-chain default RPC; set the variable explicitly. The following keyless endpoints have met these
requirements (JSON-RPC batches, the `safe` tag or `finalized` on Polygon, state at that block pinned by hash, and a
2,000-block `eth_getLogs`). Public endpoints change without notice; APN reports a refusal and never retries with
another provider.

| Chain | Endpoint | Notes |
| --- | --- | --- |
| Ethereum (1) | `https://ethereum-rpc.publicnode.com` | refuses 2,000-block logs; scans halve the window |
| Optimism (10) | `https://mainnet.optimism.io`, `https://optimism-rpc.publicnode.com` | |
| Polygon PoS (137) | `https://polygon-bor-rpc.publicnode.com` | no `safe` tag; Polygon uses `finalized` |
| Monad (143) | `https://rpc.monad.xyz` | logs limited to 100 blocks; scans halve the window |
| Sei (1329) | `https://evm-rpc.sei-apis.com` | |
| Base (8453) | `https://base-rpc.publicnode.com` | `https://mainnet.base.org` answers "request limit reached" to 2,000-block logs |
| Arbitrum One (42161) | `https://arb1.arbitrum.io/rpc` | publicnode refuses state at the safe head (about 3,000 blocks behind latest) |
| Linea (59144) | `https://rpc.linea.build` | publicnode refuses 2,000-block logs |
| Unichain (130, local wallet) | `https://mainnet.unichain.org`, `https://unichain-rpc.publicnode.com` | |

`*.drpc.org` endpoints refuse JSON-RPC batches of more than three requests and do not fit these paths.

### Amounts and fees

**Exact gross (`--amount`).** `--amount` is the exact successful sender debit `G`. APN quotes the provider's USDC fee `F`
and recipient amount `N`, requiring `G = N + F`, `F <= --max-fee` and `N >= --min-received`, with at most three quote
attempts to reach that equality. There is no unused amount or refund for a successful exact-gross batch. The recipient
and the fee recipient must both differ from the sender and from each other.

```sh
apn gasless balance --profile metamask --chain 8453
apn gasless transfer prepare --profile metamask --chain 8453 \
  --to <recipient-address> --amount 10 --max-fee 0.2 --min-received 9.8 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
```

**Fixed recipient net.** MetaMask server wallets also accept an exact recipient amount with explicit ceilings:

```sh
apn gasless transfer prepare --profile metamask --chain 42161 \
  --to <recipient-address> --net-amount-atomic 1000 \
  --max-gross-atomic 25000 --max-fee-atomic 24000 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
```

These three atomic options are required together and cannot be combined with `--amount`, `--max-fee` or
`--min-received`; other wallet adapters refuse this mode. All quantities are integer USDC atoms. Preparation quotes the
exact net once and computes the estimated debit as net plus fee. Confirmation quotes that same net again; the fee and
actual debit may change only inside both approved ceilings. Current safe and head balances must cover the actual debit.
The approval screen shows the fixed net, estimated debit and fee, both ceilings and the original expiry.

Fixed-net operations expose `requested_fixed_net_atomic` and `maximum_gross_atomic`; `gross_atomic` is the prepared
estimate before dispatch and the actual dispatched estimate afterwards. (In the saved request, `request.fixedNet` holds
`netAtomic` and `maxGrossAtomic`, `grossAtomic` is the maximum owner budget and `preparedGrossAtomic` binds the original
snapshot to its quoted debit.) A completed receipt proves that debit equals delivered net plus fee and reports
`unused_gross_atomic` as maximum gross minus actual debit. That unused budget stays in the wallet; it is not a refund or
an additional transfer.

**Repricing.** What you approve is `--max-fee` and `--min-received` (or the fixed-net ceilings), not one exact price.
The quote is taken again after your approval, and a fee that has moved is accepted while it stays inside `--max-fee`
and still leaves the recipient at or above `--min-received`. A repriced batch has its delegation re-derived; that
repriced batch and delegation are what the durable dispatch marker records and the single provider POST carries. The
approved intent itself never changes, so the fingerprint you confirmed stays the same.

A fee above the owner's cap (the lower of `--max-fee` and `--amount` minus `--min-received`; in fixed-net mode
`--max-fee-atomic` and `--max-gross-atomic` minus `--net-amount-atomic`) refuses with
`APN_FEE_BUDGET_EXCEEDED / mm_gasless_fee_cap`, naming the quoted fee, the cap, the network and the option that set it,
and dispatches nothing. At prepare its next action offers a higher cap only if you accept that fee.

### Prepare refusals

Each of these ends a prepare before anything is written:

- `APN_PROVIDER_CAPABILITY_UNAVAILABLE / mm_gasless_relay_unsupported`: MetaMask's relay lists do not offer the chain.
  The refusal names the list that withholds it: the server-wallet network list
  (`agentic-mimir-service …/v1/supportedNetworks`, `mm_read_relay_server_wallet_network`) or the relay network list
  (`tx-sentinel-ethereum-mainnet/networks`, the chain's `relayTransactions` flag, `mm_read_relay_sentinel_flag`).
- `APN_PROVIDER_CAPABILITY_UNAVAILABLE / mm_gasless_fee_unquoted`: MetaMask's fee quote (`tx-sentinel-<network>`,
  `infura_simulateTransactions`) answered without `result.transactions[-1].fees[0].tokenFees`. APN never reads that
  alone as a USDC shortfall. When the same low fee tier carries an error and its own native gas terms prove a shortfall
  (`balanceNeeded` equals `gas` x `maxFeePerGas` exactly and exceeds `currentBalance`), the refusal states the native
  gas required and held, in wei and in the network's native unit (`mm_read_native_*`,
  `provider_cause: native_gas_below_required`); otherwise it says no cause is proven (`provider_cause: unverified`).
  Neither points at USDC, and APN never sends the transfer with native gas instead. The refusal also carries the
  answer's closed facts (the simulated transfer's status, whether the fee tier carried an error, and the sponsorship
  flag); the provider's own text is never shown.
- `APN_INSUFFICIENT_USDC / mm_gasless_balance`: the quote priced the relay, but APN's own `balanceOf` read of the server
  wallet is below the net amount plus the quoted fee (raised 5% on Ethereum, as the pinned client signs it), either at
  the fee quote or at APN's chain snapshot right after it (named with its safe or latest block). The refusal carries
  both numbers (`usdc_current_atomic`, `usdc_required_atomic`); its next action is `apn gasless balance` for the same
  profile and chain. A snapshot whose pins or shape do not hold is `APN_RPC_PROTOCOL / mm_gasless_evidence_invalid`.

Any other malformed quote is `APN_PROVIDER_UNAVAILABLE / mm_gasless_provider_unavailable`.

### Login project and server wallet

MetaMask keeps server wallets per project, and `mm` keeps its cached wallet list across logins, so a login can select a
wallet its own project does not hold. Before any other provider read of a quote, APN reads the session project's wallet
list (`GET agentic-mimir-service …/v1/projects/{projectId}/wallets` with the session's own token). That happens at
prepare and again in the fresh quote approve takes before the dispatch marker, so a refusal comes before anything is
signed or sent:

- `APN_PROVIDER_SESSION_REQUIRED / mm_gasless_project_has_no_wallets`: the project has no server wallet (the list
  answered 404 or names no EVM wallet).
- `APN_PROVIDER_SESSION_REQUIRED / mm_gasless_wallet_not_in_project`: the project's EVM server wallets do not include the
  connected one. The refusal gives their count (`mm_read_project_wallet_count`), never their addresses.

Any other answer (another HTTP status, a malformed list, a timeout) is `APN_PROVIDER_UNAVAILABLE /
mm_gasless_provider_unavailable`, naming the read (`mm_read_network: project-wallets`) and any HTTP status
(`mm_read_http_status`); the transfer does not continue.

The next actions spell out two ways forward, with `mm` written as the pinned client APN runs (Homebrew links only
`apn`):

1. To keep paying from the connected wallet, sign in to MetaMask with the account that created it (`mm logout`, then
   `mm login`, then `mm wallet select` with that address if the account holds several wallets) and connect the profile
   again with `apn wallet connect`. The address stays the same, so no revision is needed.
2. Pay from another wallet of the current project: a new address, so its `apn wallet connect` names the profile's
   current revision with `--expected-revision`, and funds on the old address stay with the login that created it. In a
   project with no server wallet, `mm init --wallet server-wallet --mode guard --json` creates its first one. In a
   project that already has some, `mm init` creates none: it selects one of them and keeps that wallet's server-side
   trading mode, so list them with `mm wallet list` and pick one with `mm wallet select`.

A refusal at approve ends the operation `failed_before_effect`, and that approve output names the same two ways
forward. While another unresolved operation holds the profile, its steps come first, because wallet connect waits for
it.

### Approval and the checks before dispatch

Approval shows the exact USDC debit, recipient amount, quoted fee, fee ceiling, minimum receipt and persistent
permission, then asks for the six-character approval code printed on the same screen. The code is bound to the full
operation ID and fingerprint.

Take as long as you need on that screen. Every check between your approval and the dispatch marker is taken again at
that moment: the provider binding and policy, the RPC endpoint identity, the chain state at the pinned safe and head
blocks, the unconsumed one-use permission counter and the price. The preparation snapshot is kept as identity and
designation evidence only. Only the five-minute deadline bounds the approval, and 15 seconds of it are reserved for the
dispatch itself.

Inside that window a transient failure is waited out rather than ending the operation: up to 18 attempts, 5 seconds
apart, for a provider or RPC transport failure (`mm_gasless_provider_unavailable`, `mm_gasless_rpc_unavailable`), a
concurrent MetaMask CLI write to its own session files (`mm_gasless_state_busy`), a quote that will not converge
(`mm_gasless_quote_unstable`) and a fee above `--max-fee` that may fall back inside it (`mm_gasless_fee_cap`). Waiting
stops as soon as the remaining window no longer covers another pause plus the reserve, and Ctrl-C ends it at once.

A definite refusal is never retried: an expired or non-monotonic clock, a changed provider binding or policy, a changed
RPC endpoint, a changed designation, a consumed permission and a USDC balance below `--amount` all end the operation
immediately, before any effect. A check that could not complete at all is recorded as
`APN_PROVIDER_UNAVAILABLE / mm_gasless_guard_unavailable`; `mm_gasless_internal` means only that APN could not classify
a failure.

### Dispatch and the permission it leaves

The provider signs and executes the two transfers (recipient and fee) as one exact batch. It may install or preserve the
pinned EIP-7702 designation on the same wallet address, and that designation can remain afterwards. The permission
allows one successful batch and has no on-chain expiry. APN's five-minute deadline limits only the first dispatch; a
timeout, revert or later expiry does not revoke the permission or guarantee that no payment can occur.

APN records a durable dispatch marker before its single provider POST. The marker carries the repriced quote and
delegation when the guard repriced, so every later observation, settlement proof and receipt is read against the batch
that was actually dispatched. After the marker, repeated approval or `operation resume` only observes the dispatched
request and delegation. Lost responses, provider failures and pending MFA stay unresolved. A canonical revert is
`failed_effects_pending` and keeps the profile guard, because the permission may still be redeemed later. Only an
independently proved completion, a proved failure before any effect, or a disabled delegation (below) is terminal.

Unresolved operations block competing payments and wallet lifecycle changes for the profile. A new MetaMask Agent
gasless transfer also waits for unresolved operations of every other APN profile bound to the same server-wallet
address on that chain: once the account carries the pinned designation, an earlier signed delegation could be redeemed,
so the account is held, not just the profile. Public output contains hashed provider identities and accounting, never
the private request UUID, session token, unsigned wire or provider response.

### Submit diagnostic (`submit_diagnostic`)

A dispatch that ends `unknown_finality` with `mm_gasless_submit_unknown` stays unknown: APN cannot prove the relay
request never arrived. The output of that same `approve` or `resume` call carries `submit_diagnostic`, which is never
stored. It contains closed facts only; no body, URL, header or identifier is included.

| Field | Meaning |
| --- | --- |
| `stage` | The helper stage the submit stopped at. |
| `post` | Whether the single POST could have left (values below). |
| `http_status` | The POST's HTTP status, when it was sent and answered. |
| `check` | The check that refused: APN's body or response checks, a duplicate or unexpected request, the deadline or clock, the session, an answer outside 2xx, no usable answer after it left, or the helper runner. |
| `provider_error` | MetaMask's error code from a non-2xx answer, when it is a short upper-case token. |
| `provider_status` | An unrecognized job status from a 2xx answer, when it is a short upper-case token. |

| `post` | Meaning |
| --- | --- |
| `not_reached` | No POST could have left: APN's own checks stopped before it, or no helper process started. |
| `refused` | APN's body check refused the request before sending it. |
| `sent` | The request may have reached MetaMask. |
| `unknown` | A helper that ran failed, so the request may or may not have left. |

Only `not_reached` and `refused` rule out a payment. On any other value, never prepare the transfer again; resume the
same operation.

### MFA and provider outcomes

If MetaMask requires MFA, the operation reports `mm_gasless_provider_approval`. Confirm the existing transaction in
MetaMask Mobile or through the email registered to your MetaMask dashboard, then resume the same operation. APN does not
approve provider policy changes. The operation stays guarded while confirmation is pending; neither another CLI approval
nor resume sends a second request. Provider metadata, approval links and signatures are discarded from public output.

If MetaMask then closes that request as `DENIED` or `EXPIRED`, the operation reports `mm_gasless_provider_mfa_rejected`:
by MetaMask's job order the request closed at the MFA step, before signing. That is the provider's word, not proof that
no signature exists, so the operation stays guarded until a proved outcome or owner abandonment. A `FAILED` or
`BROADCAST_FAILED` request, or a `DENIED` or `EXPIRED` one that never reported MFA, stays `mm_gasless_provider_failed`.
Once MetaMask reports a closed status, a later failed provider read (such as an expired session) keeps that status and
reason instead of replacing it with `mm_gasless_provider_unavailable` or `mm_gasless_session_unavailable`.

### Recovery

Continue with `apn operation resume --operation <operation-id>`, without `--wait-seconds`, including after the APN
deadline. A provider status or hash is only a hint. Completion requires the independently authenticated transaction,
canonical receipt and finality, the exact two-call batch, the consumed permission, USDC delivery/fee/debit and the
outer gas payer. A temporarily unusable clock or full history keeps the saved guard and cannot authorize another
dispatch.

**One-use counter first.** Each resume after dispatch first reads the delegation's one-use counter
(`LimitedCallsEnforcer.callCounts` for the pinned DelegationManager) and the enforcer code at the finality block, pinned
by block hash. The counter only rises, and only inside a successful redemption of this exact delegation, so a count of 0
proves that no redemption exists up to that block and APN moves its scan cursor there without any `eth_getLogs`
request.

**Log search.** Only once the count is 1 does APN search the logs, in windows of at most 2,000 blocks from the cursor
and at most eight `eth_getLogs` requests per resume. A window the RPC refuses as too wide, or rate-limits, is halved
and asked again, down to 62 blocks. A refusal at that width ends the resume as `mm_gasless_rpc_log_range` or
`mm_gasless_rpc_rate_limited`; a transport failure is `mm_gasless_rpc_unavailable`. In every case the blocks already
proved in that resume stay proved, and the next resume continues from there.

**Disabled delegation.** Each resume whose redemption count reads 0 at the finality block also reads
`disabledDelegations(<delegation hash>)` on the pinned manager at that same block, pinned by hash, against the manager's
pinned code. When it is set, the operation becomes `revoked_unused` (terminal, reason `mm_gasless_delegation_disabled`,
`one_use_status: disabled_unused`), its account and profile holds are released and nothing is sent. Only the delegator
(the server wallet itself) can call `DelegationManager.disableDelegation`; from then on every `redeemDelegations` of
that hash reverts (`CannotUseADisabledDelegation`). The delegation can be redeemed again only if that same wallet calls
`enableDelegation`, which is a new act of the owner's wallet, not of APN or a relayer.

**History capacity.** A resume whose result differs from the saved one only in when it was read writes nothing. The
operation history holds 96 transitions and keeps the last slot for the terminal transition, so a long-unresolved
operation can always still complete or be abandoned. Once only that slot is left, resume keeps observing: a proved
completion is saved, and any other result is reported as `transient_observation` with a `mm_gasless_record_capacity`
warning instead of being saved.

### Owner abandonment

A MetaMask Agent transfer whose outcome is still unknown after its approval window can be released with
`apn operation abandon --operation <operation-id>` after the exact acknowledgement. APN records `abandoned_unknown`;
MetaMask may still relay the transfer later, because its delegation has no on-chain expiry. The confirmation screen
shows the gross of the batch actually dispatched; for a fixed-net transfer it also shows the approved ceiling.

Abandonment is an acknowledgement, not an outcome. `apn operation resume` still observes an abandoned dispatch (the
provider status of the original request, then the chain), and a proof replaces it: the redemption (`completed`, with
its exact delivery and fee) or the delegation disabled before any redemption (`revoked_unused`). Anything else is shown
as `transient_observation` and is not saved over the acknowledgement. When an observation went through
`--observation-rpc-env`, the next action of the still unresolved operation repeats that option.

### Disabling a disclosed delegation

When MetaMask closed the request (`FAILED`, `DENIED`, `EXPIRED`), the relay reverted, or you abandoned the operation, the
delegation may still be redeemed and only a proof ends that. Your exit is to disable it from the server wallet itself:

```sh
apn gasless transfer revoke --operation <operation-id>
apn operation resume --operation <operation-id>
```

`revoke` reads, at the finality block pinned by hash, that the delegation is neither redeemed nor disabled, and that the
pinned DelegationManager hashes the call's delegation tuple (`getDelegationHash`) to the operation's delegation hash.
It then prices exactly `DelegationManager.disableDelegation(<that delegation>)` from the server wallet at the latest
block (`eth_estimateGas`, pending nonce, 2 x base fee + priority fee, and on OP-stack chains the L1 data and operator
fee upper bounds). It refuses with `APN_INSUFFICIENT_GAS` and the exact amount to send when the wallet's native balance
is below that maximum.

The foreground screen shows the call, the nonce, the gas fields and the maximum native cost. After the six-character
code, APN checks that the wallet's selected server wallet is the delegator, and the MetaMask Agent Wallet
(`mm wallet send-transaction`) signs and broadcasts the call after its own Guard policy and MFA. The call moves no USDC.
The pinned nonce lets one such call land; a second disable reverts (`AlreadyDisabled`). Nothing is written to the
operation: the chain is the record. `operation resume` then proves the outcome: `revoked_unused` when the delegation is
disabled with no redemption, or `completed` when the redemption landed first. MCP returns the CLI handoff.

The `revoke` output reports `submission`:

- `acknowledged`: with the transaction hash.
- `pending`: MetaMask waits on your MFA.
- `unknown`: never a reason to disable again; `operation resume` reads the chain. Its `reason` says what APN saw
  (`provider_response_empty` when `mm` wrote nothing to stdout, `provider_response_malformed`,
  `provider_handoff_outcome_unknown`).

`provider` records the `mm` child process as APN received it, before its bytes are zeroed: the admitted package version
and shasum, outcome, exit code or signal, duration, and for stdout and stderr the byte count, the SHA-256 of a complete
capture and each JSON frame's keys and value types. Values are shown only for `ok`, `code`, `kind`, `status`, `mode` and
`chainNamespace`; ids, addresses, hashes and messages never appear. Eligible operations list
`apn gasless transfer revoke` among their next actions.

## MetaMask Smart Account

Use an existing `metamask-smart-account` profile with its original Base owner, session key and active periodic USDC
permission. Set `APN_BASE_RPC_URL` to an explicit public HTTPS Base RPC (see the
[endpoint table](#networks-and-rpc) above). The RPC must support numeric block reads, `safe` and `finalized` blocks,
complete transaction receipts and bounded logs. APN checks the current permission nonce, available allowance, owner USDC
balance, session state and pinned contract deployments before signing and disclosure. No new grant, account deployment
or native funding is part of this command. Other networks are not executable through this adapter.

The public MetaMask facilitator pays native gas. The fee is zero: the owner's debit and the recipient's credit both
equal `--amount` (`G = N`, `F = 0`). The owner and session need no native balance.

```sh
apn gasless balance --profile smart-account --chain 8453
apn gasless transfer prepare --profile smart-account --chain 8453 \
  --to <recipient-address> --amount 1 --max-fee 0 --min-received 1 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
```

Preparation saves the exact transfer and its five-minute deadline without signing. Foreground approval shows the owner,
session, recipient, USDC amount, zero fee, existing root permission and expiry, and asks for the six-character approval
code bound to the full operation ID and fingerprint. MCP supplies the same foreground CLI handoff.

APN signs one child permission for the exact transfer. The child has an on-chain expiry and does not replace the
existing root permission. Verification discloses this signed child to the facilitator; a failed verification, lost
response or timeout does not prove that it cannot be used. APN durably records each signing, disclosure and settlement
attempt before that boundary.

After disclosure, `apn operation resume --operation <operation-id>` only reads independent RPC evidence; omit
`--wait-seconds`. Resume does not sign again or repeat verification or settlement, even if the previous response was
lost. It can recover without an active session or grant. The operation keeps its profile guard until an independently
proved completion or unused expiry.

Completion requires the authenticated signed outer transaction, exact child and root redemption, a canonical safe
receipt, USDC delivery and spent amount, and an external native gas payer. Provider responses and transaction hashes are
only hints. Unused expiry (`expired_unused`) requires a complete canonical scan, finalized expiry and zero child
spending; elapsed wall time alone cannot release the guard. Interrupted scans continue from the saved cursor.

Status and receipt commands read local evidence and omit signed permissions, session secrets and provider response
bodies. Unknown amounts remain unknown.

## State and upgrades

The gasless journal, receipts and encrypted effects use separate files under the existing APN state directory; wallet
and earlier operation formats are preserved. Reinstalling or upgrading must preserve that directory and its existing
wrapping secret. Recover an unresolved operation with the same release that wrote it or a compatible newer one; an older
binary does not provide gasless recovery. Do not delete unresolved state or create a replacement payment to work around
it. `apn operation status` and `apn operation resume` read the saved journal without running any other binary.

## Reason codes

| Code | Profile | What it means / what to do |
| --- | --- | --- |
| `gasless_protocol_upgraded`, `gasless_offer_outdated` | Local | A pin or offer rule changed since preparation. Prepare a new transfer. |
| `fee_exceeds_cap`, `fee_calibration` | Local quote | The quote is above your limits, or no reliable quote was produced. |
| `gasless_mirror_estimate_bounds`, `gasless_mirror_estimate_unavailable` | Local | The pre-approval estimate did not fit, or the bundler refused it; ended `failed_before_effect`, nothing signed. |
| `gasless_rpc_unavailable` | Local | An RPC transport failure did not clear within the retry allowance. |
| `gasless_guard_unavailable` | Local | An error APN could not classify. |
| `gasless_allowance_drift` | Local | A non-zero paymaster allowance remains; clear it before a new prepare. |
| `mm_gasless_fee_cap` | MetaMask | The quoted fee is above your cap; nothing was dispatched. |
| `mm_gasless_relay_unsupported`, `mm_gasless_fee_unquoted`, `mm_gasless_balance` | MetaMask | Prepare refusals, see [Prepare refusals](#prepare-refusals). |
| `mm_gasless_project_has_no_wallets`, `mm_gasless_wallet_not_in_project` | MetaMask | The `mm` login's project does not hold the connected wallet; nothing was sent. See [Login project and server wallet](#login-project-and-server-wallet). |
| `mm_gasless_submit_unknown` | MetaMask | The dispatch outcome is unknown; read `submit_diagnostic` and resume. |
| `mm_gasless_provider_approval` | MetaMask | Confirm the transaction through MetaMask MFA, then resume. |
| `mm_gasless_provider_mfa_rejected`, `mm_gasless_provider_failed` | MetaMask | The provider closed the request; still guarded until proof. Consider `revoke`. |
| `mm_gasless_rpc_log_range`, `mm_gasless_rpc_rate_limited`, `mm_gasless_rpc_unavailable` | MetaMask | The RPC refused or failed during recovery; resume continues from the proved cursor. |
| `mm_gasless_delegation_disabled` | MetaMask | The delegation was disabled before any redemption; `revoked_unused`, holds released. |
| `mm_gasless_record_capacity` | MetaMask | History is full except the terminal slot; observations are reported, not saved. |
| `APN_INSUFFICIENT_GAS` | MetaMask `revoke` | Send the stated native amount to the server wallet, then retry `revoke`. |

## Compatibility

These notes matter only for operations prepared by older releases.

- **Policy binding.** Local operations without an owner policy binding (Base and Ethereum prepared before the allowlist
  existed; the other chains and Avalanche facilitator operations prepared before APN 0.5.42) cannot be approved or
  replayed. Signed or exposed ones remain available for observation.
- **Fee budget.** Local operations prepared by APN 0.5.13 or earlier froze the exact quote instead of the whole fee
  budget `F`.
- **Wire formats.** Saved local operations keep their original wire, hash and recovery semantics; upgrading does not
  replace their approvals or signed material. Wire v2 and v3 operations keep their original gas offers and the prices
  frozen at preparation from the fast tier; before each effect those frozen fields must still cover a fresh slow tier,
  and a higher current fee stops the action without changing its approved budget.
- **Revert closes.** Local records written before APN 0.5.43 may remain `failed_effects_pending`; the next observation
  closes them.
- **Receipts.** A receipt saved by an earlier release whose only difference from today's projection is the proof class
  it named is accepted and repaired the next time the operation is read.
- **Observation RPC.** `--observation-rpc-env` needs APN 0.5.12 or later for Local operations and 0.5.16 or later for
  MetaMask Agent and Smart Account operations. Readers from 0.5.11 and earlier reject records containing the
  `observation_source` field, so do not downgrade below 0.5.12 once an operation has been observed this way.
- **MetaMask Agent records.** Operations written before the reprice guard existed have no dispatched-material field;
  they load unchanged and are read as never repriced. A history that an earlier release filled to 96 nonterminal
  transitions still loads and still takes its one terminal transition. Receipts written before `revoke` or the
  observation-RPC option appeared in next actions remain valid.
