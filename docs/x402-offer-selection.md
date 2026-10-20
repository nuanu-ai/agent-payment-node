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

- Payment window: `maxTimeoutSeconds` from 30 through 3,600 seconds, one bound (`X402_OFFER_MIN_TIMEOUT_SECONDS`,
  `X402_OFFER_MAX_TIMEOUT_SECONDS`) for EIP-3009 and Permit2 alike. It becomes the authorization's `validBefore` or
  Permit2 `deadline`. In the public discovery catalog (71,406 `exact` offers, read 2026-10-21) 95.1% ask at most 300 s
  and 96.4% at most 3,600 s; the ~3.5% asking seven days are refused as `x402_offer_timeout_exceeds_bound`. The
  30 s floor is what local wallet custody needs to sign, so every lane that signs through it applies the floor at
  selection, before any consent: `x402 inspect` and `x402 fetch` skip a shorter offer to the next one, while the
  foreground Permit2 lane (its checked inspection, preflight and prepare) refuses its lowest-index admitted offer as
  `x402_offer_timeout_below_bound` rather than skipping it, because a saved Permit2 operation re-derives its offer by
  the same lowest-index rule (records prepared earlier with a shorter window still load).
- `extra` keys APN understands are checked strictly: `assetTransferMethod` (absent, `eip3009`, `permit2`, `erc7710`;
  anything else is `x402_offer_method_unsupported`), `name` and `version` (required for EIP-3009, a pair for Permit2),
  `decimals` (must equal the token's own decimals, read on chain or USDC's 6 on the released pairs:
  `x402_token_decimals_mismatch`), Permit2 `spenderAddress` (exactly the x402 exact Permit2 proxy
  `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`, else `x402_offer_spender_mismatch`) and `chainId` (exactly the offer's
  chain, else `x402_offer_chain_mismatch`). Every other key (`signerAddress`, `x402PaymentConfigId`, `challengeId`, …)
  is the seller's own: never a reason to refuse, sent back unchanged in `accepted`. The same holds for offer fields
  outside `extra`: the ones APN understands (`scheme`, `network`, `asset`, `amount`, `payTo`, `maxTimeoutSeconds`) are
  strict, while v1-style fields (`maxAmountRequired`, `resource`, `description`, `mimeType`, `outputSchema`, …) are
  carried unchanged, for Permit2 as for EIP-3009. The seller's `resource` is echoed unchanged too (its `serviceName`,
  `tags`, …). Solana offers follow the same rule for `feePayer` and `memo`.
- Resource: the challenge's `resource.url` must name the requested endpoint, the same scheme, host, port and path
  after WHATWG normalisation; query and fragment may differ (most sellers name the resource without the caller's
  query). The paid request goes to the requested URL, and the seller's `resource` is echoed unchanged. Another origin
  or path is refused as `x402_resource_url_mismatch`. The foreground Permit2 lane's checked challenge uses the same rule.
- A refusal names the real reason per offer: `reason`, the deciding `field`, the seller's value (`sellerValue`) and
  what APN accepts (`accepted`), plus one line per refused offer of the selected chain and token (`refused`), in CLI
  and MCP alike. `x402_offer_asset_not_offered` means the seller offers that chain and token not at all.
- Seller text is untrusted input an agent reads, so a refusal's `message` holds only APN's own words (the offer's
  place, the selected network and token, the reason and field). Seller values go only into structured `details`, and
  verbatim only when they match `^[A-Za-z0-9._:/-]{1,64}$`; any other value (a URL with a query, text with spaces,
  JSON) is shown as `length:<UTF-8 bytes> sha256:<hex>` of its text. Solana offer refusals follow the same rule.

## Seller PAYMENT-RESPONSE

Several PAYMENT-RESPONSE (or `X-PAYMENT-RESPONSE`) copies count as one settlement hint only when every copy is
byte-identical. Copies that differ, a folded or padded value, bytes outside printable ASCII or an oversized value are
no hint at all. Either way the paid body is kept in the record (EVM x402 and Solana): settlement is proven on chain,
never by this header, and a body kept without a hint is never paid for again.

## Lanes these rules leave as they are

- Foreground `x402 permit2 approve`: its own transport holds an attempt whose PAYMENT-RESPONSE copies are duplicated
  or malformed until `observe` proves the outcome on chain.
  That lane never stores a seller body, so nothing is lost; identical copies are not taken as a hint there.
- ERC-7710 (MetaMask Smart Account, Base USDC): settlement is proven only through the seller's transaction, so a
  body kept without a usable PAYMENT-RESPONSE ends through the delegated transfer-scan expiry proof or the owner's
  abandon, never as settled. The scan proves "unused" only when the authorization window holds no Transfer of the
  token from the wallet to the payee of any value: the delegation caps a cumulative amount, so a redemption of less
  than the price, or of two parts, keeps the operation unresolved (owner abandon keeps the hold).
- The native Keychain agent (`native/src/x402.rs`) is not part of the CLI payment path: the npm CLI signs every x402
  payment through its own local wallet custody and never calls it. The agent keeps its own older bounds (Base
  EIP-3009 only, a window of 30–300 s), which the bounds above do not change.
- Coinbase provider x402 (Base USDC): it still needs exactly one eligible offer, and any method's candidate counts.

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
