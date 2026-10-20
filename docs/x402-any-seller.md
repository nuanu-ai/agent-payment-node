# x402 to any seller (EVM and Solana)

APN pays a seller's `exact` offer on any EVM network and token, and on Solana for any SPL mint, the owner admitted. The seller still supplies only
`payTo`, amount and resource; the network and token must be admitted by the owner, and the token's identity is read
from the chain at prepare. Nothing is inferred from the seller's words alone.

## Admission (unchanged in kind)

- Standard x402 (`x402 fetch`, EIP-3009, unattended): the owner's profile x402 policy per chain and token,
  `wallet policy set --chain eip155:<id> --asset <token>` (foreground TTY to create or raise). Caps stay atomic units
  of that token. Without `--asset`, `--chain` keeps its released meaning: USDC on Base, Ethereum and Arbitrum; on any
  other chain the command refuses (`x402_asset_required`). Base USDC keeps its original no-network policy record.
- Permit2 (`x402 permit2 approve`, foreground TTY): the active allowlist policy row for that chain and token with the
  x402 rail, its caps and the `x402-exact-permit2` mechanism pin. Token symbol and decimals come from that row.

## Pins removed and what verifies instead

| Pin removed | Replaced by |
|---|---|
| `x402-network.ts` table Base/Ethereum/Arbitrum -> USDC (gate of inspect, prepare, policy, RPC reads, every stored-record validator, custody signer) | Owner policy for the exact chain+token; at prepare one batch pinned to one block: `DOMAIN_SEPARATOR` equals keccak(EIP-712 domain of the offer's `name`/`version`, chain, token), `authorizationState(payer, fresh nonce)` answers a canonical `false`, `decimals()` answers (and equals the offer's `extra.decimals` if declared), `balanceOf`. Stored records are checked against their own chain/network/token fields. |
| `EVM_NETWORKS` enum on `--chain` for x402 and wallet policy | Any `eip155:<positive id>`; the RPC's `eth_chainId` must equal it. |
| `extra.decimals` must be 6 | On-chain `decimals()`; stored in the record (`tokenFacts.decimals`) for the abandon prompt. |
| Permit2 `X402_PERMIT2_ASSETS` (Avalanche USDT row) and `X402_PERMIT2_BLOCKED` (Ethereum USDT) | Allowlist row (chain, token, symbol, decimals, caps, mechanism pin), stored in the record (`material.asset`). The Avalanche row stays only to reconstruct records prepared before. |
| `PERMIT2_CODE_HASH` (Avalanche runtime) | Permit2 runtime code at `0x0000…8BA3` with its two immutables (cached chain id, cached EIP-712 domain separator) zeroed hashes to the one template hash seen on 10 chains, and the immutables equal this chain id and the recomputed Permit2 domain separator. |
| Per-asset proxy code hash | The x402 exact proxy at `0x4020…0001` has one runtime hash on every chain checked (CREATE2, no chain immutables). |
| Permit2 token domain pin (`TetherToken`/`1`) | Needed only for a sponsored EIP-2612 permit: the seller's `name`/`version` hint must recompute the token's on-chain `DOMAIN_SEPARATOR` (a third pinned POST, only then); otherwise the existing allowance must cover the amount. |
| Chain `43114`/`0xa86a` in Permit2 prepare, proxy-call, observer, conflict claim and the ledger's unsigned-cancel guard | The record's own admitted chain, checked against `eth_chainId`. |

## Finality and read tags

- The proof tag is decided by the chain's stack, frozen in the record (`tokenFacts.proofTag`), never taken from what a
  node answers and never retried with another tag. `safe`: Ethereum 1 (justified checkpoint), Arbitrum One 42161
  (Nitro, batch posted to L1) and OP Stack chains (`safe` = derived from data posted to L1, the rule APN already uses
  for Base): OP 10, Base 8453, World Chain 480, Celo 42220, Unichain 130, Ink 57073, Soneium 1868, Mode 34443,
  Zora 7777777, Lisk 1135, Fraxtal 252, Metal L2 1750, Shape 360. Source: the OP Superchain Registry
  (`ethereum-optimism/superchain-registry`) for the stack, corroborated on chain on 2026-10-20 (L1Block
  `0x4200…0015` and GasPriceOracle `0x4200…000F` predeploys present, `safe` served behind `latest`). Every other
  chain is `finalized`: Polygon PoS (no `safe`: "safe block not found"), BNB, Avalanche, Monad, Sei (instant or fast
  finality), and chains whose stack is not confirmed from the registry (BOB, Cyber, Orderly, MegaETH, Swellchain,
  Mint, Superseed: OP-style predeploys but registry membership unconfirmed here). Adding a chain is one list entry.
- EIP-3009: the prepare read and the settlement proof use that tag; expiry is always a `finalized` proof.
- Permit2: settlement uses the same tag, expiry `finalized` and a block strictly after the deadline (Permit2 reverts
  only when `block.timestamp > deadline`, so a block stamped at the deadline can still settle; EIP-3009 expires at
  `>= validBefore`). Pre-sign facts (balance, allowance, decimals, nonce word, Permit2 and proxy code) are read at the
  record's proof tag in unattended `x402 fetch`, like the EIP-3009 prepare read; the foreground `x402 permit2 approve`
  lane reads them at `latest`, pinned by block hash, under its 30 s block-age bound, and freezes its proof tag in the
  record (records from before 0.5.53 keep `finalized`). Either way they predict settlement and cannot move money (the
  signature binds token, amount, payee, nonce and a deadline of at most 3,600 s, the seller-window bound below).

## Method choice (deterministic)

- `x402 fetch` (unattended, CLI and MCP, profile x402 policy): EIP-3009 when the seller offers it for the selected
  chain+token, otherwise Permit2 (local wallet only); the lowest-index offer of that method within cap, balance and payee
  pin wins, and an operation never changes method. Permit2 here has the same caps, overfunded-wallet guard, payee pin,
  usage reservation, idempotency, single send and recovery as EIP-3009; the frozen authorization is the witness transfer
  (32-byte random nonce = Permit2 unordered nonce, `validBefore` = deadline). The wallet's existing allowance to Permit2
  must cover the price, or the seller's declared EIP-2612 sponsorship pays it with an exact-amount permit whose
  name/version hint must recompute the token's on-chain `DOMAIN_SEPARATOR`. APN never sends an on-chain approval to
  Permit2 unattended: the refusal `x402_permit2_allowance_required` names the owner's command for that exact chain and
  token (below). Settlement is Permit2's nonce bit
  at the stack's tag; expiry is the bit unused at `finalized` past the deadline. A seller-required payment identifier is
  refused (the Permit2 wire carries none); every wire check runs before signing.
- `x402 permit2 approve` stays the foreground TTY lane under allowlist admission (lowest-index admitted Permit2 offer).
- `x402 permit2 allowance set|revoke` (foreground TTY only; MCP returns the handoff): one owned operation (family
  `permit2_allowance`) that sends ERC-20 `approve(Permit2, amount)` from the local wallet, never unlimited. The chain and
  token must be admitted by the owner's profile x402 policy (the amount is at most its wallet balance cap) or else by the
  allowlist Permit2 row (at most its x402 daily cap); revoke (amount zero) needs no admission. Gas caps are the owner's
  flags (`--max-gas-limit`, `--max-fee-per-gas-wei`, `--max-priority-fee-per-gas-wei`). Prepare reads one block (nonce
  equal to the pending one, allowance, balance, estimate) and freezes it; after consent the transaction is sealed, the
  send is marked, then sent once. `observe` completes on a receipt at or below the chain's proof tag (canonical block,
  the token's Approval log or the allowance read at the tag), or ends it `superseded` on the shared finalized
  never-lands rule with its era proof; an unsigned preparation expires; the owner's abandon is the last exit.

## RPC

`--rpc-url` is the explicit per-chain setting of every x402 command; a missing one is refused naming the chain
(`x402_rpc_required`), a wrong one by `eth_chainId` (`APN_CHAIN_MISMATCH` naming the chain). No endpoint is
substituted.

## Solana `exact` (SPL)

- Commands: `x402 solana pay` (unattended, CLI and MCP, like `x402 fetch`), `x402 solana observe` and `status`, and the
  generic `operation status|resume|abandon`. Family `x402_solana`, store `x402-solana/`, states `prepared → reserving →
  signed → exposed → settled | failed_onchain | expired_unlanded | abandoned_unknown`, with `failed_before_effect` from
  every state before `exposed`.
- Owner rules, the same as EVM unattended x402: the owner's profile x402 policy for the mint, set by the same command
  and options (`wallet policy set --chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp --asset <mint>
  --max-balance-usdc-atomic <atomic> --max-x402-amount-atomic <atomic>`, foreground TTY to create or raise; bound to the
  profile's local Solana wallet; no ETH cap and no EVM payee pin). Its per-payment cap bounds the price, and the
  wallet's balance of the mint must not exceed its balance cap at prepare and again on the fresh read before signing
  (`APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402`); a policy changed after prepare refuses. Per-mint admission stays the
  active allowlist row `solana:<genesis>` + mint with the x402 rail, its caps and the mechanism pin `x402-exact-svm` /
  SPL Token program (and its optional recipient pin); the usage ledger reserves before signing.
- Offer rule: the lowest-index `exact` offer on `solana:5eykt4Us…` for the mint, within `--max-amount`, the policy and the
  allowlist per-payment caps, payee admitted, with a third-party `extra.feePayer`. Mint decimals must equal the row's,
  read on chain; a Token-2022 mint and a payee without its associated token account are refused by name.
- Transaction (x402 SVM spec, Path 1), checked before signing (decompiled, and byte-equal to a rebuild from the frozen
  terms): v0, no lookup tables, signers exactly [fee payer, payer], instructions SetComputeUnitLimit 20000,
  SetComputeUnitPrice 1 micro-lamport (the reference client's values; the facilitator pays), one classic
  `TransferChecked` of the frozen amount and decimals to the payee's ATA, and one Memo (`MemoSq4gqAB…`, no accounts)
  holding the seller's `extra.memo` verbatim (1-256 UTF-8 bytes) or, when none is declared, a 16-byte random nonce in
  hex, as the spec requires; the fee payer is in no instruction. The memo is frozen in the record, so settlement (which
  compares the whole message) checks it too. Extras the spec does not define (`reference`, `session`, `name`, …) put
  nothing into the transaction; they reach the seller unchanged inside `accepted`.
- Native SOL is not this scheme: wrapped-SOL offers with `extra.native` (a system-program lamport transfer, no
  facilitator fee payer, payer pays the fee) are refused by name (`x402_solana_native_sol_unsupported`); the spec pays
  only an SPL or Token-2022 `TransferChecked` sponsored by the facilitator. A wSOL SPL offer with a fee payer would fit,
  but the wSOL mint is not in the frozen allowlist inventory, so no owner can admit it yet.
- Execution: a fresh blockhash is bound (its height checked against it), the bytes simulated, the owner cap reserved,
  the payer signs (fee-payer slot empty) and the exposure is recorded before the single paid request. A replay never
  sends again. A failure once the payment has a record (a seller HTTP error, a transport error, a malformed response
  after exposure, or a refusal before it) keeps its own error and answers with the operation itself in `operation`
  (its id, state and `exposed_at`, no signed bytes) and its next actions, the first being the no-send
  `apn x402 solana observe --operation <id>`; after exposure the payment may have landed, and observe proves it.
  EVM x402 answers the same way after its header is sent: the operation in `effect_unknown` with `operation.resume`
  and `operation.status`; a resume re-presents only the same signed authorization, once, while its nonce reads unused.
- Settlement: the fee payer's signature is the transaction id, unknown to APN in advance. The seller's
  PAYMENT-RESPONSE `transaction` is only a hint; otherwise the payer token account's finalized `getSignaturesForAddress`
  page is opened above the binding's floor slot. A candidate counts when `getSignatureStatuses` says `finalized` and
  `getTransaction` at `finalized` shows exactly the frozen message, APN's payer signature, a verifying fee-payer
  signature and the exact token deltas (none on failure).
- Never lands: the finalized height (read first) is above the blockhash's `lastValidBlockHeight`, and the same index
  page reaches a signature at or below the floor slot (the context slot of the blockhash read; the transaction can only
  land later), so the index covers the whole window and no entry in it is this payment. Otherwise the payment waits;
  the owner's TTY abandon is the last exit and leaves the price charged.
- RPC: `APN_SOLANA_RPC_URL` only (never the public default); missing, the refusal names it (`x402_rpc_required`).
- Open: admission is limited to mints in the frozen allowlist inventory (USDC, USDT).
