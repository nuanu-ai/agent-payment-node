# x402 in non-USDC list assets

Sprint Card 2 asks for x402 payments in list assets, not only USDC. APN's x402 path pays USDC only, through the
EIP-3009 `exact` scheme. The list's non-USDC tokens are USDT on Ethereum (`0xdAC17F958D2ee523a2206206994597C13D831ec7`)
and USDT on Avalanche C-Chain (`0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7`). This document records what the x402
ecosystem supports for them today, which parts APN now implements, and what is still open.

All evidence was collected on 2026-09-18 between 07:35 and 07:54 UTC. It used keyless GETs, read-only JSON-RPC calls
and facilitator `/verify` calls. No `/settle` call was made. The rehearsal keys were ephemeral, lived only in
memory and never held funds. Raw requests and responses are in `docs/evidence/x402-non-usdc-2026-09-18/`.

## Verdict

| Asset | Keyless x402 path | Why |
| --- | --- | --- |
| USDT, Avalanche (`eip155:43114`) | **Yes**: `exact` scheme, `assetTransferMethod: "permit2"`, optional `eip2612GasSponsoring`, PayAI facilitator | The token has an EIP-2612 `permit`. The x402 exact Permit2 proxy is deployed. PayAI advertises `exact` v2 on `eip155:43114` and verifies Permit2 payloads without a key. |
| USDT, Ethereum (`eip155:1`) | **No (blocked)** | No keyless facilitator settles `eip155:1`: PayAI answers `invalid_network`, x402.org lists only EVM testnets, and Coinbase CDP needs an API key. The token also has no EIP-2612 or EIP-3009, so the payer would first have to send an ETH-paid `approve` to Permit2. |
| Native coins (ETH, AVAX, …) | **No (blocked)** | No x402 EVM scheme moves native coins. `exact` supports only `eip3009` and `permit2`, which are both ERC-20 flows. `upto`, `batch-settlement` and `auth-capture` in `@x402/evm` 2.23.0 are ERC-20 flows too. |

## Evidence

### Installed packages (`@x402/evm` 2.23.0, `@x402/core` 2.23.0)

- `exact` routes on `requirements.extra.assetTransferMethod` (`"eip3009"` by default, or `"permit2"`). The type comment
  describes Permit2 as the "universal fallback for any ERC-20".
- The Permit2 payload is `{ signature, permit2Authorization: { from, permitted: { token, amount }, spender, nonce, deadline,
  witness: { to, validAfter } } }`. It is a `PermitWitnessTransferFrom` under the domain `{ name: "Permit2", chainId,
  verifyingContract: 0x000000000022D473030F116dDEE9F6B43aC78BA3 }`. The spender is the exact proxy
  `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`.
- Permit2 needs a token allowance. There are three ways to provide it: a payer-sent `approve(Permit2)`; the
  `eip2612GasSponsoring` extension (the payer signs an EIP-2612 permit and the facilitator calls `settleWithPermit`);
  or `erc20ApprovalGasSponsoring` (the payer signs a raw approve transaction and the facilitator broadcasts it).
- The reference facilitator's `verifyPermit2` checks, in order: the scheme and network, that the asset has code,
  the spender equals the proxy, the recipient equals `payTo`, deadline ≥ now+6, validAfter ≤ now, the exact amount
  and token, the Permit2 signature, and then a `settle`/`settleWithPermit` simulation.

### Facilitator `/supported` (keyless GET)

| Facilitator | Result |
| --- | --- |
| `https://facilitator.payai.network/supported` | HTTP 200. `exact` v2 on `eip155:8453, 84532, 43114, 43113, 1329, 713715, 137, 80002, 196, 1952, 1187947933, 324705682, 42161, 421614`, but **not `eip155:1`**. Extensions: `bazaar`, `eip2612GasSponsoring`, `erc20ApprovalGasSponsoring`. 15 EVM signers. |
| `https://x402.org/facilitator/supported` | HTTP 200. The only EVM kinds are on `eip155:84532` (Base Sepolia: `exact`, `upto`, `batch-settlement`). No EVM mainnet. |
| `https://api.cdp.coinbase.com/platform/v2/x402/supported` | Not reached. The local resolver returned a content-filter sinkhole (`lamanlabuh.aduankonten.id`). Coinbase's hosted facilitator authenticates verify and settle with CDP API keys. Its client package, `@coinbase/x402`, is not installed here. Either way CDP is out under the keyless directive. |

### Chain state (read-only `eth_getCode` / `eth_call`)

| Probe | Ethereum | Avalanche |
| --- | --- | --- |
| Permit2 code | 9152 bytes | 9152 bytes |
| Exact Permit2 proxy code | 2913 bytes, keccak `0xce6429c0…048b9` | 2913 bytes, same keccak |
| `proxy.PERMIT2()` | canonical Permit2 | canonical Permit2 |
| USDT `name()` | `Tether USD` | `TetherToken` |
| USDT `DOMAIN_SEPARATOR()` / `nonces()` | revert / revert | `0xf6d4d20b…6cc0f4` / `0` |
| USDT `permit` selector `0xd505accf` | absent | present (implementation `0xba2a995b…f75a6`) |
| USDT EIP-3009 selectors | absent | absent |

Recomputing the Avalanche separator proves the EIP-2612 domain is `{ name: "TetherToken", version: "1", chainId: 43114 }`.

The proxy is also in production use. A live Base mainnet transaction,
`0xb882d8d3bc4add6e20fc13df3654f546de6094eb98436eb44528e87f5f6a6e51` (block 51452270), calls the proxy's
`settleWithPermit` (selector `0xfa340378`) for the SBC token. Its receipt carries two token `Approval` logs, exactly
one `Transfer` and exactly one proxy `SettledWithPermit()`. APN's settlement proof expects exactly this layout. The
receipt is committed as the fixture `tests/fixtures/x402-permit2/base-settle-with-permit-live.json`. The same scan
found no proxy settlement in the most recent ~20k Avalanche blocks or ~10k Ethereum blocks.

### `/verify` rehearsals (ephemeral unfunded keys, amount 1 atomic unit)

| Request | Response |
| --- | --- |
| Avalanche USDT, Permit2 payload | `200 {"isValid":false,"invalidReason":"permit2_insufficient_balance"}` |
| Avalanche USDT, Permit2 plus `eip2612GasSponsoring` | `200 {"isValid":false,"invalidReason":"permit2_insufficient_balance"}` |
| Avalanche USDT, tampered Permit2 signature | `200 {"isValid":false,"invalidReason":"invalid_permit2_signature"}` |
| Ethereum USDT, Permit2 payload | `400 {"isValid":false,"invalidReason":"invalid_network","invalidMessage":"Unsupported network: eip155:1"}` |
| Avalanche, payloads built by APN's new modules (with and without the permit) | `200 … "permit2_insufficient_balance"` for both |

The tampered case shows that PayAI really verifies the Permit2 witness signature. The untampered cases pass every
static check and the signature check, and then stop at the settle simulation only because the payer holds no USDT.
That is the furthest point reachable without funds. Settlement itself is unproven, and it stays an owner-only live act.

## What this change implements (`src/x402-permit2/`)

- `registry.ts` pins Permit2, the exact proxy, the owner mechanism pin `{ provider: "x402-exact-permit2", reference:
  <proxy> }`, the maximum seller timeout (300 s), and one admitted asset: Avalanche USDT with its proven token domain,
  separator and proxy code hash. Ethereum USDT is listed as blocked, with a precise refusal reason.
- `offer.ts` implements `selectPermit2Offer`. It selects the first seller offer that pays a list-pinned token on a
  list network through `exact` and `permit2`, and keeps the original index and exact requirement. It refuses any
  unknown field, any other transfer method, a mismatched `name`/`version`, a bad checksum, a zero or non-canonical
  amount, a timeout outside 1–300 s, and a payee that is the payer, the token, Permit2 or the proxy.
- `authorization.ts` plans the payment. The plan has one Permit2 witness transfer (spender = proxy, witness.to =
  payee, validAfter 0, deadline = now + seller timeout, a 256-bit random nonce). An EIP-2612 permit for exactly the
  amount is added only when the observed Permit2 allowance is short and the seller advertised
  `eip2612GasSponsoring`; otherwise the plan refuses with `x402_permit2_allowance_required`. Every signature must
  recover to the frozen payer before the x402 v2 payload is assembled. Signing goes through a `Permit2SignerPort`;
  this module holds no key material.
- `policy.ts` provides `X402Permit2AllowlistGate`, the owner allowlist gate for rail `x402`. It requires an
  owner-activated policy, the owner's EVM account, a frozen-list token, an admission on `x402`, the exact Permit2
  mechanism pin, the per-rail per-operation cap and the shared daily cap. It reserves usage in the common
  `AssetUsageLedger`, replays idempotently, and follows the operation forward (submitted, finalized,
  unknown_finality, or failed_before_effect before exposure).
- `approval.ts` builds the foreground screen. The screen shows the payee, amount, proxy, Permit2 permit bound,
  deadline and policy caps, and binds them into one fingerprint and a six-character code. `TtyPermit2Approval` needs
  a real terminal and the exact code.
- `settlement.ts` proves settlement from a successful receipt. The receipt must carry exactly one pinned-token
  `Transfer(payer → payee, amount)` and exactly one proxy `Settled()` or `SettledWithPermit()` matching the signed
  path. It also provides the read-only Permit2 `nonceBitmap` call and a consumed-bit check for recovery.

Tests: `tests/core/x402-permit2.test.ts`, `x402-permit2-policy.test.ts` and `x402-permit2-reference.test.ts`, with
fixtures in `tests/fixtures/x402-permit2/`. The reference test runs APN's payload through the `@x402/evm` reference
facilitator `ExactEvmScheme.verify` with offline chain reads, and checks both `settle` and `settleWithPermit`. It
also runs the settlement proof against the live Base `settleWithPermit` receipt above.

## Not done yet (smallest viable completion)

Nothing in this change is reachable from the CLI or MCP. No path can sign or send a payment yet.

1. **Custody.** Add a local Permit2 signer next to `facilitator-gasless/custody.ts`. It needs a reviewed
   `signTypedData` exception in `scripts/core-forbidden-surface.mjs`. The signer must accept only these two typed-data
   shapes.
2. **Service and journal.** Add a Permit2 x402 operation, with its own journal like `facilitator-gasless`, rather
   than bending the EIP-3009 state machine. The order is: decode the 402 with `x402-codec.ts`, select, admit, read
   (balance, allowance, `nonces`, proxy code hash, token separator, finalized block), plan, show the screen, reserve,
   sign, send the paid request once, verify the PAYMENT-RESPONSE transaction on a finalized block, and follow the
   ledger to `finalized`.
3. **Recovery.** If the response is lost, read the nonce bitmap. A consumed nonce means finding the Transfer receipt
   inside the deadline window. An unconsumed nonce after the deadline on a finalized block means the authorization
   expired unused. The ledger mapping for "expired after exposure" must be decided with the owner.
4. **Network admission.** x402 `eip155:43114` is separate from `EVM_NETWORKS` (`src/evm-asset.ts`), which the
   direct-EVM work owns. The Permit2 path keys on its own registry, so it does not need that list.
5. **Live acceptance (owner only).** One funded Avalanche USDT payment to a seller that offers `exact`/`permit2`
   through PayAI, with the facilitator response and independent on-chain settlement recorded. No such seller is
   known yet. A seller-side rehearsal would need a merchant that advertises this offer.
6. **Ethereum USDT.** This stays blocked until a keyless facilitator supports `eip155:1`. Even then, the payer would
   need an ETH-paid Permit2 approval (a direct-EVM effect) or an `erc20ApprovalGasSponsoring` facilitator on that
   network.
