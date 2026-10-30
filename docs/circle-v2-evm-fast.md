# Circle V2 EVM Fast runtime

`apn circle evm` moves USDC from Arbitrum One to Sei, Linea or Monad with Circle CCTP V2 Fast (`depositForBurn` with
`minFinalityThreshold` 1000), for any local profile. A source wallet approves and burns USDC on Arbitrum; a destination
wallet submits the mint on the destination chain and pays its gas; the minted USDC goes to a beneficiary you name.

## Routes

The source is always Arbitrum One (chain 42161, CCTP domain 3) with native USDC
`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`. The CCTP V2 contracts have the same addresses on every chain:
TokenMessenger `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`, MessageTransmitter
`0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`, TokenMinter `0xfd78EE919681417d192449715b2594ab58f5D002`. See Circle's
[contract addresses](https://developers.circle.com/cctp/references/contract-addresses).

| Destination | Chain ID | CCTP domain | Destination USDC | Mint gas budget (native atomic units) | Gas billed on |
| --- | --- | --- | --- | --- | --- |
| Sei | 1329 | 16 | `0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392` | 50000000000000000 | gas used |
| Linea | 59144 | 11 | `0x176211869cA2b568f2A7D4EE941E073a821EE1ff` | 100000000000000 | gas used |
| Monad | 143 | 15 | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 100000000000000000 | full signed gas limit |

### RPC configuration

| Chain | Variable | Keyless default | Log window for external-mint scans |
| --- | --- | --- | --- |
| Arbitrum One (source) | `APN_ARBITRUM_RPC_URL` | `https://arbitrum-one-rpc.publicnode.com` | — |
| Sei | `APN_SEI_RPC_URL` | `https://evm-rpc.sei-apis.com` | 2,000 blocks |
| Linea | `APN_LINEA_RPC_URL` | `https://rpc.linea.build` | 10,000 blocks |
| Monad | `APN_MONAD_RPC_URL` | `https://rpc.monad.xyz` | 100 blocks |

An endpoint you set must accept the same log window. Linea defaults to `rpc.linea.build` because
`linea-rpc.publicnode.com` refuses transmitter logs older than about 128 blocks without a personal token.

## Requirements and owner policy

Admission is each profile's own active policy.

- **Source profile** (`--profile`): its policy must bind `accounts.evm` to the source wallet and admit Arbitrum USDC and
  Arbitrum native on the bridge rail, with caps and this mechanism (`<destination>` is the destination chain ID):

  ```json
  { "provider": "circle-cctp-v2", "reference": "circle-v2-evm-fast-42161-<destination>.v2" }
  ```

- **Destination profile** (`--destination-profile`): its policy must admit the destination native asset with the same
  mechanism, up to the route's mint gas budget.
- **Optional recipient pin.** A `recipients` pin on the source USDC admission must list the beneficiary. It is checked
  at prepare, at reservation, and at every confirmation before an effect (source approval, first burn, mint). Without a
  pin the policy does not restrict beneficiaries; the beneficiary is still shown on the consent screen and bound into the
  burn, the issuer message and the mint proof.
- **Sei gas.** Native Sei funding of the destination wallet must finish before mint preparation.

## Commands

```sh
apn circle evm prepare --profile <source-profile> --destination-profile <gas-profile> \
  --destination-chain <1329|59144|143> --idempotency-key <key> --beneficiary <address> \
  --gross-atomic <amount> --max-issuer-fee-atomic <cap> --min-mint-atomic <floor>
apn circle evm approve-source --operation <operation-id>
apn circle evm observe --operation <operation-id>
apn circle evm approve-mint --operation <operation-id>
apn circle evm status --operation <operation-id>
apn circle evm refresh-attestation --operation <operation-id>
apn circle evm cleanup --operation <operation-id>
apn circle evm adopt-external-mint --operation <operation-id> --transaction-hash <canonical-mint-hash>
```

Every `prepare` input is explicit and required; there is no default profile, beneficiary or amount.

- `--profile`: the source signer is this profile's custody wallet. It approves and burns `--gross-atomic` USDC on
  Arbitrum.
- `--destination-profile`: the mint signer and destination gas payer is this profile's custody wallet (it may be the
  same profile). It submits `receiveMessage` and pays the destination gas.
- `--beneficiary`: receives the minted USDC; it need not be a local wallet.
- Amounts are positive integer atomic USDC. `--max-issuer-fee-atomic` must be below `--gross-atomic`, and
  `--min-mint-atomic` at most gross minus that cap. Prepare reads Circle's current Fast fee rate; the quoted issuer fee
  (rounded up) must fit `--max-issuer-fee-atomic` and leave at least `--min-mint-atomic`, otherwise it refuses
  (`funding_fee_cap_or_net_floor`).
- `--idempotency-key`: 8 to 128 safe ASCII characters, in the global payment key space.

`approve-source`, `approve-mint` and `cleanup` need foreground physical TTY consent; the consent screen shows both
profiles and wallets, the beneficiary, gross, maximum issuer fee, minimum net mint, the native gas capacities and the
exact effects. MCP exposes `prepare`, `observe`, `status`, `refresh-attestation` and `adopt-external-mint` directly and
returns a CLI handoff for the consent commands.

## Lifecycle

1. `prepare` freezes the route, both profiles, the policies, the amounts and the fee quote. Source signing expires 15
   minutes after preparation (`source_signing_expires_at`); this is also the route's expiry.
2. `approve-source` signs and sends the exact bounded USDC approval and the burn, each at most once.
3. `observe` follows the source transactions, Circle's attestation and source finality.
4. `approve-mint` mints the issuer-verified burn nonce once, from the destination wallet. If someone else already
   minted the message, it is adopted instead, with no consent and nothing signed.
5. `observe` proves destination finality and closes the operation.

`next_actions` names the step the route waits for:

| Next action | When |
| --- | --- |
| `approve-source` | The approval or burn is not signed yet (also after a confirmed approval). `cleanup` is listed beside it, because `approve-source` refuses unsigned effects after `source_signing_expires_at`. |
| `observe` | An effect may be on chain, or the attestation or finality is pending. |
| `approve-mint` | The burn and the issuer attestation are verified and no owned mint is on its way. |
| `cleanup` | The operation is in `cleanup_required`. |

`actual_economics` reports what the receipts proved: the burned gross from the burn's `DepositForBurn`, and the
credited net and issuer fee from the mint (owned or adopted external), each null until proven. `amount_atomic`,
`minimum_output_atomic` and `maximum_issuer_fee_atomic` stay the caps.

States: `awaiting_source`, `source_unknown`, `awaiting_mint`, `mint_unknown`, `awaiting_finality` and
`cleanup_required` are non-terminal; `completed`, `cleaned`, `cancelled_unsubmitted`, `nonce_retired`,
`external_fulfilled` and `abandoned_unknown` are terminal.

## Usage reservations

Shared asset usage reserves the gross USDC; on Arbitrum 30000000000000 wei for the approval, 30000000000000 wei for the
burn and 15000000000000 wei for an optional cleanup (at most 75000000000000 wei per route); and the destination native
ceiling. Finalized usage conservatively counts the approved approval, burn and destination caps; an unused cleanup
reserve counts 0. Receipt proofs keep the actual approval and burn fees separately. Monad actual fees use the full
billed gas limit.

## Proof of completion

Success requires fresh independent observations of source finality (`finalized`) and destination canonical inclusion
(`safe`), a bound nonce and zero residual allowance. Issuer signatures may authorize the mint while source finality is
still pending.

**Residual allowance.** It is proven at the burn block from receipts, not read at `latest`: the confirmed approval at
nonce n set the allowance to exactly the burn amount (its `Approval` event) and the burn at nonce n+1 moved that amount
(its `DepositForBurn` event). A later, unrelated approval from the same wallet therefore cannot block the operation.

**Destination mint.** The proof decodes the pinned V2 `MintAndWithdraw` event with net amount and `feeCollected`. A
positive issuer fee requires exactly two zero-origin USDC transfers before the aggregate event: the net mint to the
recipient, then the fee mint of exactly `feeCollected` to a nonzero address. Who receives Circle's fee is not part of
the operation, so it is not checked. A zero fee requires the same V2 event and exactly one principal transfer.

**Expired attestation.** Use read-only `refresh-attestation --operation <id>` for the same burn and nonce before any
mint mark. There is no reburn and no fallback.

## Recovery

Signing and broadcast have separate durable marks. A crash after a mark, or a lost RPC response, keeps all holds;
nothing is signed again.

**Lost broadcast answer.** A mint or approve-zero cleanup whose broadcast answer was lost is checked on each `observe`,
`approve-mint` or `cleanup`. If the node knows neither its transaction nor a receipt and the signer's latest nonce has
not passed the effect's nonce, the identical sealed bytes are sent again, once per command (same hash and nonce, so at
most one inclusion), and only after the command read MessageTransmitter `usedNonces` as 0.

**Nonce taken by another transaction.** If the finalized nonce has passed the effect's nonce while a node whose
transaction index reaches the envelope's era block (the latest block read while freezing the envelope, bound into its
hash) knows neither its transaction nor a receipt, another transaction took the nonce and the effect is
`abandoned_unsent`. `approve-mint` then freezes a fresh mint envelope under fresh foreground consent while `usedNonces`
is still 0; `cleanup` re-arms the approve-zero at the next nonce. A used issuer message means someone else minted it
(see below).

**Undecidable effects.** A possibly-sent effect that no proof decides (an envelope frozen before era blocks were
recorded, or only pruned nodes available) takes the owner's exit: past the route's expiry,
`apn operation abandon --operation <id>` asks for TTY consent and ends the route `abandoned_unknown`. Nothing is signed
or sent, and every usage hold stays charged.

**Cleanup.** `cleanup --operation <id>` is an explicit zero-allowance recovery after an approval without a burn attempt,
or after a canonical finalized source revert. A wholly unsubmitted operation can be cancelled only after checking zero
allowance and the absence of every encrypted effect material. Ambiguous effects cannot be cancelled. A reverted
destination mint stays held for observation; there is no automatic retry.

**Holds.** Frozen custody, encrypted private material, common owner locks, operation enumeration and idempotency bind
both signing profiles. A canonically included burn with consumed allowance may free its source nonce domain for the
next Circle route only after an independent canonical recheck and latest nonce advancement; other rails keep the source
hold. Budget holds and destination conflicts remain until closure. The Circle signing domains are Arbitrum, Sei, Linea
and Monad; the standalone Ethereum/Optimism, TRON and Solana rails do not overlap them.

### Someone else relayed the mint

The burn's `destinationCaller` is zero, so any relayer may submit the issuer message on the destination, and public
relayers usually do within seconds of a Fast burn. When the message's `usedNonces` is nonzero and no owned mint landed,
`observe`, `approve-mint` and every command that observes first settle it without signing, consent or sending:

1. An owned mint that never left this node (unsigned, signed without saved bytes, sealed but never past its submission
   fence), or whose possibly sent transaction the node does not know (neither the transaction nor a receipt), can only
   revert. It becomes `abandoned_unsent` with the journal reason `mint_closed_issuer_message_used_externally`, and its
   signed bytes are discarded. An owned transaction the node knows keeps being observed and is never adopted over.
2. Once the burn is canonically finalized on Arbitrum, the command reads the burn block's header for its time and scans
   MessageTransmitter `MessageReceived` logs filtered by the message nonce, from the destination block stamped 60
   seconds before the burn up to the latest head. It reads headers and logs only: the start block is found from headers,
   and each `eth_getLogs` covers at most the route's log window. The read plan is 1 identity, 1 head, at most 32 headers
   and at most 64 log windows, each retried once on a transient failure, on its own budget.
3. A found transaction is adopted in the same command through `adopt-external-mint` after the command's locks are
   released: the operation ends `external_fulfilled` with usage finalized. While the destination safe head has not
   reached it, the command reports it found and the next observation adopts it.

The command output carries `external_mint` with `status` (`awaiting_source_finality`, `found_awaiting_finality`,
`adopted` or `not_found`), the destination chain, the transmitter, the message nonce, the transaction hash and the
scanned block range. When the bounded scan does not find the transaction (a relay later than 64 windows after the
burn), the operation is otherwise unchanged and the next action is
`apn circle evm adopt-external-mint --operation <operation-id> --transaction-hash <transaction-hash>`, with the
transaction found from those details.

### Adopt a public external mint

`apn circle evm adopt-external-mint --operation <operation-id> --transaction-hash <canonical-mint-hash>` settles an
operation from public proof that a third party minted its burn. It cannot sign, estimate, broadcast, open financial
consent or renew a policy. A mint whose caller is controlled by any local APN wallet or provider profile is refused;
the owned mint path still requires its exact owner caller.

**What it verifies.** Freshly finalized source approval and burn; the safe destination receipt and canonical signed
transaction; the exact issuer message and attestation bytes in the transaction (verified against the attester set when
frozen, and by the transmitter on chain when it accepted them); the transmitter's `MessageReceived` with this nonce,
source domain, sender and body; the current deployment configuration; the consumed nonce; zero residual allowance; and
the exact USDC credit in the canonical receipt for the operation's recipient, gross amount, issuer fee and minimum
output. Later spending by the recipient does not invalidate that credit; neither current balance coverage nor an
archive balance query is needed.

**Reads.** The explicit transaction, its receipt and block headers, the functional deployment configuration at both
latest heads and `usedNonces` at the latest head, under a shared budget of 160 requests, 120 seconds and four concurrent
requests. No state at an old block and no contract code is read, so a pruned keyless node can serve it.

**Preconditions.** Every owned mint and cleanup material, SIGN claim and SEND claim must be absent, including when an
owned mint envelope was never created. The one exception is an owned attempt that can never mint (`abandoned_unsent`:
its nonce was taken, or its issuer message was used while the node knew neither its transaction nor a receipt, or a
fresh envelope re-armed after it and not signed since): its permanent claims stay, but its signed bytes must be gone.
Conflicting proofs and any prior owned SIGN or SEND entry fail closed.

**Result.** Adoption keeps the frozen purpose, profiles and gas-owner identity, fingerprint, policies and expiry. It
grants no new financial authority and needs no policy renewal or signing consent. Source principal and approval/burn
caps stay conservatively used; only the proven never-entered owned cleanup and mint holds become
`released_unsubmitted`. The external caller's receipt fee is reported separately and is not charged to the destination
profile. The terminal state is `external_fulfilled`, with a permanent operation, message and nonce tombstone that keeps
a restored journal from entering an owned mint or cleanup. Create-only operation, nonce and source-message claims
prevent duplicate adoption, and an interrupted settlement resumes idempotently. A matching, conflicting or malformed
public claim blocks the owned mint before consent, estimation or custody, including after an old journal is restored.

## Native Arbitrum ETH while a Circle mint completes

A direct native Arbitrum transfer from a wallet with an unresolved Circle operation normally waits for it. Once that
operation's source burn is canonically finalized (approval and burn confirmed, zero residual allowance), it never signs
on Arbitrum again: cleanup and nonce retirement need an unburned source, and the mint is on the destination chain. A
native transfer to the custody wallet of any local profile then proceeds without waiting; any other recipient still
waits until the Circle operation is terminal.

## Compatibility

Operations written in the earlier fixed v1 schema (`apn.circle-v2-evm-operation.v1`, one fixed amount to one fixed
recipient, written by APN 0.5.40 to 0.5.42) are read-only; no v1 operation can be prepared and the v1 executing runtime
is removed.

- A v1 journal answers `status`, `operation status` and `receipt get`, and `observe` once it is terminal (returned as
  stored). Every effect command (`approve-source`, `approve-mint`, `refresh-attestation`, `cleanup`,
  `adopt-external-mint`) refuses it. The v1 `cleanup-nonce` command and v1 external adoption no longer exist.
- Records are validated against their own stored binding hash and their own custody records, never against code
  constants, so every v1 journal keeps loading.
- v1 operations keep their `circle-v2-evm-fast-42161-<destination>.v1` mechanism reference and their held usage rows,
  which still count against caps.
- Files that only the removed v1 runtime read (nonce-retirement intent, authority and claims, v1 external claims and
  evidence) are left on disk and no longer read.
