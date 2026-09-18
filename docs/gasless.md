# USDC transfers with gas paid from the amount

Use an existing local wallet, Coinbase Agentic Wallet, MetaMask Agent server wallet or MetaMask Smart Account profile to send
canonical USDC with the fee included in the amount. The sender needs no native
gas balance. The selected profile determines the supported networks, fee
calculation and recovery rules described below.

APN 0.5.22 includes this capability. Package availability, mainnet transfer
evidence and receiving human acceptance are tracked separately for each profile
and network. `apn gasless capabilities` reports the exact adapter and acceptance
state without reading a wallet,
Keychain, RPC or provider. MetaMask Smart Account is admitted on Base only.
Coinbase Agentic Wallet is executable for canonical Base USDC through its existing profile.
This same-chain transfer does not establish gasless x402 or bridge support.

## Local wallet networks and configuration

The local path reserves a maximum USDC fee and sends the remainder. Circle's
token paymaster supplies native gas; APN approves and accounts for the fee in
canonical USDC.

Use an existing local EVM wallet profile and an explicit public HTTPS RPC for
the selected numeric chain ID. APN checks the actual chain, deployed bytecode,
proxy implementation slots, linked signature checker, USDC domain and account
state. A changed or unavailable deployment fails closed.

| Network | Chain ID | Required RPC environment | Optional bundler environment |
| --- | --- | --- | --- |
| Ethereum | 1 | `APN_ETHEREUM_RPC_URL` | `APN_ETHEREUM_BUNDLER_RPC_URL` |
| Optimism | 10 | `APN_OPTIMISM_RPC_URL` | `APN_OPTIMISM_BUNDLER_RPC_URL` |
| Unichain | 130 | `APN_UNICHAIN_RPC_URL` | `APN_UNICHAIN_BUNDLER_RPC_URL` |
| Polygon PoS | 137 | `APN_POLYGON_RPC_URL` | `APN_POLYGON_BUNDLER_RPC_URL` |
| Base | 8453 | `APN_BASE_RPC_URL` | `APN_BASE_BUNDLER_RPC_URL` |
| Arbitrum One | 42161 | `APN_ARBITRUM_RPC_URL` | `APN_ARBITRUM_BUNDLER_RPC_URL` |
| Avalanche C-Chain (this adapter unavailable) | 43114 | `APN_AVALANCHE_RPC_URL` | `APN_AVALANCHE_BUNDLER_RPC_URL` |

The admitted Avalanche bundler path does not support EIP-7702, so this Circle
paymaster adapter cannot run there. The capability matrix keeps its Avalanche
row with `executable_adapter: false`; the executable list for this adapter
contains six chains. Existing Avalanche records from this adapter, identical
prepare lookups, status, receipts and permission-invalidation observation remain
available. New Local transfers on Avalanche use the
[x402 facilitator route](#local-wallet-on-avalanche-x402-facilitator) instead.
See [Pimlico chain support](https://docs.pimlico.io/guides/supported-chains#avalanche).

The default bundler is the selected chain's public Pimlico endpoint. The
registry exposes its exact URL. The RPC must support canonical block-hash
state reads and safe-block observation. Credentials in user-info and URL
fragments are rejected. Endpoint identities are frozen into each intent;
changing an endpoint during an operation does not create permission to submit
through the new endpoint.

The [public Pimlico endpoint](https://docs.pimlico.io/references/bundler/public-endpoint)
requires no API key and permits 20 requests per minute per IP. Other calls from
the same IP share that limit. APN verifies both endpoint chains and EntryPoint
support once within each fresh snapshot; balance, preparation and execution
guards do not repeat that snapshot's network checks. Each signing and disclosure
boundary still reads current account and protocol state. This reduces request
volume without changing the approved operation or allowing submission retries.
Each snapshot groups bundler chain identity, EntryPoint support and the current
Pimlico gas-price quote into one read-only HTTP batch. v2 and v3 offers freeze
both fee fields at preparation from the fast tier. Before each effect, those
frozen fields must still cover a fresh slow tier. A higher current fee stops the
action without changing its approved budget. v4 operations take fresh prices at
each step until signing, as described below.
Configured bundlers must support this batch and gas-price API. Batch members and
HTTP requests are separate counts; a batch does not guarantee provider admission.

### Offers, fee headroom and the pre-signing check

New local operations freeze wire format v4. Its offer sizes each gas field from
estimates of the exact first-use UserOperation measured on 2026-09-15, with at
least 20 % margin.

| Chain | Verification | Call | Paymaster verification | Pre-verification, first use |
| --- | --- | --- | --- | --- |
| Ethereum | 75,000 | 130,000 | 485,000 | 100,000 |
| Polygon PoS | 75,000 | 140,000 | 695,000 | 100,000 |

Circle's paymaster verification on Polygon needs about 576,000 gas, which the
earlier 500,000 offer could not cover. A repeated use keeps 125,000
pre-verification. Base, Arbitrum One, Optimism and Unichain keep their earlier
sizes. Saved v2 and v3 operations keep their original offers and validation.

New operations set gas prices when each step runs, not when the transfer is
prepared. The approval screen and the fee permit freeze your maximum fee in
USDC, and the Circle paymaster cannot charge more than that on-chain. After
approval, before each step until the UserOperation is signed, APN reads
Pimlico's current prices. It takes a priority fee of at least twice the fast
tier and continues only while the whole offer at those prices fits your maximum
fee. The UserOperation is signed with the prices chosen just before signing.
The check before sending still requires those prices to cover the bundler's
current slow tier. For these operations, the `gas` prices in the operation
status are the preparation quote.

A quote above your maximum fee is refused at preparation.

After approval, every check retries a transient failure inside the approval
window: a quote above your maximum fee, bundler price drift, a rate limit, a
provider error, an RPC transport failure, or a mirror estimate the bundler
could not run. A retry waits 5 seconds, takes at most 18 checks, and stops
while the window still leaves room for the remaining steps. Interrupting the
command stops the wait at once. A retry never re-signs, never re-discloses and
never re-sends.

These refusals are never retried: an expired window, a changed owner binding,
nonce or paymaster allowance, a balance below the transfer, and a mirror
estimate that does not fit the frozen offer.

A transport failure that never clears is recorded as `gasless_rpc_unavailable`.
The older `gasless_guard_unavailable` now means only an error APN could not
classify.

A receipt saved by an earlier release, whose only difference from today's
projection is the proof class it named, is accepted and repaired the next time
the operation is read. Saved v2 and v3 operations keep the prices frozen at
preparation.

Before the approval screen, APN estimates the same UserOperation signed by a
throwaway key, with a state override that gives that key the transfer's USDC.
If the estimate does not fit the frozen offer, or the bundler refuses the
override, the operation ends as `failed_before_effect` with
`gasless_mirror_estimate_bounds` or `gasless_mirror_estimate_unavailable`.
Your key is not loaded, nothing is signed with it and nothing is disclosed. An
operation that was approved but not yet signed runs the same check on resume
before signing.

There is no default chain, arbitrary token option or native-payment fallback.
The USDC address comes from the verified chain registry. USDC has six decimals;
amount inputs use ordinary decimal notation with at most six fractional digits.

USDT on Ethereum uses a separate engine. Pimlico's keyless ERC-20 paymaster takes its fee in USDT. The CLI does not
use this engine yet; see [Gasless USDT on Ethereum](gasless-usdt.md). Avalanche USDT is blocked because neither
keyless sponsor accepts EIP-7702 there.

## Shared commands

```sh
apn gasless capabilities
apn gasless balance --profile default --chain 8453
apn gasless transfer prepare --profile default --chain 8453 \
  --to <recipient-address> --amount 10 --max-fee 0.2 --min-received 9.8 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
apn operation status --operation <operation-id>
apn receipt get --operation <operation-id>
```

The example permits a total amount of 10 USDC, a fee no greater than 0.2 USDC
and delivery of at least 9.8 USDC. For a local wallet, preparation checks that the current
paymaster quote fits these limits and freezes the whole fee budget
`F = min(max-fee, amount - min-received)`, here 0.2 USDC. It fixes recipient amount
`N = 10 - F`. A paymaster price increase between preparation and signing does not
cancel the transfer while a fresh quote still fits `F`; operations prepared by
APN 0.5.13 or earlier froze the exact quote instead. If the actual fee `A` is lower than
`F`, the unused `F - A` stays with the sender. The sender's successful debit
is `N + A`; APN does not move the spare fee budget to the recipient later.

Preparation does not sign or submit. Approval displays the exact chain, USDC
contract, sender, recipient, total budget, recipient amount, fee ceiling and
permissions. The human types the displayed six-character approval code in a
foreground terminal. The code is derived from the full operation fingerprint,
and for MetaMask also from the full operation ID, so it approves only this
operation. MCP returns that exact
CLI handoff and cannot satisfy this approval with injected automation.

The same global idempotency key and profile guards cover direct transfers,
x402, Solana/TRON, LI.FI and gasless operations. Repeating the identical prepare
returns its saved operation without another quote or signature. Different
inputs with the same key are rejected.

## Coinbase Agentic Wallet on Base

Use an existing `coinbase-agentic-wallet` profile bound to the intended AWAL
account. Set `APN_BASE_RPC_URL` to an explicit public HTTPS Base RPC before
prepare, approve and resume. APN rechecks the provider address and the frozen
smart-account proxy, implementation and EntryPoint deployment before the one
provider invocation.

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

Coinbase's CDP paymaster pays native gas. The exact successful accounting is
`G = N`, `F = 0`: sender canonical-USDC debit and recipient credit both equal
`--amount`, sender native debit is zero, and no token fee is deducted. Approval
displays these values and requires the common foreground phrase.

APN writes `started` before exactly one `awal@2.12.1 send ... --chain base
--asset usdc --json` child. A returned transaction hash or a single hash found
in error text is only a locator. A missing hash is allowed. After `started`,
approval replay and resume never invoke AWAL again.

Recovery scans at most 256 safe Base blocks per resume, in log requests of at
most ten blocks. Finite absence advances the durable cursor but never proves
failure or permits redispatch. Completion requires one independently verified
EntryPoint v0.6 UserOperation for the frozen account call, exact canonical-USDC
sender debit and recipient credit, a unique native-fee sponsorship event,
unchanged account deployment, transaction/block membership and safe inclusion.
Multiple candidates, deployment drift, reorgs, nonzero token fees, extra account
calls or unavailable evidence retain the guard. Keep the bound Coinbase account
exclusive to this operation until its positive settlement is terminal.

## Local wallet permissions and failures

On first use, approval includes EIP-7702 delegation of the existing address to
the pinned account implementation. Delegation persists after this transfer.
Repeated use reuses that designation without a new authorization tuple. APN
also signs a permit for exactly `F` USDC to the pinned paymaster. The permit
and signed UserOperation have no on-chain expiry; the five-minute APN deadline
limits new APN actions, not the lifetime of already signed material.

The account batch sends exactly `N` USDC and clears the paymaster allowance.
A failed transfer can still pay a USDC fee. The receipt reports the observed
prefund, refund, actual charge and residual allowance separately. A failed
operation with residual permission remains `failed_effects_pending`; APN
keeps the profile guard until safe evidence proves the permission cleared.
There is no automatic revocation, extra cleanup transaction or new payment.

## Local wallet recovery and proof

```sh
apn operation resume --operation <operation-id>
```

Resume performs one bounded continuation or observation; omit `--wait-seconds`.
An approved phase that has never been attempted can continue before the
deadline after fresh checks. Each signing attempt, permit disclosure and
submission has a durable marker. After an interruption, APN loads only the
original seal. It never repeats a marked estimate or send. Missing material,
lost responses and expiry after a signing marker keep an explicit unresolved
state and retain the profile guard.

The bundler supplies only a candidate transaction location. Completion needs
independent canonical RPC evidence: authenticated outer transaction and block
membership, the exact EntryPoint event, USDC prefund/refund/delivery logs,
consumed nonces, expected delegation and zero safe allowance. Another owner's
batched operation is allowed; multiple operations for this owner in the same
transaction are ambiguous and cannot close this payment. A reverted outer
transaction does not prove that signed permissions can no longer be used.

For Local transfers, Polygon PoS uses the RPC `finalized` block, which reflects
milestone finality. Other admitted Local networks use `safe`. The saved
`safeBlock` field records this selected finality boundary for settlement and
permission recovery. Unavailable finality never falls back to `latest`.

If only the permit and optional delegation authorization were disclosed, the
owner can invalidate them separately and then resume the same operation. APN
closes it as `failed_permissions_invalidated` only after canonical safe and
current state prove the old permit nonce consumed, authorization nonce invalid,
zero paymaster allowance, unchanged EntryPoint nonce and no pending transaction.
The original bootstrap seal must be known, and no final UserOperation signing
attempt may exist. Missing or conflicting proof keeps the guard.

This outcome records cleared permissions and that no final payment was
submitted. Transfer delivery, token fee/debit and native cost stay unknown;
any externally paid cleanup is separate. It preserves the original operation
history and permits a new transfer only through a new prepare and approval.
APN does not perform the external revocation or start another payment.

If a final UserOperation was already sealed, recovery additionally requires its
exact original hash and a canonical scan with no matching event through the
safe block used by the proof. Both safe and current EntryPoint nonces must be
greater than the frozen nonce, as well as satisfying permit, authorization,
allowance and pending-transaction checks. This prevents the old signed operation
from becoming usable again after future delegation or approval. The resulting
`rpc_safe_final_permissions_invalidated` receipt releases the guard while
preserving the original submission-attempt marker and unknown past financial
results. It never reports an unacknowledged attempt as a confirmed submission,
successful payment or zero-cost failure. External recovery fees remain separate.

Canonical recovery scans at most 256 safe blocks per resume, using log requests
of at most ten blocks each. Failed requests and invalid logs never advance the
cursor; a reorganization can rewind it. The next observation cannot skip an
unread range.

`operation status` and `receipt get` use saved evidence without network access;
they may repair local operation or receipt records after an interrupted write. Receipts
contain hashes and public accounting, without permits, signatures, raw
UserOperations, encrypted keys or provider response text.

### Explicit observation RPC recovery

APN 0.5.12 includes an explicit recovery option for a saved Local gasless
operation whose original RPC cannot serve historical reads. APN 0.5.16 extends
it to saved MetaMask Agent and Smart Account gasless operations. The published
0.5.11 binary does not include this option; use a verified 0.5.12 or later
compatible artifact.

```sh
export APN_ETHEREUM_ARCHIVE_RPC_URL='<verified-public-https-rpc-url>'
apn operation resume --operation <operation-id> \
  --observation-rpc-env APN_ETHEREUM_ARCHIVE_RPC_URL
```

The option names a local environment variable; it does not take a URL. Names
must match `APN_[A-Z0-9_]+_RPC_URL` and contain at most 128 characters. MCP uses
the same optional `observation_rpc_env` field. Do not combine it with
`--rpc-url` or `--wait-seconds`. Local, MetaMask Agent and Smart Account gasless
operations accept it; other operation kinds reject it.

This mode only observes. It cannot access signing material, estimate fees,
disclose permissions or send a transaction, even if an approved phase could
otherwise continue. APN verifies the selected chain, registered contracts and
token domain, and the original preparation block before accepting evidence.
It uses the canonical EntryPoint scan without a bundler locator and keeps the
same bounded scan, reorg, receipt, nonce and allowance rules described above.
Unavailable or conflicting evidence retains the guard.

For MetaMask Agent and Smart Account gasless operations the option applies only
after the original dispatch or exposure. APN proves the selected chain and the
operation's frozen safe block before accepting evidence, then applies the
family's usual finality and settlement rules. Approval, dispatch, verification
and settlement never use the named RPC. The saved operation records the
environment variable name, the RPC origin and a hash of the full URL; the URL
itself is never stored.

Accepted observations include `observation_source`: the explicit recovery
policy, environment-variable name, RPC origin, full-endpoint hash and binding
to the original intent and preparation block. The full URL is never stored in
the operation or receipt. The signed intent, original endpoint identities,
sealed material and historical transitions remain unchanged. A nonterminal
operation's next action retains the explicit environment-variable option.
Terminal resume, status and receipt calls use saved evidence without network
access.

The new reader accepts existing records without rewriting their old fields.
Older 0.5.11 readers reject records containing the new observation-source
field. Verify a candidate against a protected state copy before global
activation, and keep a compatible reader for records it subsequently writes.

### Failures before disclosure and owner abandonment

If APN stops after a local signature but before any signed material is disclosed or
submitted, for example because a fee, balance or nonce check fails right after
signing, the operation ends as `failed_before_effect` and releases the profile.
The sealed material is never sent.

When signed material was disclosed or submitted and the outcome is still unknown
after the approval window, the owner can release the profile with
`apn operation abandon --operation <operation-id>`. APN first retries its read-only
observation, then asks for the exact acknowledgement and records terminal
`abandoned_unknown` with owner-acknowledgement-only proof. A signed delegation or
UserOperation may still execute later because the fee permit and delegation do
not expire.

## Local wallet on Avalanche (x402 facilitator)

A local wallet sends Avalanche C-Chain USDC without holding AVAX. The owner
signs one EIP-3009 `transferWithAuthorization` for the exact recipient and
amount. PayAI's public x402 facilitator checks it and submits the transaction,
paying the gas itself. No token fee is taken: the recipient receives the full
amount, and the account keeps no delegation or allowance after the payment.

| Item | Value |
| --- | --- |
| Chain | Avalanche C-Chain, chain ID 43114 (`eip155:43114`) |
| Token | Native USDC `0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e`, 6 decimals |
| Required RPC environment | `APN_AVALANCHE_RPC_URL` |
| Facilitator | `https://facilitator.payai.network`, free public tier, x402 v2 `exact` |
| Approved relayer | `0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63` |
| Authorization validity | 120 seconds after approval |

```sh
apn gasless balance --profile <profile> --chain 43114
apn gasless transfer prepare --profile <profile> --chain 43114 --to <recipient> \
  --amount 1.5 --max-fee 0 --min-received 1.5 --idempotency-key <key>
apn gasless transfer approve --operation <operation-id>
```

`--max-fee` and `--min-received` keep the shared command shape. This route
charges no fee, so any `--min-received` up to the amount is satisfied.

Preparation checks the bound local wallet, the chain ID, the USDC balance at a
finalized block and the facilitator's current support for Avalanche `exact`
payments with an approved relayer. Approval asks for a six-character code. APN
then repeats those checks, signs in memory and writes a durable marker before
the authorization leaves the process. It calls the facilitator's verify and
settle endpoints once each and never repeats them. The signature is never saved;
state and receipts keep only its hash.

After that marker only chain evidence ends the operation:

- `completed` needs a finalized successful receipt with exactly one
  `AuthorizationUsed` for the owner and nonce and exactly one USDC `Transfer`
  of the exact amount to the recipient. A settlement batched with other
  payments in one transaction is accepted.
- `expired_unused` needs a finalized block at or after the authorization's
  `validBefore` in which the nonce is still unused. EIP-3009 then rules out any
  later use.

A verification rejection, a failed settlement or a lost response does not end
the operation. Run `apn operation resume --operation <operation-id>` after the
120-second window to record the outcome. Recovery never signs or contacts the
facilitator. It reads whichever `APN_AVALANCHE_RPC_URL` is configured at that
moment, so an unavailable RPC can be replaced. A transaction hash reported by
the facilitator is only a hint; the on-chain authorization state decides.

An approval interrupted before the marker ends as `failed_before_effect`,
because nothing left APN. A resume after the approval deadline ends an
unapproved operation the same way. An unresolved operation blocks new transfers
from the same address on Avalanche only.

If the RPC cannot prove either outcome, for example because the nonce reads as
used but no matching receipt is found, the owner can release the address with
`apn operation abandon --operation <operation-id>`. This is accepted only once
the authorization has expired and one more facilitator timeout (60 seconds) has
passed. APN first retries its read-only recovery, then asks for the exact
acknowledgement and records `abandoned_unknown` with owner-acknowledgement-only
proof. The authorization cannot execute after it expires, but whether it
executed before then stays unknown.

## MetaMask Agent server wallet

Use a profile already bound to the intended MetaMask Agent server-wallet address
and its existing production session. The current selected wallet must resolve
to that same address. This path does not create a wallet, change selection,
refresh a login or complete provider MFA. If the session is unavailable,
complete the normal provider login separately and continue the saved operation.

| Network | Chain ID | Required RPC environment | Finality |
| --- | --- | --- | --- |
| Ethereum | 1 | `APN_ETHEREUM_RPC_URL` | safe |
| Optimism | 10 | `APN_OPTIMISM_RPC_URL` | safe |
| Polygon PoS | 137 | `APN_POLYGON_RPC_URL` | finalized |
| Monad | 143 | `APN_MONAD_RPC_URL` | safe |
| Sei | 1329 | `APN_SEI_RPC_URL` | safe |
| Base | 8453 | `APN_BASE_RPC_URL` | safe |
| Arbitrum One | 42161 | `APN_ARBITRUM_RPC_URL` | safe |
| Linea | 59144 | `APN_LINEA_RPC_URL` | safe |

MetaMask supplies the relay; no bundler configuration is used. The explicit
public HTTPS RPC must provide canonical block-hash state reads, the listed
finality tag, complete transaction/receipt membership and bounded log queries.
APN checks protocol and USDC implementation code at preparation and settlement.
Unichain and Avalanche belong to the local-wallet path above.

For MetaMask, `--amount` is the exact successful sender debit `G`. APN quotes the
provider's USDC fee `F` and recipient amount `N`, requiring `G = N + F`,
`F <= --max-fee` and `N >= --min-received`. It makes at most three quote attempts
to reach that equality. What you approve is `--max-fee` and `--min-received`, not
one exact price: the quote is taken again after your approval, and a fee that has
moved is accepted while it still stays inside `--max-fee` and still leaves the
recipient at or above `--min-received`. A repriced batch has its delegation
re-derived, and that repriced batch and delegation are what the durable dispatch
marker records and the single provider POST carries. A fee above `--max-fee`
refuses with `APN_FEE_BUDGET_EXCEEDED / mm_gasless_fee_cap` and dispatches
nothing. There is no unused amount or refund for a successful MetaMask batch. The
recipient and fee recipient must both differ from the sender and each other.

```sh
apn gasless balance --profile metamask --chain 8453
apn gasless transfer prepare --profile metamask --chain 8453 \
  --to <recipient-address> --amount 10 --max-fee 0.2 --min-received 9.8 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
```

Preparation does not sign or submit. Approval displays the exact USDC debit,
recipient amount, quoted fee, fee ceiling, minimum receipt and persistent
permission, then asks for the six-character approval code printed on the same
screen. The code is bound to the full operation ID and fingerprint.

Take as long as you need on that screen. Every check between your approval and
the dispatch marker is taken again at that moment: the provider binding and
policy, the RPC endpoint identity, the chain state at the pinned safe and head
blocks, the unconsumed one-use permission counter and the price. The preparation
snapshot is kept as identity and designation evidence only; it is never read as
a claim that the chain state is still current, so a long read of the screen no
longer refuses the transfer. Only the five-minute deadline bounds it, and 15
seconds of it are reserved for the dispatch itself.

Inside that window a transient failure is waited out rather than ending the
operation: up to 18 attempts, 5 seconds apart, for a provider or RPC transport
failure (`mm_gasless_provider_unavailable`, `mm_gasless_rpc_unavailable`), a
concurrent MetaMask CLI write to its own session files (`mm_gasless_state_busy`),
a quote that will not converge (`mm_gasless_quote_unstable`) and a fee above
`--max-fee` that may fall back inside it (`mm_gasless_fee_cap`). Waiting stops as
soon as the remaining window no longer covers another pause plus the reserve, and
Ctrl-C ends it at once. A definite refusal is never retried: an expired or
non-monotonic clock, a changed provider binding or policy, a changed RPC
endpoint, a changed designation, a consumed permission and a USDC balance below
`--amount` all end the operation immediately, before any effect. A check that
could not complete at all is recorded as
`APN_PROVIDER_UNAVAILABLE / mm_gasless_guard_unavailable`;
`mm_gasless_internal` now means only that APN could not classify a failure.

The provider signs and executes the two transfers as one exact batch. It may
install or preserve the pinned EIP-7702 designation on the same wallet address.
That designation can remain afterward. The permission allows one successful
batch and has no onchain expiry. APN's five-minute deadline limits only the first
dispatch; a timeout, revert or later expiry does not revoke the permission or
guarantee that no payment can occur.

APN records a durable dispatch marker before making its single provider POST.
That marker carries the repriced quote and delegation when the guard repriced,
so the batch that was dispatched is the batch every later observation, settlement
proof and receipt is read against; the approved intent itself never changes, so
the fingerprint you confirmed stays the same. After that marker, repeated
approval or `operation resume` only observes the dispatched request and
delegation. Lost responses, provider failures and pending
MFA remain unresolved. A canonical revert is `failed_effects_pending` and
retains the profile guard because the permission may still be redeemed later.
Only independently proved completion or failure before any effect is terminal.

If MetaMask requires MFA, the operation reports `mm_gasless_provider_approval`.
Confirm the existing transaction in MetaMask Mobile or the email registered to
your MetaMask dashboard, then resume the same operation. APN does not approve
provider policy changes. The saved operation stays guarded while confirmation
is pending; neither another CLI approval nor resume sends a second request.
Provider metadata, approval links and signatures are discarded from public output.

Continue with `apn operation resume --operation <operation-id>`, without
`--wait-seconds`, including after the APN deadline. A provider status or hash
is only a hint. Completion requires the independently authenticated transaction,
canonical receipt and finality, exact two-call batch, consumed permission,
USDC delivery/fee/debit and outer gas payer. A temporarily unusable clock or
full history preserves the saved guard and cannot authorize another dispatch.

`operation status` and `receipt get` use saved evidence without network access;
they may repair local operation or receipt records after an interrupted write. Public output
contains hashed provider identities and accounting, without the private
request UUID, session token, unsigned wire or provider response. Unresolved
operations block competing payments and wallet lifecycle changes for the profile.

### MetaMask owner abandonment

A MetaMask Agent transfer whose outcome is still unknown after its approval window
can be released with `apn operation abandon --operation <operation-id>` after the
exact acknowledgement. APN records `abandoned_unknown`; MetaMask may still relay the
transfer later because its delegation has no on-chain expiry.

## MetaMask Smart Account

Use an existing `metamask-smart-account` profile with its original Base owner,
session key and active periodic USDC permission. Set `APN_BASE_RPC_URL` to an
explicit public HTTPS Base RPC. The RPC must support numeric block reads,
`safe` and `finalized` blocks, complete transaction receipts and bounded logs.
APN checks the current permission nonce, available allowance, owner USDC balance,
session state and pinned contract deployments before signing and disclosure.
No new grant, account deployment or native funding is part of this command.

The public MetaMask facilitator pays native gas. For this provider the exact
fee is zero: the successful owner debit and recipient credit both equal
`--amount` (`G = N`, `F = 0`). The owner and session need no native balance.
Other networks are not executable through this adapter.

```sh
apn gasless balance --profile smart-account --chain 8453
apn gasless transfer prepare --profile smart-account --chain 8453 \
  --to <recipient-address> --amount 1 --max-fee 0 --min-received 1 \
  --idempotency-key <unique-key>
apn gasless transfer approve --operation <operation-id>
```

Preparation saves the exact transfer and its five-minute deadline without
signing. Foreground approval displays the owner, session, recipient, USDC
amount, zero fee, existing root permission and expiry, and asks for the
six-character approval code bound to the full operation ID and fingerprint.
MCP supplies the same
foreground CLI handoff.

APN signs one child permission for the exact transfer. The child has an
onchain expiry and does not replace the existing root permission. Verification
discloses this signed child to the facilitator; a failed verification, lost
response or timeout does not prove that it cannot be used. APN durably records
each signing, disclosure and settlement attempt before that boundary.

After disclosure, `apn operation resume --operation <operation-id>` only reads
independent RPC evidence. Omit `--wait-seconds`. Resume does not sign again or
repeat verification or settlement, even if the previous response was lost.
It can recover without an active session or grant. The operation retains its
profile guard until independently proved completion or unused expiry.

Completion requires the authenticated signed outer transaction, exact child
and root redemption, canonical safe receipt, USDC delivery and spent amount,
and an external native gas payer. Provider responses and transaction hashes
are only hints. Unused expiry requires a complete canonical scan, finalized
expiry and zero child spending; elapsed wall time alone cannot release the
guard. Interrupted scans continue from the saved cursor.

Status and receipt commands read local evidence and omit signed permissions,
session secrets and provider response bodies. Unknown amounts remain unknown.
Source and installed tests do not establish fresh Base transfer acceptance.

## Existing state and upgrades

The gasless journal, receipts and encrypted effects use separate files under
the existing APN state directory. The original wallet and prior operation
formats are preserved. Reinstalling or upgrading must preserve that directory
and its existing wrapping secret. Recover an unresolved operation with the
same verified archive or a compatible newer archive. An older binary does not
provide gasless recovery; do not delete unresolved state or create a replacement
payment to work around it.

Once the state directory contains any Smart Account gasless operation, select
a recovery archive through the current archive's read-only preflight. Supply
canonical absolute paths and the manifest hash obtained from independent
archive, source and installed-byte verification:

```sh
node <verified-current-package>/dist/smart-account-gasless/recovery-gate.js \
  --state-root <existing-state-root> \
  --archive <target-archive.tgz> \
  --manifest <verified-target-manifest.json> \
  --manifest-sha256 <independently-verified-manifest-sha256> \
  --package-root <target-installed-package>
```

Only select the target executable after a successful preflight. The gate
validates saved journals and the target's exact runtime bytes without running
the target or editing state. An unknown manifest, changed artifact, malformed
state or incompatible runtime returns
`APN_OPERATION_BLOCKED / sa_gasless_archive_incompatible`. Recheck after a
state or installation change.

The retained I745 archive with SHA-256
`1883f117a84552e720319d2770ea9439fad30d8eb6f1bd3212f344854b0ce267`
is incompatible with Smart Account gasless state: its original operation
lookup cannot discover this family or its guards. Preserve it as historical
evidence; use the verified current archive for this state. The preflight does
not change older binaries or migrate existing profiles and operations.

MetaMask Agent operations written before the reprice guard existed carry no
dispatched-material field. They keep their exact stored key set, transition
hashes and integrity hash, load unchanged and are read as never repriced.

New local operations freeze wire format v2. First use includes the delegation
authorization; repeated use sends an ordinary operation for the already
delegated account. Saved operations without that version retain their original
wire, hash and recovery semantics. Upgrading does not replace their approvals
or signed material.

Synthetic source and temporary-installed tests establish software behavior.
They do not establish real-wallet, mainnet, receiving-human or public-release
acceptance. Those checks require their own explicit approval and evidence.
