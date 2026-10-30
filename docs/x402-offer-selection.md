# Standard x402 offer lists

A seller's x402 v2 `PAYMENT-REQUIRED` challenge lists one or more offers. This page describes which offers APN accepts,
how it picks one, and how it reports refusals.

## Offer lists

- APN accepts any nonempty, schema-valid x402 v2 offer list within the header budget: 64 KiB encoded and 48 KiB
  decoded. There is no separate limit on the number of offers.
- Unsupported networks and payment mechanisms may sit beside a supported offer. Selection keeps the offer's original
  index and exact requirements; the merchant challenge is never rewritten.
- The selected offer must still match the selected network and owner-admitted asset, a supported payment mechanism, the
  on-chain token domain, the timeout, the balance and the explicit amount and policy caps
  ([any seller](x402-any-seller.md)).
- A longer list does not enable unadmitted tokens, Gateway, credit bundles, SIWX or other wallet-provider capabilities.
  Unknown optional extensions are not authorization to run their protocols.

## Offer terms and refusals

The same rules judge an EVM `exact` offer in `x402 inspect`, `x402 fetch` (EIP-3009 and Permit2) and the foreground
Permit2 lane.

**Payment window.** `maxTimeoutSeconds` must be from 30 through 3,600 seconds, for EIP-3009 and Permit2 alike
(`X402_OFFER_MIN_TIMEOUT_SECONDS`, `X402_OFFER_MAX_TIMEOUT_SECONDS`). It becomes the authorization's `validBefore` or the
Permit2 `deadline`.

- Offers asking for more than 3,600 seconds (some ask for seven days) are refused as
  `x402_offer_timeout_exceeds_bound`.
- The 30-second floor is the time local wallet custody needs to sign, so every lane that signs through it applies the
  floor at selection, before any consent. `x402 inspect` and `x402 fetch` skip a shorter offer and move to the next one.
  The foreground Permit2 lane (its checked inspection, preflight and prepare) refuses its lowest-index admitted offer as
  `x402_offer_timeout_below_bound` instead of skipping it, because a saved Permit2 operation re-derives its offer by the
  same lowest-index rule.

**`extra` fields APN understands are checked strictly.**

| Field | Rule | Refusal |
| --- | --- | --- |
| `assetTransferMethod` | Absent, `eip3009`, `permit2` or `erc7710`. | `x402_offer_method_unsupported` |
| `name`, `version` | Required for EIP-3009; a pair for Permit2. | |
| `decimals` | Must equal the token's own decimals, read on chain (USDC's 6 on the Base, Ethereum and Arbitrum USDC pairs). | `x402_token_decimals_mismatch` |
| `spenderAddress` (Permit2) | Exactly the x402 exact Permit2 proxy `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`. | `x402_offer_spender_mismatch` |
| `chainId` | Exactly the offer's chain. | `x402_offer_chain_mismatch` |

Every other `extra` key (`signerAddress`, `x402PaymentConfigId`, `challengeId`, …) belongs to the seller: it is never a
reason to refuse and is sent back unchanged in `accepted`. The same holds outside `extra`: the fields APN understands
(`scheme`, `network`, `asset`, `amount`, `payTo`, `maxTimeoutSeconds`) are strict, while v1-style fields
(`maxAmountRequired`, `resource`, `description`, `mimeType`, `outputSchema`, …) are carried unchanged, for Permit2 as
for EIP-3009. The seller's `resource` object is echoed unchanged too (its `serviceName`, `tags`, …). Solana offers follow
the same rule for `feePayer` and `memo`.

**Resource.** The challenge's `resource.url` must name the requested endpoint: the same scheme, host, port and path
after WHATWG normalization. Query and fragment may differ, since most sellers name the resource without the caller's
query. The paid request goes to the requested URL. Another origin or path is refused as `x402_resource_url_mismatch`.
The foreground Permit2 lane uses the same rule.

**How refusals are reported.** A refusal names the real reason per offer: `reason`, the deciding `field`, the seller's
value (`sellerValue`) and what APN accepts (`accepted`), plus one line per refused offer of the selected chain and token
(`refused`), in CLI and MCP alike. `x402_offer_asset_not_offered` means the seller does not offer that chain and token
at all.

**Seller text is untrusted.** An agent reads refusals, so a refusal's `message` holds only APN's own words (the offer's
position, the selected network and token, the reason and field). Seller values appear only in the structured `details`,
and verbatim only when they match `^[A-Za-z0-9._:/-]{1,64}$`. Any other value (a URL with a query, text with spaces,
JSON) is shown as `length:<UTF-8 bytes> sha256:<hex>` of its text. Solana offer refusals follow the same rule.

## Seller PAYMENT-RESPONSE

Several `PAYMENT-RESPONSE` (or `X-PAYMENT-RESPONSE`) copies count as one settlement hint only when every copy is
byte-identical. Copies that differ, a folded or padded value, bytes outside printable ASCII or an oversized value are no
hint at all. Either way the paid body is kept in the record (EVM x402 and Solana). Settlement is proven on chain, never
by this header, and a body kept without a hint is never paid for again.

Accepted transaction fields are described in [settlement fields](x402-settlement-compatibility.md).

## Lanes with their own rules

- **Foreground `x402 permit2 approve`.** Its own transport holds an attempt whose `PAYMENT-RESPONSE` copies are
  duplicated or malformed until `observe` proves the outcome on chain. That lane never stores a seller body, so nothing
  is lost; identical copies are not taken as a hint there.
- **ERC-7710 (MetaMask Smart Account, Base USDC).** Settlement is proven only through the seller's transaction, so a body
  kept without a usable `PAYMENT-RESPONSE` ends through the delegated transfer-scan expiry proof or the owner's abandon,
  never as settled. The scan proves "unused" only when the authorization window holds no `Transfer` of the token from
  the wallet to the payee of any value. The delegation caps a cumulative amount, so a redemption of less than the price,
  or in two parts, keeps the operation unresolved (owner abandon keeps the hold).
- **Native Keychain agent** (`native/src/x402.rs`). It is not part of the CLI payment path: the npm CLI signs every x402
  payment through its own local wallet custody and never calls it. The agent keeps its own narrower bounds (Base
  EIP-3009 only, a window of 30–300 seconds).
- **Coinbase provider x402 (Base USDC).** It still needs exactly one eligible offer, and a candidate of any method counts.

## Records and recovery

- Durable records keep the selected index, the exact requirement and the existing hashes. The full seller offer list is
  not stored. The original index is metadata, not a substitute for validating the protected requirement and operation
  integrity.
- Every offer takes bytes, so an index at or beyond the decoded header budget cannot have come from an accepted header
  and is rejected.
- GET requests and absent, present-but-empty and nonempty POST bodies keep their frozen identity. Recovery reuses the
  same authorization, never a replacement.
- Recovering a lost seller result also needs the merchant's supported idempotent result-recovery contract; it cannot be
  inferred from arbitrary extensions or application headers. Without that contract, APN may establish settlement and
  report the result as unavailable rather than paying again.

## Compatibility

- Records written when APN limited offer lists to 16 entries keep their schemas and fingerprints; the byte bound
  replaced that limit.
- Foreground Permit2 records prepared earlier with a payment window shorter than 30 seconds still load.
