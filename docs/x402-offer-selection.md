# Standard x402 offer lists

APN accepts a nonempty, schema-valid x402 v2 offer list within its existing
64 KiB encoded / 48 KiB decoded header budget. There is no independent
16-offer limit. Unsupported networks and payment mechanisms may coexist with
a supported offer; selection retains the offer's original index and exact
requirements rather than rewriting the merchant challenge.

The selected offer still has to match the selected network and owner-admitted
asset, supported payment mechanism, on-chain token domain, timeout, balance and
explicit amount/policy caps ([any seller](x402-any-seller.md)). A larger list does
not enable unadmitted tokens, Gateway, credit bundles, SIWX or additional
wallet-provider capabilities.
Unknown optional extensions are not authorization to execute their protocols.

## Offer terms and refusals

The same rules judge an EVM `exact` offer in `x402 inspect`, `x402 fetch` (EIP-3009 and Permit2) and the
foreground Permit2 lane:

- Payment window: `maxTimeoutSeconds` from 30 (1 in the foreground Permit2 lane) through 3,600 seconds, one bound
  (`X402_OFFER_MAX_TIMEOUT_SECONDS`) for EIP-3009 and Permit2 alike. It becomes the authorization's `validBefore` or
  Permit2 `deadline`. In the public discovery catalog (71,406 `exact` offers, read 2026-10-21) 95.1% ask at most 300 s
  and 96.4% at most 3,600 s; the ~3.5% asking seven days are refused as `x402_offer_timeout_exceeds_bound`.
- `extra` keys APN understands are checked strictly: `assetTransferMethod` (absent, `eip3009`, `permit2`, `erc7710`;
  anything else is `x402_offer_method_unsupported`), `name` and `version` (required for EIP-3009, a pair for Permit2),
  `decimals` (must equal the token's own decimals, read on chain or USDC's 6 on the released pairs:
  `x402_token_decimals_mismatch`), Permit2 `spenderAddress` (exactly the x402 exact Permit2 proxy
  `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`, else `x402_offer_spender_mismatch`) and `chainId` (exactly the offer's
  chain, else `x402_offer_chain_mismatch`). Every other key (`signerAddress`, `x402PaymentConfigId`, `challengeId`, …)
  is the seller's own: never a reason to refuse, sent back unchanged in `accepted`. The seller's `resource` is echoed
  unchanged too (its `serviceName`, `tags`, …), for Permit2 as for EIP-3009. Solana offers follow the same rule for
  `feePayer` and `memo`.
- A refusal names the real reason per offer: `reason`, the deciding `field`, the seller's value (`sellerValue`) and
  what APN accepts (`accepted`), plus one line per refused offer of the selected chain and token (`refused`), in CLI
  and MCP alike. `x402_offer_asset_not_offered` means the seller offers that chain and token not at all;
  `x402_resource_url_mismatch` means the challenge names another resource URL than the one requested.

## Seller PAYMENT-RESPONSE

Several PAYMENT-RESPONSE (or `X-PAYMENT-RESPONSE`) copies count as one settlement hint only when every copy is
byte-identical. Copies that differ, a folded or padded value, bytes outside printable ASCII or an oversized value are
no hint at all. Either way the paid body is kept in the record (EVM x402 and Solana): settlement is proven on chain,
never by this header, and a body kept without a hint is never paid for again.

Durable records retain the selected index, exact requirement and existing
hashes. Every offer occupies bytes, so an index at or beyond the complete
decoded wire budget cannot have come from an accepted header and is rejected.
The byte bound replaces the unrelated16 ceiling without changing old record
schemas or fingerprints. The full seller offer list is not persisted;
the original index is metadata, not a substitute for protected requirement
and operation-integrity validation.

GET and absent, present-empty and nonempty POST requests retain their existing
frozen identity. Recovery reuses the same authorization, never a replacement.
Recovering a lost seller result also requires the merchant's supported
idempotent result-recovery contract; it cannot be inferred from arbitrary
extensions or application headers. Without that contract, APN may establish
settlement and honestly report an unavailable result instead of repaying.

The committed Quicknode21-offer fixture and synthetic late-index tests are
compatibility evidence, not a paid Quicknode purchase or live settlement on
Ethereum/Arbitrum. APN execution capabilities and live proof remain separate.
