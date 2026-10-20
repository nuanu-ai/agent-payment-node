# x402 to any seller (EVM)

APN pays a seller's `exact` offer on any EVM network and token the owner admitted. The seller still supplies only
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

- EIP-3009: proofs and the prepare read use `safe` on Base, Ethereum and Arbitrum (where released APN already proves
  at `safe`) and `finalized` on every other chain. The choice is frozen in the record (`tokenFacts.proofTag`); no tag
  is ever retried with another. Polygon PoS clients do not serve `safe` (answer: "safe block not found"), so the
  strongest tag is the only one that works there. Expiry stays a `finalized` proof everywhere. On slow-finality chains
  (OP Stack, other L2s) a `finalized` balance lags funding by up to ~20 min; proving at `safe` there is an owner
  decision (one entry in the safe-chain list), never a fallback.
- Permit2: pre-sign facts (balance, allowance, nonce word, payer code) are read at `latest`, pinned by block hash, so the
  existing 30 s block-age bound holds on every chain; they predict settlement and cannot move money (the signature
  binds token, amount, payee, nonce and a deadline of at most 300 s). Settlement and expiry stay `finalized` proofs.

## Method choice (deterministic)

The command is the method: `x402 fetch` pays only EIP-3009 offers (no `assetTransferMethod`, or `eip3009`), and
`x402 permit2 approve` pays only `permit2` offers, even for USDC. `x402 fetch` takes the lowest-index offer of the
selected chain+token within cap, balance and token domain; `x402 permit2 approve` takes the lowest-index Permit2 offer
on any owner-admitted chain+token (cap or balance then refuse, never skip). An operation never changes method. When the chosen asset is
offered only through Permit2, `x402 fetch` refuses with `x402_offer_permit2_only` and names the Permit2 command;
consent stays where it is (Permit2 is foreground TTY).

## RPC

`--rpc-url` is the explicit per-chain setting of every x402 command; a missing one is refused naming the chain
(`x402_rpc_required`), a wrong one by `eth_chainId` (`APN_CHAIN_MISMATCH` naming the chain). No endpoint is
substituted.

## Solana `exact` (not built here)

Needs: a Solana x402 operation family (index adapter, journal, terminal lists); custody signing of a v0 transaction
with the seller's facilitator as fee payer (`extra.feePayer`), exactly ComputeBudget + `TransferChecked` of the admitted
mint to the payee's ATA (no create-ATA by the payer); owner admission per mint from the allowlist; settlement by
`getSignatureStatuses` at `finalized`; never-lands by the frozen `lastValidBlockHeight` passed at `finalized` with the
signature unknown (R4 exit 2); explicit `APN_SOLANA_RPC_URL`.
