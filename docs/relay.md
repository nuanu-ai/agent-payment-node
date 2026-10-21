# Relay bridge routes

Relay routes move a profile's funds from one chain to a recipient on another through the keyless public Relay API.
Five CLI commands cover every route. Relay is not exposed as MCP tools.

```text
apn relay prepare --profile <profile> --source-chain <caip2> --asset <usdc|native> --destination-chain <caip2> --recipient <address> \
  --amount-atomic <source-atomic> --min-output-atomic <destination-atomic> --max-deposit-network-fee-wei <wei> \
  [--max-approval-network-fee-wei <wei>] [--payer <address> --max-provider-fee-atomic <usdc> --quote-file <absolute-json-path>] \
  --idempotency-key <key>
apn relay execute --profile <profile> --operation <operation-id> --rpc-url <source-rpc>
apn relay observe --profile <profile> --operation <operation-id> --rpc-url <source-rpc> [--destination-rpc-url <destination-rpc>]
apn relay status  --profile <profile> --operation <operation-id>
apn relay retire  --profile <profile> --operation <operation-id>
```

## Routes

`relay prepare` chooses the route from the source chain, the source asset and the destination chain. The mechanism
reference is what the owner policy must admit on the `bridge` rail.

| Source | `--asset` | Destination | Mechanism reference | Route-only options |
| --- | --- | --- | --- | --- |
| Ethereum `eip155:1` | `usdc` | BNB native `eip155:56` | `ethereum-usdc-bnb-native-v1` | `--max-approval-network-fee-wei` |
| Ethereum `eip155:1` | `usdc` | Base ETH `eip155:8453` | `ethereum-usdc-base-eth-v1` | `--max-approval-network-fee-wei` |
| BNB `eip155:56` | `native` | Polygon POL `eip155:137` | `bnb-native-polygon-native-v1` | none |
| BNB `eip155:56` | `native` | Monad MON `eip155:143` | `bnb-native-monad-native-v1` | none |
| Base `eip155:8453` | `native` | MegaETH USDm `eip155:4326` | `base-native-megaeth-usdm-v1` | none |
| Base `eip155:8453` | `native` | Polygon POL `eip155:137` | `base-native-polygon-native-v1` | none |
| Arbitrum `eip155:42161` | `usdc` | Ethereum USDC `eip155:1` | `arbitrum-usdc-ethereum-usdc-source-draft-v1` | `--max-approval-network-fee-wei`, `--payer`, `--max-provider-fee-atomic`, `--quote-file` |

A route-only option is required on its route and refused on every other route; no option is ignored. Any other
combination is refused with reason `relay_route_unknown`. `--amount-atomic` is in the source asset's atomic units and
`--min-output-atomic` in the destination asset's.

## Who pays, who receives, what is admitted

Every command names its profile; there is no default profile. An operation is visible only to the profile that prepared
it. The payer is that profile's wallet (`--payer` on the Arbitrum route must equal the policy account). Admission is the
profile's own active owner policy: `accounts.evm` equal to the wallet, the exact source asset on rail `bridge` with
mechanism `{ "provider": "relay", "reference": <reference> }`, and its per-transfer and daily caps. A policy may pin
`recipients` (1 to 16 addresses) on the bridge admission; the pin is checked at prepare, approval, reservation and before
the first send. Without a pin the recipient is the caller's required input, shown on the foreground confirmation.

The recipient, amount, minimum output and fee ceilings are shown on the foreground confirmation. Refunds are derived: the
source refund goes to the payer, the destination refund to the recipient (Polygon refunds in USDC; the output stays POL).

Operations saved by earlier releases under `bnb-native-monad-native-default-v1`, `base-native-mega-usdm-default-v1` or
`base-native-polygon-native-buyer-v1` still load, execute, observe and retire under the policy pin they were prepared
with. A new prepare never uses those references; restage the policy with the references above to prepare again.

## Prepare

`relay prepare` reads the active policy and one keyless Relay quote (the Arbitrum route reads the saved quote file
instead) and writes an immutable unsigned operation. It never signs. The quote validator recomputes the Relay settlement
order ID with the vendored official SDK, recovers the pinned solver and re-encodes the exact deposit; it refuses extra
steps or output calls, changed currencies or recipients, lower outputs and changed refund rows.

Native BNB routes refuse a quote whose deposit fee exceeds `--max-deposit-network-fee-wei`. On Base that value is the full
OP Stack fee budget: L2 gas, the GasPriceOracle L1 fee upper bound for at most 512 signed bytes and the operator fee.

## Execute

`relay execute` takes the route from the saved operation and runs its next source effect after foreground terminal
confirmation. Each effect is signed once by the profile's encrypted local wallet behind a durable single-send marker; an
ambiguous send is observed by its saved hash and never repeated.

- Ethereum USDC routes: one approval, then one deposit, in the same call.
- Native routes: one deposit. On Base the exact deposit is simulated against fresh balance and nonce, and execution
  refuses before signing when the full fee exceeds the consented ceiling.
- Arbitrum USDC: one step per call. A canonical allowance check runs first; a sufficient allowance is saved as a verified
  approval skip, otherwise the approval is signed in the same call. After `relay observe` proves the approval final, the
  next `relay execute` sends the deposit.

The RPC URL must be a credential-free public HTTPS endpoint; Ethereum, BNB and Base execution also require a bare origin
(no path or query). A successful call names the next command in `next_actions`.

A crash before signed custody closes the attempt without a source effect, releases its usage reservation and permits
retirement. A Base attempt with a durable signing marker but missing signed material keeps its usage hold, cannot sign
again and cannot be retired as no-effect.

## Observe

`relay observe` never signs or sends. `--rpc-url` is the source chain RPC; `--destination-rpc-url` is the destination
chain RPC and is required except on the Arbitrum route, where omitting it proves the Arbitrum source effects only.

It proves the saved source effects at finality (Ethereum finalized, BNB 15 blocks, Base and Arbitrum safe), reads one
keyless Relay status as a discovery hint, and proves one credit to the operation's own recipient on the destination:
Polygon at its milestone-finalized checkpoint (a direct native transfer or exactly one Relay router v3 event naming the
recipient), Monad at 15 blocks, BNB, Base, MegaETH (exactly one pinned USDm Transfer) and Ethereum (one canonical USDC
Transfer) at `safe`. Physical RPC starts share persisted 750 ms provider-family pacing.

Provider success bound to the source hash plus one qualifying credit yields `operationalAcceptance: true`; one payout can
accept one operation. An accepted Arbitrum credit is recorded create-only and later observations return it without
network reads. `paidAcceptance` stays `false`: no result asserts cryptographic Relay order causality or a merchant purchase.

## Status and retire

`relay status` makes one bounded GET to Relay `status/v3`; provider hashes are candidates, not on-chain proof.

`relay retire` is local and does not use the network. It retires an untouched quote, an exact native attempt proven to
have failed before any effect, or a token route whose only sent effect is a confirmed or verified-skipped approval (that
abandonment needs foreground consent; the approval stays on chain and the principal hold is released). It never retires
a signing marker, signed-but-unsent bytes or an unresolved send.

An allowance left on the Relay depository changes the next Ethereum USDC quote: when it already covers the amount,
Relay quotes the deposit alone. Ethereum USDC routes always send their own approval, so `relay prepare` refuses that
quote with `APN_OPERATION_BLOCKED`, reason `relay_existing_allowance`, and names `apn wallet allowance status` and
`apn wallet allowance revoke` for the exact chain, USDC and depository. After the revoke is final, the same prepare
command quotes the approval and the deposit again.

## Locks

Base native execution holds wallet custody outermost through consent, wallet reads, signing and the send response;
the wallet profile, allowlist profile, owner and operation locks follow the state store order. Signing and broadcast
claims are create-only and fsynced, so restoring an older journal cannot authorize another send.
