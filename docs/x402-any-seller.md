# x402 to any seller (EVM and Solana)

APN pays a seller's x402 `exact` offer from a local wallet on any EVM network and token the owner admitted, and on
Solana for an admitted classic SPL mint. The seller supplies only `payTo`, the amount and the resource. The network and
token must be admitted by the owner, and the token's identity is read from the chain at prepare. Nothing is inferred
from the seller's words alone.

Admissions made through an allowlist row (Permit2, Solana) can name only an asset of the frozen allowlist inventory. On
Solana that is USDC and USDT (`wallet capabilities-solana` lists them); wSOL is not in it.

Related pages: [offer selection](x402-offer-selection.md), [settlement fields](x402-settlement-compatibility.md),
[Permit2 requests](x402-non-usdc.md), [allowlist policy](allowlist-policy.md).

## Admission

| Lane | Commands | Owner admission |
| --- | --- | --- |
| Standard EVM x402 (EIP-3009, or Permit2 when the seller offers only that) | `x402 inspect`, `x402 fetch prepare/approve`; unattended, CLI and MCP | The profile x402 policy for the exact chain and token |
| Foreground Permit2 | `x402 permit2 approve` | The active allowlist row for that chain and token with the `x402` rail, its caps and the Permit2 mechanism pin |
| Solana `exact` | `x402 solana pay`; unattended, CLI and MCP | The profile x402 policy for the mint, plus the active allowlist row for the mint with the `x402` rail |

**Profile x402 policy.** Set it with `wallet policy set --chain eip155:<id> --asset <token>` and the policy limits
(`--max-balance-usdc-atomic`, `--max-x402-amount-atomic`). Creating or raising a policy needs the foreground terminal.
Caps are atomic units of that token.

- Without `--asset`, `--chain` means USDC on Base, Ethereum and Arbitrum. On any other chain the command refuses with
  `x402_asset_required`.
- Omitting `--chain` selects Base.
- Base USDC keeps its original policy record without a network field; every other chain and token has its own record.

**Allowlist row for Permit2.** The row names the chain and token with the `x402` rail, its caps and exactly this
mechanism pin:

```json
{ "provider": "x402-exact-permit2", "reference": "0x402085c248EeA27D92E8b30b2C58ed07f9E20001" }
```

The token symbol and decimals come from that row.

## What APN verifies

| Subject | Check |
| --- | --- |
| Network | Any `eip155:<positive id>`. The RPC's `eth_chainId` must equal it. |
| EIP-3009 token | At prepare, one batch pinned to one block: `DOMAIN_SEPARATOR` equals keccak of the EIP-712 domain built from the offer's `name` and `version`, the chain and the token; `authorizationState(payer, fresh nonce)` answers a canonical `false`; `decimals()` answers (and equals the offer's `extra.decimals` when declared); `balanceOf`. |
| Decimals | The token's on-chain `decimals()`, stored in the record (`tokenFacts.decimals`) for the abandon prompt. |
| Permit2 token | The allowlist row (chain, token, symbol, decimals, caps, mechanism pin), stored in the record (`material.asset`). |
| Permit2 contract | Canonical Permit2 at `0x000000000022D473030F116dDEE9F6B43aC78BA3`. With its two immutables (cached chain id, cached EIP-712 domain separator) zeroed, its runtime code must hash to the one canonical template; the immutables must equal this chain id and the recomputed Permit2 domain separator. |
| x402 exact Permit2 proxy | `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`, deployed with CREATE2: one runtime code hash on every chain, with no chain-specific immutables. |
| Token EIP-2612 domain | Needed only for a sponsored EIP-2612 permit: the seller's `name`/`version` hint must recompute the token's on-chain `DOMAIN_SEPARATOR` (a third pinned POST, made only then). Otherwise the existing allowance to Permit2 must cover the amount. |
| Stored records | Each record is checked against its own chain, network and token fields; its admitted chain is checked against `eth_chainId`. |

## RPC

`--rpc-url` is the explicit per-chain setting of every EVM x402 command. A missing one is refused naming the chain
(`x402_rpc_required`); one on the wrong chain is refused by `eth_chainId` (`APN_CHAIN_MISMATCH`, naming the chain). No
endpoint is substituted. Solana uses `APN_SOLANA_RPC_URL` ([below](#solana-exact-spl)).

## Proof tags and finality

The proof tag is decided by the chain's stack and frozen in the record (`tokenFacts.proofTag`). It is never taken from
what a node answers, and a read is never retried with another tag.

- **`safe`**: Ethereum 1 (justified checkpoint), Arbitrum One 42161 (Nitro, batch posted to L1), and OP Stack chains,
  where `safe` is derived from data posted to L1: OP 10, Base 8453, World Chain 480, Celo 42220, Unichain 130, Ink 57073,
  Soneium 1868, Mode 34443, Zora 7777777, Lisk 1135, Fraxtal 252, Metal L2 1750, Shape 360. OP Stack membership comes
  from the OP Superchain Registry (`ethereum-optimism/superchain-registry`), corroborated on chain (the L1Block
  `0x4200…0015` and GasPriceOracle `0x4200…000F` predeploys are present and `safe` is served behind `latest`).
- **`finalized`**: every other chain. This includes Polygon PoS (no `safe` tag: "safe block not found"), BNB,
  Avalanche, Monad and Sei (instant or fast finality), and chains with OP-style predeploys whose registry membership is
  not confirmed (BOB, Cyber, Orderly, MegaETH, Swellchain, Mint, Superseed).

Supporting another chain's tag is one list entry in `src/x402-network.ts`.

- **EIP-3009**: the prepare read and the settlement proof use the record's tag. Expiry is always a `finalized` proof.
  An authorization expires at `block.timestamp >= validBefore`.
- **Permit2**: settlement uses the same tag. Expiry needs `finalized` and a block strictly after the deadline, because
  Permit2 reverts only when `block.timestamp > deadline`; a block stamped exactly at the deadline can still settle.
- Permit2 pre-sign facts (balance, allowance, decimals, nonce word, Permit2 and proxy code) are read at the record's
  proof tag in unattended `x402 fetch`, like the EIP-3009 prepare read. The foreground `x402 permit2 approve` lane reads
  them at `latest`, pinned by block hash, under its 30-second block-age bound, and freezes its proof tag in the record.
  Either way these facts only predict settlement and cannot move money: the signature binds token, amount, payee,
  nonce and a deadline of at most 3,600 seconds ([payment window](x402-offer-selection.md#offer-terms-and-refusals)).

## Method choice (EVM)

The choice is deterministic, and an operation never changes method.

### `x402 fetch` (unattended)

- APN uses EIP-3009 when the seller offers it for the selected chain and token, otherwise Permit2 (local wallet only).
  The lowest-index offer of that method within the cap, the balance and the payee pin wins.
- Permit2 here has the same caps, overfunded-wallet guard, payee pin, usage reservation, idempotency, single send and
  recovery as EIP-3009. The frozen authorization is the witness transfer: a 32-byte random nonce (the Permit2 unordered
  nonce) and `validBefore` as the deadline.
- The wallet's existing allowance to Permit2 must cover the price, or the seller's declared EIP-2612 sponsorship pays
  it with an exact-amount permit whose name/version hint must recompute the token's on-chain `DOMAIN_SEPARATOR`.
- APN never sends an onchain approval to Permit2 unattended. The refusal `x402_permit2_allowance_required` names the
  owner's `x402 permit2 allowance set` command for that exact chain and token.
- Settlement is Permit2's nonce bit at the stack's tag; expiry is the bit still unused at `finalized` past the
  deadline.
- A seller-required payment identifier is refused, because the Permit2 wire format carries none. Every wire check runs
  before signing.

### `x402 permit2 approve` (foreground)

The foreground TTY lane under allowlist admission. It pays the lowest-index admitted Permit2 offer. See
[Permit2 requests](x402-non-usdc.md).

### `x402 permit2 allowance` (foreground)

```sh
apn x402 permit2 allowance set --profile <profile> --chain <caip2> --asset <token> --amount <atomic> \
  --rpc-url <https-rpc> --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> \
  --idempotency-key <key>
apn x402 permit2 allowance revoke --profile <profile> --chain <caip2> --asset <token> \
  --rpc-url <https-rpc> --max-gas-limit <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> \
  --idempotency-key <key>
apn x402 permit2 allowance observe --operation <operation-id> --rpc-url <https-rpc>
apn x402 permit2 allowance status --operation <operation-id>
```

- `set` and `revoke` run only in the foreground terminal; over MCP they return the handoff. Each is one owned operation
  (family `permit2_allowance`) that sends ERC-20 `approve(Permit2, amount)` from the local wallet. The amount is never
  unlimited.
- `set` requires the chain and token to be admitted by the owner's profile x402 policy (the amount is at most its wallet
  balance cap) or else by the allowlist Permit2 row (at most its x402 daily cap). `revoke` (amount zero) needs no
  admission.
- Gas caps are the owner's flags.
- Prepare reads one block (a nonce equal to the pending one, the allowance, the balance, the estimate) and freezes it.
  After consent the transaction is sealed, the send is marked, and it is sent once.
- `observe` completes the operation on a receipt at or below the chain's proof tag (canonical block, the token's
  `Approval` log, or the allowance read at that tag), or ends it `superseded` under the shared finalized never-lands rule
  with its proof. An unsigned preparation expires. The owner's abandon is the last exit.
- States: `prepared`, `signed`, `submitted`; terminal `completed`, `reverted`, `superseded`, `failed_before_effect`,
  `abandoned_unknown`.

## Solana `exact` (SPL)

### Commands

```sh
apn wallet policy set --profile <profile> --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp --asset <mint> \
  --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic>
apn x402 solana pay --profile <profile> --url <https-url> --asset <mint> --max-amount <atomic> --idempotency-key <key>
apn x402 solana observe --operation <operation-id>
apn x402 solana status --operation <operation-id>
```

The generic `operation status|resume|abandon` also work. The family is `x402_solana` and the store `x402-solana/`.
States: `prepared → reserving → signed → exposed → settled | failed_onchain | expired_unlanded | abandoned_unknown`, with
`failed_before_effect` reachable from every state before `exposed`.

### Owner rules

The same as unattended EVM x402:

- The owner's profile x402 policy for the mint, set with the command above (foreground terminal to create or raise). It
  is bound to the profile's local Solana wallet, with no ETH cap and no EVM payee pin.
- Its per-payment cap bounds the price. The wallet's balance of the mint must not exceed its balance cap at prepare and
  again on the fresh read before signing (`APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402`). A policy changed after prepare
  refuses.
- Per-mint admission is the active allowlist row `solana:<genesis>` + mint with the `x402` rail, its caps, the mechanism
  pin `x402-exact-svm` for the SPL Token program, and its optional `recipients` pin. The usage ledger reserves before
  signing.

### Offer rule

APN pays the lowest-index `exact` offer on `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` for the mint, within
`--max-amount`, the policy and the allowlist per-payment caps, with an admitted payee and a third-party
`extra.feePayer`. Mint decimals must equal the row's, read on chain. A Token-2022 mint, and a payee without an
associated token account, are refused by name.

### Transaction

The transaction follows the x402 SVM specification (Path 1) and is checked before signing, both decompiled and
byte-equal to a rebuild from the frozen terms:

- version 0, no lookup tables, signers exactly [fee payer, payer];
- `SetComputeUnitLimit` 20000 and `SetComputeUnitPrice` 1 micro-lamport (the reference client's values; the facilitator
  pays);
- one classic `TransferChecked` of the frozen amount and decimals to the payee's associated token account;
- one Memo (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, no accounts) holding the seller's `extra.memo` verbatim
  (1–256 UTF-8 bytes) or, when none is declared, a 16-byte random nonce in hex, as the specification requires.

The fee payer appears in no instruction. The memo is frozen in the record, so settlement, which compares the whole
message, checks it too. Extra fields the specification does not define (`reference`, `session`, `name`, …) put nothing
into the transaction; they reach the seller unchanged inside `accepted`.

### Native SOL

Native SOL is not this scheme. Wrapped-SOL offers with `extra.native` (a system-program lamport transfer, no facilitator
fee payer, the payer pays the fee) are refused by name (`x402_solana_native_sol_unsupported`): the specification pays
only an SPL or Token-2022 `TransferChecked` sponsored by the facilitator. A wSOL SPL offer with a fee payer would fit,
but the wSOL mint is not in the frozen allowlist inventory, so no owner can admit it.

### Execution

A fresh blockhash is bound (its height checked against it), the bytes are simulated, the owner cap is reserved, the
payer signs (fee-payer slot empty), and the exposure is recorded before the single paid request. A replay never sends
again.

A failure after the payment has a record (a seller HTTP error, a transport error, a malformed response after exposure,
or a refusal before it) keeps its own error and answers with the operation itself in `operation` (its id, state and
`exposed_at`, no signed bytes) and its next actions. The first next action is the no-send
`apn x402 solana observe --operation <id>`: after exposure the payment may have landed, and observe proves it.

EVM x402 answers the same way once its payment header is sent: the operation is in `effect_unknown` with
`operation.resume` and `operation.status`. A resume re-presents only the same signed authorization, once, while its
nonce reads unused.

### Settlement

The fee payer's signature is the transaction id and is unknown to APN in advance. The seller's PAYMENT-RESPONSE
`transaction` is only a hint. Otherwise APN opens the payer token account's finalized `getSignaturesForAddress` page
above the binding's floor slot. A candidate counts when `getSignatureStatuses` says `finalized` and `getTransaction` at
`finalized` shows exactly the frozen message, APN's payer signature, a verifying fee-payer signature and the exact token
balance changes (none on failure).

### Never lands

A payment is proven never to land when the finalized block height (read first) is above the blockhash's
`lastValidBlockHeight`, and the same signature page reaches a signature at or below the floor slot (the context slot of
the blockhash read; the transaction can only land later). The page then covers the whole window, and no entry in it is
this payment. Otherwise the payment waits. The owner's TTY abandon is the last exit and leaves the price charged.

### RPC

`APN_SOLANA_RPC_URL` only; the public default endpoint is never used for Solana x402. When it is missing, the refusal
names it (`x402_rpc_required`).

## Limits

- Allowlist admission (Permit2, Solana) is limited to assets in the frozen allowlist inventory; on Solana that is USDC
  and USDT.
- Token-2022 mints, native SOL and wSOL are not payable on Solana.
- Permit2 is available to the local wallet only.
- APN never sends an unattended approval to Permit2.

## Reason codes

| Reason | Meaning | What to do |
| --- | --- | --- |
| `x402_asset_required` | `--chain` without `--asset` on a chain other than Base, Ethereum or Arbitrum. | Name the token with `--asset`. |
| `x402_rpc_required` | No RPC for the chain (`--rpc-url`, or `APN_SOLANA_RPC_URL` on Solana). | Provide it. |
| `APN_CHAIN_MISMATCH` | The RPC serves another chain. | Use an endpoint of the selected chain. |
| `x402_permit2_allowance_required` | The allowance to Permit2 is too low and the seller offers no EIP-2612 sponsorship. | Run the `x402 permit2 allowance set` command the refusal names. |
| `APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402` | The wallet holds more of the token than the policy's balance cap. | Move funds out or raise the cap in the foreground. |
| `x402_solana_native_sol_unsupported` | The seller offers native SOL. | Not payable. |

Offer-level refusals (payment window, `extra` fields, resource URL) are listed in
[offer selection](x402-offer-selection.md#offer-terms-and-refusals).

## Compatibility

- Policies, records and hashes of the released pairs (USDC on Base, Ethereum and Arbitrum) keep their original shape.
- Permit2 records prepared before generic admission (Avalanche USDT) are still reconstructed from their stored asset
  row; that row admits nothing new.
- Foreground Permit2 records prepared by older versions keep `finalized` as their pre-sign read tag.
