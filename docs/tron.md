# TRON mainnet direct transfers

This APN 0.5.26 package includes local TRX and canonical USDT transfers on
TRON mainnet. Package availability, clean installation and live mainnet transfer
acceptance require separate evidence. No TRX or USDT mainnet execution acceptance
has been recorded yet.

| Profile | Account and balance | Direct transfer |
| --- | --- | --- |
| Local `local` | Implemented with a separate encrypted secp256k1 wallet | Implemented; activated sender, foreground policy and transfer approval required |
| Coinbase `coinbase-awal` (`awal` 2.12.1) | Unavailable | Blocked: pinned provider has no TRON rail |
| MetaMask `metamask-smart-account` | Unavailable | Blocked: pinned provider has no TRON rail |
| MetaMask `metamask-agent-wallet` | Unavailable | Blocked: pinned provider has no TRON rail |

The three nonlocal rows report the capability blocker
`pinned_provider_has_no_tron_rail`. TRON x402, gas sponsorship or other gasless
execution, and bridge execution are unavailable for every profile; current
gasless coverage is 0/4. These capabilities are not inherited from an EVM
provider or from the presence of USDT. A provider refusal never switches the
operation to the local signer.

## Account, assets and RPC

Inspect the current matrix without network access:

```sh
apn wallet capabilities-tron
apn help --json
apn help wallet ensure-tron
apn help pay transfer prepare-tron
```

Every account or money command requires an explicit profile. A local TRON
wallet has its own encrypted secp256k1 private key and never reuses the profile's
EVM or Solana key. Its envelope uses the existing macOS login-Keychain wrapping
secret, separate chain records and owner-only storage under the APN state root.
Repeating ensure keeps the same address; a different execution owner or changed
address is refused.

```sh
apn wallet ensure-tron --profile tron-local --provider local --accept-risk true
```

This command creates a real local wallet when run outside a test fixture. It
does not fund or activate the account. `--accept-risk true` is mandatory because
APN and the unlocked macOS user session hold the signing capability. Encryption
protects a copied APN state directory without its Keychain secret; it does not
protect a compromised APN process, login session, user account or host. Review
the returned public address and intended network before any external funding.

Configure the intended public HTTPS API base in `APN_TRON_RPC_URL`. There is no
default endpoint, and the common `--rpc-url` option remains for EVM operations.
URL credentials, query parameters, fragments, non-443 ports, private addresses
and redirects are rejected. Requests use bounded POST bodies and responses,
public-address pinning, built-in TLS roots and a ten-second deadline. APN verifies
the full mainnet genesis block
`00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc`.
Endpoint text and raw RPC errors are not included in receipts.

For an endpoint that needs slower request starts, set the optional
`APN_TRON_RPC_MIN_POST_INTERVAL_MS` to a canonical integer from `0` to `1000`.
Unset or `0` keeps the current behavior. The interval applies at the physical
HTTPS POST start after DNS validation for all TRON RPC calls made by this APN
client, including concurrent calls; it does not
remove any safety reads or retry a failed request. The maximum is bounded for
the ten-read TRX preparation: ten requests can each use their ten-second RPC
deadline, nine 1000 ms gaps add exactly 9 seconds, and the existing ten-second
transaction-expiry reserve leaves this within the 120-second TRON window.
Actual response time and head age still matter; preparation refuses when the
remaining transaction window is insufficient. Endpoint rate limits can vary,
so select the interval for the intended provider.

```sh
export APN_TRON_RPC_URL=https://your-tron-mainnet-api.example
export APN_TRON_RPC_MIN_POST_INTERVAL_MS=1000
apn pay transfer prepare-tron --profile tron-local --asset trx \
  --to <tron-recipient> --amount 1 --max-fee-trx 2 \
  --idempotency-key tron-trx-example-001
```

```sh
export APN_TRON_RPC_URL=https://your-tron-mainnet-api.example
apn wallet balance-tron --profile tron-local --asset trx
apn wallet balance-tron --profile tron-local --asset usdt
```

Both balance commands report the selected asset and the separate TRX fee balance
from current solidified state; they do not sign, broadcast or activate an
account.

The only assets are native TRX (`native:trx`) and canonical TRON USDT at
`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`. Both use six decimal places. APN attests
the USDT contract's six-decimal response before token preparation or evidence
acceptance. Arbitrary TRC-20 assets, TRC-10 assets, delegated permission signing,
self-transfers and arbitrary signing or broadcasting are outside this finite
payment profile. A recipient may be supplied as canonical Base58Check or as a
42-digit hex address beginning with `41`; APN normalizes it to Base58Check.

The local sender must already be an activated normal TRON account. If its owner
permission is present, APN requires permission 0, threshold 1 and exactly the
stored sender key with weight 1. `wallet ensure-tron` alone does not meet this
condition. Receiving only TRC-20 USDT does not activate the address, so a wallet
can show a USDT balance while remaining unable to originate a transaction.

## Policy, preparation and the total TRX cap

TRX and USDT start denied. Two owner decisions are needed. The owner allowlist
policy must admit the asset on the `direct` rail; its per-operation and daily
caps are the only principal caps (see `docs/allowlist-direct-integration.md`).
The chain policy below, admitted in a foreground terminal, now caps only the
total resource fee in TRX; its principal flags are still required by the
command but are not enforced. The values below only illustrate command syntax.

```sh
apn policy admit-tron --profile tron-local --asset trx \
  --max-per-transfer 2 --daily-limit 5 --max-fee-trx 2

apn policy admit-tron --profile tron-local --asset usdt \
  --max-per-transfer 1 --daily-limit 3 --max-fee-trx 30
```

The terminal displays the exact account, genesis, asset identity, atomic limits
and policy hash, then requires the displayed policy-hash-bound phrase. MCP returns
an exact CLI handoff and cannot provide this human approval. Policy replacement
is blocked while the profile has an unresolved money operation.

Amounts and TRX fee caps must be positive canonical decimal strings with at most
six fractional digits. Values such as `1`, `1.25` and `0.000001` are accepted.
Signs, exponent notation, whitespace, leading zeroes, trailing fractional zeroes
and excess precision are refused. Daily principal usage follows UTC in the
shared allowlist usage ledger. Every nonterminal reservation continues to
reserve its full principal across UTC days; a timeout or unknown outcome does
not release it.

Prepare one immutable transfer:

```sh
apn pay transfer prepare-tron --profile tron-local --asset trx \
  --to <tron-recipient> --amount 1 --max-fee-trx 2 \
  --idempotency-key tron-trx-example-001

apn pay transfer prepare-tron --profile tron-local --asset usdt \
  --to <tron-recipient> --amount 1 --max-fee-trx 30 \
  --idempotency-key tron-usdt-example-001
```

Preparation verifies mainnet, the account and owner permission, the admitted
policy, available TRX and selected-asset funds, current resource prices and the
next maintenance boundary. USDT preparation also verifies the exact contract,
reads the token balance and simulates the exact `transfer(address,uint256)` call.
It freezes an unsigned one-contract, one-signature transaction and sends
nothing.

`--max-fee-trx` is the operator-selected ceiling for all native resource debit
for this operation. APN derives a transaction-specific maximum no greater than
that ceiling, shows it during approval and requires the sender's TRX balance to
cover it. The components are:

- For TRX to an already activated recipient, the maximum is the frozen
  transaction's Bandwidth bytes multiplied by the current Bandwidth price.
- For TRX to an absent recipient, APN supports native account activation and
  uses the larger of the ordinary Bandwidth maximum and the system activation
  fee plus the fixed account-creation Bandwidth fallback. This remains safe if
  the recipient becomes activated after preparation. The transferred TRX amount
  is additional to the fee maximum when checking sender funds.
- For USDT, the maximum is the transaction's caller Energy `fee_limit` plus its
  Bandwidth maximum. TRON's `fee_limit` covers Energy only; Bandwidth is charged
  separately. A TRC-20 recipient does not incur APN's account-activation
  component and is not activated by the token transfer. USDT therefore still
  requires a separate TRX balance for the full frozen maximum.

Staked Bandwidth or Energy may reduce the fee eventually burned, but it does not
expand the frozen ceiling. APN records actual Bandwidth use/burn, Energy
use/burn and any native activation component in terminal evidence. There is no
TRON rent component.

## Protocol and price-window condition

This implementation admits only a node that reports java-tron code version
`4.8.2.1` during preparation and every pre-submission revalidation. It also
requires the reviewed VM and consensus-expiry feature flags and all required
chain parameters. A different version, missing parameter or unsupported flag
returns `APN_PROVIDER_CAPABILITY_UNAVAILABLE` before signing.

Bandwidth price, Energy price, activation fees and chain maximum `fee_limit` are
dynamic governance parameters rather than documentation constants. APN reads
them twice around a fresh head and next-maintenance snapshot, binds the exact
values into the operation, and sets expiry to at most 120 seconds while staying
strictly before that maintenance boundary. It rechecks the version, parameter
hash, maintenance time, reference block, solidified activation snapshot, funding
and Energy estimate before and after approval and again before submission. A
stale or changed window, including fewer than ten seconds remaining, returns
`APN_REPREPARE_REQUIRED` before signing. Only a terminal `failed_before_effect`
operation can be replaced with a new idempotency key after review; once
submission may have occurred, keep observing the existing operation.

The reviewed primary protocol sources are:

- [java-tron `GreatVoyage-v4.8.2.1`](https://github.com/tronprotocol/java-tron/tree/GreatVoyage-v4.8.2.1), the exact protocol tag required by this source profile.
- [Bandwidth charging and account-creation paths](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.1/chainbase/src/main/java/org/tron/core/db/BandwidthProcessor.java#L96-L285).
- [Energy `fee_limit` enforcement](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.1/actuator/src/main/java/org/tron/core/actuator/VMActuator.java#L462-L602) and [resource receipt accounting](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.1/chainbase/src/main/java/org/tron/core/capsule/ReceiptCapsule.java#L260-L317).
- [Block execution before maintenance proposal processing](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.1/framework/src/main/java/org/tron/core/db/Manager.java#L825-L859) and [proposal processing](https://github.com/tronprotocol/java-tron/blob/GreatVoyage-v4.8.2.1/framework/src/main/java/org/tron/core/consensus/ProposalController.java#L26-L99).
- TRON's official [account activation](https://developers.tron.network/docs/account) and [internal transaction](https://developers.tron.network/docs/internal-transactions) documentation, which distinguishes native account creation from TRC-20 contract storage.

## Foreground approval and recovery

Review and approve only the prepared operation ID:

```sh
apn pay transfer approve --operation <operation-id>
apn operation status --operation <operation-id>
apn operation resume --operation <operation-id>
apn receipt get --operation <operation-id>
```

Approval needs foreground stdin and stderr attached to a TTY. The prompt displays
the profile, provider and custody, genesis, exact asset, sender, recipient,
principal, Bandwidth bound, Energy `fee_limit`, possible activation component,
total sender resource maximum, policy hash, operation fingerprint, maintenance
boundary and expiry. It requires the exact displayed phrase within 60 seconds or
the shorter transaction expiry. APN revalidates immediately before and after
that approval, then signs at most one permission-0 transaction with one
signature and no memo.

Local signing persists the exact signed transaction in encrypted custody storage
before submission. APN durably records submission intent before the first
broadcast. A crash before that boundary can recover and first-submit the same
approved sealed transaction. Once a broadcast may have occurred, approval
replay, status and resume never send it again.
`operation status` and `receipt get` use local durable evidence and may initialize
state directories or repair local records after an interrupted write. `operation resume`
uses `APN_TRON_RPC_URL` for one bounded solidified-history observation of the
same transaction ID; omit `--wait-seconds` for this rail.

If submission acknowledgment is missing, mismatched or interrupted, the
operation remains `unknown_finality`. Missing solidified history or invalid or
incomplete evidence also stays unresolved. Continue observing the same operation
and transaction; do not prepare or send a replacement payment. Unknown
operations continue reserving policy limits. A same-key replay returns the same
frozen intent, while a conflicting intent under that key and another concurrent
money operation for the profile are refused.

Completion requires the exact signed transaction in the exact solidified block,
matching transaction information, a valid sender signature, the expected result
codes and actual fees within the frozen maximum. USDT additionally requires
exactly one canonical `Transfer(address,address,uint256)` log from the canonical
contract with the exact sender, recipient and amount. Current solidified sender
and recipient balances are labeled supplemental observations; they are not
presented as transaction-local deltas. A solidified USDT `REVERT` becomes a
terminal failed receipt only after exact identity and fee evidence is verified.
Other result codes, malformed evidence or absent history never become success.

The durable operation is authoritative. If terminal receipt writing was
interrupted, receipt access returns the exact recovery action and `operation
resume` repairs the derived receipt under the same locks. Seeds, signed payloads
and raw provider responses never appear in public operation or receipt output.

## MCP surface and open acceptance

The same binder and core expose dedicated tools
`apn_wallet_ensure_tron`, `apn_wallet_balance_tron`,
`apn_wallet_capabilities_tron`, `apn_policy_admit_tron` and
`apn_pay_transfer_prepare_tron`. Common tools provide
`apn_pay_transfer_approve`, `apn_operation_status`, `apn_operation_resume` and
`apn_receipt_get`. MCP field names use underscores. Policy admission and transfer
approval return a foreground CLI handoff; MCP does not type the consent phrase or
approve a payment.

Deterministic tests exercise synthetic TRX and USDT preparation, signing,
solidified success/revert evidence, fee accounting, restart and no-replay
recovery. They do not use public network traffic or money. Local TRX and local
USDT each retain an open mainnet acceptance row. Publication, clean installation
and each bounded live transfer require separate evidence; none is established by
this document, a capability response, a public RPC identity read or a fixture.

## Expired unlanded transfer

A local TRX or USDT transfer can stay `unknown_finality` when broadcast lost its response and solidified history never shows the transaction. `operation resume` keeps observing and never rebroadcasts it. After the solidified head timestamp passes the frozen expiration by more than one block interval and solidified history still has no transaction or info for its id, the owner may end the operation in a foreground terminal:

```sh
apn operation abandon --operation <operation-id>
```

The operation becomes `abandoned_unknown` with an owner-acknowledgement receipt, and the profile can prepare a new transfer. The financial outcome stays unknown because history can be incomplete; APN refuses abandonment while the expiration window is open or the transaction is visible.
